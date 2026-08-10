/**
 * js/statusEngine.js — Cálculo del estado real de cada auditoría
 * ============================================================================
 * Aquí se decide, para cada registro unificado que produjo matching.js, cuál
 * es su estado de ejecución REAL a partir de la evidencia encontrada (no del
 * estatus manual del cronograma, que solo se conserva como referencia).
 *
 * Estados posibles (QA.statusEngine.ESTADOS):
 *   EJECUTADA     - hay evidencia de realización o cierre (02_REA o 04_CIE
 *                   con archivos), o es un grupo FAA Self-Evaluation.
 *   EN_EJECUCION  - solo hay evidencia de aviso/notificación (01_AVI), aún
 *                   sin realización.
 *   VENCIDA       - la fecha programada ya pasó y no hay evidencia de
 *                   ejecución (ni aviso ni realización).
 *   PENDIENTE     - todavía no llega (o no tiene) la fecha programada y no
 *                   hay evidencia.
 *
 * Estas reglas son intencionalmente simples y están CENTRALIZADAS en este
 * archivo para que, tal como pide el proyecto, puedan ajustarse fácilmente
 * más adelante sin tocar el resto de la app (KPIs, gráficos y tablas solo
 * consumen "estadoCalculado", nunca recalculan evidencia).
 *
 * Desde que los datos viven en Supabase (editados a mano en vez de
 * escaneados de una carpeta local), ya no existen los orígenes especiales
 * "FAA_SELF_EVAL" / "EVIDENCE_ONLY" que distinguía el motor de cruce
 * anterior (js/matching.js, retirado): quien carga una auditoría FAA o una
 * evidencia suelta simplemente registra sus archivos en el conteo
 * "02_REA" (realización), y con eso basta para que cuente como ejecutada.
 */

window.QA = window.QA || {};

QA.statusEngine = (function () {
  const ESTADOS = { EJECUTADA: "EJECUTADA", EN_EJECUCION: "EN_EJECUCION", VENCIDA: "VENCIDA", PENDIENTE: "PENDIENTE" };

  function hasFiles(counts, key) { return !!(counts && counts[key] > 0); }

  function computeEstado(audit, today) {
    const counts = audit.evidenciaCounts;
    const ejecutada = hasFiles(counts, "02_REA") || hasFiles(counts, "04_CIE");
    if (ejecutada) return ESTADOS.EJECUTADA;

    const avisada = hasFiles(counts, "01_AVI") || hasFiles(counts, "03_SEG") || hasFiles(counts, "05_EVI");
    const fecha = audit.fechaProgramada;
    const vencida = fecha && fecha.getTime() < today.getTime();

    if (vencida) return ESTADOS.VENCIDA;
    if (avisada) return ESTADOS.EN_EJECUCION;
    return ESTADOS.PENDIENTE;
  }

  function computeCancelada(audit) {
    const text = QA.utils.normalize((audit.estatusManualCrono || "") + " " + (audit.estadoCierreHallazgosManualCrono || ""));
    return text.includes("CANCELAD");
  }

  function computeReprogramada(audit) {
    return !!audit.fechaReprogramacion;
  }

  /**
   * Bucket único para el gráfico de dona "Estado del Programa" (6 categorías
   * mutuamente excluyentes, en orden de prioridad). Las auditorías
   * "En Ejecución" y "Vencidas" -que sí tienen su propia tarjeta KPI- se
   * agrupan aquí bajo "Pendientes" para respetar exactamente las 6
   * categorías solicitadas sin duplicar información en la dona.
   */
  function computeDonutBucket(audit) {
    if (audit.esExtraordinaria) return "Extraordinarias";
    if (audit.esCancelada) return "Canceladas";
    if (audit.estadoCalculado === ESTADOS.EJECUTADA) return "Ejecutadas";
    if (audit.esReprogramada && audit.estadoCalculado !== ESTADOS.EJECUTADA) return "Reprogramadas";
    if (audit.estadoCalculado === ESTADOS.PENDIENTE) return "Programadas";
    return "Pendientes"; // VENCIDA o EN_EJECUCION
  }

  /** Aplica el motor de estado a todos los registros (in-place + devuelve el arreglo). */
  function applyAll(audits, today) {
    today = today || new Date();
    audits.forEach((audit) => {
      audit.estadoCalculado = computeEstado(audit, today);
      audit.esCancelada = computeCancelada(audit);
      audit.esReprogramada = computeReprogramada(audit);
      audit.donutBucket = computeDonutBucket(audit);
      audit.diasParaVencer = audit.fechaProgramada ? QA.utils.daysBetween(new Date(), new Date(audit.fechaProgramada)) : null;
    });
    return audits;
  }

  return { ESTADOS, computeEstado, computeCancelada, computeReprogramada, computeDonutBucket, applyAll };
})();
