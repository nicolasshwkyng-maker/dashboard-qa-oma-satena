/**
 * js/app.js — Orquestación de la aplicación
 * ============================================================================
 * Punto de entrada. Conecta la pantalla de login (Supabase Auth), carga los
 * datos desde Supabase (js/dataService.js), conecta los filtros globales con
 * gráficos y tablas, y wire-ea los formularios de edición de Auditoría y
 * Hallazgo. Cualquier cambio (desde esta pestaña u otra sesión) llega vía
 * Realtime y dispara un refresco automático de KPIs/gráficas/tablas.
 *
 * Pipeline de carga:
 *   1. dataService.fetchAuditorias / fetchHallazgos / fetchFaaDocumentos
 *   2. statusEngine.applyAll -> calcula el estado real de cada auditoría
 *   3. attachFindingsToAudits -> agrega conteos de hallazgos por auditoría
 *      (el vínculo mismo ya es un FK real en la base de datos, no una
 *      adivinanza por nombre como en la versión basada en Excel/carpetas)
 *   4. kpiEngine + charts + tables -> se pintan con los datos ya filtrados
 */

(function () {
  const u = QA.utils;

  const state = {
    allAudits: [], allFindings: [], allFaaDocs: [],
    loaded: false, lastKpis: null,
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
  function showLoginScreen() {
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
   * Login / logout (Supabase Auth)
   * ------------------------------------------------------------------ */
  function wireLoginScreen() {
    document.getElementById("loginForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      clearSetupAlert();
      const email = document.getElementById("loginEmail").value.trim();
      const password = document.getElementById("loginPassword").value;
      const btn = document.getElementById("btnLogin");
      btn.disabled = true;
      try {
        await QA.dataService.signIn(email, password);
        // El listener de onAuthChange se encarga de mostrar la app.
      } catch (err) {
        showSetupAlert("No se pudo iniciar sesión: " + (err && err.message ? err.message : err), "danger");
      } finally {
        btn.disabled = false;
      }
    });
  }

  function wireLogout() {
    document.getElementById("btnLogout").addEventListener("click", async () => {
      await QA.dataService.signOut();
    });
  }

  /* ------------------------------------------------------------------ *
   * Carga de datos desde Supabase
   * ------------------------------------------------------------------ */
  /** Cuenta hallazgos por auditoría a partir del FK real hallazgo.auditoriaVinculada
   * (ya resuelto por dataService — no hace falta adivinar por similitud de nombre). */
  function attachFindingsToAudits(audits, findings) {
    const findingsByAudit = new Map();
    findings.forEach((f) => {
      if (!f.auditoriaVinculada) return;
      if (!findingsByAudit.has(f.auditoriaVinculada)) findingsByAudit.set(f.auditoriaVinculada, []);
      findingsByAudit.get(f.auditoriaVinculada).push(f);
    });
    audits.forEach((a) => {
      const list = findingsByAudit.get(a.id) || [];
      a.hallazgosVinculados = list.length;
      a.hallazgosVinculadosNC = list.filter(f => f.condicion === "NC").length;
      a.hallazgosVinculadosOB = list.filter(f => f.condicion === "OB").length;
    });
  }

  async function loadAndRenderAll() {
    try {
      showLoading("Cargando auditorías, hallazgos y documentos FAA…");
      const [audits, findings, faaDocs] = await Promise.all([
        QA.dataService.fetchAuditorias(), QA.dataService.fetchHallazgos(), QA.dataService.fetchFaaDocumentos(),
      ]);
      QA.statusEngine.applyAll(audits);
      attachFindingsToAudits(audits, findings);

      state.allAudits = audits;
      state.allFindings = findings;
      state.allFaaDocs = faaDocs;
      state.loaded = true;

      QA.filters.load();
      populateFilterOptions();
      renderEverything();

      document.getElementById("lblUltimaActualizacion").textContent = "Actualizado: " + new Date().toLocaleString("es-CO");
      hideLoading();
    } catch (e) {
      hideLoading();
      console.error(e);
      alert("No se pudieron cargar los datos desde Supabase: " + (e && e.message ? e.message : e));
    }
  }

  const debouncedReload = u.debounce(() => { if (state.loaded) loadAndRenderAll(); }, 400);

  async function handleAuthedSession() {
    showAppScreen();
    clearSetupAlert();
    await loadAndRenderAll();
    if (!stopRealtime) stopRealtime = QA.dataService.subscribeToChanges(debouncedReload);
  }

  function handleSignedOut() {
    if (stopRealtime) { stopRealtime(); stopRealtime = null; }
    state.loaded = false;
    showLoginScreen();
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
    fillSelect("fAnio", opts.years, null, null, s.anio);
    fillSelect("fMes", opts.months, "value", "label", s.mes);
    fillSelect("fClasificacion", opts.clasificaciones, null, null, s.clasificacion);
    fillSelect("fTipo", ["Proveedor", "Área Interna", "Inspección"], null, null, s.tipo);
    fillSelect("fProveedor", opts.proveedores, null, null, s.proveedor);
    fillSelect("fAreaInterna", opts.areasInternas, null, null, s.areaInterna);
    fillSelect("fModalidad", opts.modalidades, null, null, s.modalidad);
    fillSelect("fUbicacion", opts.ubicaciones, null, null, s.ubicacion);
    fillSelect("fAuditor", opts.auditores, null, null, s.auditor);
    document.getElementById("fEstado").value = s.estado || "";
  }

  function wireFilters() {
    const map = { fAnio: "anio", fMes: "mes", fClasificacion: "clasificacion", fTipo: "tipo", fProveedor: "proveedor", fAreaInterna: "areaInterna", fModalidad: "modalidad", fUbicacion: "ubicacion", fAuditor: "auditor", fEstado: "estado" };
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
  function kpiCardHtml(label, value, hint, listKey, kind) {
    const clickable = !!listKey;
    const attrs = clickable ? ` data-kpi-list="${listKey}" data-kpi-kind="${kind}" data-kpi-title="${u.escapeHtml(label)}" role="button" tabindex="0"` : "";
    return `<div class="qa-kpi-card${clickable ? " qa-kpi-clickable" : ""}"${attrs}><div class="qa-kpi-value">${u.escapeHtml(String(value))}</div><div class="qa-kpi-label">${u.escapeHtml(label)}</div>${hint ? `<div class="qa-kpi-hint">${u.escapeHtml(hint)}</div>` : ""}</div>`;
  }

  function renderKpis(k) {
    document.getElementById("kpiGridResumen").innerHTML = [
      kpiCardHtml("Total de Auditorías", k.totalAuditorias, `${k.programadas} programadas + ${k.extraordinarias} extraordinarias`, "totalAuditorias", "audits"),
      kpiCardHtml("Auditorías Programadas", k.programadas, null, "programadas", "audits"),
      kpiCardHtml("Auditorías Ejecutadas", k.ejecutadas, "Incluye extraordinarias ejecutadas", "ejecutadas", "audits"),
      kpiCardHtml("Auditorías Pendientes", k.pendientes, null, "pendientes", "audits"),
      kpiCardHtml("Auditorías Extraordinarias", k.extraordinarias, null, "extraordinarias", "audits"),
      kpiCardHtml("En Ejecución", k.enEjecucion, null, "enEjecucion", "audits"),
      kpiCardHtml("% Cumplimiento", k.cumplimientoPct + "%", "Ejecutadas (incl. extraordinarias) / Programadas al inicio", "ejecutadas", "audits"),
      kpiCardHtml("Hallazgos Abiertos", k.hallazgosAbiertos, null, "hallazgosAbiertos", "findings"),
      kpiCardHtml("Hallazgos Cerrados", k.hallazgosCerrados, null, "hallazgosCerrados", "findings"),
      kpiCardHtml("Total de Hallazgos", k.hallazgosTotal, null, "hallazgosTotal", "findings"),
      kpiCardHtml("Auditorías Vencidas", k.vencidas, null, "vencidas", "audits"),
      kpiCardHtml("Próximos 30 Días", k.proximos30Dias, null, "proximos30Dias", "audits"),
    ].join("");

    document.getElementById("kpiGridHallazgos").innerHTML = [
      kpiCardHtml("Total de Hallazgos", k.hallazgosTotal, null, "hallazgosTotal", "findings"),
      kpiCardHtml("Abiertos", k.hallazgosAbiertos, null, "hallazgosAbiertos", "findings"),
      kpiCardHtml("Cerrados", k.hallazgosCerrados, null, "hallazgosCerrados", "findings"),
      kpiCardHtml("% Cerrados", k.hallazgosTotal ? Math.round((k.hallazgosCerrados / k.hallazgosTotal) * 100) + "%" : "0%"),
    ].join("");
  }

  /* ------------------------------------------------------------------ *
   * Modal de detalle al hacer clic en una tarjeta KPI
   * ------------------------------------------------------------------ */
  let kpiModalInstance = null;

  function estadoEfectivoHallazgo(f) { return f.estadoHallazgo || f.estadoAuditoria || null; }

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
    ["kpiGridResumen", "kpiGridHallazgos"].forEach((gridId) => {
      const grid = document.getElementById(gridId);
      const trigger = (e) => {
        const card = e.target.closest("[data-kpi-list]");
        if (!card) return;
        if (e.type === "keydown" && e.key !== "Enter" && e.key !== " ") return;
        if (e.type === "keydown") e.preventDefault();
        const listKey = card.dataset.kpiList;
        const kind = card.dataset.kpiKind;
        const items = (state.lastKpis && state.lastKpis.lists && state.lastKpis.lists[listKey]) || [];
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

  function openAuditoriaForm(audit) {
    editingAuditoria = audit || null;
    document.getElementById("auditoriaForm").reset();
    document.getElementById("afId").value = audit ? audit.id : "";
    document.getElementById("auditoriaModalLabel").textContent = audit ? "Editar Auditoría" : "Nueva Auditoría";
    document.getElementById("afAuditado").value = audit ? (audit.auditado || "") : "";
    document.getElementById("afCiudad").value = audit ? (audit.ciudad || "") : "";
    document.getElementById("afClasificacionLabel").value = audit ? (audit.clasificacionLabel || "") : "";
    document.getElementById("afTipoAmplio").value = audit ? (audit.tipoAmplio || "Proveedor") : "Proveedor";
    document.getElementById("afModalidad").value = audit ? (audit.modalidad || "") : "";
    document.getElementById("afAuditorResponsable").value = audit ? (audit.auditorResponsable || "") : "";
    document.getElementById("afFechaProgramada").value = dateInputVal(audit && audit.fechaProgramada);
    document.getElementById("afEsExtraordinaria").checked = !!(audit && audit.esExtraordinaria);
    document.getElementById("afFechaEjecucionReal").value = dateInputVal(audit && audit.fechaEjecucionReal);
    document.getElementById("afFechaReprogramacion").value = dateInputVal(audit && audit.fechaReprogramacion);
    document.getElementById("afEstatusManualCrono").value = audit ? (audit.estatusManualCrono || "") : "";
    const counts = (audit && audit.evidenciaCounts) || {};
    document.getElementById("afEv01").value = counts["01_AVI"] || 0;
    document.getElementById("afEv02").value = counts["02_REA"] || 0;
    document.getElementById("afEv03").value = counts["03_SEG"] || 0;
    document.getElementById("afEv04").value = counts["04_CIE"] || 0;
    document.getElementById("afEv05").value = counts["05_EVI"] || 0;
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
    const counts = {
      "01_AVI": Number(document.getElementById("afEv01").value) || 0,
      "02_REA": Number(document.getElementById("afEv02").value) || 0,
      "03_SEG": Number(document.getElementById("afEv03").value) || 0,
      "04_CIE": Number(document.getElementById("afEv04").value) || 0,
      "05_EVI": Number(document.getElementById("afEv05").value) || 0,
    };
    const esExtraordinaria = document.getElementById("afEsExtraordinaria").checked;
    return {
      auditado: document.getElementById("afAuditado").value.trim(),
      ciudad: document.getElementById("afCiudad").value.trim() || null,
      clasificacionLabel: document.getElementById("afClasificacionLabel").value.trim() || null,
      tipoAuditoria: document.getElementById("afClasificacionLabel").value.trim() || null,
      tipoAmplio: document.getElementById("afTipoAmplio").value,
      modalidad: document.getElementById("afModalidad").value.trim() || null,
      auditorResponsable: document.getElementById("afAuditorResponsable").value.trim() || null,
      fechaProgramada: dateFromInput("afFechaProgramada"),
      esExtraordinaria,
      esNoProgramadaEnCrono: esExtraordinaria,
      fechaEjecucionReal: dateFromInput("afFechaEjecucionReal"),
      fechaReprogramacion: dateFromInput("afFechaReprogramacion"),
      estatusManualCrono: document.getElementById("afEstatusManualCrono").value.trim() || null,
      evidenciaCounts: counts,
      evidenciaTotalFiles: Object.values(counts).reduce((s, n) => s + n, 0),
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
  function renderFaaPanel() {
    const docs = state.allFaaDocs;
    const categorias = new Set(docs.map(d => d.categoryKey));
    document.getElementById("kpiGridFaa").innerHTML = [
      kpiCardHtml("Documentos / Revisiones", docs.length, "En Self Evaluation Completadas"),
      kpiCardHtml("Categorías con Evidencia", categorias.size),
      kpiCardHtml("Auditorías Extraordinarias Generadas", categorias.size, "Suman a la ejecución general del programa"),
    ].join("");
    QA.charts.renderFaaCategorias(QA.kpiEngine.faaPorCategoria(docs));
    QA.tables.updateFaaTable(docs);
  }

  /* ------------------------------------------------------------------ *
   * Render principal
   * ------------------------------------------------------------------ */
  function renderEverything() {
    const { audits, findings } = QA.filters.apply(state.allAudits, state.allFindings);
    const k = QA.kpiEngine.computeKpis(audits, findings);
    state.lastKpis = k;
    renderKpis(k);
    QA.charts.renderAll(audits, findings);
    QA.tables.updateAuditoriasTable(audits, openAuditoriaForm);
    QA.tables.updateHallazgosTable(findings, openHallazgoForm);
    renderFaaPanel();
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
        QA.charts.resizeAll();
      });
    });
  }

  /* ------------------------------------------------------------------ *
   * Acciones de cabecera: actualizar, imprimir, exportar PDF, nuevos registros
   * ------------------------------------------------------------------ */
  function wireHeaderActions() {
    document.getElementById("btnRefreshData").addEventListener("click", loadAndRenderAll);
    document.getElementById("btnPrint").addEventListener("click", () => QA.exportPdf.print());
    document.getElementById("btnExportPdf").addEventListener("click", async () => {
      showLoading("Generando PDF…");
      try {
        await QA.exportPdf.exportDashboardToPdf(
          ["secResumen", "secPrograma", "secHallazgos", "secFaa"],
          { title: "Dashboard QA-OMA — SATENA M.R.O.", onProgress: (i, total) => showLoading(`Generando PDF… (${i + 1}/${total})`) }
        );
      } catch (e) {
        console.error(e);
        alert("No se pudo generar el PDF: " + (e && e.message ? e.message : e));
      } finally { hideLoading(); }
    });
    document.getElementById("btnExportAuditoriasExcel").addEventListener("click", () => QA.tables.exportAuditoriasExcel());
    document.getElementById("btnExportHallazgosExcel").addEventListener("click", () => QA.tables.exportHallazgosExcel());
    document.getElementById("btnNuevaAuditoria").addEventListener("click", () => openAuditoriaForm(null));
    document.getElementById("btnNuevoHallazgo").addEventListener("click", () => openHallazgoForm(null));
  }

  /* ------------------------------------------------------------------ *
   * Arranque
   * ------------------------------------------------------------------ */
  document.addEventListener("DOMContentLoaded", async () => {
    if (!QA.supabaseClient) {
      showSetupAlert(QA.supabaseConfigError || "Cliente Supabase no configurado.", "danger");
      document.getElementById("loginForm").classList.add("d-none");
      return;
    }

    wireLoginScreen();
    wireLogout();
    wireFilters();
    wireNav();
    wireHeaderActions();
    wireKpiModals();
    wireAuditoriaForm();
    wireHallazgoForm();

    QA.dataService.onAuthChange((event, session) => {
      if (event === "SIGNED_OUT") { handleSignedOut(); return; }
      if (session) handleAuthedSession(); else handleSignedOut();
    });
  });
})();
