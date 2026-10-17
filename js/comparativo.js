/**
 * js/comparativo.js — Comparativo de vigencias (años)
 * ============================================================================
 * Pone lado a lado todas las vigencias cargadas. Reutiliza kpiEngine (los
 * mismos números que ve cada pestaña por vigencia) y no aplica los filtros
 * globales: compara el programa completo de cada año.
 *
 *   buildModel(byYear)  -> indicadores, series mensuales y distribuciones
 *   renderTable(model)  -> tabla HTML con la columna Δ (última vs anterior)
 *   render(byYear)      -> tabla + gráficos (QA.charts.renderComparativo)
 */

window.QA = window.QA || {};

QA.comparativo = (function () {
  const u = QA.utils;
  const K = QA.kpiEngine;
  const EST = QA.statusEngine.ESTADOS;

  /** @param {Map<number,{audits:object[],findings:object[]}>} byYear */
  function buildModel(byYear, today) {
    today = today || new Date();
    const years = [...byYear.keys()].sort((a, b) => a - b);
    const perYear = {};
    years.forEach((anio) => {
      const { audits, findings } = byYear.get(anio);
      const aud = K.porTipoRegistro(audits, "AUDITORIA");
      const insp = K.porTipoRegistro(audits, "INSPECCION");
      const reales = K.hallazgosReales(findings);
      const k = K.computeKpis(aud, findings, today);
      const ki = K.computeKpis(insp, [], today);

      const ejecutadasPorMes = Array(12).fill(0);
      aud.forEach((a) => {
        if (a.estadoCalculado === EST.EJECUTADA && a.fechaReferencia) ejecutadasPorMes[a.fechaReferencia.getMonth()]++;
      });
      const clasificacion = {};
      K.porClasificacion(aud).forEach(([label, n]) => { clasificacion[label] = n; });

      const nc = reales.filter((f) => f.condicion === "NC").length;
      const ob = reales.filter((f) => f.condicion === "OB").length;
      const cerradosPct = reales.length ? Math.round((k.hallazgosCerrados / reales.length) * 1000) / 10 : null;
      const ratio = k.ejecutadas ? Math.round((reales.length / k.ejecutadas) * 10) / 10 : null;
      perYear[anio] = { k, ki, nc, ob, cerradosPct, ratio, ejecutadasPorMes, clasificacion, enCurso: anio === today.getFullYear() };
    });
    return { years, perYear, today };
  }

  // better: "up" = subir es bueno · "down" = subir es malo · null = neutro
  const ROWS = [
    { group: "Programa" },
    { label: "Total de registros", get: (d) => d.k.totalAuditorias },
    { label: "Programados", get: (d) => d.k.programadas },
    { label: "No programados (extraordinarios)", get: (d) => d.k.extraordinarias },
    { group: "Ejecución" },
    { label: "Ejecutados", get: (d) => d.k.ejecutadas, better: "up" },
    { label: "Ejecutados programados", get: (d) => d.k.ejecutadasProgramadas, better: "up" },
    { label: "No ejecutados", get: (d) => d.k.noEjecutadas, better: "down" },
    { label: "Cancelados", get: (d) => d.k.canceladas },
    { group: "Cumplimiento" },
    { label: "% Cumplimiento cronograma original", get: (d) => d.k.cumplimientoOriginalPct, pct: true, better: "up" },
    { label: "% Avance total del programa", get: (d) => d.k.avanceTotalPct, pct: true, better: "up" },
    { group: "Cierre de auditorías ejecutadas" },
    { label: "Cerradas", get: (d) => d.k.auditoriasCerradas, better: "up" },
    { label: "Abiertas", get: (d) => d.k.auditoriasAbiertas, better: "down" },
    { label: "Cierre parcial", get: (d) => d.k.auditoriasCierreParcial },
    { group: "Hallazgos" },
    { label: "Total de hallazgos", get: (d) => d.k.hallazgosTotal },
    { label: "No conformidades (NC)", get: (d) => d.nc, better: "down" },
    { label: "Observaciones (OB)", get: (d) => d.ob },
    { label: "Abiertos", get: (d) => d.k.hallazgosAbiertos, better: "down" },
    { label: "Cerrados", get: (d) => d.k.hallazgosCerrados, better: "up" },
    { label: "% de hallazgos cerrados", get: (d) => d.cerradosPct, pct: true, better: "up" },
    { label: "Hallazgos por auditoría ejecutada", get: (d) => d.ratio, decimals: 1 },
    { group: "Inspecciones" },
    { label: "Total de inspecciones", get: (d) => d.ki.totalAuditorias },
    { label: "Programadas", get: (d) => d.ki.programadas },
    { label: "Ejecutadas", get: (d) => d.ki.ejecutadas, better: "up" },
    { label: "% Cumplimiento cronograma original", get: (d) => d.ki.cumplimientoOriginalPct, pct: true, better: "up" },
  ];

  function fmt(v, row) {
    if (v === null || v === undefined || Number.isNaN(v)) return "—";
    if (row.pct) return v.toLocaleString("es-CO", { maximumFractionDigits: 1 }) + "%";
    if (row.decimals) return v.toLocaleString("es-CO", { minimumFractionDigits: row.decimals, maximumFractionDigits: row.decimals });
    return v.toLocaleString("es-CO");
  }

  function deltaCell(prev, last, row) {
    if (prev === null || prev === undefined || last === null || last === undefined) return `<td class="cmp-delta cmp-na">—</td>`;
    const d = Math.round((last - prev) * 10) / 10;
    if (d === 0) return `<td class="cmp-delta cmp-flat">= 0${row.pct ? " pts" : ""}</td>`;
    const cls = !row.better ? "cmp-flat" : ((d > 0) === (row.better === "up") ? "cmp-good" : "cmp-bad");
    const arrow = d > 0 ? "▲" : "▼";
    const txt = (d > 0 ? "+" : "−") + Math.abs(d).toLocaleString("es-CO", { maximumFractionDigits: 1 }) + (row.pct ? " pts" : "");
    return `<td class="cmp-delta ${cls}">${arrow} ${txt}</td>`;
  }

  function renderTable(model) {
    const { years, perYear } = model;
    const showDelta = years.length >= 2;
    const prev = years[years.length - 2], last = years[years.length - 1];
    const head = `<thead><tr><th>Indicador</th>${years.map((y) => `<th>${y}${perYear[y].enCurso ? ' <span title="Vigencia en curso: sus cifras todavía pueden crecer">(en curso)</span>' : ""}</th>`).join("")}${showDelta ? `<th>Δ ${last} vs ${prev}</th>` : ""}</tr></thead>`;
    const body = ROWS.map((row) => {
      if (row.group) return `<tr class="cmp-group"><td colspan="${years.length + 1 + (showDelta ? 1 : 0)}">${u.escapeHtml(row.group)}</td></tr>`;
      const vals = years.map((y) => row.get(perYear[y]));
      return `<tr><td>${u.escapeHtml(row.label)}</td>${vals.map((v) => `<td>${fmt(v, row)}</td>`).join("")}${showDelta ? deltaCell(vals[vals.length - 2], vals[vals.length - 1], row) : ""}</tr>`;
    }).join("");
    document.getElementById("tblComparativo").innerHTML = head + `<tbody>${body}</tbody>`;
  }

  function render(byYear) {
    const model = buildModel(byYear);
    const intro = document.getElementById("cmpIntro");
    if (intro) {
      intro.textContent = `Vigencias cargadas: ${model.years.join(", ")}. El comparativo usa el programa completo de cada año (los filtros de las otras pestañas no aplican aquí). ` +
        (model.years.some((y) => model.perYear[y].enCurso) ? "La vigencia en curso aún puede cambiar: compara con cautela los totales." : "");
    }
    renderTable(model);
    QA.charts.renderComparativo(model);
    return model;
  }

  return { buildModel, render };
})();
