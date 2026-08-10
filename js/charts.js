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

  const PALETTE = {
    azul: "#0C447C", azulM: "#185FA5", azulL: "#E6F1FB",
    teal: "#085041", tealM: "#0F6E56", tealL: "#E1F5EE",
    gris: "#2C2C2A", grisM: "#5F5E5A", grisL: "#F1EFE8",
    amber: "#B5541C", amberL: "#FBEADD",
    rojo: "#A32D2D", rojoL: "#FCEBEB",
    verde: "#3B6D11", verdeL: "#EAF3DE",
    morado: "#534AB7",
  };

  const DONUT_BUCKET_COLORS = {
    "Por Ejecutar": PALETTE.azulM,
    "Ejecutada": PALETTE.verde,
    "No Ejecutada": PALETTE.rojo,
    "Cancelada": PALETTE.grisM,
    "Extraordinarias": PALETTE.morado,
  };

  const CIERRE_COLORS = {
    "Cerrada": PALETTE.verde,
    "Abierta": PALETTE.rojo,
    "Cierre Parcial": PALETTE.amber,
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

  function barConfig({ labels, datasets, horizontal, stacked, onClick }) {
    return {
      type: "bar",
      data: { labels, datasets },
      options: withClickHandlers({
        indexAxis: horizontal ? "y" : "x",
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: datasets.length > 1, position: "top", align: "end" } },
        scales: {
          x: { stacked: !!stacked, grid: { display: !horizontal }, ticks: { autoSkip: false } },
          y: { stacked: !!stacked, grid: { display: horizontal, color: "#EDEBE3" }, beginAtZero: true },
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

  function renderAvanceGauge(d) {
    const canvas = document.getElementById("chartAvanceGauge");
    if (!canvas) return;
    if (instances.chartAvanceGauge) instances.chartAvanceGauge.destroy();
    const color = d.realPct >= d.esperadoPct ? PALETTE.verde : PALETTE.rojo;
    const scaleMax = Math.max(100, d.realPct, d.esperadoPct);
    instances.chartAvanceGauge = new Chart(canvas.getContext("2d"), {
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
          x: { min: 0, max: scaleMax, grid: { color: "#EDEBE3" }, ticks: { callback: (v) => v + "%" } },
          y: { display: false },
        },
      },
      plugins: [metaMarkerPlugin(d.esperadoPct)],
    });
  }

  /* ------------------------------------------------------------------ *
   * PROGRAMA
   * ------------------------------------------------------------------ */
  function renderProgramaPorMes(d, onClick) {
    getOrCreate("chartProgramaMes", barConfig({
      labels: d.labels,
      datasets: [
        { label: "Programadas", data: d.programadas, backgroundColor: PALETTE.azulL, borderColor: PALETTE.azulM, borderWidth: 1.5, borderRadius: 4 },
        { label: "Ejecutadas", data: d.ejecutadas, backgroundColor: PALETTE.verde, borderRadius: 4 },
        { label: "No Programadas Ejecutadas", data: d.extraordinarias, backgroundColor: PALETTE.morado, borderRadius: 4 },
      ],
      onClick,
    }));
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
      [PALETTE.azulM, PALETTE.tealM, PALETTE.grisM, PALETTE.amber],
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
  function renderAuditoriasPorCierre(buckets, onClick) {
    getOrCreate("chartAuditoriasPorCierre", doughnutConfig(
      buckets.map(b => b.label), buckets.map(b => b.value),
      buckets.map(b => CIERRE_COLORS[b.label] || PALETTE.grisM),
      onClick
    ));
  }

  /* ------------------------------------------------------------------ *
   * HALLAZGOS
   * ------------------------------------------------------------------ */
  function renderHallazgosEstado(pairs, onClick) {
    const colorFor = (label) => label === "Cerrado" ? PALETTE.verde : label === "Abierto" ? PALETTE.rojo : label === "Cierre Parcial" ? PALETTE.amber : PALETTE.grisM;
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

  function renderHallazgosProceso(pairs, onClick) {
    getOrCreate("chartHallazgosProceso", barConfig({
      labels: pairs.map(p => p[0]),
      horizontal: true,
      datasets: [{ label: "Hallazgos", data: pairs.map(p => p[1]), backgroundColor: PALETTE.morado, borderRadius: 4 }],
      onClick,
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
   * FAA Self Evaluation
   * ------------------------------------------------------------------ */
  function renderFaaCategorias(pairs, onClick) {
    getOrCreate("chartFaaCategorias", barConfig({
      labels: pairs.map(p => p[0]),
      horizontal: true,
      datasets: [{ label: "Documentos", data: pairs.map(p => p[1]), backgroundColor: PALETTE.azulM, borderRadius: 4 }],
      onClick,
    }));
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
    renderProgramaPorMes(QA.kpiEngine.programaPorMes(auditoriasSoloTipo), handlers.onProgramaMes);
    renderEstadoPrograma(QA.kpiEngine.estadoPrograma(auditoriasSoloTipo), handlers.onEstadoPrograma);
    renderAuditoriasPorCierre(QA.kpiEngine.auditoriasPorCierre(auditoriasSoloTipo), handlers.onAuditoriasPorCierre);
    renderHallazgosEstado(QA.kpiEngine.hallazgosPorEstado(findings), handlers.onHallazgosEstado);
    renderHallazgosClasificacion(QA.kpiEngine.hallazgosPorClasificacion(findings), handlers.onHallazgosClasificacion);
    renderHallazgosProceso(QA.kpiEngine.hallazgosPorProceso(findings), handlers.onHallazgosProceso);
    renderHallazgosTendencia(QA.kpiEngine.hallazgosTendenciaMensual(findings), handlers.onHallazgosTendencia);

    // Auditorías (sección propia): solo tipo AUDITORIA
    renderPorClasificacion(QA.kpiEngine.porClasificacion(auditoriasSoloTipo), "chartClasificacion", handlers.onAuditoriasClasificacion);
    renderPorModalidad(QA.kpiEngine.porModalidad(auditoriasSoloTipo), "chartModalidad", handlers.onAuditoriasModalidad);
    renderPorUbicacion(QA.kpiEngine.porUbicacion(auditoriasSoloTipo), "chartUbicacion", handlers.onAuditoriasUbicacion);

    // Inspecciones (sección propia): solo tipo INSPECCION
    renderPorClasificacion(QA.kpiEngine.porClasificacion(inspeccionesSoloTipo), "chartInspClasificacion", handlers.onInspeccionesClasificacion);
    renderPorUbicacion(QA.kpiEngine.porUbicacion(inspeccionesSoloTipo), "chartInspUbicacion", handlers.onInspeccionesUbicacion);
  }

  /** Chart.js calcula el tamaño del canvas en el momento de crearlo: si el
   * gráfico se crea (o se actualiza) mientras su pestaña está oculta
   * (display:none), queda con tamaño 0. Se llama después de mostrar una
   * pestaña para que los gráficos que contiene se vean bien. */
  function resizeAll() {
    Object.values(instances).forEach((c) => { try { c.resize(); } catch (e) { /* noop */ } });
  }

  return { renderAll, resizeAll, renderFaaCategorias };
})();
