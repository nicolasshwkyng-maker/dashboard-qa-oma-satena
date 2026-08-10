/**
 * js/dataService.js — fuente de datos: Supabase en vez de Excel/carpetas
 * ============================================================================
 * Reemplaza a fileAccess.js + excelParser.js + folderScanner.js + matching.js
 * como origen de los datos. Expone:
 *   - Auth: signIn, signOut, getSession, onAuthChange
 *   - Lectura: fetchAuditorias, fetchHallazgos
 *   - Escritura: saveAuditoria, deleteAuditoria, saveHallazgo, deleteHallazgo
 *   - Tiempo real: subscribeToChanges(callback) — dispara callback() ante
 *     cualquier INSERT/UPDATE/DELETE en auditorias u hallazgos, para que
 *     app.js pueda refrescar KPIs/gráficas/tablas sin recargar la página.
 *
 * Las funciones de statusEngine.js/kpiEngine.js/charts.js/tables.js siguen
 * operando sobre los mismos objetos camelCase de siempre (auditado,
 * fechaProgramada, evidenciaCounts, ...) — este módulo es el único que
 * conoce los nombres de columna snake_case de Postgres.
 */

window.QA = window.QA || {};

QA.dataService = (function () {
  const sb = () => QA.supabaseClient;

  function requireClient() {
    if (!sb()) throw new Error(QA.supabaseConfigError || "Cliente Supabase no inicializado.");
    return sb();
  }

  /* ------------------------------------------------------------------ *
   * Auth
   * ------------------------------------------------------------------ */
  async function signIn(email, password) {
    const { data, error } = await requireClient().auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data.session;
  }
  async function signOut() {
    await requireClient().auth.signOut();
  }
  async function getSession() {
    const { data } = await requireClient().auth.getSession();
    return data.session;
  }
  /** callback(event, session) — event es "SIGNED_IN" | "SIGNED_OUT" |
   * "INITIAL_SESSION" | "TOKEN_REFRESHED" | ... (ver docs de Supabase Auth). */
  function onAuthChange(callback) {
    requireClient().auth.onAuthStateChange((event, session) => callback(event, session));
  }

  /* ------------------------------------------------------------------ *
   * Conversión de fechas: Postgres "date" (YYYY-MM-DD) <-> JS Date, tal
   * como espera el resto de la app (kpiEngine.js hace a.fechaProgramada.getMonth()).
   * ------------------------------------------------------------------ */
  function toDate(v) { return v ? new Date(v + "T00:00:00") : null; }
  function toDateStr(v) {
    if (!v) return null;
    const d = (v instanceof Date) ? v : new Date(v);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  }

  /* ------------------------------------------------------------------ *
   * auditorias: mapeo DB (snake_case) <-> app (camelCase)
   * ------------------------------------------------------------------ */
  function fromDbAuditoria(row) {
    return {
      id: row.id,
      idAuditadoCrono: row.id_auditado_crono,
      auditado: row.auditado,
      clasificacionCanonica: row.clasificacion_canonica,
      clasificacionLabel: row.clasificacion_label,
      tipoAuditoria: row.tipo_auditoria,
      tipoAmplio: row.tipo_amplio,
      ciudad: row.ciudad,
      modalidad: row.modalidad,
      auditorResponsable: row.auditor_responsable,
      fechaProgramada: toDate(row.fecha_programada),
      esNoProgramadaEnCrono: !!row.es_no_programada_en_crono,
      esExtraordinaria: !!row.es_extraordinaria,
      fechaEjecucionReal: toDate(row.fecha_ejecucion_real),
      estatusManualCrono: row.estatus_manual_crono,
      estadoCierreHallazgosManualCrono: row.estado_cierre_hallazgos_manual_crono,
      fechaReprogramacion: toDate(row.fecha_reprogramacion),
      especificacionServicio: row.especificacion_servicio,
      evidenciaCounts: row.evidencia_counts || {},
      evidenciaTotalFiles: row.evidencia_total_files || 0,
      primeraFechaEvidencia: toDate(row.primera_fecha_evidencia),
      ultimaFechaEvidencia: toDate(row.ultima_fecha_evidencia),
      notas: row.notas,
      updatedAt: row.updated_at,
      // Completados por statusEngine.applyAll() después de leer, igual que hoy.
      estadoCalculado: null, hallazgosVinculados: 0, hallazgosVinculadosNC: 0, hallazgosVinculadosOB: 0,
    };
  }

  function toDbAuditoria(a) {
    return {
      id_auditado_crono: a.idAuditadoCrono || null,
      auditado: a.auditado,
      clasificacion_canonica: a.clasificacionCanonica || null,
      clasificacion_label: a.clasificacionLabel || null,
      tipo_auditoria: a.tipoAuditoria || null,
      tipo_amplio: a.tipoAmplio || null,
      ciudad: a.ciudad || null,
      modalidad: a.modalidad || null,
      auditor_responsable: a.auditorResponsable || null,
      fecha_programada: toDateStr(a.fechaProgramada),
      es_no_programada_en_crono: !!a.esNoProgramadaEnCrono,
      es_extraordinaria: !!a.esExtraordinaria,
      fecha_ejecucion_real: toDateStr(a.fechaEjecucionReal),
      estatus_manual_crono: a.estatusManualCrono || null,
      estado_cierre_hallazgos_manual_crono: a.estadoCierreHallazgosManualCrono || null,
      fecha_reprogramacion: toDateStr(a.fechaReprogramacion),
      especificacion_servicio: a.especificacionServicio || null,
      evidencia_counts: a.evidenciaCounts || {},
      evidencia_total_files: a.evidenciaTotalFiles || 0,
      primera_fecha_evidencia: toDateStr(a.primeraFechaEvidencia),
      ultima_fecha_evidencia: toDateStr(a.ultimaFechaEvidencia),
      notas: a.notas || null,
    };
  }

  async function fetchAuditorias() {
    const { data, error } = await requireClient().from("auditorias").select("*").order("auditado");
    if (error) throw error;
    return data.map(fromDbAuditoria);
  }

  /** @param {object} a - objeto camelCase de la app. Si trae "id", actualiza; si no, crea. */
  async function saveAuditoria(a) {
    const payload = toDbAuditoria(a);
    const client = requireClient();
    if (a.id) {
      const { data, error } = await client.from("auditorias").update(payload).eq("id", a.id).select().single();
      if (error) throw error;
      return fromDbAuditoria(data);
    }
    const { data, error } = await client.from("auditorias").insert(payload).select().single();
    if (error) throw error;
    return fromDbAuditoria(data);
  }

  async function deleteAuditoria(id) {
    const { error } = await requireClient().from("auditorias").delete().eq("id", id);
    if (error) throw error;
  }

  /* ------------------------------------------------------------------ *
   * hallazgos: mapeo DB (snake_case) <-> app (camelCase)
   * ------------------------------------------------------------------ */
  function fromDbHallazgo(row) {
    return {
      id: row.id,
      auditoriaVinculada: row.auditoria_id, // ahora FK real, ya no adivinado por matching.js
      idAuditoria: row.id_auditoria_legacy,
      numeroReporte: row.numero_reporte,
      tipoAuditoria: row.tipo_auditoria,
      modalidad: row.modalidad,
      clasificacionRaw: row.clasificacion_raw,
      subClasificacionProveedor: row.sub_clasificacion_proveedor,
      auditado: row.auditado,
      subAreaReporte: row.sub_area_reporte,
      procesoReporte: row.proceso_reporte,
      auditorLider: row.auditor_lider,
      auditorObservador: row.auditor_observador,
      auditorApoyo: row.auditor_apoyo,
      fechaInicio: toDate(row.fecha_inicio),
      fechaTerminacion: toDate(row.fecha_terminacion),
      ciudadEjecucion: row.ciudad_ejecucion,
      fechaNotificacion: toDate(row.fecha_notificacion),
      consecutivoNotificacion: row.consecutivo_notificacion,
      fechaLimiteRespuestaInforme: toDate(row.fecha_limite_respuesta_informe),
      fechaRespuestaInforme: toDate(row.fecha_respuesta_informe),
      fechaSeguimientoSatena: toDate(row.fecha_seguimiento_satena),
      proximoSeguimiento: toDate(row.proximo_seguimiento),
      fechaCierreFinalAuditoria: toDate(row.fecha_cierre_final_auditoria),
      auditorCierre: row.auditor_cierre,
      estadoAuditoria: row.estado_auditoria,
      condicion: row.condicion,
      requisito: row.requisito,
      descripcion: row.descripcion,
      clasificacionReporte: row.clasificacion_reporte,
      barreras: row.barreras,
      probabilidad: row.probabilidad,
      severidad: row.severidad,
      combinacionProbSeveridad: row.combinacion_prob_severidad,
      fechaLimiteCumplimiento: toDate(row.fecha_limite_cumplimiento),
      fechaCierreReporte: toDate(row.fecha_cierre_reporte),
      estadoHallazgo: row.estado_hallazgo,
    };
  }

  function toDbHallazgo(f) {
    return {
      auditoria_id: f.auditoriaVinculada || null,
      id_auditoria_legacy: f.idAuditoria || null,
      numero_reporte: f.numeroReporte || null,
      tipo_auditoria: f.tipoAuditoria || null,
      modalidad: f.modalidad || null,
      clasificacion_raw: f.clasificacionRaw || null,
      sub_clasificacion_proveedor: f.subClasificacionProveedor || null,
      auditado: f.auditado || null,
      sub_area_reporte: f.subAreaReporte || null,
      proceso_reporte: f.procesoReporte || null,
      auditor_lider: f.auditorLider || null,
      auditor_observador: f.auditorObservador || null,
      auditor_apoyo: f.auditorApoyo || null,
      fecha_inicio: toDateStr(f.fechaInicio),
      fecha_terminacion: toDateStr(f.fechaTerminacion),
      ciudad_ejecucion: f.ciudadEjecucion || null,
      fecha_notificacion: toDateStr(f.fechaNotificacion),
      consecutivo_notificacion: f.consecutivoNotificacion || null,
      fecha_limite_respuesta_informe: toDateStr(f.fechaLimiteRespuestaInforme),
      fecha_respuesta_informe: toDateStr(f.fechaRespuestaInforme),
      fecha_seguimiento_satena: toDateStr(f.fechaSeguimientoSatena),
      proximo_seguimiento: toDateStr(f.proximoSeguimiento),
      fecha_cierre_final_auditoria: toDateStr(f.fechaCierreFinalAuditoria),
      auditor_cierre: f.auditorCierre || null,
      estado_auditoria: f.estadoAuditoria || null,
      condicion: f.condicion || null,
      requisito: f.requisito || null,
      descripcion: f.descripcion || null,
      clasificacion_reporte: f.clasificacionReporte || null,
      barreras: f.barreras || null,
      probabilidad: f.probabilidad || null,
      severidad: f.severidad || null,
      combinacion_prob_severidad: (f.combinacionProbSeveridad === "" || f.combinacionProbSeveridad === undefined) ? null : f.combinacionProbSeveridad,
      fecha_limite_cumplimiento: toDateStr(f.fechaLimiteCumplimiento),
      fecha_cierre_reporte: toDateStr(f.fechaCierreReporte),
      estado_hallazgo: f.estadoHallazgo || null,
    };
  }

  async function fetchHallazgos() {
    const { data, error } = await requireClient().from("hallazgos").select("*").order("fecha_inicio", { ascending: false });
    if (error) throw error;
    return data.map(fromDbHallazgo);
  }

  /** @param {object} f - objeto camelCase de la app. Si trae "id", actualiza; si no, crea. */
  async function saveHallazgo(f) {
    const payload = toDbHallazgo(f);
    const client = requireClient();
    if (f.id) {
      const { data, error } = await client.from("hallazgos").update(payload).eq("id", f.id).select().single();
      if (error) throw error;
      return fromDbHallazgo(data);
    }
    const { data, error } = await client.from("hallazgos").insert(payload).select().single();
    if (error) throw error;
    return fromDbHallazgo(data);
  }

  async function deleteHallazgo(id) {
    const { error } = await requireClient().from("hallazgos").delete().eq("id", id);
    if (error) throw error;
  }

  /* ------------------------------------------------------------------ *
   * faa_self_eval_documentos: solo metadatos, solo lectura por ahora (se
   * cargan vía el script de migración o directo en el SQL Editor de
   * Supabase; no tienen UI de edición todavía).
   * ------------------------------------------------------------------ */
  function fromDbFaaDoc(row) {
    return {
      id: row.id,
      categoryKey: row.categoria_key,
      categoryLabel: row.categoria_label,
      name: row.nombre_documento,
      lastModified: row.fecha_documento ? toDate(row.fecha_documento).getTime() : null,
      size: row.tamano_bytes || 0,
    };
  }

  async function fetchFaaDocumentos() {
    const { data, error } = await requireClient().from("faa_self_eval_documentos").select("*").order("categoria_label");
    if (error) throw error;
    return data.map(fromDbFaaDoc);
  }

  /* ------------------------------------------------------------------ *
   * Tiempo real: cualquier cambio en auditorias/hallazgos (desde esta
   * pestaña u otra sesión) dispara callback() para que app.js vuelva a
   * pedir los datos y repinte KPIs/gráficas/tablas (renderEverything()).
   * ------------------------------------------------------------------ */
  function subscribeToChanges(callback) {
    const channel = requireClient()
      .channel("qa-dashboard-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "auditorias" }, callback)
      .on("postgres_changes", { event: "*", schema: "public", table: "hallazgos" }, callback)
      .subscribe();
    return () => requireClient().removeChannel(channel);
  }

  return {
    signIn, signOut, getSession, onAuthChange,
    fetchAuditorias, saveAuditoria, deleteAuditoria,
    fetchHallazgos, saveHallazgo, deleteHallazgo,
    fetchFaaDocumentos,
    subscribeToChanges,
  };
})();
