/**
 * js/excelImport.js — carga del Excel de control (hojas AUDITORIAS_2026 +
 * HALLAZGOS_2026) directo en el navegador, sin backend.
 * ============================================================================
 * Reutiliza js/excelParser.js (lectura de las hojas) y js/matching.js
 * (clasificación canónica + vínculo hallazgo->auditoría por similitud de
 * nombre) — la misma lógica que antes corría en Node contra Supabase
 * (scripts/migrate-2026.mjs), ahora produciendo directamente los objetos
 * camelCase que ya consume el resto de la app (statusEngine/kpiEngine/...),
 * listos para guardar con QA.dataService.replaceAllFromExcel().
 */

window.QA = window.QA || {};

QA.excelImport = (function () {
  const TIPO_AMPLIO_BY_CATEGORY = {
    OMA: "Proveedor", OMA_EXT: "Proveedor", PROVEEDOR: "Proveedor",
    LABORATORIO_CALIBRACION: "Proveedor", MANTENIMIENTO_ETAA: "Proveedor", CIAC: "Proveedor",
    AREA_INTERNA: "Área Interna", AUMENTO_CAPACIDADES: "Área Interna",
    INSPECCION: "Inspección",
  };

  /**
   * @param {File} file - el .xlsx elegido en el <input type="file">, con
   *   las hojas AUDITORIAS_2026 y HALLAZGOS_2026.
   * @returns {Promise<{audits: object[], findings: object[], resumen: object}>}
   */
  async function importFromExcel(file) {
    const rawAuditorias = await QA.excelParser.parseAuditorias2026(file);
    const rawFindings = await QA.excelParser.parseHallazgos2026(file);
    if (!rawAuditorias.length) {
      throw new Error('La hoja "AUDITORIAS_2026" no tiene filas de datos válidas.');
    }

    const audits = rawAuditorias.map((a) => {
      const categoria = QA.matching.resolveCategory(a.clasificacionRaw);
      return Object.assign({}, a, {
        id: crypto.randomUUID(),
        clasificacionCanonica: categoria,
        clasificacionLabel: (categoria && QA.config.CANONICAL_CATEGORIES[categoria]) || a.clasificacionRaw,
        tipoAmplio: a.tipoRegistro === "INSPECCION" ? "Inspección" : (TIPO_AMPLIO_BY_CATEGORY[categoria] || "Proveedor"),
        esExtraordinaria: !!a.esNoProgramadaEnCrono,
        auditorResponsable: null,
        notas: null,
      });
    });

    const findings = rawFindings.map((f) => Object.assign({}, f, { id: crypto.randomUUID() }));
    QA.matching.linkFindingsToAudits(findings, audits);

    const sinVincular = findings.filter((f) => !f.auditoriaVinculada).length;
    return {
      audits,
      findings,
      resumen: {
        auditorias: audits.filter((a) => a.tipoRegistro === "AUDITORIA").length,
        inspecciones: audits.filter((a) => a.tipoRegistro === "INSPECCION").length,
        hallazgos: findings.length,
        hallazgosVinculados: findings.length - sinVincular,
        hallazgosSinVincular: sinVincular,
      },
    };
  }

  return { importFromExcel };
})();
