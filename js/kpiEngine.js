/**
 * js/kpiEngine.js — Cálculo de indicadores (KPIs) y agregaciones para gráficos
 * ============================================================================
 * Módulo puro: recibe el arreglo unificado de auditorías (ya con
 * "estadoCalculado"/"cierreRollup" asignado por statusEngine.js) y el
 * arreglo de hallazgos, y devuelve números y agregaciones listas para
 * pintar. No toca el DOM ni Chart.js — así se puede recalcular en cada
 * cambio de filtro sin acoplarse a la capa visual.
 */

window.QA = window.QA || {};

QA.kpiEngine = (function () {
  const u = QA.utils;
  const EST = QA.statusEngine.ESTADOS;
  const CIERRE = QA.statusEngine.CIERRE;

  /** Cada fila de la hoja HALLAZGOS_2026 cuenta como un hallazgo registrado
   * (igual criterio validado con el usuario para la fuente anterior). El
   * estado de cierre viene directo de la columna "ESTADO" (Abierto/Cerrado/
   * Cierre Parcial) — ya no hace falta caer al estado de la auditoría. */
  function estadoEfectivo(f) { return f.estadoHallazgo || null; }

  /* ------------------------------------------------------------------ *
   * Separar Auditorías de Inspecciones (columna "Tipo" del Excel 2026)
   * ------------------------------------------------------------------ */
  function porTipoRegistro(audits, tipo) { return audits.filter(a => a.tipoRegistro === tipo); }

  /* ------------------------------------------------------------------ *
   * KPIs principales (tarjetas superiores del dashboard)
   * ------------------------------------------------------------------ */
  function computeKpis(audits, findings, today) {
    today = today || new Date();
    const programadas = audits.filter(a => !a.esExtraordinaria);
    const extraordinarias = audits.filter(a => a.esExtraordinaria);
    const ejecutadas = audits.filter(a => a.estadoCalculado === EST.EJECUTADA);
    const ejecutadasProgramadas = programadas.filter(a => a.estadoCalculado === EST.EJECUTADA);
    const extraordinariasEjecutadas = extraordinarias.filter(a => a.estadoCalculado === EST.EJECUTADA);
    const porEjecutar = audits.filter(a => a.estadoCalculado === EST.POR_EJECUTAR);
    const noEjecutadas = audits.filter(a => a.estadoCalculado === EST.NO_EJECUTADA);
    const canceladas = audits.filter(a => a.estadoCalculado === EST.CANCELADA);

    const en30dias = (() => {
      const limite = new Date(today.getTime() + QA.config.KPI.PROXIMOS_DIAS * 86400000);
      return audits.filter(a => a.fechaReferencia && a.estadoCalculado !== EST.EJECUTADA &&
        a.fechaReferencia.getTime() >= today.getTime() && a.fechaReferencia.getTime() <= limite.getTime());
    })();

    const hallazgosAbiertos = findings.filter(f => estadoEfectivo(f) === "Abierto");
    const hallazgosCerrados = findings.filter(f => estadoEfectivo(f) === "Cerrado");
    const hallazgosCierreParcial = findings.filter(f => estadoEfectivo(f) === "Cierre Parcial");

    const auditoriasCerradas = audits.filter(a => a.cierreRollup === CIERRE.CERRADO);
    const auditoriasAbiertas = audits.filter(a => a.cierreRollup === CIERRE.ABIERTO);
    const auditoriasCierreParcial = audits.filter(a => a.cierreRollup === CIERRE.CIERRE_PARCIAL);

    // % Cumplimiento del CRONOGRAMA ORIGINAL: solo cuenta lo programado
    // desde el inicio — nunca puede superar 100%.
    const cumplimientoOriginal = programadas.length ? (ejecutadasProgramadas.length / programadas.length) * 100 : 0;
    // % Avance TOTAL del programa: al numerador de arriba se le suman las
    // extraordinarias ejecutadas — SÍ puede superar 100%, mostrando
    // explícitamente cuánto aportaron las auditorías no programadas.
    const avanceTotal = programadas.length ? ((ejecutadasProgramadas.length + extraordinariasEjecutadas.length) / programadas.length) * 100 : 0;

    return {
      programadas: programadas.length,
      ejecutadas: ejecutadas.length,
      ejecutadasProgramadas: ejecutadasProgramadas.length,
      extraordinarias: extraordinarias.length,
      extraordinariasEjecutadas: extraordinariasEjecutadas.length,
      porEjecutar: porEjecutar.length,
      noEjecutadas: noEjecutadas.length,
      canceladas: canceladas.length,
      proximos30Dias: en30dias.length,
      cumplimientoOriginalPct: Math.round(cumplimientoOriginal * 10) / 10,
      avanceTotalPct: Math.round(avanceTotal * 10) / 10,
      hallazgosTotal: findings.length,
      hallazgosAbiertos: hallazgosAbiertos.length,
      hallazgosCerrados: hallazgosCerrados.length,
      hallazgosCierreParcial: hallazgosCierreParcial.length,
      auditoriasCerradas: auditoriasCerradas.length,
      auditoriasAbiertas: auditoriasAbiertas.length,
      auditoriasCierreParcial: auditoriasCierreParcial.length,
      totalAuditorias: audits.length,
      // Listas crudas (mismos criterios que arriba) para poder mostrar el
      // detalle al hacer clic en una tarjeta KPI (ver app.js openKpiModal).
      lists: {
        totalAuditorias: audits,
        programadas, ejecutadas, ejecutadasProgramadas, extraordinarias, extraordinariasEjecutadas,
        porEjecutar, noEjecutadas, canceladas, proximos30Dias: en30dias,
        hallazgosTotal: findings, hallazgosAbiertos, hallazgosCerrados, hallazgosCierreParcial,
        auditoriasCerradas, auditoriasAbiertas, auditoriasCierreParcial,
      },
    };
  }

  /* ------------------------------------------------------------------ *
   * Avance esperado vs real, con corte a hoy (para el gauge "Brecha de
   * Ejecución"). Solo considera auditorías PROGRAMADAS (las extraordinarias
   * no tenían fecha comprometida desde el inicio, así que no aplican a
   * "cuánto debería llevar hoy" del cronograma original).
   *   - esperadoPct: % de lo programado cuya fecha ya pasó (debería estar
   *     ejecutado a esta altura del cronograma).
   *   - realPct: % de lo programado que realmente está ejecutado hoy
   *     (igual criterio que cumplimientoOriginalPct).
   *   - brechaPct: real - esperado. Negativo = atrasado, positivo = adelantado.
   * ------------------------------------------------------------------ */
  function avanceEsperadoVsReal(audits, today) {
    today = today || new Date();
    const programadas = audits.filter(a => !a.esExtraordinaria);
    const total = programadas.length;
    const deberianEstarHechas = programadas.filter(a => a.fechaProgramada && a.fechaProgramada.getTime() <= today.getTime()).length;
    const ejecutadasProgramadas = programadas.filter(a => a.estadoCalculado === EST.EJECUTADA).length;
    const esperadoPct = total ? (deberianEstarHechas / total) * 100 : 0;
    const realPct = total ? (ejecutadasProgramadas / total) * 100 : 0;
    return {
      total, deberianEstarHechas, ejecutadasProgramadas,
      esperadoPct: Math.round(esperadoPct * 10) / 10,
      realPct: Math.round(realPct * 10) / 10,
      brechaPct: Math.round((realPct - esperadoPct) * 10) / 10,
    };
  }

  /* ------------------------------------------------------------------ *
   * Programa: programadas vs ejecutadas por mes (+ extraordinarias)
   * ------------------------------------------------------------------ */
  /** Se ubica cada auditoría por "fechaReferencia" (ver
   * statusEngine#computeFechaReferencia): columna J "Ejecucion Reprogramada"
   * si tiene valor, si no columna I "Fecha Proyectada" — regla del usuario,
   * aplica igual a programadas y extraordinarias. Sin ninguna de las 2, la
   * auditoría no aparece en el gráfico mensual. */
  function programaPorMes(audits) {
    const buckets = Array.from({ length: 12 }, () => ({ programadas: 0, ejecutadas: 0, extraordinarias: 0 }));
    audits.forEach((a) => {
      const fecha = a.fechaReferencia;
      if (!fecha) return;
      const m = fecha.getMonth();
      if (a.esExtraordinaria) {
        if (a.estadoCalculado === EST.EJECUTADA) buckets[m].extraordinarias++;
        return;
      }
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
    const order = ["Por Ejecutar", "Ejecutada", "No Ejecutada", "Cancelada", "Extraordinarias"];
    const counts = countBy(audits, a => a.donutBucket);
    const map = new Map(counts);
    return order.map(label => ({ label, value: map.get(label) || 0 }));
  }

  /** Dona "Auditorías por Cierre": rollup calculado a partir de los
   * hallazgos vinculados a cada auditoría EJECUTADA (ver
   * statusEngine#computeAuditoriaRollup) — las que aún no se ejecutan no
   * tienen "cierreRollup" (null) y quedan fuera de este gráfico. */
  function auditoriasPorCierre(audits) {
    const order = ["Cerrada", "Abierta", "Cierre Parcial"];
    const labelFor = { CERRADO: "Cerrada", ABIERTO: "Abierta", CIERRE_PARCIAL: "Cierre Parcial" };
    const ejecutadas = audits.filter(a => a.cierreRollup);
    const counts = countBy(ejecutadas, a => labelFor[a.cierreRollup]);
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
    computeKpis, avanceEsperadoVsReal, programaPorMes, porClasificacion, porModalidad, porUbicacion, faaPorCategoria, porTipoRegistro,
    estadoPrograma, auditoriasPorCierre, hallazgosPorEstado, hallazgosPorClasificacion, hallazgosPorProceso,
    hallazgosTendenciaMensual, hallazgosEmitidosVsCerrados,
  };
})();
