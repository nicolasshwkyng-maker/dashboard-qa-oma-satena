/**
 * js/matching.js — Motor de cruce: cronograma <-> evidencia
 * ============================================================================
 * Este es el módulo más delicado de la app: relaciona tres fuentes que NO
 * comparten un identificador común (cada Excel usa su propia numeración de
 * ID, y las carpetas de evidencia se llaman distinto a como aparece el
 * auditado en el cronograma).
 *
 * Estrategia de vinculación, en orden de prioridad:
 *   1. Overrides manuales (data.js) — siempre ganan, son casos verificados.
 *   2. Reglas por palabra clave para "Áreas y Talleres Internos".
 *   3. Emparejamiento por fecha más cercana para "Inspección" (no tiene
 *      nombre de entidad, solo fecha + base).
 *   4. Similitud difusa de texto (nombre auditado vs. nombre de carpeta)
 *      para el resto de categorías (OMA, OMA-Exterior, Proveedores,
 *      Laboratorios, CIAC, Mantenimiento ETAA, Aumento de Capacidades).
 *
 * Ninguna estrategia automática es perfecta con nombres comerciales reales
 * (siglas, marcas, error de tipeo). Lo que NO logra vincularse con
 * confianza suficiente (QA.config.MATCH_CONFIDENCE_THRESHOLD) se deja
 * visible en el panel de diagnóstico en vez de adivinar — así el equipo QA
 * lo revisa y, si hace falta, agrega un override en data.js.
 */

window.QA = window.QA || {};

QA.matching = (function () {
  const u = QA.utils;
  const cfg = QA.config;

  /* ------------------------------------------------------------------ *
   * Clasificación: texto crudo -> categoría canónica
   * ------------------------------------------------------------------ */
  function resolveCategory(rawText) {
    const norm = u.normalize(rawText);
    if (cfg.CLASSIFICATION_EXACT_MAP[norm]) return cfg.CLASSIFICATION_EXACT_MAP[norm];
    for (const rule of cfg.CLASSIFICATION_KEYWORD_RULES) {
      if (norm.includes(u.normalize(rule.contains))) return rule.category;
    }
    return null; // sin categoría reconocida -> quedará "Sin clasificar" en diagnósticos
  }

  const TIPO_LABEL_BY_CATEGORY = {
    OMA: "OMA", OMA_EXT: "OMA Exterior", PROVEEDOR: "Proveedor",
    AREA_INTERNA: "Área Interna", LABORATORIO_CALIBRACION: "Laboratorio de Calibración",
    MANTENIMIENTO_ETAA: "Mantenimiento ETAA", AUMENTO_CAPACIDADES: "Aumento de Capacidades",
    CIAC: "CIAC", INSPECCION: "Inspección",
  };

  // Clasificación "amplia" pedida en los requisitos (Proveedor / Área
  // interna / Inspección): agrupa las 9 categorías canónicas (más finas,
  // usadas para el filtro "Clasificación") en solo 3 grandes grupos.
  const TIPO_AMPLIO_BY_CATEGORY = {
    OMA: "Proveedor", OMA_EXT: "Proveedor", PROVEEDOR: "Proveedor",
    LABORATORIO_CALIBRACION: "Proveedor", MANTENIMIENTO_ETAA: "Proveedor", CIAC: "Proveedor",
    AREA_INTERNA: "Área Interna", AUMENTO_CAPACIDADES: "Área Interna",
    INSPECCION: "Inspección",
  };

  /* ------------------------------------------------------------------ *
   * Punto de entrada principal
   * ------------------------------------------------------------------ */
  function buildUnifiedAudits({ cronoRows, leafFolders, faaScanResult }) {
    const diagnostics = { unmatchedCronoRows: [], unmatchedFolders: [], lowConfidenceMatches: [], unrecognizedClassification: [] };

    const enrichedCrono = cronoRows.map(row => {
      const category = resolveCategory(row.clasificacionRaw);
      if (!category) diagnostics.unrecognizedClassification.push(row);
      return { ...row, categoria: category };
    });

    // Carpetas disponibles por categoría (excluye INSP, que se resuelve aparte).
    const usedFolderPaths = new Set();
    const folderByPath = new Map(leafFolders.map(f => [f.path, f]));

    const audits = [];

    // --- 1) Categorías con nombre de entidad (todo menos AREA_INTERNA/INSPECCION) ---
    const nameBasedCategories = Object.keys(cfg.CATEGORY_FOLDER_PATHS).filter(c => c !== "AREA_INTERNA");
    nameBasedCategories.forEach((category) => {
      if (category === "INSPECCION") return; // se procesa aparte (fechas, no nombres)
      const candidateFolders = leafFolders.filter(f => (cfg.CATEGORY_FOLDER_PATHS[category] || []).some(prefix => f.path.startsWith(prefix)));
      const rowsInCategory = enrichedCrono.filter(r => r.categoria === category);
      rowsInCategory.forEach((row) => {
        const result = matchByNameOrOverride(row, candidateFolders);
        audits.push(buildAuditRecord(row, result, category));
        if (result.folder) usedFolderPaths.add(result.folder.path);
        else diagnostics.unmatchedCronoRows.push(row);
        if (result.folder && result.confidence !== null && result.confidence < cfg.MATCH_CONFIDENCE_THRESHOLD) {
          diagnostics.lowConfidenceMatches.push({ row, folder: result.folder, confidence: result.confidence });
        }
      });
    });

    // --- 2) Áreas y Talleres Internos (reglas por palabra clave) ---
    const areaInternaRows = enrichedCrono.filter(r => r.categoria === "AREA_INTERNA");
    const areaInternaFolders = leafFolders.filter(f => (cfg.CATEGORY_FOLDER_PATHS.AREA_INTERNA || []).some(prefix => f.path.startsWith(prefix)));
    const faaCategoryMatches = (cfg.FAA_SELF_EVAL.categories || []).map(c => u.normalize(c.cronogramaAuditadoMatch));
    areaInternaRows.forEach((row) => {
      // Las 9 auditorías "SATENA M.R.O (Limited ... ) FAA" / "(Other
      // Metallic...) FAA" no usan carpeta AUD_INT — su ejecución real se
      // representa con la auditoría sintética del panel FAA_SELF_EVAL
      // (ver QA.faaSelfEval.buildSyntheticAudits, que ya vincula de
      // vuelta a este mismo "idAuditado" para fines informativos). NO se
      // crea aquí un registro adicional: hacerlo duplicaría el conteo
      // (una vez "pendiente" desde el cronograma y otra vez "ejecutada"
      // desde el panel FAA para la misma auditoría). Se compara contra la
      // configuración real de categorías FAA (data.js) en vez de un
      // patrón de texto suelto, porque no todas contienen la palabra
      // "Limited" (ej. "Other Metallic and Composite Components").
      const normAuditado = u.normalize(row.auditado);
      if (faaCategoryMatches.some(m => normAuditado.includes(m))) {
        return;
      }
      const result = matchAreaInterna(row, areaInternaFolders);
      audits.push(buildAuditRecord(row, result, "AREA_INTERNA"));
      if (result.folder) usedFolderPaths.add(result.folder.path);
      else diagnostics.unmatchedCronoRows.push(row);
    });

    // --- 3) Inspección (emparejamiento por fecha) ---
    const inspRows = enrichedCrono.filter(r => r.categoria === "INSPECCION");
    const inspFolders = leafFolders.filter(f => f.topCategory === "INSP");
    const inspResults = matchInspeccion(inspRows, inspFolders);
    inspResults.matched.forEach(({ row, folder, method }) => {
      audits.push(buildAuditRecord(row, { folder, confidence: null, method }, "INSPECCION"));
      usedFolderPaths.add(folder.path);
    });
    inspResults.unmatchedRows.forEach((row) => {
      audits.push(buildAuditRecord(row, { folder: null, confidence: null, method: null }, "INSPECCION"));
      diagnostics.unmatchedCronoRows.push(row);
    });

    // --- 4) Carpetas con evidencia pero SIN fila de cronograma -> extraordinarias por evidencia ---
    leafFolders.forEach((folder) => {
      if (usedFolderPaths.has(folder.path)) return;
      if (folder.totalFiles === 0) return; // carpeta vacía sin vínculo: no aporta nada, se ignora
      audits.push(buildEvidenceOnlyAuditRecord(folder));
      diagnostics.unmatchedFolders.push(folder);
    });

    // --- 5) Autoevaluaciones FAA (panel especial) ---
    const faaAudits = QA.faaSelfEval.buildSyntheticAudits(faaScanResult, cronoRows);
    audits.push(...faaAudits);

    return { audits, diagnostics, faaScanResult };
  }

  /* ------------------------------------------------------------------ *
   * Emparejamiento genérico por nombre, en 3 pasos de prioridad:
   *   1. Override manual explícito (data.js, casos verificados a mano).
   *   2. Registro oficial de aliases (data.js, la fuente de verdad que
   *      usa a diario el propio equipo QA_MRO en sus otras herramientas)
   *      — se compara el "nombre original" registrado, no el nombre
   *      crudo de la carpeta, así que la similitud de texto es mucho más
   *      confiable.
   *   3. Similitud difusa directa entre el nombre de carpeta y el
   *      auditado, como último recurso para carpetas nuevas que todavía
   *      no están en el registro oficial.
   * ------------------------------------------------------------------ */
  const aliasRegistryByPath = new Map((cfg.OFFICIAL_ALIAS_REGISTRY || []).map(e => [e.folderPath, e.nombreOriginal]));

  function matchByNameOrOverride(row, candidateFolders) {
    const override = cfg.MANUAL_MATCH_OVERRIDES.find(o => u.normalize(row.auditado).includes(u.normalize(o.auditadoMatch)));
    if (override) {
      const folder = candidateFolders.find(f => f.path === override.folderPath) || null;
      if (folder) return { folder, confidence: 1, method: "override" };
    }

    let best = null, bestScore = 0, bestMethod = null;
    candidateFolders.forEach((folder) => {
      const officialName = aliasRegistryByPath.get(folder.path);
      if (officialName) {
        const score = u.textSimilarity(row.auditado, officialName);
        if (score > bestScore) { bestScore = score; best = folder; bestMethod = "alias_registry"; }
      }
    });
    if (best && bestScore >= cfg.MATCH_CONFIDENCE_THRESHOLD) return { folder: best, confidence: bestScore, method: bestMethod };

    // Sin registro oficial (carpeta nueva) o puntaje insuficiente: similitud directa contra el nombre de carpeta.
    best = null; bestScore = 0;
    candidateFolders.forEach((folder) => {
      const folderLabel = folder.name.replace(/^\d+_/, "").replace(/_/g, " ");
      const score = u.textSimilarity(row.auditado, folderLabel);
      if (score > bestScore) { bestScore = score; best = folder; }
    });
    if (best && bestScore >= cfg.MATCH_CONFIDENCE_THRESHOLD) return { folder: best, confidence: bestScore, method: "fuzzy" };
    return { folder: null, confidence: bestScore, method: null };
  }

  /* ------------------------------------------------------------------ *
   * Áreas y Talleres Internos: reglas por palabra clave (+ ciudad opcional)
   * ------------------------------------------------------------------ */
  function matchAreaInterna(row, candidateFolders) {
    const normAuditado = u.normalize(row.auditado);
    const normCiudad = u.normalize(row.ciudad || "");
    for (const rule of cfg.AREA_INTERNA_RULES) {
      if (!rule.folder) continue; // regla documental (ej. LIMITED->FAA) sin carpeta directa
      if (!normAuditado.includes(u.normalize(rule.contains))) continue;
      if (rule.city && !normCiudad.includes(u.normalize(rule.city))) continue;
      const folder = candidateFolders.find(f => f.path === rule.folder);
      if (folder) return { folder, confidence: 1, method: "area_interna_rule" };
    }
    // Sin regla aplicable: intenta similitud difusa como último recurso.
    return matchByNameOrOverride(row, candidateFolders);
  }

  /* ------------------------------------------------------------------ *
   * Inspección: sin nombre de entidad útil -> se empareja por fecha.
   * Ver README para el detalle de la heurística (carpetas con fecha
   * explícita en el nombre vs. carpetas "por mes" sin desagregar).
   * ------------------------------------------------------------------ */
  function matchInspeccion(rows, folders) {
    const DATE_RE = /(\d{2})-(\d{2})-(\d{2})/;
    const decorated = folders.map((folder) => {
      const segs = folder.path.split("/");
      const last = segs[segs.length - 1];
      const dateMatch = last.match(DATE_RE);
      let explicitDate = null;
      if (dateMatch) explicitDate = new Date(2000 + parseInt(dateMatch[3], 10), parseInt(dateMatch[2], 10) - 1, parseInt(dateMatch[1], 10));
      const monthSeg = segs[1]; // INSP/<0X_MES>/...
      const monthIdx = monthSeg ? parseInt(monthSeg.slice(0, 2), 10) - 1 : null;
      const baseSeg = segs.find(s => /^[A-Z]{3}_\d+$/i.test(s));
      const baseCode = baseSeg ? baseSeg.split("_")[0].toUpperCase() : null;
      return { folder, explicitDate, monthIdx, baseCode, used: false };
    });

    const matched = [];
    const unmatchedRows = [];
    const rowsSorted = [...rows].sort((a, b) => (a.fechaProgramada || 0) - (b.fechaProgramada || 0));

    // Paso 1: emparejar filas con carpetas de FECHA explícita más cercana (misma fecha o dentro de +/-10 días).
    rowsSorted.forEach((row) => {
      if (!row.fechaProgramada) { unmatchedRows.push(row); return; }
      let best = null, bestDiff = Infinity;
      decorated.forEach((d) => {
        if (d.used || !d.explicitDate) return;
        const diff = Math.abs(d.explicitDate.getTime() - row.fechaProgramada.getTime());
        if (diff < bestDiff) { bestDiff = diff; best = d; }
      });
      const TEN_DAYS = 10 * 86400000;
      if (best && bestDiff <= TEN_DAYS) {
        best.used = true;
        matched.push({ row, folder: best.folder, method: "insp_date_exacta" });
      } else {
        unmatchedRows.push(row);
      }
    });

    // Paso 2: filas restantes -> intenta carpeta "agregada por mes" (sin fecha propia) del mismo mes.
    const stillUnmatched = [];
    unmatchedRows.forEach((row) => {
      if (!row.fechaProgramada) { stillUnmatched.push(row); return; }
      const monthIdx = row.fechaProgramada.getMonth();
      const monthFolder = decorated.find(d => !d.explicitDate && d.monthIdx === monthIdx && d.folder.totalFiles > 0);
      if (monthFolder) {
        matched.push({ row, folder: monthFolder.folder, method: "insp_mes_agregado" });
        // No se marca "used" en exclusiva: varias filas del mismo mes sin
        // fecha propia en disco comparten la evidencia agregada del mes
        // (limitación real de cómo se archivó la evidencia, documentada
        // en el README).
      } else {
        stillUnmatched.push(row);
      }
    });

    return { matched, unmatchedRows: stillUnmatched };
  }

  /* ------------------------------------------------------------------ *
   * Construcción del registro unificado de Auditoria
   * ------------------------------------------------------------------ */
  function buildAuditRecord(row, matchResult, category) {
    const folder = matchResult.folder;
    const esExtraordinaria = row.esNoProgramadaEnCrono === true;
    return {
      id: "CRONO-" + row.idAuditado,
      origen: folder ? "CRONO_MATCHED" : "CRONO_UNMATCHED",
      idAuditado: row.idAuditado,
      auditado: row.auditado,
      clasificacionCanonica: category,
      clasificacionLabel: cfg.CANONICAL_CATEGORIES[category] || row.clasificacionRaw,
      tipoAuditoria: TIPO_LABEL_BY_CATEGORY[category] || category,
      tipoAmplio: TIPO_AMPLIO_BY_CATEGORY[category] || "Proveedor",
      ciudad: row.ciudad,
      modalidad: row.modalidad,
      auditorResponsable: null,
      fechaProgramada: row.fechaProgramada,
      esNoProgramadaEnCrono: row.esNoProgramadaEnCrono,
      esExtraordinaria,
      estatusManualCrono: row.estatusManual,
      estadoCierreHallazgosManualCrono: row.estadoCierreHallazgosManual,
      fechaReprogramacion: row.fechaReprogramacion,
      especificacionServicio: row.especificacionServicio,
      carpetaEvidencia: folder ? folder.path : null,
      evidenciaCounts: folder ? folder.counts : null,
      evidenciaTotalFiles: folder ? folder.totalFiles : 0,
      primeraFechaEvidencia: folder ? folder.firstFileDate : null,
      ultimaFechaEvidencia: folder ? folder.lastFileDate : null,
      matchConfidence: matchResult.confidence,
      matchMethod: matchResult.method,
      estadoCalculado: null, // lo completa statusEngine.js
    };
  }

  function buildEvidenceOnlyAuditRecord(folder) {
    // Intenta deducir la categoría canónica a partir del prefijo de ruta.
    let category = null;
    for (const [cat, prefixes] of Object.entries(cfg.CATEGORY_FOLDER_PATHS)) {
      if (prefixes.some(p => folder.path.startsWith(p))) { category = cat; break; }
    }
    return {
      id: "EVID-" + u.slugify(folder.path),
      origen: "EVIDENCE_ONLY",
      idAuditado: null,
      auditado: folder.name.replace(/^\d+_/, "").replace(/_/g, " "),
      clasificacionCanonica: category,
      clasificacionLabel: category ? cfg.CANONICAL_CATEGORIES[category] : "Sin clasificar",
      tipoAuditoria: category ? TIPO_LABEL_BY_CATEGORY[category] : "Sin clasificar",
      tipoAmplio: category ? (TIPO_AMPLIO_BY_CATEGORY[category] || "Proveedor") : "Proveedor",
      ciudad: null,
      modalidad: null,
      auditorResponsable: null,
      fechaProgramada: null,
      esNoProgramadaEnCrono: true,
      esExtraordinaria: true,
      estatusManualCrono: null,
      estadoCierreHallazgosManualCrono: null,
      fechaReprogramacion: null,
      especificacionServicio: null,
      carpetaEvidencia: folder.path,
      evidenciaCounts: folder.counts,
      evidenciaTotalFiles: folder.totalFiles,
      primeraFechaEvidencia: folder.firstFileDate,
      ultimaFechaEvidencia: folder.lastFileDate,
      matchConfidence: null,
      matchMethod: null,
      estadoCalculado: null,
    };
  }

  /* ------------------------------------------------------------------ *
   * Vincula cada hallazgo (hoja "Hallazgos Auditoria") con su auditoría
   * unificada, para poder cruzar hallazgos <-> auditorías ejecutadas tal
   * como lo pide el proyecto. El "ID AUDITORIA" de esa hoja pertenece a
   * una numeración propia del otro archivo (no es el mismo ID que
   * "ID AUDITADO" de CRONO DEF), así que el cruce también se hace por
   * categoría + similitud de nombre.
   * ------------------------------------------------------------------ */
  function linkFindingsToAudits(findings, audits) {
    const auditsByCategory = new Map();
    audits.forEach((a) => {
      const cat = a.clasificacionCanonica || "SIN_CLASIFICAR";
      if (!auditsByCategory.has(cat)) auditsByCategory.set(cat, []);
      auditsByCategory.get(cat).push(a);
    });

    // Cachea el mejor match por combinación (idAuditoria) para no recalcular
    // la similitud de texto por cada fila de hallazgo (varias filas
    // comparten el mismo idAuditoria = misma auditoría, varios hallazgos).
    const cache = new Map();
    const FINDINGS_MATCH_THRESHOLD = 0.35; // más permisivo que el general: es un enlace informativo, no determina KPIs de ejecución.

    findings.forEach((finding) => {
      const cacheKey = finding.idAuditoria;
      if (!cache.has(cacheKey)) {
        const category = resolveCategory(finding.clasificacionRaw);
        const pool = (category && auditsByCategory.get(category)) || audits;
        let best = null, bestScore = 0;
        pool.forEach((a) => {
          const score = u.textSimilarity(finding.auditado, a.auditado);
          if (score > bestScore) { bestScore = score; best = a; }
        });
        cache.set(cacheKey, (best && bestScore >= FINDINGS_MATCH_THRESHOLD) ? { audit: best, score: bestScore } : null);
      }
      const match = cache.get(cacheKey);
      finding.auditoriaVinculada = match ? match.audit.id : null;
      finding.auditoriaVinculadaConfidence = match ? match.score : null;
    });

    // Índice inverso: cada auditoría conoce el conteo de hallazgos ligados.
    const findingsByAuditId = new Map();
    findings.forEach((f) => {
      if (!f.auditoriaVinculada) return;
      if (!findingsByAuditId.has(f.auditoriaVinculada)) findingsByAuditId.set(f.auditoriaVinculada, []);
      findingsByAuditId.get(f.auditoriaVinculada).push(f);
    });
    audits.forEach((a) => {
      const list = findingsByAuditId.get(a.id) || [];
      // Se cuentan todas las filas de la hoja Hallazgos vinculadas a esta
      // auditoría (mismo criterio que el KPI general "Total de
      // Hallazgos"): incluye filas CONDICIÓN "N/A" (auditoría cerrada sin
      // no-conformidades/observaciones, pero igualmente registrada).
      a.hallazgosVinculados = list.length;
      a.hallazgosVinculadosNC = list.filter(f => f.condicion === "NC").length;
      a.hallazgosVinculadosOB = list.filter(f => f.condicion === "OB").length;
      // El cronograma no registra auditor responsable; se completa con el
      // auditor líder del hallazgo vinculado más frecuente, cuando existe.
      if (!a.auditorResponsable && list.length) {
        const counts = new Map();
        list.forEach(f => { if (f.auditorLider) counts.set(f.auditorLider, (counts.get(f.auditorLider) || 0) + 1); });
        let top = null, topCount = 0;
        counts.forEach((c, name) => { if (c > topCount) { topCount = c; top = name; } });
        a.auditorResponsable = top;
      }
    });

    return findings;
  }

  return { buildUnifiedAudits, resolveCategory, linkFindingsToAudits };
})();
