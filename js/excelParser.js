/**
 * js/excelParser.js — Lectura de los 2 archivos Excel fuente con SheetJS
 * ============================================================================
 * Extrae ÚNICAMENTE las hojas requeridas y las convierte en arreglos de
 * objetos JS con nombres de campo estables (independientes del texto exacto
 * de los encabezados en español, que puede tener saltos de línea, tildes
 * inconsistentes, etc.).
 *
 * Los índices de columna usados aquí fueron verificados manualmente contra
 * el contenido real de los archivos (ver README.md, sección "Modelo de
 * datos"). Si SATENA reordena o agrega columnas en el futuro, este es el
 * único lugar que debe ajustarse.
 */

window.QA = window.QA || {};

QA.excelParser = (function () {
  const u = QA.utils;

  async function readWorkbook(file) {
    const buf = await file.arrayBuffer();
    return XLSX.read(buf, { type: "array", cellDates: true, cellNF: false });
  }

  function sheetToRows(wb, sheetName) {
    if (!wb.Sheets[sheetName]) {
      throw new Error(`La hoja "${sheetName}" no existe en el archivo. Hojas disponibles: ${wb.SheetNames.join(", ")}`);
    }
    return XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: true, defval: null });
  }

  function isEmptyRow(row) {
    return !row || row.every(v => v === null || v === undefined || v === "");
  }

  /* ------------------------------------------------------------------ *
   * CRONO DEF — Programa de auditorías (cronograma originalmente aprobado)
   * ------------------------------------------------------------------ */
  async function parseCronoDef(file) {
    const wb = await readWorkbook(file);
    const rows = sheetToRows(wb, "CRONO DEF");
    const out = [];
    for (let i = 1; i < rows.length; i++) { // fila 0 = encabezado
      const r = rows[i];
      if (isEmptyRow(r)) continue;
      if (r[0] === null || r[0] === undefined) continue; // sin ID AUDITADO -> no es una fila de datos válida
      const fechaAuditoria2026Raw = r[10];
      const item = {
        idAuditado: r[0],
        clasificacionRaw: r[1] || "",
        activo: r[2] === "si" || r[2] === "Si" || r[2] === "SI",
        auditado: (r[3] || "").toString().trim(),
        ciudad: (r[4] || "").toString().trim() || null,
        fechaUltimaAuditoria: u.toDateOrNull(r[5]),
        ultimoServicio: u.toDateOrNull(r[7]),
        modalidad: (r[8] || "").toString().trim() || null,
        validadoHasta: u.toDateOrNull(r[9]),
        // Columna "FECHA AUDITORIA 2026": puede ser una fecha real (auditoría
        // programada con fecha) o el texto "No programada" (auditoría
        // extraordinaria agregada después del cronograma original).
        fechaProgramada: u.toDateOrNull(fechaAuditoria2026Raw),
        esNoProgramadaEnCrono: u.isUnscheduledMarker(fechaAuditoria2026Raw),
        fechaBI: u.toDateOrNull(r[11]),
        especificacionServicio: (r[12] || "").toString().trim() || null,
        comentarioEjecucion: (r[13] || "").toString().trim() || null,
        // Estados manuales tal como los mantiene el equipo QA (se recortan
        // espacios porque el Excel trae inconsistencias, ej. "Ejecutada ").
        estatusManual: (r[14] || "").toString().trim() || null,
        estadoCierreHallazgosManual: (r[15] || "").toString().trim() || null,
        fechaReprogramacion: u.toDateOrNull(r[16]),
        tentativaCumplimiento: u.toDateOrNull(r[17]),
      };
      out.push(item);
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * Hallazgos Auditoria — hallazgos (NC/OB) por auditoría ejecutada
   * ------------------------------------------------------------------ */
  async function parseHallazgos(file) {
    const wb = await readWorkbook(file);
    const rows = sheetToRows(wb, "Hallazgos Auditoria");
    // El encabezado real está en la fila 4 (índice 3); filas 1-3 son títulos
    // de sección fusionados.
    const out = [];
    for (let i = 4; i < rows.length; i++) {
      const r = rows[i];
      if (isEmptyRow(r)) continue;
      if (r[0] === null || r[0] === undefined) continue; // sin ID AUDITORIA
      out.push({
        idAuditoria: r[0],
        numeroReporte: r[1],
        tipoAuditoria: (r[2] || "").toString().trim() || null, // Externa/Interna
        modalidad: (r[3] || "").toString().trim() || null,     // Presencial/Remota
        clasificacionRaw: (r[4] || "").toString().trim(),
        subClasificacionProveedor: (r[5] || "").toString().trim() || null,
        auditado: (r[6] || "").toString().trim(),
        subAreaReporte: (r[7] || "").toString().trim() || null,
        procesoReporte: (r[8] || "").toString().trim() || null,
        auditorLider: (r[9] || "").toString().trim() || null,
        auditorObservador: (r[10] || "").toString().trim() || null,
        auditorApoyo: (r[11] || "").toString().trim() || null,
        fechaInicio: u.toDateOrNull(r[12]),
        fechaTerminacion: u.toDateOrNull(r[13]),
        ciudadEjecucion: (r[14] || "").toString().trim() || null,
        fechaNotificacion: u.toDateOrNull(r[19]),
        consecutivoNotificacion: r[20] || null,
        fechaLimiteRespuestaInforme: u.toDateOrNull(r[21]),
        fechaRespuestaInforme: u.toDateOrNull(r[22]),
        fechaSeguimientoSatena: u.toDateOrNull(r[23]),
        proximoSeguimiento: u.toDateOrNull(r[27]),
        fechaCierreFinalAuditoria: u.toDateOrNull(r[28]),
        auditorCierre: (r[30] || "").toString().trim() || null,
        estadoAuditoria: (r[31] || "").toString().trim() || null, // Abierto/Cerrado (a nivel de auditoría completa)
        condicion: (r[32] || "").toString().trim() || null,       // NC / OB / N/A
        requisito: (r[33] || "").toString().trim() || null,
        descripcion: (r[34] || "").toString().trim() || null,
        clasificacionReporte: (r[35] || "").toString().trim() || null, // taxonomía de causa raíz
        barreras: (r[36] || "").toString().trim() || null,
        probabilidad: (r[37] || "").toString().trim() || null,
        severidad: (r[38] || "").toString().trim() || null,
        combinacionProbSeveridad: (typeof r[39] === "number") ? r[39] : null,
        fechaLimiteCumplimiento: u.toDateOrNull(r[40]),
        fechaCierreReporte: u.toDateOrNull(r[41]),
        estadoHallazgo: (r[42] || "").toString().trim() || null, // Abierto/Cerrado (a nivel del hallazgo individual)
      });
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * Control SATDSG — bitácora de comunicaciones oficiales (Aviso, Informe,
   * Seguimiento, Cierre). No es una tabla de hallazgos: se usa como apoyo
   * de trazabilidad de notificaciones, no alimenta los KPIs de hallazgos.
   * ------------------------------------------------------------------ */
  async function parseControlSatdsg(file) {
    const wb = await readWorkbook(file);
    const rows = sheetToRows(wb, "Control SATDSG");
    const out = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (isEmptyRow(r)) continue;
      if (!r[4]) continue; // sin "auditado" no es una fila útil
      out.push({
        fechaAuditoria: u.toDateOrNull(r[0]),
        idSatdsg: r[1] || null,
        tipoDocumento: (r[2] || "").toString().trim() || null, // Aviso/Informe/Seguimiento/Cierre/Cierre Parcial
        clasificacionRaw: (r[3] || "").toString().trim(),
        auditado: (r[4] || "").toString().trim(),
        estadoEnvio: (r[5] || "").toString().trim() || null,
        consecutivosRespuestas: r[6] || null,
        observaciones: (r[7] || "").toString().trim() || null,
      });
    }
    return out;
  }

  return { parseCronoDef, parseHallazgos, parseControlSatdsg };
})();
