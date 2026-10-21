/**
 * js/app.js — Orquestación de la aplicación
 * ============================================================================
 * Punto de entrada. Carga los datos desde IndexedDB (js/dataService.js) —sin
 * backend, sin login—, conecta los filtros globales con gráficos y tablas, y
 * wire-ea los formularios de edición de Auditoría y Hallazgo, además del
 * flujo de carga de Excel (js/excelImport.js). Un cambio hecho en OTRA
 * pestaña de este mismo navegador llega vía BroadcastChannel y dispara un
 * refresco automático de KPIs/gráficas/tablas.
 *
 * Pipeline de carga:
 *   1. dataService.fetchAuditorias / fetchHallazgos
 *   2. statusEngine.applyAll -> calcula el estado real de cada auditoría
 *   3. attachFindingsToAudits -> agrega conteos de hallazgos por auditoría
 *   4. kpiEngine + charts + tables -> se pintan con los datos ya filtrados
 */

(function () {
  const u = QA.utils;

  const YEAR_KEY = "qa_satena_dashboard_vigencia";
  const state = {
    // everyAudits/everyFindings = TODAS las vigencias cargadas; allAudits/
    // allFindings = solo la vigencia (año) elegida en el selector del header.
    everyAudits: [], everyFindings: [],
    allAudits: [], allFindings: [],
    years: [], year: null,
    loaded: false, lastKpis: null, lastKpisInsp: null,
  };
  let stopRealtime = null;

  /* ------------------------------------------------------------------ *
   * Utilidades de UI
   * ------------------------------------------------------------------ */
  function showLoading(msg) {
    document.getElementById("loadingMsg").textContent = msg || "Procesando…";
    document.getElementById("loadingOverlay").classList.remove("d-none");
  }
  function hideLoading() { document.getElementById("loadingOverlay").classList.add("d-none"); }

  function showSetupAlert(message, type) {
    const box = document.getElementById("setupAlertBox");
    box.innerHTML = `<div class="qa-alert-${type || "danger"}">${u.escapeHtml(message)}</div>`;
  }
  function clearSetupAlert() { document.getElementById("setupAlertBox").innerHTML = ""; }

  function showAppScreen() {
    document.getElementById("setupScreen").classList.add("d-none");
    document.getElementById("appRoot").classList.remove("d-none");
  }
  function showEmptyDataScreen() {
    document.getElementById("appRoot").classList.add("d-none");
    document.getElementById("setupScreen").classList.remove("d-none");
  }

  /** "YYYY-MM-DD" para <input type="date">, en componentes locales (evita
   * corrimientos de zona horaria que puede introducir toISOString()). */
  function dateInputVal(d) {
    if (!d) return "";
    const dt = (d instanceof Date) ? d : new Date(d);
    if (isNaN(dt.getTime())) return "";
    const y = dt.getFullYear(), m = String(dt.getMonth() + 1).padStart(2, "0"), day = String(dt.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  function dateFromInput(id) {
    const v = document.getElementById(id).value;
    return v ? new Date(v + "T00:00:00") : null;
  }

  /* ------------------------------------------------------------------ *
   * Carga de datos desde Supabase
   * ------------------------------------------------------------------ */
  /** Agrupa hallazgos por auditoría a partir del FK real hallazgo.auditoriaVinculada
   * (ya resuelto por dataService — no hace falta adivinar por similitud de
   * nombre). Se necesita ANTES de statusEngine.applyAll para calcular el
   * rollup de cierre por auditoría (ver js/statusEngine.js). */
  function buildFindingsByAuditId(findings) {
    const map = new Map();
    findings.forEach((f) => {
      if (!f.auditoriaVinculada) return;
      if (!map.has(f.auditoriaVinculada)) map.set(f.auditoriaVinculada, []);
      map.get(f.auditoriaVinculada).push(f);
    });
    return map;
  }

  function attachFindingsToAudits(audits, findingsByAuditId) {
    audits.forEach((a) => {
      // Los marcadores "N/A" (cierre sin hallazgo) no son hallazgos reales.
      const list = QA.kpiEngine.hallazgosReales(findingsByAuditId.get(a.id) || []);
      a.hallazgosVinculados = list.length;
      a.hallazgosVinculadosNC = list.filter(f => f.condicion === "NC").length;
      a.hallazgosVinculadosOB = list.filter(f => f.condicion === "OB").length;
    });
  }

  async function renderLastImportLabel() {
    const metas = await QA.dataService.getImportMetaByYear();
    const meta = metas[state.year];
    const el = document.getElementById("lblUltimaActualizacion");
    if (!meta) { el.textContent = ""; return; }
    const fecha = new Date(meta.importedAt).toLocaleString("es-CO");
    el.textContent = `Vigencia ${state.year}: cargada el ${fecha}` + (meta.fileName ? ` desde "${meta.fileName}"` : "");
  }

  /* ------------------------------------------------------------------ *
   * Vigencias (años): selector del header + comparativo
   * ------------------------------------------------------------------ */
  function savedYear() {
    try { return Number(localStorage.getItem(YEAR_KEY)) || null; } catch (e) { return null; }
  }
  function persistYear() {
    try { localStorage.setItem(YEAR_KEY, String(state.year)); } catch (e) { /* no crítico */ }
  }

  /** Recalcula la lista de vigencias presentes y deja elegida una válida
   * (la actual, si sigue existiendo; si no la última usada; si no la más reciente). */
  function refreshYears() {
    const years = [...new Set(state.everyAudits.map((a) => a.anio).filter(Boolean))].sort((a, b) => a - b);
    state.years = years;
    if (!years.includes(state.year)) {
      const saved = savedYear();
      state.year = years.includes(saved) ? saved : years[years.length - 1];
    }
    const sel = document.getElementById("selAnio");
    sel.innerHTML = years.map((y) => `<option value="${y}">${y}</option>`).join("");
    sel.value = String(state.year);
    persistYear();
  }

  function applyYearSlice() {
    state.allAudits = state.everyAudits.filter((a) => a.anio === state.year);
    state.allFindings = state.everyFindings.filter((f) => f.anio === state.year);
  }

  /** Pestaña "Comparativo de Vigencias": solo existe con 2 o más años cargados. */
  function renderComparativo() {
    const nav = document.getElementById("navComparativo");
    const hay = state.years.length >= 2;
    nav.classList.toggle("d-none", !hay);
    if (!hay) {
      if (!document.getElementById("secComparativo").classList.contains("d-none")) document.querySelector('.qa-nav-item[data-section="secResumen"]').click();
      return;
    }
    const byYear = new Map(state.years.map((y) => [y, {
      audits: state.everyAudits.filter((a) => a.anio === y),
      findings: state.everyFindings.filter((f) => f.anio === y),
    }]));
    QA.comparativo.render(byYear);
  }

  function wireYearPicker() {
    document.getElementById("selAnio").addEventListener("change", async (e) => {
      state.year = Number(e.target.value);
      persistYear();
      QA.filters.reset(); // los proveedores/áreas elegidos pueden no existir en la otra vigencia
      applyYearSlice();
      populateFilterOptions();
      renderEverything();
      await renderLastImportLabel();
    });
  }

  async function loadAndRenderAll() {
    try {
      showLoading("Leyendo auditorías y hallazgos…");
      await QA.dataService.migrateLegacy();
      const [audits, findings] = await Promise.all([
        QA.dataService.fetchAuditorias(), QA.dataService.fetchHallazgos(),
      ]);
      const findingsByAuditId = buildFindingsByAuditId(findings);
      QA.statusEngine.applyAll(audits, findingsByAuditId);
      attachFindingsToAudits(audits, findingsByAuditId);

      state.everyAudits = audits;
      state.everyFindings = findings;
      state.loaded = true;

      QA.filters.load();
      refreshYears();
      applyYearSlice();
      populateFilterOptions();
      renderEverything();
      renderComparativo();

      await renderLastImportLabel();
      hideLoading();
    } catch (e) {
      hideLoading();
      console.error(e);
      alert("No se pudieron leer los datos guardados en este navegador: " + (e && e.message ? e.message : e));
    }
  }

  // startApp (no loadAndRenderAll) para que, si otra pestaña reinició la app,
  // esta también vuelva a la pantalla inicial en vez de mostrar datos viejos.
  const debouncedReload = u.debounce(() => { if (state.loaded) startApp(); }, 400);

  /** Muestra la app o la pantalla "sin datos todavía" según si ya hay algo
   * cargado en IndexedDB — reemplaza al antiguo chequeo de sesión Supabase. */
  async function startApp() {
    const audits = await QA.dataService.fetchAuditorias();
    if (!audits.length) { showEmptyDataScreen(); return; }
    showAppScreen();
    clearSetupAlert();
    await loadAndRenderAll();
    if (!stopRealtime) stopRealtime = QA.dataService.subscribeToChanges(debouncedReload);
  }

  /* ------------------------------------------------------------------ *
   * Filtros
   * ------------------------------------------------------------------ */
  function fillSelect(id, options, valueKey, labelKey, currentValue) {
    const sel = document.getElementById(id);
    const placeholder = sel.options[0];
    sel.innerHTML = "";
    sel.appendChild(placeholder);
    options.forEach((opt) => {
      const value = valueKey ? opt[valueKey] : opt;
      const label = labelKey ? opt[labelKey] : opt;
      const o = document.createElement("option");
      o.value = value; o.textContent = label;
      sel.appendChild(o);
    });
    sel.value = currentValue || "";
  }

  function populateFilterOptions() {
    const opts = QA.filters.buildOptions(state.allAudits, state.allFindings);
    const s = QA.filters.getState();
    fillSelect("fMes", opts.months, "value", "label", s.mes);
    fillSelect("fClasificacion", opts.clasificaciones, null, null, s.clasificacion);
    fillSelect("fTipo", ["Proveedor", "Área Interna", "Inspección"], null, null, s.tipo);
    fillSelect("fProveedor", opts.proveedores, null, null, s.proveedor);
    fillSelect("fAreaInterna", opts.areasInternas, null, null, s.areaInterna);
    fillSelect("fModalidad", opts.modalidades, null, null, s.modalidad);
    fillSelect("fUbicacion", opts.ubicaciones, null, null, s.ubicacion);
    fillSelect("fAuditor", opts.auditores, null, null, s.auditor);
    document.getElementById("fEstado").value = s.estado || "";
    document.getElementById("fProgramacion").value = s.programacion || "";
  }

  function wireFilters() {
    const map = { fMes: "mes", fClasificacion: "clasificacion", fTipo: "tipo", fProveedor: "proveedor", fAreaInterna: "areaInterna", fModalidad: "modalidad", fUbicacion: "ubicacion", fAuditor: "auditor", fEstado: "estado", fProgramacion: "programacion" };
    Object.entries(map).forEach(([elId, key]) => {
      document.getElementById(elId).addEventListener("change", (e) => {
        QA.filters.setValue(key, e.target.value);
        renderEverything();
      });
    });
    document.getElementById("btnClearFilters").addEventListener("click", () => {
      QA.filters.reset();
      populateFilterOptions();
      renderEverything();
    });
  }

  /* ------------------------------------------------------------------ *
   * Render principal (KPIs + gráficos + tablas), respetando filtros
   * ------------------------------------------------------------------ */
  /**
   * `listKey` referencia una entrada de k.lists (ver kpiEngine.computeKpis)
   * y `kind` indica si esa lista contiene auditorías o hallazgos, para que
   * el modal de detalle sepa qué columnas pintar (ver openKpiModal). Las
   * tarjetas sin listKey (ej. "% Cerrados") no son clicables.
   */
  function kpiCardHtml(label, value, hint, listKey, kind, accent) {
    const clickable = !!listKey;
    const attrs = clickable ? ` data-kpi-list="${listKey}" data-kpi-kind="${kind}" data-kpi-title="${u.escapeHtml(label)}" role="button" tabindex="0"` : "";
    const cls = ["qa-kpi-card", clickable ? "qa-kpi-clickable" : "", accent ? `qa-kpi-card--${accent}` : ""].filter(Boolean).join(" ");
    return `<div class="${cls}"${attrs}><div class="qa-kpi-value">${u.escapeHtml(String(value))}</div><div class="qa-kpi-label">${u.escapeHtml(label)}</div>${hint ? `<div class="qa-kpi-hint">${u.escapeHtml(hint)}</div>` : ""}</div>`;
  }

  /** Agrupa tarjetas relacionadas bajo un título, para que el Resumen
   * Ejecutivo se lea por temas en vez de una sola cuadrícula plana. */
  function kpiGroupHtml(title, cardsHtml) {
    return `<div class="qa-kpi-group"><div class="qa-kpi-group-title">${u.escapeHtml(title)}</div><div class="qa-kpi-grid">${cardsHtml}</div></div>`;
  }

  function renderKpis(k) {
    document.getElementById("kpiGridResumen").innerHTML = [
      kpiGroupHtml("Programa", [
        kpiCardHtml("Total de Registros", k.totalAuditorias, `${k.programadas} programados + ${k.extraordinarias} extraordinarios`, "totalAuditorias", "audits"),
        kpiCardHtml("Programados", k.programadas, null, "programadas", "audits"),
        kpiCardHtml("Extraordinarios (No Programados)", k.extraordinarias, `${k.extraordinariasEjecutadas} ejecutados`, "extraordinarias", "audits"),
      ].join("")),
      kpiGroupHtml("Ejecución", [
        kpiCardHtml("Ejecutados", k.ejecutadas, "Incluye extraordinarios ejecutados", "ejecutadas", "audits", "acero"),
        kpiCardHtml("Ejecutados Programados", k.ejecutadasProgramadas, "Ejecutados que SÍ estaban en el cronograma", "ejecutadasProgramadas", "audits", "acero"),
        kpiCardHtml("Por Ejecutar", k.porEjecutar, k.estatusProgramada ? `${k.estatusProgramada} con fecha confirmada (Programada)` : null, "porEjecutar", "audits", "acero"),
        kpiCardHtml("Programada (fecha confirmada)", k.estatusProgramada, "Pendientes con fecha confirmada — incluidas en Por Ejecutar", "estatusProgramada", "audits", "acero"),
        kpiCardHtml("No Ejecutadas", k.noEjecutadas, null, "noEjecutadas", "audits", "acero"),
        kpiCardHtml("Canceladas", k.canceladas, null, "canceladas", "audits", "acero"),
      ].join("")),
      kpiGroupHtml("Cumplimiento", [
        kpiCardHtml("% Cumplimiento Cronograma Original", k.cumplimientoOriginalPct + "%", "Ejecutados programados / Total programado (nunca > 100%)", "ejecutadasProgramadas", "audits", "amarillo"),
        kpiCardHtml("% Avance Total del Programa", k.avanceTotalPct + "%", "Incluye extraordinarios ejecutados — puede superar 100%", "ejecutadas", "audits", "amarillo"),
      ].join("")),
      kpiGroupHtml("Cierre de Auditorías Ejecutadas", [
        kpiCardHtml("Cerradas", k.auditoriasCerradas, "Sin hallazgos o todos cerrados", "auditoriasCerradas", "audits", "verde"),
        kpiCardHtml("Abiertas", k.auditoriasAbiertas, "Con hallazgos abiertos (o marcadas Abierta)", "auditoriasAbiertas", "audits", "verde"),
        kpiCardHtml("Cierre Parcial", k.auditoriasCierreParcial, "Mezcla de hallazgos abiertos/cerrados", "auditoriasCierreParcial", "audits", "verde"),
      ].join("")),
      kpiGroupHtml("Hallazgos", [
        kpiCardHtml("Total de Hallazgos", k.hallazgosTotal, null, "hallazgosTotal", "findings", "rojo"),
        kpiCardHtml("Abiertos", k.hallazgosAbiertos, null, "hallazgosAbiertos", "findings", "rojo"),
        kpiCardHtml("Cerrados", k.hallazgosCerrados, null, "hallazgosCerrados", "findings", "rojo"),
        kpiCardHtml("Cierre Parcial", k.hallazgosCierreParcial, null, "hallazgosCierreParcial", "findings", "rojo"),
      ].join("")),
      kpiGroupHtml("Alertas", [
        kpiCardHtml("Próximos 30 Días", k.proximos30Dias, "Por ejecutar con fecha cercana", "proximos30Dias", "audits", "negro"),
      ].join("")),
    ].join("");

    document.getElementById("kpiGridHallazgos").innerHTML = [
      kpiCardHtml("Total de Hallazgos", k.hallazgosTotal, null, "hallazgosTotal", "findings"),
      kpiCardHtml("Abiertos", k.hallazgosAbiertos, null, "hallazgosAbiertos", "findings"),
      kpiCardHtml("Cerrados", k.hallazgosCerrados, null, "hallazgosCerrados", "findings"),
      kpiCardHtml("Cierre Parcial", k.hallazgosCierreParcial, null, "hallazgosCierreParcial", "findings"),
    ].join("");
  }

  /** Bloque "Inspecciones" del Resumen Ejecutivo: mismas tarjetas de
   * Programa / Ejecución / Cumplimiento / Alertas que Auditorías, pero
   * calculadas SOLO con inspecciones (sin mezclar con las auditorías). */
  function renderKpisInspecciones(k) {
    document.getElementById("kpiGridResumenInsp").innerHTML = [
      kpiGroupHtml("Programa", [
        kpiCardHtml("Total de Inspecciones", k.totalAuditorias, `${k.programadas} programadas + ${k.extraordinarias} no programadas`, "totalAuditorias", "audits"),
        kpiCardHtml("Programadas", k.programadas, null, "programadas", "audits"),
        kpiCardHtml("No Programadas", k.extraordinarias, `${k.extraordinariasEjecutadas} ejecutadas`, "extraordinarias", "audits"),
      ].join("")),
      kpiGroupHtml("Ejecución", [
        kpiCardHtml("Ejecutadas", k.ejecutadas, "Incluye no programadas ejecutadas", "ejecutadas", "audits", "acero"),
        kpiCardHtml("Ejecutadas Programadas", k.ejecutadasProgramadas, "Ejecutadas que SÍ estaban en el cronograma", "ejecutadasProgramadas", "audits", "acero"),
        kpiCardHtml("Por Ejecutar", k.porEjecutar, k.estatusProgramada ? `${k.estatusProgramada} con fecha confirmada (Programada)` : null, "porEjecutar", "audits", "acero"),
        kpiCardHtml("Programada (fecha confirmada)", k.estatusProgramada, "Pendientes con fecha confirmada — incluidas en Por Ejecutar", "estatusProgramada", "audits", "acero"),
        kpiCardHtml("No Ejecutadas", k.noEjecutadas, null, "noEjecutadas", "audits", "acero"),
        kpiCardHtml("Canceladas", k.canceladas, null, "canceladas", "audits", "acero"),
      ].join("")),
      kpiGroupHtml("Cumplimiento", [
        kpiCardHtml("% Cumplimiento Cronograma Original", k.cumplimientoOriginalPct + "%", "Ejecutadas programadas / Total programado (nunca > 100%)", "ejecutadasProgramadas", "audits", "amarillo"),
        kpiCardHtml("% Avance Total", k.avanceTotalPct + "%", "Incluye no programadas ejecutadas — puede superar 100%", "ejecutadas", "audits", "amarillo"),
      ].join("")),
      kpiGroupHtml("Alertas", [
        kpiCardHtml("Próximos 30 Días", k.proximos30Dias, "Por ejecutar con fecha cercana", "proximos30Dias", "audits", "negro"),
      ].join("")),
    ].join("");
  }

  /** Texto bajo el gauge "Brecha de Ejecución": Real / Meta hoy / Brecha,
   * con color según si va adelantado (verde) o atrasado (rojo) el cronograma.
   * `elId`/`realLabel` parametrizables para reusar el mismo render en el
   * gauge "con No Programadas" (ver renderEverything). */
  function renderBrechaResumen(g, elId, realLabel) {
    const el = document.getElementById(elId || "brechaResumenTexto");
    if (!el) return;
    const ok = g.brechaPct >= 0;
    const brechaTexto = (ok ? "+" : "") + g.brechaPct + " pts";
    el.innerHTML = `
      <div class="qa-brecha-item"><div class="val">${g.realPct}%</div><div class="lbl">${realLabel || "Avance Real"}</div></div>
      <div class="qa-brecha-item"><div class="val">${g.esperadoPct}%</div><div class="lbl">Meta a Hoy</div></div>
      <div class="qa-brecha-item ${ok ? "ok" : "behind"}"><div class="val">${brechaTexto}</div><div class="lbl">Brecha (${ok ? "adelantado" : "atrasado"})</div></div>
    `;
  }

  /** KPI simples para las secciones Auditorías / Inspecciones (subconjunto
   * ya filtrado por tipoRegistro — ver renderEverything). */
  function renderSubsectionKpis(gridId, subset) {
    const k = QA.kpiEngine.computeKpis(subset, []);
    document.getElementById(gridId).innerHTML = [
      kpiCardHtml("Total", k.totalAuditorias),
      kpiCardHtml("Programadas", k.programadas),
      kpiCardHtml("Ejecutadas", k.ejecutadas, "Incluye extraordinarias ejecutadas"),
      kpiCardHtml("% Cumplimiento Original", k.cumplimientoOriginalPct + "%"),
    ].join("");
  }

  /* ------------------------------------------------------------------ *
   * Modal de detalle al hacer clic en una tarjeta KPI
   * ------------------------------------------------------------------ */
  let kpiModalInstance = null;

  function estadoEfectivoHallazgo(f) { return f.estadoHallazgo || null; }

  function openKpiModal(title, items, kind) {
    document.getElementById("kpiModalLabel").textContent = `${title} (${items.length})`;
    const head = document.getElementById("kpiModalHead");
    const body = document.getElementById("kpiModalBody");

    if (kind === "findings") {
      head.innerHTML = "<tr><th>Auditoría</th><th>Descripción</th><th>Causa raíz</th><th>Estado</th><th>Fecha</th></tr>";
      body.innerHTML = items.length ? items.map(f => `<tr>
        <td>${u.escapeHtml(f.auditado || "—")}</td>
        <td style="white-space:normal;min-width:220px">${u.escapeHtml((f.descripcion && f.descripcion !== "N/A") ? f.descripcion : "—")}</td>
        <td>${u.escapeHtml((f.clasificacionReporte && f.clasificacionReporte !== "N/A") ? f.clasificacionReporte : "—")}</td>
        <td>${u.escapeHtml(estadoEfectivoHallazgo(f) || "—")}</td>
        <td>${u.formatDate(f.fechaInicio)}</td>
      </tr>`).join("") : `<tr><td colspan="5" class="text-center text-muted py-3">Sin registros.</td></tr>`;
    } else {
      head.innerHTML = "<tr><th>Auditoría / Inspección</th><th>Tipo</th><th>Fecha</th><th>Estado</th></tr>";
      body.innerHTML = items.length ? items.map(a => `<tr>
        <td>${u.escapeHtml(a.auditado || "—")}</td>
        <td>${u.escapeHtml(a.tipoAuditoria || a.clasificacionLabel || "—")}</td>
        <td>${a.fechaProgramada ? u.formatDate(a.fechaProgramada) : (a.esExtraordinaria ? "No programada" : "—")}</td>
        <td>${QA.tables.estadoBadgeHtml(a.estadoCalculado)}</td>
      </tr>`).join("") : `<tr><td colspan="4" class="text-center text-muted py-3">Sin registros.</td></tr>`;
    }
    if (!kpiModalInstance) kpiModalInstance = new bootstrap.Modal(document.getElementById("kpiModal"));
    kpiModalInstance.show();
  }

  function wireKpiModals() {
    const kpiSource = { kpiGridResumen: "lastKpis", kpiGridHallazgos: "lastKpis", kpiGridResumenInsp: "lastKpisInsp" };
    Object.keys(kpiSource).forEach((gridId) => {
      const grid = document.getElementById(gridId);
      const trigger = (e) => {
        const card = e.target.closest("[data-kpi-list]");
        if (!card) return;
        if (e.type === "keydown" && e.key !== "Enter" && e.key !== " ") return;
        if (e.type === "keydown") e.preventDefault();
        const listKey = card.dataset.kpiList;
        const kind = card.dataset.kpiKind;
        const kpis = state[kpiSource[gridId]];
        const items = (kpis && kpis.lists && kpis.lists[listKey]) || [];
        openKpiModal(card.dataset.kpiTitle, items, kind);
      };
      grid.addEventListener("click", trigger);
      grid.addEventListener("keydown", trigger);
    });
  }

  /* ------------------------------------------------------------------ *
   * Formulario de Auditoría (crear / editar / eliminar)
   * ------------------------------------------------------------------ */
  let auditoriaModalInstance = null;
  let editingAuditoria = null; // objeto completo cargado (para preservar campos que el form no edita), o null si es nueva

  function getAuditoriaModal() {
    if (!auditoriaModalInstance) auditoriaModalInstance = new bootstrap.Modal(document.getElementById("auditoriaModal"));
    return auditoriaModalInstance;
  }

  /** `defaultTipoRegistro` — al crear desde "+ Nueva Inspección" se abre
   * el mismo formulario preseleccionado en Inspección (ver wireHeaderActions). */
  function openAuditoriaForm(audit, defaultTipoRegistro) {
    editingAuditoria = audit || null;
    document.getElementById("auditoriaForm").reset();
    document.getElementById("afId").value = audit ? audit.id : "";
    document.getElementById("auditoriaModalLabel").textContent = audit ? "Editar Registro" : "Nuevo Registro";
    document.getElementById("afAuditado").value = audit ? (audit.auditado || "") : "";
    document.getElementById("afCiudad").value = audit ? (audit.ciudad || "") : "";
    document.getElementById("afClasificacionLabel").value = audit ? (audit.clasificacionLabel || "") : "";
    document.getElementById("afTipoRegistro").value = audit ? (audit.tipoRegistro || "AUDITORIA") : (defaultTipoRegistro || "AUDITORIA");
    document.getElementById("afEstatus").value = audit ? (audit.estatus || "Por Ejecutar") : "Por Ejecutar";
    document.getElementById("afCierre").value = audit ? (audit.cierreManual || "") : "";
    document.getElementById("afModalidad").value = audit ? (audit.modalidad || "") : "";
    document.getElementById("afAuditorResponsable").value = audit ? (audit.auditorResponsable || "") : "";
    document.getElementById("afFechaProgramada").value = dateInputVal(audit && audit.fechaProgramada);
    document.getElementById("afEsExtraordinaria").checked = !!(audit && audit.esExtraordinaria);
    document.getElementById("afFechaEjecucionReal").value = dateInputVal(audit && audit.fechaEjecucionReal);
    document.getElementById("afNotas").value = audit ? (audit.notas || "") : "";
    document.getElementById("afBtnDelete").classList.toggle("d-none", !audit);
    toggleFechaEjecucionRealVisibility();
    getAuditoriaModal().show();
  }

  function toggleFechaEjecucionRealVisibility() {
    const show = document.getElementById("afEsExtraordinaria").checked;
    document.getElementById("afFechaEjecucionRealWrap").classList.toggle("d-none", !show);
  }

  function collectAuditoriaFormValues() {
    const esExtraordinaria = document.getElementById("afEsExtraordinaria").checked;
    const tipoRegistro = document.getElementById("afTipoRegistro").value;
    return {
      auditado: document.getElementById("afAuditado").value.trim(),
      ciudad: document.getElementById("afCiudad").value.trim() || null,
      clasificacionLabel: document.getElementById("afClasificacionLabel").value.trim() || null,
      tipoRegistro,
      tipoAmplio: tipoRegistro === "INSPECCION" ? "Inspección" : "Proveedor",
      estatus: document.getElementById("afEstatus").value,
      cierreManual: document.getElementById("afCierre").value || null,
      modalidad: document.getElementById("afModalidad").value.trim() || null,
      auditorResponsable: document.getElementById("afAuditorResponsable").value.trim() || null,
      fechaProgramada: dateFromInput("afFechaProgramada"),
      esExtraordinaria,
      esNoProgramadaEnCrono: esExtraordinaria,
      fechaEjecucionReal: dateFromInput("afFechaEjecucionReal"),
      notas: document.getElementById("afNotas").value.trim() || null,
    };
  }

  function wireAuditoriaForm() {
    document.getElementById("afEsExtraordinaria").addEventListener("change", toggleFechaEjecucionRealVisibility);
    document.getElementById("auditoriaForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const values = collectAuditoriaFormValues();
      if (!values.auditado) return;
      const merged = Object.assign({}, editingAuditoria || {}, values);
      if (!merged.anio) merged.anio = state.year; // los registros nuevos pertenecen a la vigencia que se está viendo
      try {
        await QA.dataService.saveAuditoria(merged);
        getAuditoriaModal().hide();
        await loadAndRenderAll();
      } catch (err) {
        alert("No se pudo guardar la auditoría: " + (err && err.message ? err.message : err));
      }
    });
    document.getElementById("afBtnDelete").addEventListener("click", async () => {
      if (!editingAuditoria || !editingAuditoria.id) return;
      if (!confirm(`¿Eliminar la auditoría "${editingAuditoria.auditado}"? Los hallazgos vinculados quedarán sin auditoría asociada. Esta acción no se puede deshacer.`)) return;
      try {
        await QA.dataService.deleteAuditoria(editingAuditoria.id);
        getAuditoriaModal().hide();
        await loadAndRenderAll();
      } catch (err) {
        alert("No se pudo eliminar la auditoría: " + (err && err.message ? err.message : err));
      }
    });
  }

  /* ------------------------------------------------------------------ *
   * Formulario de Hallazgo (crear / editar / eliminar)
   * ------------------------------------------------------------------ */
  let hallazgoModalInstance = null;
  let editingHallazgo = null;

  function getHallazgoModal() {
    if (!hallazgoModalInstance) hallazgoModalInstance = new bootstrap.Modal(document.getElementById("hallazgoModal"));
    return hallazgoModalInstance;
  }

  function populateAuditoriaSelect(currentId) {
    const sel = document.getElementById("hfAuditoriaId");
    sel.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = ""; placeholder.textContent = "— Selecciona una auditoría —";
    sel.appendChild(placeholder);
    state.allAudits.slice()
      .sort((a, b) => (a.auditado || "").localeCompare(b.auditado || "", "es"))
      .forEach((a) => {
        const o = document.createElement("option");
        o.value = a.id; o.textContent = a.auditado;
        sel.appendChild(o);
      });
    sel.value = currentId || "";
  }

  function openHallazgoForm(finding) {
    editingHallazgo = finding || null;
    document.getElementById("hallazgoForm").reset();
    document.getElementById("hfId").value = finding ? finding.id : "";
    document.getElementById("hallazgoModalLabel").textContent = finding ? "Editar Hallazgo" : "Nuevo Hallazgo";
    populateAuditoriaSelect(finding ? finding.auditoriaVinculada : "");
    document.getElementById("hfCondicion").value = finding ? (finding.condicion || "NC") : "NC";
    document.getElementById("hfEstadoHallazgo").value = finding ? (finding.estadoHallazgo || "") : "";
    document.getElementById("hfAuditorLider").value = finding ? (finding.auditorLider || "") : "";
    document.getElementById("hfFechaInicio").value = dateInputVal(finding && finding.fechaInicio);
    document.getElementById("hfFechaCierreReporte").value = dateInputVal(finding && finding.fechaCierreReporte);
    document.getElementById("hfClasificacionReporte").value = finding ? (finding.clasificacionReporte || "") : "";
    document.getElementById("hfRequisito").value = finding ? (finding.requisito || "") : "";
    document.getElementById("hfDescripcion").value = finding ? (finding.descripcion || "") : "";
    document.getElementById("hfBtnDelete").classList.toggle("d-none", !finding);
    getHallazgoModal().show();
  }

  function collectHallazgoFormValues() {
    return {
      auditoriaVinculada: document.getElementById("hfAuditoriaId").value || null,
      condicion: document.getElementById("hfCondicion").value,
      estadoHallazgo: document.getElementById("hfEstadoHallazgo").value || null,
      auditorLider: document.getElementById("hfAuditorLider").value.trim() || null,
      fechaInicio: dateFromInput("hfFechaInicio"),
      fechaCierreReporte: dateFromInput("hfFechaCierreReporte"),
      clasificacionReporte: document.getElementById("hfClasificacionReporte").value.trim() || null,
      requisito: document.getElementById("hfRequisito").value.trim() || null,
      descripcion: document.getElementById("hfDescripcion").value.trim() || null,
    };
  }

  function wireHallazgoForm() {
    document.getElementById("hallazgoForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const values = collectHallazgoFormValues();
      if (!values.auditoriaVinculada) { alert("Selecciona la auditoría a la que pertenece este hallazgo."); return; }
      const linkedAudit = state.allAudits.find(a => a.id === values.auditoriaVinculada);
      values.auditado = linkedAudit ? linkedAudit.auditado : (editingHallazgo ? editingHallazgo.auditado : null);
      const merged = Object.assign({}, editingHallazgo || {}, values);
      merged.anio = (linkedAudit && linkedAudit.anio) || merged.anio || state.year;
      try {
        await QA.dataService.saveHallazgo(merged);
        getHallazgoModal().hide();
        await loadAndRenderAll();
      } catch (err) {
        alert("No se pudo guardar el hallazgo: " + (err && err.message ? err.message : err));
      }
    });
    document.getElementById("hfBtnDelete").addEventListener("click", async () => {
      if (!editingHallazgo || !editingHallazgo.id) return;
      if (!confirm("¿Eliminar este hallazgo? Esta acción no se puede deshacer.")) return;
      try {
        await QA.dataService.deleteHallazgo(editingHallazgo.id);
        getHallazgoModal().hide();
        await loadAndRenderAll();
      } catch (err) {
        alert("No se pudo eliminar el hallazgo: " + (err && err.message ? err.message : err));
      }
    });
  }

  /* ------------------------------------------------------------------ *
   * Panel FAA Self Evaluation (metadatos, ver js/dataService.js)
   * ------------------------------------------------------------------ */
  function renderFaaPanel(auditoriasSoloTipo) {
    const faa = QA.kpiEngine.faaAuditorias(auditoriasSoloTipo);
    const ejecutadas = faa.filter(a => a.estadoCalculado === QA.statusEngine.ESTADOS.EJECUTADA).length;
    const cerradas = faa.filter(a => a.cierreRollup === QA.statusEngine.CIERRE.CERRADO).length;
    const hallazgos = faa.reduce((n, a) => n + (a.hallazgosVinculados || 0), 0);
    document.getElementById("kpiGridFaa").innerHTML = [
      kpiCardHtml("Auditorías FAA", faa.length, "Categorías detectadas en la hoja de auditorías"),
      kpiCardHtml("Ejecutadas", ejecutadas),
      kpiCardHtml("Cerradas", cerradas, "Sin hallazgos o todos cerrados"),
      kpiCardHtml("Hallazgos vinculados", hallazgos),
    ].join("");
    QA.charts.renderAuditoriasPorCierre(QA.kpiEngine.auditoriasPorCierre(faa), (label) => {
      openKpiModal(`Auditorías FAA — ${label}`, QA.kpiEngine.auditoriasPorCierreItems(faa, label), "audits");
    }, "chartFaaCierre");
    QA.tables.updateFaaTable(faa, openAuditoriaForm);
  }

  /* ------------------------------------------------------------------ *
   * Drill-down de gráficas: un callback por gráfico que abre el modal de
   * detalle (openKpiModal) con los registros crudos detrás de la barra/
   * porción clicada — ver js/charts.js#renderAll y js/kpiEngine.js (las
   * funciones "...Items" hacen el mismo filtro exacto que agrega los datos
   * del gráfico, para que el detalle siempre cuadre con lo mostrado).
   * ------------------------------------------------------------------ */
  function buildChartDrilldownHandlers(auditoriasSoloTipo, inspeccionesSoloTipo, findings) {
    const K = QA.kpiEngine;
    return {
      onProgramaMes: (label, datasetLabel, monthIndex) => {
        const categoriaMap = { "Programadas": "programadas", "Ejecutadas": "ejecutadas", "No Programadas Ejecutadas": "extraordinarias" };
        const categoria = categoriaMap[datasetLabel];
        if (!categoria) return;
        openKpiModal(`${datasetLabel} — ${u.MONTH_NAMES[monthIndex]}`, K.auditoriasDeMes(auditoriasSoloTipo, monthIndex, categoria), "audits");
      },
      onInspeccionesMes: (label, datasetLabel, monthIndex) => {
        const categoriaMap = { "Programadas": "programadas", "Ejecutadas": "ejecutadas", "No Programadas Ejecutadas": "extraordinarias" };
        const categoria = categoriaMap[datasetLabel];
        if (!categoria) return;
        openKpiModal(`Inspecciones ${datasetLabel} — ${u.MONTH_NAMES[monthIndex]}`, K.auditoriasDeMes(inspeccionesSoloTipo, monthIndex, categoria), "audits");
      },
      onEstadoPrograma: (label) => openKpiModal(`Estado del Programa — ${label}`, K.estadoProgramaItems(auditoriasSoloTipo, label), "audits"),
      onAuditoriasPorCierre: (label) => openKpiModal(`Auditorías por Cierre — ${label}`, K.auditoriasPorCierreItems(auditoriasSoloTipo, label), "audits"),
      onHallazgosEstado: (label) => openKpiModal(`Hallazgos — ${label}`, K.hallazgosPorEstadoItems(findings, label), "findings"),
      onHallazgosClasificacion: (label) => openKpiModal(`Hallazgos por Causa Raíz — ${label}`, K.hallazgosPorClasificacionItems(findings, label), "findings"),
      onHallazgosTendencia: (label, datasetLabel, monthIndex) => {
        const serie = datasetLabel === "Cerrados" ? "cerrados" : "emitidos";
        openKpiModal(`Hallazgos ${datasetLabel} — ${u.MONTH_NAMES[monthIndex]}`, K.hallazgosTendenciaItems(findings, monthIndex, serie), "findings");
      },
      onAuditoriasClasificacion: (label) => openKpiModal(`Auditorías — ${label}`, K.auditoriasPorClasificacionItems(auditoriasSoloTipo, label), "audits"),
      onAuditoriasModalidad: (label) => openKpiModal(`Auditorías — ${label}`, K.auditoriasPorModalidadItems(auditoriasSoloTipo, label), "audits"),
      onAuditoriasUbicacion: (label) => openKpiModal(`Auditorías — ${label}`, K.auditoriasPorUbicacionItems(auditoriasSoloTipo, label), "audits"),
      onInspeccionesClasificacion: (label) => openKpiModal(`Inspecciones — ${label}`, K.auditoriasPorClasificacionItems(inspeccionesSoloTipo, label), "audits"),
      onInspeccionesUbicacion: (label, datasetLabel) => {
        const categoriaMap = { "Programadas": "programadas", "Ejecutadas": "ejecutadas", "No Programadas Ejecutadas": "extraordinarias" };
        const categoria = categoriaMap[datasetLabel];
        if (!categoria) return;
        openKpiModal(`Inspecciones ${datasetLabel} — ${label}`, K.auditoriasDeUbicacion(inspeccionesSoloTipo, label, categoria), "audits");
      },
    };
  }

  /* ------------------------------------------------------------------ *
   * Render principal
   * ------------------------------------------------------------------ */
  function renderEverything() {
    const { audits, findings } = QA.filters.apply(state.allAudits, state.allFindings);

    // El Resumen Ejecutivo (KPIs + gráficas de Auditorías/Cumplimiento/
    // Cierre) contabiliza SOLO tipoRegistro=AUDITORIA — las Inspecciones no
    // se mezclan aquí, tienen su propio resumen en la pestaña Inspecciones.
    const auditoriasSoloTipo = QA.kpiEngine.porTipoRegistro(audits, "AUDITORIA");
    const inspeccionesSoloTipo = QA.kpiEngine.porTipoRegistro(audits, "INSPECCION");

    const k = QA.kpiEngine.computeKpis(auditoriasSoloTipo, findings);
    state.lastKpis = k;
    renderKpis(k);

    const kInsp = QA.kpiEngine.computeKpis(inspeccionesSoloTipo, []);
    state.lastKpisInsp = kInsp;
    renderKpisInspecciones(kInsp);

    QA.charts.renderAll(audits, findings, auditoriasSoloTipo, inspeccionesSoloTipo,
      buildChartDrilldownHandlers(auditoriasSoloTipo, inspeccionesSoloTipo, findings));
    renderBrechaResumen(QA.kpiEngine.avanceEsperadoVsReal(auditoriasSoloTipo));
    renderBrechaResumen(QA.kpiEngine.avanceEsperadoVsRealConNoProgramadas(auditoriasSoloTipo), "brechaResumenTextoTotal", "Avance Real + No Programadas");
    const gInsp = QA.kpiEngine.avanceEsperadoVsReal(inspeccionesSoloTipo);
    const gInspTotal = QA.kpiEngine.avanceEsperadoVsRealConNoProgramadas(inspeccionesSoloTipo);
    ["brechaInspTexto", "brechaResInspTexto"].forEach((id) => renderBrechaResumen(gInsp, id));
    ["brechaInspTextoTotal", "brechaResInspTextoTotal"].forEach((id) => renderBrechaResumen(gInspTotal, id, "Avance Real + No Programadas"));
    renderSubsectionKpis("kpiGridPrograma", auditoriasSoloTipo);
    renderSubsectionKpis("kpiGridInspecciones", inspeccionesSoloTipo);
    QA.tables.updateAuditoriasTable(auditoriasSoloTipo, openAuditoriaForm);
    QA.tables.updateInspeccionesTable(inspeccionesSoloTipo, (a) => openAuditoriaForm(a, "INSPECCION"));
    // Excluye los hallazgos "N/A" (marcadores de cierre manual, ver
    // kpiEngine#hallazgosReales) de la tabla — no son hallazgos reales, solo
    // se usan para el rollup de cierre de la auditoría.
    QA.tables.updateHallazgosTable(QA.kpiEngine.hallazgosReales(findings), openHallazgoForm);
    renderFaaPanel(auditoriasSoloTipo);
    QA.charts.resizeAll();
  }

  /* ------------------------------------------------------------------ *
   * Navegación entre secciones (pestañas tipo Power BI)
   * ------------------------------------------------------------------ */
  function wireNav() {
    document.querySelectorAll(".qa-nav-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".qa-nav-item").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        document.querySelectorAll(".qa-section").forEach(s => s.classList.add("d-none"));
        document.getElementById(btn.dataset.section).classList.remove("d-none");
        // Los filtros globales no aplican al comparativo (compara programas completos).
        document.getElementById("filtersBar").classList.toggle("d-none", btn.dataset.section === "secComparativo");
        QA.charts.resizeAll();
      });
    });
  }

  /* ------------------------------------------------------------------ *
   * Carga de Excel: botón en el header y en la pantalla "sin datos" abren
   * el mismo <input type="file"> oculto. Cada Excel trae una o varias
   * vigencias (hojas AUDITORIAS_<año> + HALLAZGOS_<año>): reemplaza SOLO
   * esas vigencias y conserva las demás (ver js/excelImport.js y
   * dataService.replaceVigencias).
   * ------------------------------------------------------------------ */
  function wireExcelImport() {
    const input = document.getElementById("excelFileInput");
    const openPicker = () => input.click();
    document.getElementById("btnCargarExcel").addEventListener("click", openPicker);
    document.getElementById("btnCargarExcelSetup").addEventListener("click", openPicker);

    input.addEventListener("change", async () => {
      const file = input.files[0];
      input.value = ""; // permite volver a elegir el mismo archivo más adelante
      if (!file) return;

      const hayDatos = state.loaded && state.everyAudits.length > 0;

      showLoading("Leyendo el Excel…");
      clearSetupAlert();
      try {
        // Un Excel puede traer una o varias vigencias; solo se reemplazan las que trae.
        const years = await QA.excelParser.listYears(file);
        const reemplazan = years.map((y) => y.anio).filter((y) => state.years.includes(y));
        if (reemplazan.length) {
          hideLoading();
          const conservan = state.years.filter((y) => !reemplazan.includes(y));
          const ok = confirm(`Vas a reemplazar los datos de la vigencia ${reemplazan.join(", ")} con "${file.name}". ` +
            (conservan.length ? `Las vigencias ${conservan.join(", ")} se conservan. ` : "") + "Esta acción no se puede deshacer. ¿Continuar?");
          if (!ok) return;
          showLoading("Leyendo el Excel…");
        }
        const { vigencias } = await QA.excelImport.importFromExcel(file);
        await QA.dataService.replaceVigencias(vigencias, { fileName: file.name, importedAt: new Date().toISOString() });
        state.year = vigencias[vigencias.length - 1].anio; // se muestra lo recién cargado
        await startApp();
        let msg = "Carga completa:\n" + vigencias.map(({ resumen: r }) =>
          `· Vigencia ${r.anio} (${r.hojaAuditorias}${r.hojaHallazgos ? " + " + r.hojaHallazgos : ""}): ${r.auditorias} auditorías, ${r.inspecciones} inspecciones, ${r.hallazgos} hallazgos (${r.hallazgosVinculados} vinculados a una auditoría).`
        ).join("\n");
        vigencias.forEach(({ resumen: r }) => {
          if (r.hallazgosSinVincular) {
            msg += `\n\nVigencia ${r.anio}: ${r.hallazgosSinVincular} hallazgo(s) no se pudieron vincular a ninguna auditoría. Auditados sin coincidencia:\n- ${r.nombresSinVincular.slice(0, 10).join("\n- ")}\n\nRevisa que el nombre en "NOMBRE AUDITADO" de ${r.hojaHallazgos} sea igual al de "Area o Proveedor" en ${r.hojaAuditorias}.`;
          }
        });
        alert(msg);
      } catch (e) {
        console.error(e);
        const msg = "No se pudo cargar el Excel: " + (e && e.message ? e.message : e);
        if (hayDatos) alert(msg); else showSetupAlert(msg, "danger");
      } finally {
        hideLoading();
      }
    });
  }

  /* ------------------------------------------------------------------ *
   * Reiniciar: borra los datos guardados y las preferencias (filtros,
   * vigencia elegida) y vuelve a la pantalla inicial "cargar Excel".
   * ------------------------------------------------------------------ */
  function wireReset() {
    document.getElementById("btnReiniciar").addEventListener("click", async () => {
      const cuantas = state.years.length;
      const ok = confirm(
        "Vas a reiniciar la app: se borran TODOS los datos guardados en este navegador" +
        (cuantas ? ` (${cuantas} vigencia${cuantas === 1 ? "" : "s"}: ${state.years.join(", ")})` : "") +
        " y se limpian los filtros. Tendrás que volver a cargar un Excel. Esta acción no se puede deshacer. ¿Continuar?");
      if (!ok) return;
      showLoading("Reiniciando…");
      try {
        await QA.dataService.clearAll();
        try { localStorage.removeItem(YEAR_KEY); } catch (e) { /* no crítico */ }
        QA.filters.reset();
        Object.assign(state, { everyAudits: [], everyFindings: [], allAudits: [], allFindings: [], years: [], year: null, loaded: false, lastKpis: null, lastKpisInsp: null });
        document.getElementById("lblUltimaActualizacion").textContent = "";
        clearSetupAlert();
        showEmptyDataScreen();
        window.scrollTo(0, 0);
      } catch (e) {
        console.error(e);
        alert("No se pudo reiniciar: " + (e && e.message ? e.message : e));
      } finally {
        hideLoading();
      }
    });
  }

  /* ------------------------------------------------------------------ *
   * Acciones de cabecera: imprimir, exportar PDF, nuevos registros
   * ------------------------------------------------------------------ */
  function wireHeaderActions() {
    document.getElementById("btnPrint").addEventListener("click", () => QA.exportPdf.print());
    document.getElementById("btnExportPdf").addEventListener("click", async () => {
      showLoading("Generando PDF…");
      try {
        await QA.exportPdf.exportDashboardToPdf(
          ["secResumen", "secPrograma", "secInspecciones", "secHallazgos", "secFaa"],
          { title: `Dashboard QA-OMA — Vigencia ${state.year}`, onProgress: (i, total) => showLoading(`Generando PDF… (${i + 1}/${total})`) }
        );
      } catch (e) {
        console.error(e);
        alert("No se pudo generar el PDF: " + (e && e.message ? e.message : e));
      } finally { hideLoading(); }
    });
    document.getElementById("btnExportAuditoriasExcel").addEventListener("click", () => QA.tables.exportAuditoriasExcel());
    document.getElementById("btnExportHallazgosExcel").addEventListener("click", () => QA.tables.exportHallazgosExcel());
    document.getElementById("btnNuevaAuditoria").addEventListener("click", () => openAuditoriaForm(null, "AUDITORIA"));
    document.getElementById("btnNuevaInspeccion").addEventListener("click", () => openAuditoriaForm(null, "INSPECCION"));
    document.getElementById("btnNuevoHallazgo").addEventListener("click", () => openHallazgoForm(null));
  }

  /* ------------------------------------------------------------------ *
   * Arranque
   * ------------------------------------------------------------------ */
  document.addEventListener("DOMContentLoaded", async () => {
    wireFilters();
    wireYearPicker();
    wireNav();
    wireExcelImport();
    wireReset();
    wireHeaderActions();
    wireKpiModals();
    wireAuditoriaForm();
    wireHallazgoForm();

    await startApp();
  });
})();
