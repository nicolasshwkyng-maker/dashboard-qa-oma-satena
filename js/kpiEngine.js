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

  /** scripts/apply-cierre-manual.mjs inserta hallazgos con condicion "N/A"
   * como marcador de cierre cuando una auditoría ejecutada no tenía NC/OB
   * registrados — solo existen para que statusEngine calcule el rollup de
   * cierre de esa auditoría (ver statusEngine#computeAuditoriaRollup). No
   * son hallazgos reales (la hoja HALLAZGOS_2026 nunca trae "N/A" en esa
   * columna) y deben quedar fuera de todo conteo/gráfico de hallazgos. */
  function hallazgosReales(findings) { return findings.filter(f => f.condicion !== "N/A"); }

  /* ------------------------------------------------------------------ *
   * Separar Auditorías de Inspecciones (columna "Tipo" del Excel 2026)
   * ------------------------------------------------------------------ */
  function porTipoRegistro(audits, tipo) { return audits.filter(a => a.tipoRegistro === tipo); }

  /* ------------------------------------------------------------------ *
   * KPIs principales (tarjetas superiores del dashboard)
   * ------------------------------------------------------------------ */
  function computeKpis(audits, findings, today) {
    today = today || new Date();
    findings = hallazgosReales(findings);
    const programadas = audits.filter(a => !a.esExtraordinaria);
    const extraordinarias = audits.filter(a => a.esExtraordinaria);
    const ejecutadas = audits.filter(a => a.estadoCalculado === EST.EJECUTADA);
    const ejecutadasProgramadas = programadas.filter(a => a.estadoCalculado === EST.EJECUTADA);
    const extraordinariasEjecutadas = extraordinarias.filter(a => a.estadoCalculado === EST.EJECUTADA);
    // "Programada" (fecha confirmada) es un subestado de pendiente: suma en Por Ejecutar.
    const porEjecutar = audits.filter(a => QA.statusEngine.esPendiente(a.estadoCalculado));
    const estatusProgramada = audits.filter(a => a.estadoCalculado === EST.PROGRAMADA);
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
      estatusProgramada: estatusProgramada.length,
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
        porEjecutar, estatusProgramada, noEjecutadas, canceladas, proximos30Dias: en30dias,
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

  /** Misma "meta hoy" que avanceEsperadoVsReal (el cronograma original no
   * cambia), pero el avance real SUMA las extraordinarias ejecutadas —
   * mismo criterio que avanceTotalPct en computeKpis. Deja ver si, aunque
   * las programadas vayan atrasadas, las no programadas ya cerraron (o
   * superaron) la brecha contra la meta. Puede superar el 100%. */
  function avanceEsperadoVsRealConNoProgramadas(audits, today) {
    today = today || new Date();
    const programadas = audits.filter(a => !a.esExtraordinaria);
    const extraordinarias = audits.filter(a => a.esExtraordinaria);
    const total = programadas.length;
    const deberianEstarHechas = programadas.filter(a => a.fechaProgramada && a.fechaProgramada.getTime() <= today.getTime()).length;
    const ejecutadasProgramadas = programadas.filter(a => a.estadoCalculado === EST.EJECUTADA).length;
    const extraordinariasEjecutadas = extraordinarias.filter(a => a.estadoCalculado === EST.EJECUTADA).length;
    const esperadoPct = total ? (deberianEstarHechas / total) * 100 : 0;
    const realPct = total ? ((ejecutadasProgramadas + extraordinariasEjecutadas) / total) * 100 : 0;
    return {
      total, deberianEstarHechas, ejecutadasProgramadas, extraordinariasEjecutadas,
      esperadoPct: Math.round(esperadoPct * 10) / 10,
      realPct: Math.round(realPct * 10) / 10,
      brechaPct: Math.round((realPct - esperadoPct) * 10) / 10,
    };
  }

  /* ------------------------------------------------------------------ *
   * Programa: programadas vs ejecutadas por mes (+ no programadas)
   * ------------------------------------------------------------------ */
  /** Compara el PLAN original contra lo realmente ejecutado, mes a mes:
   *   - programadas: se ubican por su fecha proyectada ORIGINAL
   *     (fechaProgramada, columna I) — una auditoría planeada para febrero
   *     cuenta como programada de febrero aunque se haya ejecutado en marzo.
   *   - ejecutadas / extraordinarias (no programadas ejecutadas): se ubican
   *     por su fecha de referencia (statusEngine#computeFechaReferencia:
   *     ejecución real si existe, si no la proyectada).
   * Las 2 últimas se apilan en una sola barra en el gráfico (total
   * ejecutado del mes) contra la barra de programadas. */
  function programaPorMes(audits) {
    const buckets = Array.from({ length: 12 }, () => ({ programadas: 0, ejecutadas: 0, extraordinarias: 0 }));
    audits.forEach((a) => {
      if (!a.esExtraordinaria && a.fechaProgramada) buckets[a.fechaProgramada.getMonth()].programadas++;
      if (a.estadoCalculado !== EST.EJECUTADA || !a.fechaReferencia) return;
      const m = a.fechaReferencia.getMonth();
      if (a.esExtraordinaria) buckets[m].extraordinarias++; else buckets[m].ejecutadas++;
    });
    return {
      labels: u.MONTH_ABBR,
      programadas: buckets.map(b => b.programadas),
      ejecutadas: buckets.map(b => b.ejecutadas),
      extraordinarias: buckets.map(b => b.extraordinarias),
    };
  }

  /** Auditorías detrás de UNA barra del gráfico mensual (drill-down al
   * hacer clic) — mismo criterio exacto que programaPorMes, para que el
   * detalle siempre coincida con el número mostrado. `categoria` ∈
   * "programadas" | "ejecutadas" | "extraordinarias". */
  function auditoriasDeMes(audits, monthIndex, categoria) {
    return audits.filter((a) => {
      if (categoria === "programadas") return !a.esExtraordinaria && !!a.fechaProgramada && a.fechaProgramada.getMonth() === monthIndex;
      if (a.estadoCalculado !== EST.EJECUTADA || !a.fechaReferencia || a.fechaReferencia.getMonth() !== monthIndex) return false;
      return categoria === "extraordinarias" ? a.esExtraordinaria : (categoria === "ejecutadas" && !a.esExtraordinaria);
    });
  }

  function countBy(audits, keyFn) {
    const map = new Map();
    audits.forEach((a) => {
      const key = keyFn(a) || "No especificado";
      map.set(key, (map.get(key) || 0) + 1);
    });
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }

  /** Items detrás de UNA barra/porción de dona agrupada por `keyFn` — mismo
   * criterio exacto que countBy, para drill-down al hacer clic en el
   * gráfico (ver app.js). */
  function itemsWhere(items, keyFn, label) {
    return items.filter(it => (keyFn(it) || "No especificado") === label);
  }

  const keyClasificacion = a => a.clasificacionLabel;
  const keyModalidad = a => a.modalidad;
  const keyUbicacion = a => a.ciudad;
  const keyHallazgoClasificacion = f => f.clasificacionReporte;

  function porClasificacion(audits) { return countBy(audits, keyClasificacion); }
  function porModalidad(audits) { return countBy(audits, keyModalidad); }
  function porUbicacion(audits) { return countBy(audits, keyUbicacion); }
  /** Auditorías FAA ("limited ratings" de la propia OMA): filas de
   * AUDITORIAS_2026 cuyo nombre coincide con alguna categoría de
   * QA.config.FAA_SELF_EVAL.categories (ver data.js). */
  function faaAuditorias(audits) {
    const cats = QA.config.FAA_SELF_EVAL.categories.map(c => u.normalize(c.cronogramaAuditadoMatch));
    return audits.filter((a) => { const n = u.normalize(a.auditado); return cats.some(c => n.includes(c)); });
  }

  /** Programadas vs ejecutadas por ubicación (ciudad): mismas 3 series que
   * programaPorMes — programadas (todas las programadas del lugar),
   * ejecutadas (programadas ya ejecutadas) y extraordinarias (no
   * programadas ejecutadas). Ordenado de mayor a menor actividad. */
  function programaPorUbicacion(audits) {
    const map = new Map();
    audits.forEach((a) => {
      const key = keyUbicacion(a) || "No especificado";
      if (!map.has(key)) map.set(key, { programadas: 0, ejecutadas: 0, extraordinarias: 0 });
      const b = map.get(key);
      const ejecutada = a.estadoCalculado === EST.EJECUTADA;
      if (!a.esExtraordinaria) { b.programadas++; if (ejecutada) b.ejecutadas++; }
      else if (ejecutada) b.extraordinarias++;
    });
    const rows = [...map.entries()].sort((x, y) =>
      (y[1].programadas + y[1].ejecutadas + y[1].extraordinarias) - (x[1].programadas + x[1].ejecutadas + x[1].extraordinarias));
    return {
      labels: rows.map(r => r[0]),
      programadas: rows.map(r => r[1].programadas),
      ejecutadas: rows.map(r => r[1].ejecutadas),
      extraordinarias: rows.map(r => r[1].extraordinarias),
    };
  }
  /** Drill-down de una barra de programaPorUbicacion. `categoria` ∈
   * "programadas" | "ejecutadas" | "extraordinarias". */
  function auditoriasDeUbicacion(audits, label, categoria) {
    return itemsWhere(audits, keyUbicacion, label).filter((a) => {
      if (categoria === "programadas") return !a.esExtraordinaria;
      if (a.estadoCalculado !== EST.EJECUTADA) return false;
      return categoria === "extraordinarias" ? a.esExtraordinaria : (categoria === "ejecutadas" && !a.esExtraordinaria);
    });
  }

  function auditoriasPorClasificacionItems(audits, label) { return itemsWhere(audits, keyClasificacion, label); }
  function auditoriasPorModalidadItems(audits, label) { return itemsWhere(audits, keyModalidad, label); }
  function auditoriasPorUbicacionItems(audits, label) { return itemsWhere(audits, keyUbicacion, label); }

  function estadoPrograma(audits) {
    const order = ["Por Ejecutar", "Programada", "Ejecutada", "No Ejecutada", "Cancelada", "Extraordinarias"];
    const counts = countBy(audits, a => a.donutBucket);
    const map = new Map(counts);
    return order.map(label => ({ label, value: map.get(label) || 0 }));
  }
  function estadoProgramaItems(audits, label) { return audits.filter(a => a.donutBucket === label); }

  const CIERRE_LABEL_FOR = { CERRADO: "Cerrada", ABIERTO: "Abierta", CIERRE_PARCIAL: "Cierre Parcial" };

  /** Dona "Auditorías por Cierre": rollup calculado a partir de los
   * hallazgos vinculados a cada auditoría EJECUTADA (ver
   * statusEngine#computeAuditoriaRollup) — las que aún no se ejecutan no
   * tienen "cierreRollup" (null) y quedan fuera de este gráfico. */
  function auditoriasPorCierre(audits) {
    const order = ["Cerrada", "Abierta", "Cierre Parcial"];
    const ejecutadas = audits.filter(a => a.cierreRollup);
    const counts = countBy(ejecutadas, a => CIERRE_LABEL_FOR[a.cierreRollup]);
    const map = new Map(counts);
    return order.map(label => ({ label, value: map.get(label) || 0 }));
  }
  function auditoriasPorCierreItems(audits, label) {
    return audits.filter(a => a.cierreRollup && CIERRE_LABEL_FOR[a.cierreRollup] === label);
  }

  /* ------------------------------------------------------------------ *
   * Hallazgos
   * ------------------------------------------------------------------ */
  function hallazgosPorEstado(findings) {
    return countBy(hallazgosReales(findings), f => estadoEfectivo(f));
  }
  function hallazgosPorEstadoItems(findings, label) { return itemsWhere(hallazgosReales(findings), estadoEfectivo, label); }
  function hallazgosPorClasificacion(findings) {
    return countBy(hallazgosReales(findings), keyHallazgoClasificacion);
  }
  function hallazgosPorClasificacionItems(findings, label) { return itemsWhere(hallazgosReales(findings), keyHallazgoClasificacion, label); }

  /* Clasificación estandarizada del reporte (columna AK, oct-2026):
   * "<INT|EXT>-<código> <categoría>" — INT = proceso interno (área/taller/base
   * propia), EXT = proveedor externo. Ver Criterios_Clasificacion_Hallazgos.xlsx.
   * Una etiqueta que no siga el formato (libros anteriores) queda como su propia
   * categoría, en la serie "Sin proceso". */
  const RE_CLASIF = /^(INT|EXT)-(\d{2})\s+(.+)$/;
  const PROCESOS = ["Interno", "Externo", "Sin proceso"];
  function procesoHallazgo(f) {
    const m = RE_CLASIF.exec(String(f.clasificacionReporte || "").trim());
    return m ? (m[1] === "INT" ? "Interno" : "Externo") : "Sin proceso";
  }
  function categoriaHallazgo(f) {
    const t = String(f.clasificacionReporte || "").trim();
    const m = RE_CLASIF.exec(t);
    return m ? `${m[2]} ${m[3]}` : (t || "No especificado");
  }
  function hallazgosPorClasificacionProceso(findings) {
    const map = new Map();
    hallazgosReales(findings).forEach((f) => {
      const c = categoriaHallazgo(f);
      if (!map.has(c)) map.set(c, { Interno: 0, Externo: 0, "Sin proceso": 0 });
      map.get(c)[procesoHallazgo(f)]++;
    });
    const labels = [...map.keys()].sort((a, b) => a.localeCompare(b, "es", { numeric: true }));
    const serie = (p) => labels.map((l) => map.get(l)[p]);
    return { labels, interno: serie("Interno"), externo: serie("Externo"), sinProceso: serie("Sin proceso") };
  }
  function hallazgosPorClasificacionProcesoItems(findings, categoria, proceso) {
    return hallazgosReales(findings).filter((f) => categoriaHallazgo(f) === categoria && (!proceso || procesoHallazgo(f) === proceso));
  }
  function hallazgosPorProceso(findings) {
    const reales = hallazgosReales(findings);
    return PROCESOS.map((p) => [p, reales.filter((f) => procesoHallazgo(f) === p).length]).filter(([, n]) => n > 0);
  }
  function hallazgosPorProcesoItems(findings, proceso) { return hallazgosReales(findings).filter((f) => procesoHallazgo(f) === proceso); }
  /** Emitidos (por fecha de notificación) vs cerrados (por fecha de cierre de reporte), por mes. */
  function hallazgosTendenciaMensual(findings) {
    findings = hallazgosReales(findings);
    const buckets = Array.from({ length: 12 }, () => ({ emitidos: 0, cerrados: 0 }));
    findings.forEach((f) => {
      const emitDate = f.fechaNotificacion || f.fechaInicio;
      if (emitDate) buckets[emitDate.getMonth()].emitidos++;
      if (f.fechaCierreReporte) buckets[f.fechaCierreReporte.getMonth()].cerrados++;
    });
    return { labels: u.MONTH_ABBR, emitidos: buckets.map(b => b.emitidos), cerrados: buckets.map(b => b.cerrados) };
  }
  /** `serie` ∈ "emitidos" | "cerrados" — drill-down del gráfico de tendencia mensual. */
  function hallazgosTendenciaItems(findings, monthIndex, serie) {
    findings = hallazgosReales(findings);
    if (serie === "cerrados") return findings.filter(f => f.fechaCierreReporte && f.fechaCierreReporte.getMonth() === monthIndex);
    return findings.filter((f) => {
      const d = f.fechaNotificacion || f.fechaInicio;
      return d && d.getMonth() === monthIndex;
    });
  }
  function hallazgosEmitidosVsCerrados(findings) {
    findings = hallazgosReales(findings);
    return { emitidos: findings.length, cerrados: findings.filter(f => estadoEfectivo(f) === "Cerrado").length };
  }

  return {
    computeKpis, avanceEsperadoVsReal, avanceEsperadoVsRealConNoProgramadas, programaPorMes, auditoriasDeMes,
    porClasificacion, porModalidad, porUbicacion, programaPorUbicacion, auditoriasDeUbicacion, faaAuditorias, porTipoRegistro,
    auditoriasPorClasificacionItems, auditoriasPorModalidadItems, auditoriasPorUbicacionItems,
    estadoPrograma, estadoProgramaItems, auditoriasPorCierre, auditoriasPorCierreItems,
    hallazgosReales,
    hallazgosPorEstado, hallazgosPorEstadoItems, hallazgosPorClasificacion, hallazgosPorClasificacionItems,
    procesoHallazgo, hallazgosPorClasificacionProceso, hallazgosPorClasificacionProcesoItems, hallazgosPorProceso, hallazgosPorProcesoItems,
    hallazgosTendenciaMensual, hallazgosTendenciaItems,
    hallazgosEmitidosVsCerrados,
  };
})();
