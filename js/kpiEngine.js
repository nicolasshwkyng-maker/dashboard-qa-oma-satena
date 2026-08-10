/**
 * js/kpiEngine.js — Cálculo de indicadores (KPIs) y agregaciones para gráficos
 * ============================================================================
 * Módulo puro: recibe el arreglo unificado de auditorías (ya con
 * "estadoCalculado" asignado por statusEngine.js) y el arreglo de hallazgos
 * (ya vinculados por matching.linkFindingsToAudits), y devuelve números y
 * agregaciones listas para pintar. No toca el DOM ni Chart.js — así se
 * puede recalcular en cada cambio de filtro sin acoplarse a la capa visual.
 */

window.QA = window.QA || {};

QA.kpiEngine = (function () {
  const u = QA.utils;
  const EST = QA.statusEngine.ESTADOS;

  /**
   * Cada fila de la hoja "Hallazgos Auditoria" cuenta como un hallazgo
   * registrado — así es como el equipo QA lo cuenta manualmente (61 filas
   * = 61 hallazgos), incluyendo las filas con CONDICIÓN "N/A" (auditorías
   * cerradas sin no-conformidades/observaciones, pero igualmente
   * registradas como parte del seguimiento) y sin dato (auditorías cuya
   * determinación de hallazgos aún está pendiente). NO se filtra por
   * CONDICIÓN — se cambió esta regla tras validar el conteo con el
   * usuario (ver README.md).
   *
   * Estado efectivo de una fila: usa el estado propio del hallazgo
   * (columna "ESTADO") y, si esa fila todavía no lo tiene diligenciado,
   * cae al estado general de la auditoría (columna "ESTADO DE LA
   * AUDITORÍA") como mejor aproximación disponible.
   */
  function estadoEfectivo(f) { return f.estadoHallazgo || f.estadoAuditoria || null; }

  /* ------------------------------------------------------------------ *
   * KPIs principales (tarjetas superiores del dashboard)
   * ------------------------------------------------------------------ */
  function computeKpis(audits, findings, today) {
    today = today || new Date();
    const programadas = audits.filter(a => !a.esExtraordinaria);
    const ejecutadas = audits.filter(a => a.estadoCalculado === EST.EJECUTADA);
    const ejecutadasProgramadas = programadas.filter(a => a.estadoCalculado === EST.EJECUTADA);
    const pendientes = audits.filter(a => a.estadoCalculado === EST.PENDIENTE);
    const extraordinarias = audits.filter(a => a.esExtraordinaria);
    const enEjecucion = audits.filter(a => a.estadoCalculado === EST.EN_EJECUCION);
    const vencidas = audits.filter(a => a.estadoCalculado === EST.VENCIDA);

    const en30dias = (() => {
      const limite = new Date(today.getTime() + QA.config.KPI.PROXIMOS_DIAS * 86400000);
      return audits.filter(a => a.fechaProgramada && a.estadoCalculado !== EST.EJECUTADA &&
        a.fechaProgramada.getTime() >= today.getTime() && a.fechaProgramada.getTime() <= limite.getTime());
    })();

    const hallazgosAbiertos = findings.filter(f => estadoEfectivo(f) === "Abierto");
    const hallazgosCerrados = findings.filter(f => estadoEfectivo(f) === "Cerrado");

    // % Cumplimiento: se mide contra el total PROGRAMADO al inicio del año
    // (denominador fijo), pero en el numerador se cuentan TODAS las
    // auditorías ejecutadas, incluidas las extraordinarias/no programadas
    // (regla de negocio definida por el usuario: una extraordinaria
    // ejecutada también aporta al avance real del programa). Por eso el
    // indicador puede superar el 100% si, además de cumplirse todo lo
    // proyectado, se ejecutan auditorías adicionales no programadas.
    const cumplimiento = programadas.length ? (ejecutadas.length / programadas.length) * 100 : 0;

    return {
      programadas: programadas.length,
      ejecutadas: ejecutadas.length,
      ejecutadasProgramadas: ejecutadasProgramadas.length,
      pendientes: pendientes.length,
      extraordinarias: extraordinarias.length,
      enEjecucion: enEjecucion.length,
      vencidas: vencidas.length,
      proximos30Dias: en30dias.length,
      cumplimientoPct: Math.round(cumplimiento * 10) / 10,
      hallazgosTotal: findings.length,
      hallazgosAbiertos: hallazgosAbiertos.length,
      hallazgosCerrados: hallazgosCerrados.length,
      totalAuditorias: audits.length,
      // Listas crudas (mismos criterios que arriba) para poder mostrar el
      // detalle al hacer clic en una tarjeta KPI (ver app.js openKpiModal).
      lists: {
        totalAuditorias: audits,
        programadas, ejecutadas, ejecutadasProgramadas, pendientes, extraordinarias,
        enEjecucion, vencidas, proximos30Dias: en30dias,
        hallazgosTotal: findings, hallazgosAbiertos, hallazgosCerrados,
      },
    };
  }

  /* ------------------------------------------------------------------ *
   * Programa: programadas vs ejecutadas por mes (+ extraordinarias)
   * ------------------------------------------------------------------ */
  /** Mejor fecha disponible para ubicar una extraordinaria en el mes en que
   * realmente se ejecutó: no tiene fecha programada por definición. Se
   * prioriza "fechaEjecucionReal" — campo editable a mano en el formulario
   * de auditoría (ver js/dataService.js) — sobre la fecha de evidencia,
   * porque esta última resultó no ser confiable (la fecha de modificación
   * de archivos sincronizados en la nube no refleja la fecha real de
   * ejecución; ver historial de la app). Sin "fechaEjecucionReal" cargada,
   * la auditoría simplemente no aparece en el gráfico mensual — mejor
   * omitirla que mostrar una fecha incorrecta. */
  function fechaEjecucionExtraordinaria(a) {
    return a.fechaEjecucionReal || a.primeraFechaEvidencia || a.ultimaFechaEvidencia || null;
  }

  function programaPorMes(audits) {
    const buckets = Array.from({ length: 12 }, () => ({ programadas: 0, ejecutadas: 0, extraordinarias: 0 }));
    audits.forEach((a) => {
      if (a.esExtraordinaria) {
        if (a.estadoCalculado !== EST.EJECUTADA) return;
        const fecha = fechaEjecucionExtraordinaria(a);
        if (!fecha) return;
        buckets[fecha.getMonth()].extraordinarias++;
        return;
      }
      if (!a.fechaProgramada) return;
      const m = a.fechaProgramada.getMonth();
      buckets[m].programadas++;
      if (a.estadoCalculado === EST.EJECUTADA) buckets[m].ejecutadas++;
    });
    return {
      labels: u.MONTH_ABBR,
      programadas: buckets.map(b => b.programadas),
      ejecutadas: buckets.map(b => b.ejecutadas),
      extraordinarias: buckets.map(b => b.extraordinarias),
    };
  }

  function countBy(audits, keyFn) {
    const map = new Map();
    audits.forEach((a) => {
      const key = keyFn(a) || "No especificado";
      map.set(key, (map.get(key) || 0) + 1);
    });
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }

  function porClasificacion(audits) { return countBy(audits, a => a.clasificacionLabel); }
  function porModalidad(audits) { return countBy(audits, a => a.modalidad); }
  function porUbicacion(audits) { return countBy(audits, a => a.ciudad); }
  function faaPorCategoria(faaDocs) { return countBy(faaDocs, d => d.categoryLabel); }

  function estadoPrograma(audits) {
    const order = ["Programadas", "Ejecutadas", "Pendientes", "Reprogramadas", "Canceladas", "Extraordinarias"];
    const counts = countBy(audits, a => a.donutBucket);
    const map = new Map(counts);
    return order.map(label => ({ label, value: map.get(label) || 0 }));
  }

  /* ------------------------------------------------------------------ *
   * Hallazgos
   * ------------------------------------------------------------------ */
  function hallazgosPorEstado(findings) {
    return countBy(findings, f => estadoEfectivo(f));
  }
  function hallazgosPorClasificacion(findings) {
    return countBy(findings, f => f.clasificacionReporte);
  }
  function hallazgosPorProceso(findings) {
    return countBy(findings, f => f.procesoReporte);
  }
  /** Emitidos (por fecha de notificación) vs cerrados (por fecha de cierre de reporte), por mes. */
  function hallazgosTendenciaMensual(findings) {
    const buckets = Array.from({ length: 12 }, () => ({ emitidos: 0, cerrados: 0 }));
    findings.forEach((f) => {
      const emitDate = f.fechaNotificacion || f.fechaInicio;
      if (emitDate) buckets[emitDate.getMonth()].emitidos++;
      if (f.fechaCierreReporte) buckets[f.fechaCierreReporte.getMonth()].cerrados++;
    });
    return { labels: u.MONTH_ABBR, emitidos: buckets.map(b => b.emitidos), cerrados: buckets.map(b => b.cerrados) };
  }
  function hallazgosEmitidosVsCerrados(findings) {
    return { emitidos: findings.length, cerrados: findings.filter(f => estadoEfectivo(f) === "Cerrado").length };
  }

  return {
    computeKpis, programaPorMes, porClasificacion, porModalidad, porUbicacion, faaPorCategoria,
    estadoPrograma, hallazgosPorEstado, hallazgosPorClasificacion, hallazgosPorProceso,
    hallazgosTendenciaMensual, hallazgosEmitidosVsCerrados,
  };
})();
