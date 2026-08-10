/**
 * js/filters.js — Filtros globales del dashboard
 * ============================================================================
 * Maneja el estado de los filtros (Año, Mes, Proveedor, Área interna,
 * Clasificación, Modalidad, Ubicación, Auditor, Estado, Tipo) y aplica ese
 * estado tanto a auditorías como a hallazgos. El estado se guarda en
 * localStorage para que persista entre sesiones (conveniencia, no crítico).
 */

window.QA = window.QA || {};

QA.filters = (function () {
  const u = QA.utils;
  const STORAGE_KEY = "qa_satena_dashboard_filters";

  const EMPTY_STATE = {
    anio: "", mes: "", proveedor: "", areaInterna: "", clasificacion: "",
    modalidad: "", ubicacion: "", auditor: "", estado: "", tipo: "",
  };

  let state = { ...EMPTY_STATE };

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) state = { ...EMPTY_STATE, ...JSON.parse(raw) };
    } catch (e) { /* localStorage no disponible: se usa el estado por defecto */ }
    return state;
  }

  function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* no crítico */ }
  }

  function reset() { state = { ...EMPTY_STATE }; persist(); }

  function setValue(key, value) { state[key] = value; persist(); }

  function getState() { return { ...state }; }

  /* ------------------------------------------------------------------ *
   * Construcción de las opciones disponibles para cada dropdown, a
   * partir de los datos realmente cargados (nunca listas fijas).
   * ------------------------------------------------------------------ */
  function buildOptions(audits, findings) {
    const years = new Set(), months = new Set(), proveedores = new Set(), areasInternas = new Set(),
      clasificaciones = new Set(), modalidades = new Set(), ubicaciones = new Set(), auditores = new Set();

    audits.forEach((a) => {
      if (a.fechaProgramada) { years.add(a.fechaProgramada.getFullYear()); months.add(a.fechaProgramada.getMonth()); }
      if (a.tipoAmplio === "Proveedor") proveedores.add(a.auditado);
      if (a.tipoAmplio === "Área Interna") areasInternas.add(a.auditado);
      if (a.clasificacionLabel) clasificaciones.add(a.clasificacionLabel);
      if (a.modalidad) modalidades.add(a.modalidad);
      if (a.ciudad) ubicaciones.add(a.ciudad);
      if (a.auditorResponsable) auditores.add(a.auditorResponsable);
    });
    findings.forEach((f) => { if (f.auditorLider) auditores.add(f.auditorLider); });

    const sortAlpha = (s) => [...s].sort((a, b) => String(a).localeCompare(String(b), "es"));
    return {
      years: [...years].sort((a, b) => a - b),
      months: [...months].sort((a, b) => a - b).map(m => ({ value: m, label: u.MONTH_NAMES[m] })),
      proveedores: sortAlpha(proveedores),
      areasInternas: sortAlpha(areasInternas),
      clasificaciones: sortAlpha(clasificaciones),
      modalidades: sortAlpha(modalidades),
      ubicaciones: sortAlpha(ubicaciones),
      auditores: sortAlpha(auditores),
    };
  }

  /* ------------------------------------------------------------------ *
   * Aplicación de filtros
   * ------------------------------------------------------------------ */
  function auditMatches(a, s) {
    if (s.anio && (!a.fechaProgramada || a.fechaProgramada.getFullYear() !== Number(s.anio))) return false;
    if (s.mes !== "" && s.mes !== undefined && (!a.fechaProgramada || a.fechaProgramada.getMonth() !== Number(s.mes))) return false;
    if (s.proveedor && a.auditado !== s.proveedor) return false;
    if (s.areaInterna && a.auditado !== s.areaInterna) return false;
    if (s.clasificacion && a.clasificacionLabel !== s.clasificacion) return false;
    if (s.modalidad && a.modalidad !== s.modalidad) return false;
    if (s.ubicacion && a.ciudad !== s.ubicacion) return false;
    if (s.auditor && a.auditorResponsable !== s.auditor) return false;
    if (s.estado && a.estadoCalculado !== s.estado) return false;
    if (s.tipo && a.tipoAmplio !== s.tipo) return false;
    return true;
  }

  /** `clasifById` mapea auditoria_id -> clasificacionLabel: ahora que
   * hallazgo.auditoriaVinculada es un FK real hacia Supabase (ya no un
   * emparejamiento difuso adivinado, ver js/dataService.js), el filtro de
   * clasificación se resuelve directo por esa relación en vez de volver a
   * inferir la categoría desde el texto crudo del hallazgo. */
  function findingMatches(f, s, matchedAuditIds, clasifById) {
    if (s.anio && (!f.fechaInicio || f.fechaInicio.getFullYear() !== Number(s.anio))) return false;
    if (s.mes !== "" && s.mes !== undefined && (!f.fechaInicio || f.fechaInicio.getMonth() !== Number(s.mes))) return false;
    if (s.modalidad && f.modalidad !== s.modalidad) return false;
    if (s.ubicacion && f.ciudadEjecucion && !u.normalize(f.ciudadEjecucion).includes(u.normalize(s.ubicacion))) return false;
    if (s.auditor && f.auditorLider !== s.auditor) return false;
    if ((s.proveedor || s.areaInterna) && f.auditoriaVinculada) {
      if (!matchedAuditIds.has(f.auditoriaVinculada)) return false;
      // ya validado por auditoriaVinculada; el nombre exacto se filtra abajo si no hay vínculo
    }
    if (s.clasificacion) {
      const label = f.auditoriaVinculada ? clasifById.get(f.auditoriaVinculada) : null;
      if (label !== s.clasificacion) return false;
    }
    if (s.estado && f.auditoriaVinculada && !matchedAuditIds.has(f.auditoriaVinculada)) return false;
    return true;
  }

  function apply(audits, findings) {
    const s = getState();
    const filteredAudits = audits.filter(a => auditMatches(a, s));
    const matchedAuditIds = new Set(filteredAudits.map(a => a.id));
    const clasifById = new Map(audits.map(a => [a.id, a.clasificacionLabel]));
    const filteredFindings = findings.filter(f => findingMatches(f, s, matchedAuditIds, clasifById));
    return { audits: filteredAudits, findings: filteredFindings };
  }

  function hasActiveFilters() {
    return Object.values(state).some(v => v !== "" && v !== undefined && v !== null);
  }

  return { load, reset, setValue, getState, buildOptions, apply, hasActiveFilters, EMPTY_STATE };
})();
