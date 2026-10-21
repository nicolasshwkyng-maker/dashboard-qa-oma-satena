/**
 * js/charts.js — Renderizado de todos los gráficos (Chart.js)
 * ============================================================================
 * Capa puramente visual: recibe datos YA agregados por kpiEngine.js y
 * dibuja/actualiza los gráficos. No conoce auditorías ni hallazgos crudos,
 * solo arreglos {label, value} o series ya calculadas — así que agregar o
 * cambiar un gráfico nunca requiere tocar la lógica de negocio.
 *
 * Los gráficos se crean una sola vez (initAll) y luego se actualizan
 * in-place (updateAll) cada vez que cambian los filtros globales, en vez
 * de destruir y recrear el canvas — es más fluido y evita parpadeos.
 */

window.QA = window.QA || {};

QA.charts = (function () {
  const instances = {};

  // Nombres cortos sobre la paleta central (QA.config.PALETTE, en data.js).
  const P = QA.config.PALETTE;
  const PALETTE = {
    azul: P.azul, azulM: P.acero, azulL: P.aceroL,
    amarillo: P.amarillo,
    rojo: P.rojo, rojoL: P.rojoL,
    verde: P.verde, verdeL: P.verdeL,
    gris: P.azul, grisM: P.gris, grisL: P.grisL,
  };

  const DONUT_BUCKET_COLORS = {
    "Por Ejecutar": PALETTE.azulM,
    "Programada": P.aceroM,
    "Ejecutada": PALETTE.verde,
    "No Ejecutada": PALETTE.rojo,
    "Cancelada": PALETTE.grisM,
    "Extraordinarias": PALETTE.amarillo,
  };

  const CIERRE_COLORS = {
    "Cerrada": PALETTE.verde,
    "Abierta": PALETTE.rojo,
    "Cierre Parcial": PALETTE.amarillo,
  };

  const CATEGORY_SERIES_COLORS = Object.values(QA.config.CATEGORY_COLORS).map(c => c[0]);

  if (window.Chart) {
    Chart.defaults.font.family = "'IBM Plex Sans', 'Segoe UI', system-ui, sans-serif";
    Chart.defaults.color = PALETTE.grisM;
    Chart.defaults.plugins.legend.labels.usePointStyle = true;
    Chart.defaults.plugins.legend.labels.boxWidth = 8;
    Chart.defaults.plugins.legend.labels.font = { size: 11 };
    Chart.defaults.plugins.tooltip.backgroundColor = PALETTE.gris;
    Chart.defaults.plugins.tooltip.padding = 10;
    Chart.defaults.plugins.tooltip.cornerRadius = 6;
    Chart.defaults.plugins.tooltip.titleFont = { size: 12, weight: "600" };
    Chart.defaults.plugins.tooltip.bodyFont = { size: 12 };
  }

  function getOrCreate(id, config) {
    const canvas = document.getElementById(id);
    if (!canvas) return null;
    if (instances[id]) { instances[id].destroy(); }
    instances[id] = new Chart(canvas.getContext("2d"), config);
    return instances[id];
  }

  /** Drill-down: todo gráfico clicable recibe `onClick(label, datasetLabel,
   * index, datasetIndex)` — `label` es el valor del eje (categoría/mes),
   * `datasetLabel` el nombre de la serie (para gráficos con más de una,
   * ej. "Ejecutadas" vs "No Programadas Ejecutadas"), e `index`/
   * `datasetIndex` los índices crudos de Chart.js por si hacen falta
   * (ej. número de mes 0-11). También cambia el cursor a "pointer" al
   * pasar por encima de un elemento clicable. */
  function withClickHandlers(options, onClick) {
    if (!onClick) return options;
    options.onClick = (evt, elements, chart) => {
      if (!elements.length) return;
      const el = elements[0];
      const label = chart.data.labels[el.index];
      const ds = chart.data.datasets[el.datasetIndex];
      onClick(label, ds ? ds.label : null, el.index, el.datasetIndex);
    };
    options.onHover = (evt, elements) => {
      if (evt.native && evt.native.target) evt.native.target.style.cursor = elements.length ? "pointer" : "default";
    };
    return options;
  }

  function barConfig({ labels, datasets, horizontal, stacked, onClick, tooltipFooter }) {
    return {
      type: "bar",
      data: { labels, datasets },
      options: withClickHandlers({
        indexAxis: horizontal ? "y" : "x",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: datasets.length > 1, position: "top", align: "end" },
          tooltip: tooltipFooter ? { callbacks: { footer: tooltipFooter } } : {},
        },
        scales: {
          x: { stacked: !!stacked, grid: { display: !horizontal }, ticks: { autoSkip: false, precision: 0 } },
          y: { stacked: !!stacked, grid: { display: horizontal, color: PALETTE.grisL }, beginAtZero: true, ticks: { precision: 0 } },
        },
      }, onClick),
    };
  }

  function doughnutConfig(labels, data, colors, onClick) {
    return {
      type: "doughnut",
      data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 2, borderColor: "#fff" }] },
      options: withClickHandlers({
        responsive: true, maintainAspectRatio: false, cutout: "65%",
        plugins: { legend: { position: "right", labels: { padding: 12 } } },
      }, onClick),
    };
  }

  /* ------------------------------------------------------------------ *
   * BRECHA DE EJECUCIÓN — barra tipo "gauge": qué tanto debería llevar el
   * cronograma hoy (marcador punteado) vs qué tanto lleva realmente (barra
   * coloreada). Verde si va igual o adelantado, rojo si va atrasado.
   * ------------------------------------------------------------------ */
  function metaMarkerPlugin(esperadoPct) {
    return {
      id: "metaMarker",
      afterDatasetsDraw(chart) {
        const { ctx, chartArea, scales } = chart;
        if (!chartArea || !scales.x) return;
        const x = scales.x.getPixelForValue(esperadoPct);
        ctx.save();
        ctx.strokeStyle = PALETTE.gris;
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(x, chartArea.top);
        ctx.lineTo(x, chartArea.bottom);
        ctx.stroke();
        ctx.restore();

        ctx.save();
        ctx.fillStyle = PALETTE.gris;
        ctx.font = "600 11px 'IBM Plex Sans', sans-serif";
        const label = `Meta hoy: ${esperadoPct}%`;
        const textWidth = ctx.measureText(label).width;
        const nearRightEdge = x + textWidth + 8 > chartArea.right;
        ctx.textAlign = nearRightEdge ? "right" : "left";
        ctx.fillText(label, x + (nearRightEdge ? -6 : 6), chartArea.top - 8);
        ctx.restore();
      },
    };
  }

  function renderAvanceGauge(d, canvasId) {
    canvasId = canvasId || "chartAvanceGauge";
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    if (instances[canvasId]) instances[canvasId].destroy();
    const color = d.realPct >= d.esperadoPct ? PALETTE.verde : PALETTE.rojo;
    const scaleMax = Math.max(100, d.realPct, d.esperadoPct);
    instances[canvasId] = new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: { labels: ["Avance"], datasets: [{ data: [d.realPct], backgroundColor: color, borderRadius: 6, barThickness: 40 }] },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 22 } },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: () => `Avance real: ${d.realPct}%` } },
        },
        scales: {
          x: { min: 0, max: scaleMax, grid: { color: PALETTE.grisL }, ticks: { callback: (v) => v + "%" } },
          y: { display: false },
        },
      },
      plugins: [metaMarkerPlugin(d.esperadoPct)],
    });
  }

  /* ------------------------------------------------------------------ *
   * PROGRAMA
   * ------------------------------------------------------------------ */
  /** Pie del tooltip de las barras apiladas: al pasar por la barra de lo
   * ejecutado (ejecutadas + no programadas ejecutadas), muestra su total. */
  function footerTotalEjecutadas(items) {
    if (!items.length || items[0].dataset.stack !== "ejec") return "";
    const i = items[0].dataIndex;
    const total = items[0].chart.data.datasets
      .filter(ds => ds.stack === "ejec")
      .reduce((sum, ds) => sum + (ds.data[i] || 0), 0);
    return `Total ejecutadas: ${total}`;
  }

  /** 3 series en 2 pilas: "prog" (lo programado originalmente) frente a
   * "ejec" (ejecutadas + no programadas ejecutadas, apiladas). Sirve igual
   * para meses y para ubicaciones (`horizontal`). */
  function programadoVsEjecutadoConfig(d, horizontal, onClick) {
    return barConfig({
      labels: d.labels,
      horizontal,
      stacked: true,
      datasets: [
        { label: "Programadas", stack: "prog", data: d.programadas, backgroundColor: PALETTE.azulL, borderColor: PALETTE.azulM, borderWidth: 1.5, borderRadius: 4 },
        { label: "Ejecutadas", stack: "ejec", data: d.ejecutadas, backgroundColor: PALETTE.azul, borderRadius: 4 },
        { label: "No Programadas Ejecutadas", stack: "ejec", data: d.extraordinarias, backgroundColor: PALETTE.amarillo, borderRadius: 4 },
      ],
      onClick,
      tooltipFooter: footerTotalEjecutadas,
    });
  }

  /** `canvasId` parametrizable: el mismo gráfico se usa para Auditorías
   * (Resumen), Inspecciones (Resumen) y la pestaña Inspecciones. */
  function renderProgramaPorMes(d, onClick, canvasId) {
    getOrCreate(canvasId || "chartProgramaMes", programadoVsEjecutadoConfig(d, false, onClick));
  }

  /** Inspecciones: programadas vs ejecutadas por ubicación. */
  function renderProgramaPorUbicacion(d, canvasId, onClick) {
    getOrCreate(canvasId, programadoVsEjecutadoConfig(d, true, onClick));
  }

  /** `canvasId` parametrizable para poder reusar el mismo gráfico en la
   * sección Auditorías (default) y en Inspecciones (ver app.js). */
  function renderPorClasificacion(pairs, canvasId, onClick) {
    getOrCreate(canvasId || "chartClasificacion", barConfig({
      labels: pairs.map(p => p[0]),
      horizontal: true,
      datasets: [{ label: "Registros", data: pairs.map(p => p[1]), backgroundColor: CATEGORY_SERIES_COLORS, borderRadius: 4 }],
      onClick,
    }));
  }

  function renderPorModalidad(pairs, canvasId, onClick) {
    getOrCreate(canvasId || "chartModalidad", doughnutConfig(
      pairs.map(p => p[0]), pairs.map(p => p[1]),
      [PALETTE.azulM, PALETTE.azul, PALETTE.amarillo, PALETTE.grisM],
      onClick
    ));
  }

  function renderPorUbicacion(pairs, canvasId, onClick) {
    getOrCreate(canvasId || "chartUbicacion", barConfig({
      labels: pairs.map(p => p[0]),
      horizontal: true,
      datasets: [{ label: "Registros", data: pairs.map(p => p[1]), backgroundColor: PALETTE.azulM, borderRadius: 4 }],
      onClick,
    }));
  }

  function renderEstadoPrograma(buckets, onClick) {
    getOrCreate("chartEstadoPrograma", doughnutConfig(
      buckets.map(b => b.label), buckets.map(b => b.value),
      buckets.map(b => DONUT_BUCKET_COLORS[b.label] || PALETTE.grisM),
      onClick
    ));
  }

  /** Dona "Auditorías por Cierre" (rollup calculado desde sus hallazgos). */
  function renderAuditoriasPorCierre(buckets, onClick, canvasId) {
    getOrCreate(canvasId || "chartAuditoriasPorCierre", doughnutConfig(
      buckets.map(b => b.label), buckets.map(b => b.value),
      buckets.map(b => CIERRE_COLORS[b.label] || PALETTE.grisM),
      onClick
    ));
  }

  /* ------------------------------------------------------------------ *
   * HALLAZGOS
   * ------------------------------------------------------------------ */
  function renderHallazgosEstado(pairs, onClick) {
    const colorFor = (label) => label === "Cerrado" ? PALETTE.verde : label === "Abierto" ? PALETTE.rojo : label === "Cierre Parcial" ? PALETTE.amarillo : PALETTE.grisM;
    getOrCreate("chartHallazgosEstado", doughnutConfig(pairs.map(p => p[0]), pairs.map(p => p[1]), pairs.map(p => colorFor(p[0])), onClick));
  }

  function renderHallazgosClasificacion(pairs, onClick) {
    getOrCreate("chartHallazgosClasificacion", barConfig({
      labels: pairs.map(p => (p[0] || "").length > 38 ? p[0].slice(0, 35) + "…" : p[0]),
      horizontal: true,
      datasets: [{ label: "Hallazgos", data: pairs.map(p => p[1]), backgroundColor: PALETTE.rojo, borderRadius: 4 }],
      onClick: onClick ? (label, dsLabel, index) => onClick(pairs[index] ? pairs[index][0] : label, dsLabel, index) : undefined,
    }));
  }

  function renderHallazgosTendencia(d, onClick) {
    getOrCreate("chartHallazgosTendencia", {
      type: "line",
      data: {
        labels: d.labels,
        datasets: [
          { label: "Emitidos", data: d.emitidos, borderColor: PALETTE.rojo, backgroundColor: PALETTE.rojoL, tension: 0.3, fill: true },
          { label: "Cerrados", data: d.cerrados, borderColor: PALETTE.verde, backgroundColor: PALETTE.verdeL, tension: 0.3, fill: true },
        ],
      },
      options: withClickHandlers({
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: "top", align: "end" } },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
      }, onClick),
    });
  }

  /* ------------------------------------------------------------------ *
   * Punto de entrada: recibe TODO lo agregado (kpiEngine) y pinta todo.
   * `handlers` (opcional) trae un callback de drill-down por gráfico —
   * ver app.js#renderEverything para cómo se arman.
   * ------------------------------------------------------------------ */
  function renderAll(audits, findings, auditoriasSoloTipo, inspeccionesSoloTipo, handlers) {
    handlers = handlers || {};
    // Resumen Ejecutivo: SOLO Auditorías (tipoRegistro AUDITORIA) — las
    // Inspecciones no deben sumar aquí, tienen su propio resumen aparte.
    renderAvanceGauge(QA.kpiEngine.avanceEsperadoVsReal(auditoriasSoloTipo));
    renderAvanceGauge(QA.kpiEngine.avanceEsperadoVsRealConNoProgramadas(auditoriasSoloTipo), "chartAvanceGaugeTotal");
    renderProgramaPorMes(QA.kpiEngine.programaPorMes(auditoriasSoloTipo), handlers.onProgramaMes);
    renderEstadoPrograma(QA.kpiEngine.estadoPrograma(auditoriasSoloTipo), handlers.onEstadoPrograma);
    renderAuditoriasPorCierre(QA.kpiEngine.auditoriasPorCierre(auditoriasSoloTipo), handlers.onAuditoriasPorCierre);
    renderHallazgosEstado(QA.kpiEngine.hallazgosPorEstado(findings), handlers.onHallazgosEstado);
    renderHallazgosClasificacion(QA.kpiEngine.hallazgosPorClasificacion(findings), handlers.onHallazgosClasificacion);
    renderHallazgosTendencia(QA.kpiEngine.hallazgosTendenciaMensual(findings), handlers.onHallazgosTendencia);

    // Auditorías (sección propia): solo tipo AUDITORIA
    renderPorClasificacion(QA.kpiEngine.porClasificacion(auditoriasSoloTipo), "chartClasificacion", handlers.onAuditoriasClasificacion);
    renderPorModalidad(QA.kpiEngine.porModalidad(auditoriasSoloTipo), "chartModalidad", handlers.onAuditoriasModalidad);
    renderPorUbicacion(QA.kpiEngine.porUbicacion(auditoriasSoloTipo), "chartUbicacion", handlers.onAuditoriasUbicacion);

    // Inspecciones (sección propia): solo tipo INSPECCION
    renderPorClasificacion(QA.kpiEngine.porClasificacion(inspeccionesSoloTipo), "chartInspClasificacion", handlers.onInspeccionesClasificacion);
    // Mismos datos en 2 lugares: pestaña Inspecciones y bloque "Inspecciones"
    // del Resumen Ejecutivo (canvas distintos, ids únicos).
    const gInsp = QA.kpiEngine.avanceEsperadoVsReal(inspeccionesSoloTipo);
    const gInspTotal = QA.kpiEngine.avanceEsperadoVsRealConNoProgramadas(inspeccionesSoloTipo);
    ["chartInspAvanceGauge", "chartResInspGauge"].forEach((id) => renderAvanceGauge(gInsp, id));
    ["chartInspAvanceGaugeTotal", "chartResInspGaugeTotal"].forEach((id) => renderAvanceGauge(gInspTotal, id));
    const mesInsp = QA.kpiEngine.programaPorMes(inspeccionesSoloTipo);
    ["chartInspMes", "chartResInspMes"].forEach((id) => renderProgramaPorMes(mesInsp, handlers.onInspeccionesMes, id));
    renderProgramaPorUbicacion(QA.kpiEngine.programaPorUbicacion(inspeccionesSoloTipo), "chartInspUbicacion", handlers.onInspeccionesUbicacion);
  }

  /* ------------------------------------------------------------------ *
   * Comparativo de vigencias (ver js/comparativo.js): una serie por año
   * (o una serie por concepto con los años en el eje X).
   * ------------------------------------------------------------------ */
  const YEAR_COLORS = [PALETTE.azulM, PALETTE.amarillo, PALETTE.azul, PALETTE.verde, PALETTE.rojo, PALETTE.grisM];
  const yearColor = (i) => YEAR_COLORS[i % YEAR_COLORS.length];

  function renderComparativo(model) {
    const { years, perYear } = model;
    const yearLabels = years.map((y) => (perYear[y].enCurso ? `${y} (en curso)` : String(y)));
    const pctTooltip = { callbacks: { label: (c) => `${c.dataset.label}: ${c.parsed.y}%` } };

    // 1. Cumplimiento y avance (%): años en el eje X, una barra por indicador
    const cum = barConfig({
      labels: yearLabels,
      datasets: [
        { label: "Cumplimiento cronograma original", data: years.map((y) => perYear[y].k.cumplimientoOriginalPct), backgroundColor: PALETTE.azulM, borderRadius: 4 },
        { label: "Avance total (con no programadas)", data: years.map((y) => perYear[y].k.avanceTotalPct), backgroundColor: PALETTE.amarillo, borderRadius: 4 },
      ],
    });
    cum.options.plugins.tooltip = pctTooltip;
    cum.options.scales.y.ticks.callback = (v) => v + "%";
    getOrCreate("chartCmpCumplimiento", cum);

    // 2. Estado del programa (apilado)
    getOrCreate("chartCmpEstado", barConfig({
      labels: yearLabels, stacked: true,
      datasets: [
        { label: "Ejecutadas", data: years.map((y) => perYear[y].k.ejecutadas), backgroundColor: PALETTE.verde },
        { label: "No ejecutadas", data: years.map((y) => perYear[y].k.noEjecutadas), backgroundColor: PALETTE.rojo },
        { label: "Canceladas", data: years.map((y) => perYear[y].k.canceladas), backgroundColor: PALETTE.grisM },
        { label: "Por ejecutar (incl. programadas)", data: years.map((y) => perYear[y].k.porEjecutar), backgroundColor: PALETTE.azulM },
      ],
    }));

    // 3. Ejecutadas por mes: una serie por año
    getOrCreate("chartCmpMes", barConfig({
      labels: QA.utils.MONTH_ABBR,
      datasets: years.map((y, i) => ({ label: yearLabels[i], data: perYear[y].ejecutadasPorMes, backgroundColor: yearColor(i), borderRadius: 3 })),
    }));

    // 4. Hallazgos por estado (apilado)
    getOrCreate("chartCmpHallazgos", barConfig({
      labels: yearLabels, stacked: true,
      datasets: [
        { label: "Abiertos", data: years.map((y) => perYear[y].k.hallazgosAbiertos), backgroundColor: PALETTE.rojo },
        { label: "Cierre parcial", data: years.map((y) => perYear[y].k.hallazgosCierreParcial), backgroundColor: PALETTE.amarillo },
        { label: "Cerrados", data: years.map((y) => perYear[y].k.hallazgosCerrados), backgroundColor: PALETTE.verde },
      ],
      tooltipFooter: (items) => "Total: " + items.reduce((n, i) => n + i.parsed.y, 0),
    }));

    // 5. NC vs OB
    getOrCreate("chartCmpCondicion", barConfig({
      labels: yearLabels,
      datasets: [
        { label: "No conformidades (NC)", data: years.map((y) => perYear[y].nc), backgroundColor: PALETTE.rojo, borderRadius: 4 },
        { label: "Observaciones (OB)", data: years.map((y) => perYear[y].ob), backgroundColor: PALETTE.amarillo, borderRadius: 4 },
      ],
    }));

    // 6. Auditorías por clasificación: una serie por año
    const labels = [];
    years.forEach((y) => Object.keys(perYear[y].clasificacion).forEach((l) => { if (!labels.includes(l)) labels.push(l); }));
    labels.sort((a, b) => years.reduce((n, y) => n + (perYear[y].clasificacion[b] || 0), 0) - years.reduce((n, y) => n + (perYear[y].clasificacion[a] || 0), 0));
    getOrCreate("chartCmpClasificacion", barConfig({
      labels, horizontal: true,
      datasets: years.map((y, i) => ({ label: yearLabels[i], data: labels.map((l) => perYear[y].clasificacion[l] || 0), backgroundColor: yearColor(i), borderRadius: 3 })),
    }));

    // 7. Inspecciones
    getOrCreate("chartCmpInspecciones", barConfig({
      labels: yearLabels,
      datasets: [
        { label: "Programadas", data: years.map((y) => perYear[y].ki.programadas), backgroundColor: PALETTE.azulM, borderRadius: 4 },
        { label: "Ejecutadas", data: years.map((y) => perYear[y].ki.ejecutadas), backgroundColor: PALETTE.verde, borderRadius: 4 },
      ],
    }));
  }

  /** Chart.js calcula el tamaño del canvas en el momento de crearlo: si el
   * gráfico se crea (o se actualiza) mientras su pestaña está oculta
   * (display:none), queda con tamaño 0. Se llama después de mostrar una
   * pestaña para que los gráficos que contiene se vean bien. */
  function resizeAll() {
    Object.values(instances).forEach((c) => { try { c.resize(); } catch (e) { /* noop */ } });
  }

  return { renderAll, resizeAll, renderAuditoriasPorCierre, renderComparativo };
})();
