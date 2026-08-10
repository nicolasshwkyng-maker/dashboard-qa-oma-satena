/**
 * js/statusEngine.js — Estado real de cada auditoría y de cada hallazgo
 * ============================================================================
 * Desde la fuente de datos 2026 (hoja AUDITORIAS_2026), el estado de cada
 * auditoría ya NO se infiere de evidencia de archivos: viene directo de la
 * columna "Estatus", mantenida a mano por el equipo QA (fuente de verdad).
 * Este módulo solo normaliza ese valor a una constante interna y calcula
 * agregados derivados (bucket de la dona, rollup de cierre por auditoría a
 * partir de sus hallazgos vinculados).
 *
 * Estados posibles de auditoría (QA.statusEngine.ESTADOS):
 *   POR_EJECUTAR, EJECUTADA, NO_EJECUTADA, CANCELADA
 *
 * Estados posibles de cierre (hallazgo individual, o rollup de auditoría):
 *   ABIERTO, CERRADO, CIERRE_PARCIAL
 *
 * Reglas CENTRALIZADAS aquí para poder ajustarlas sin tocar kpiEngine/
 * charts/tables, que solo consumen "estadoCalculado" / "cierreRollup".
 */

window.QA = window.QA || {};

QA.statusEngine = (function () {
  const u = QA.utils;
  const ESTADOS = { POR_EJECUTAR: "POR_EJECUTAR", EJECUTADA: "EJECUTADA", NO_EJECUTADA: "NO_EJECUTADA", CANCELADA: "CANCELADA" };
  const CIERRE = { ABIERTO: "ABIERTO", CERRADO: "CERRADO", CIERRE_PARCIAL: "CIERRE_PARCIAL" };

  const ESTATUS_TEXT_TO_ESTADO = {
    "POR EJECUTAR": ESTADOS.POR_EJECUTAR,
    "EJECUTADA": ESTADOS.EJECUTADA,
    "NO EJECUTADA": ESTADOS.NO_EJECUTADA,
    "CANCELADA": ESTADOS.CANCELADA,
  };

  function computeEstado(audit) {
    return ESTATUS_TEXT_TO_ESTADO[u.normalize(audit.estatus)] || ESTADOS.POR_EJECUTAR;
  }

  const CIERRE_TEXT_TO_CONST = {
    "ABIERTO": CIERRE.ABIERTO,
    "CERRADO": CIERRE.CERRADO,
    "CIERRE PARCIAL": CIERRE.CIERRE_PARCIAL,
  };

  /** Estado de cierre de UN hallazgo individual (columna "ESTADO" del Excel). */
  function computeCierreHallazgo(finding) {
    return CIERRE_TEXT_TO_CONST[u.normalize(finding.estadoHallazgo)] || null;
  }

  /**
   * Rollup de cierre a nivel Auditoría, a partir del cierre de sus
   * hallazgos vinculados: Cerrada si todos cerrados, Abierta si todos
   * abiertos, Cierre Parcial si hay mezcla (o si algún hallazgo individual
   * ya está marcado como Cierre Parcial). Solo aplica a auditorías
   * EJECUTADAS (las demás no tienen nada que "cerrar" todavía → null, no
   * entran en el gráfico). Una auditoría ejecutada SIN hallazgos vinculados
   * se considera Cerrada: se ejecutó y no dejó nada pendiente por resolver.
   */
  function computeAuditoriaRollup(estadoCalculado, hallazgosDeLaAuditoria) {
    if (estadoCalculado !== ESTADOS.EJECUTADA) return null;
    const cierres = (hallazgosDeLaAuditoria || []).map(computeCierreHallazgo).filter(Boolean);
    if (!cierres.length) return CIERRE.CERRADO;
    if (cierres.some(c => c === CIERRE.CIERRE_PARCIAL)) return CIERRE.CIERRE_PARCIAL;
    const todosCerrados = cierres.every(c => c === CIERRE.CERRADO);
    const todosAbiertos = cierres.every(c => c === CIERRE.ABIERTO);
    if (todosCerrados) return CIERRE.CERRADO;
    if (todosAbiertos) return CIERRE.ABIERTO;
    return CIERRE.CIERRE_PARCIAL;
  }

  /**
   * Bucket para el gráfico de dona "Estado del Programa": refleja
   * directamente el vocabulario del Excel (Estatus), separando aparte las
   * extraordinarias/no programadas (que pueden estar en cualquier Estatus).
   */
  function computeDonutBucket(audit) {
    if (audit.esExtraordinaria) return "Extraordinarias";
    const labels = { POR_EJECUTAR: "Por Ejecutar", EJECUTADA: "Ejecutada", NO_EJECUTADA: "No Ejecutada", CANCELADA: "Cancelada" };
    return labels[audit.estadoCalculado] || "Por Ejecutar";
  }

  /**
   * Aplica el motor de estado a todas las auditorías (in-place + devuelve
   * el arreglo). `findingsByAuditId` es un Map<auditoria_id, hallazgo[]>
   * (ver app.js#attachFindingsToAudits) para calcular el rollup de cierre.
   */
  function applyAll(audits, findingsByAuditId) {
    audits.forEach((audit) => {
      audit.estadoCalculado = computeEstado(audit);
      audit.donutBucket = computeDonutBucket(audit);
      audit.cierreRollup = computeAuditoriaRollup(audit.estadoCalculado, findingsByAuditId ? findingsByAuditId.get(audit.id) : null);
      audit.diasParaVencer = audit.fechaProgramada ? u.daysBetween(new Date(), new Date(audit.fechaProgramada)) : null;
    });
    return audits;
  }

  return { ESTADOS, CIERRE, computeEstado, computeCierreHallazgo, computeAuditoriaRollup, computeDonutBucket, applyAll };
})();
