/**
 * js/faaSelfEval.js — Panel especial "Autoevaluaciones FAA"
 * ============================================================================
 * Ver el comentario extenso en data.js (QA.config.FAA_SELF_EVAL) para el
 * contexto de negocio completo. En resumen: la carpeta
 * "Self Evaluation Completadas" contiene documentos PDF sueltos agrupados
 * en sub-carpetas por "limited category" (Electrical, Mechanical,
 * Airframe, ...). Cada sub-carpeta representa UNA auditoría/autoevaluación
 * ejecutada (extraordinaria / no programada), y cada documento dentro de
 * ella es un "seguimiento"/revisión individual por referencia o parte.
 */

window.QA = window.QA || {};

QA.faaSelfEval = (function () {
  const u = QA.utils;

  /**
   * Agrupa los archivos encontrados dentro de "Self Evaluation Completadas"
   * en categorías. Usa la configuración de data.js para asignar la
   * etiqueta "oficial" cuando el nombre de carpeta coincide (normalizado);
   * si aparece una sub-carpeta nueva no contemplada en la configuración,
   * igual se agrupa correctamente usando su propio nombre como etiqueta
   * (para que la app no se rompa si el año siguiente cambia el número de
   * categorías FAA).
   */
  function scan(files, dirPaths) {
    const cfg = QA.config.FAA_SELF_EVAL;
    const rootFolder = cfg.folderName;
    const configuredByNormName = new Map(
      cfg.categories.map(c => [u.normalize(c.folderName), c])
    );

    // Sub-carpetas de primer nivel realmente presentes en disco.
    const level1Dirs = new Set();
    dirPaths.forEach(p => {
      const rel = p.slice(rootFolder.length + 1); // quita "Self Evaluation Completadas/"
      if (rel && !rel.includes("/")) level1Dirs.add(rel);
    });

    const categoriesByKey = new Map();

    function getOrCreateCategory(folderNameOnDisk) {
      const norm = u.normalize(folderNameOnDisk);
      const configured = configuredByNormName.get(norm);
      const key = configured ? configured.key : u.slugify(folderNameOnDisk);
      if (!categoriesByKey.has(key)) {
        categoriesByKey.set(key, {
          key,
          folderName: folderNameOnDisk,
          label: configured ? configured.label : folderNameOnDisk,
          cronogramaAuditadoMatch: configured ? configured.cronogramaAuditadoMatch : null,
          isConfigured: !!configured,
          files: [],
        });
      }
      return categoriesByKey.get(key);
    }

    // Asegura que TODAS las categorías configuradas existan aunque estén vacías
    // (para que el panel siempre muestre las 9 categorías conocidas, incluso
    // si alguna todavía no tiene documentos).
    cfg.categories.forEach(c => getOrCreateCategory(c.folderName));

    const generalFiles = [];
    files.forEach((f) => {
      const rel = f.path.slice(rootFolder.length + 1);
      const parts = rel.split("/");
      if (parts.length === 1) {
        // Archivo suelto directamente en la raíz -> categoría "general".
        generalFiles.push(f);
        return;
      }
      const folderNameOnDisk = parts[0];
      const cat = getOrCreateCategory(folderNameOnDisk);
      cat.files.push(f);
    });

    const categories = [...categoriesByKey.values()].map(finalizeCategory);
    categories.sort((a, b) => a.label.localeCompare(b.label));

    const general = finalizeCategory({
      key: QA.config.FAA_SELF_EVAL.generalCategoryKey,
      folderName: rootFolder,
      label: QA.config.FAA_SELF_EVAL.generalCategoryLabel,
      cronogramaAuditadoMatch: null,
      isConfigured: true,
      files: generalFiles,
    });

    const totalFiles = categories.reduce((s, c) => s + c.count, 0) + general.count;

    return { categories, general, totalFiles, totalCategories: categories.length + (general.count > 0 ? 1 : 0) };
  }

  function finalizeCategory(cat) {
    const dates = cat.files.map(f => f.lastModified).filter(Boolean);
    return {
      ...cat,
      count: cat.files.length,
      firstFileDate: dates.length ? new Date(Math.min(...dates)) : null,
      lastFileDate: dates.length ? new Date(Math.max(...dates)) : null,
    };
  }

  /**
   * Construye registros de "Auditoria" sintéticos (uno por categoría con al
   * menos un documento, más el general si aplica) para que el programa
   * completo (KPIs, gráficos, tabla de auditorías) los cuente como
   * auditorías ejecutadas extraordinarias, tal como lo definió el usuario.
   * También intenta vincular (solo informativamente) cada categoría con su
   * fila equivalente del cronograma, cuando existe.
   */
  function buildSyntheticAudits(scanResult, cronoRows) {
    const cfgLabelPrefix = QA.config.FAA_SELF_EVAL.labelPrefix;
    const allCats = [...scanResult.categories, scanResult.general].filter(c => c.count > 0);

    return allCats.map((cat) => {
      let linkedCrono = null;
      if (cat.cronogramaAuditadoMatch) {
        linkedCrono = cronoRows.find(row =>
          u.normalize(row.auditado).includes(u.normalize(cat.cronogramaAuditadoMatch))
        ) || null;
      }
      return {
        id: "FAA-" + cat.key,
        origenEspecial: "FAA_SELF_EVAL",
        auditado: `${cfgLabelPrefix} — ${cat.label}`,
        clasificacionCanonica: "AREA_INTERNA",
        clasificacionLabel: QA.config.CANONICAL_CATEGORIES.AREA_INTERNA,
        tipoAuditoria: "Área Interna",
        tipoAmplio: "Área Interna",
        ciudad: null,
        modalidad: null,
        auditorResponsable: null,
        // Regla explícita del usuario: SIEMPRE se contabiliza como
        // extraordinaria/no programada, independientemente de que exista
        // (o no) una fila equivalente en el cronograma original.
        esExtraordinaria: true,
        fechaProgramada: null,
        fechaEjecucionInicio: cat.firstFileDate,
        fechaEjecucionFin: cat.lastFileDate,
        estadoCalculado: "EJECUTADA",
        estatusManualCrono: linkedCrono ? linkedCrono.estatusManual : null,
        cronogramaIdVinculado: linkedCrono ? linkedCrono.idAuditado : null,
        evidenciaTotalFiles: cat.count,
        evidenciaCounts: null, // no aplica el patrón 01_AVI..05_EVI
        faaCategoryKey: cat.key,
        faaReviewCount: cat.count,
        carpetaEvidencia: `${QA.config.FAA_SELF_EVAL.folderName}/${cat.folderName}`,
      };
    });
  }

  return { scan, buildSyntheticAudits };
})();
