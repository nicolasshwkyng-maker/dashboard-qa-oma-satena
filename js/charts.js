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
    "Sin hallazgos": PALETTE.grisM,
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

  function barConfig({ labels, datasets, horizontal, stacked }) {
    return {
      type: "bar",
      data: { labels, datasets },
      options: {
        indexAxis: horizontal ? "y" : "x",
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: datasets.length > 1, position: "top", align: "end" } },
        scales: {
          x: { stacked: !!stacked, grid: { display: !horizontal }, ticks: { autoSkip: false } },
          y: { stacked: !!stacked, grid: { display: horizontal, color: "#EDEBE3" }, beginAtZero: true },
        },
      },
    };
  }

  function doughnutConfig(labels, data, colors) {
    return {
      type: "doughnut",
      data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 2, borderColor: "#fff" }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: "65%",
        plugins: { legend: { position: "right", labels: { padding: 12 } } },
      },
    };
  }

  /* ------------------------------------------------------------------ *
   * PROGRAMA
   * ------------------------------------------------------------------ */
  function renderProgramaPorMes(d) {
    getOrCreate("chartProgramaMes", barConfig({
      labels: d.labels,
      datasets: [
        { label: "Programadas", data: d.programadas, backgroundColor: PALETTE.azulL, borderColor: PALETTE.azulM, borderWidth: 1.5, borderRadius: 4 },
        { label: "Ejecutadas", data: d.ejecutadas, backgroundColor: PALETTE.verde, borderRadius: 4 },
        { label: "No Programadas Ejecutadas", data: d.extraordinarias, backgroundColor: PALETTE.morado, borderRadius: 4 },
      ],
    }));
  }

  /** `canvasId` parametrizable para poder reusar el mismo gráfico en la
   * sección Auditorías (default) y en Inspecciones (ver app.js). */
  function renderPorClasificacion(pairs, canvasId) {
    getOrCreate(canvasId || "chartClasificacion", barConfig({
      labels: pairs.map(p => p[0]),
      horizontal: true,
      datasets: [{ label: "Registros", data: pairs.map(p => p[1]), backgroundColor: CATEGORY_SERIES_COLORS, borderRadius: 4 }],
    }));
  }

  function renderPorModalidad(pairs, canvasId) {
    getOrCreate(canvasId || "chartModalidad", doughnutConfig(
      pairs.map(p => p[0]), pairs.map(p => p[1]),
      [PALETTE.azulM, PALETTE.tealM, PALETTE.grisM, PALETTE.amber]
    ));
  }

  function renderPorUbicacion(pairs, canvasId) {
    getOrCreate(canvasId || "chartUbicacion", barConfig({
      labels: pairs.map(p => p[0]),
      horizontal: true,
      datasets: [{ label: "Registros", data: pairs.map(p => p[1]), backgroundColor: PALETTE.azulM, borderRadius: 4 }],
    }));
  }

  function renderEstadoPrograma(buckets) {
    getOrCreate("chartEstadoPrograma", doughnutConfig(
      buckets.map(b => b.label), buckets.map(b => b.value),
      buckets.map(b => DONUT_BUCKET_COLORS[b.label] || PALETTE.grisM)
    ));
  }

  /** Dona "Auditorías por Cierre" (rollup calculado desde sus hallazgos). */
  function renderAuditoriasPorCierre(buckets) {
    getOrCreate("chartAuditoriasPorCierre", doughnutConfig(
      buckets.map(b => b.label), buckets.map(b => b.value),
      buckets.map(b => CIERRE_COLORS[b.label] || PALETTE.grisM)
    ));
  }

  /* ------------------------------------------------------------------ *
   * HALLAZGOS
   * ------------------------------------------------------------------ */
  function renderHallazgosEstado(pairs) {
    const colorFor = (label) => label === "Cerrado" ? PALETTE.verde : label === "Abierto" ? PALETTE.rojo : label === "Cierre Parcial" ? PALETTE.amber : PALETTE.grisM;
    getOrCreate("chartHallazgosEstado", doughnutConfig(pairs.map(p => p[0]), pairs.map(p => p[1]), pairs.map(p => colorFor(p[0]))));
  }

  function renderHallazgosClasificacion(pairs) {
    getOrCreate("chartHallazgosClasificacion", barConfig({
      labels: pairs.map(p => (p[0] || "").length > 38 ? p[0].slice(0, 35) + "…" : p[0]),
      horizontal: true,
      datasets: [{ label: "Hallazgos", data: pairs.map(p => p[1]), backgroundColor: PALETTE.rojo, borderRadius: 4 }],
    }));
  }

  function renderHallazgosProceso(pairs) {
    getOrCreate("chartHallazgosProceso", barConfig({
      labels: pairs.map(p => p[0]),
      horizontal: true,
      datasets: [{ label: "Hallazgos", data: pairs.map(p => p[1]), backgroundColor: PALETTE.morado, borderRadius: 4 }],
    }));
  }

  function renderHallazgosTendencia(d) {
    getOrCreate("chartHallazgosTendencia", {
      type: "line",
      data: {
        labels: d.labels,
        datasets: [
          { label: "Emitidos", data: d.emitidos, borderColor: PALETTE.rojo, backgroundColor: PALETTE.rojoL, tension: 0.3, fill: true },
          { label: "Cerrados", data: d.cerrados, borderColor: PALETTE.verde, backgroundColor: PALETTE.verdeL, tension: 0.3, fill: true },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: "top", align: "end" } },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
      },
    });
  }

  /* ------------------------------------------------------------------ *
   * FAA Self Evaluation
   * ------------------------------------------------------------------ */
  function renderFaaCategorias(pairs) {
    getOrCreate("chartFaaCategorias", barConfig({
      labels: pairs.map(p => p[0]),
      horizontal: true,
      datasets: [{ label: "Documentos", data: pairs.map(p => p[1]), backgroundColor: PALETTE.azulM, borderRadius: 4 }],
    }));
  }

  /* ------------------------------------------------------------------ *
   * Punto de entrada: recibe TODO lo agregado (kpiEngine) y pinta todo.
   * ------------------------------------------------------------------ */
  function renderAll(audits, findings, auditoriasSoloTipo, inspeccionesSoloTipo) {
    renderProgramaPorMes(QA.kpiEngine.programaPorMes(audits));
    renderEstadoPrograma(QA.kpiEngine.estadoPrograma(audits));
    renderAuditoriasPorCierre(QA.kpiEngine.auditoriasPorCierre(audits));
    renderHallazgosEstado(QA.kpiEngine.hallazgosPorEstado(findings));
    renderHallazgosClasificacion(QA.kpiEngine.hallazgosPorClasificacion(findings));
    renderHallazgosProceso(QA.kpiEngine.hallazgosPorProceso(findings));
    renderHallazgosTendencia(QA.kpiEngine.hallazgosTendenciaMensual(findings));

    // Auditorías (sección propia): solo tipo AUDITORIA
    renderPorClasificacion(QA.kpiEngine.porClasificacion(auditoriasSoloTipo), "chartClasificacion");
    renderPorModalidad(QA.kpiEngine.porModalidad(auditoriasSoloTipo), "chartModalidad");
    renderPorUbicacion(QA.kpiEngine.porUbicacion(auditoriasSoloTipo), "chartUbicacion");

    // Inspecciones (sección propia): solo tipo INSPECCION
    renderPorClasificacion(QA.kpiEngine.porClasificacion(inspeccionesSoloTipo), "chartInspClasificacion");
    renderPorUbicacion(QA.kpiEngine.porUbicacion(inspeccionesSoloTipo), "chartInspUbicacion");
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
