/**
 * js/dataService.js — fuente de datos: IndexedDB (en el propio navegador)
 * ============================================================================
 * Sin backend, sin Supabase, sin internet. Los datos se cargan subiendo el
 * Excel de control (ver js/excelImport.js) y quedan guardados en este mismo
 * navegador entre sesiones (IndexedDB) — no se sincronizan entre
 * dispositivos: si abres la app en otro computador o celular, hay que
 * volver a cargar el Excel ahí.
 *
 * Expone la misma API que usaba la versión con Supabase (fetchAuditorias,
 * saveAuditoria, ...) para que statusEngine.js/kpiEngine.js/charts.js/
 * tables.js/app.js no necesiten cambiar — solo cambia de dónde vienen y a
 * dónde van los datos.
 */

window.QA = window.QA || {};

QA.dataService = (function () {
  const DB_NAME = "qa_oma_dashboard";
  const DB_VERSION = 1;

  let dbPromise = null;
  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("auditorias")) db.createObjectStore("auditorias", { keyPath: "id" });
        if (!db.objectStoreNames.contains("hallazgos")) db.createObjectStore("hallazgos", { keyPath: "id" });
        if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function reqToPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  function txDone(t) {
    return new Promise((resolve, reject) => {
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  async function getAll(storeName) {
    const db = await openDb();
    return reqToPromise(db.transaction(storeName, "readonly").objectStore(storeName).getAll());
  }
  async function getOne(storeName, key) {
    const db = await openDb();
    return reqToPromise(db.transaction(storeName, "readonly").objectStore(storeName).get(key));
  }
  async function putOne(storeName, record) {
    const db = await openDb();
    const t = db.transaction(storeName, "readwrite");
    t.objectStore(storeName).put(record);
    await txDone(t);
    return record;
  }
  async function deleteOne(storeName, key) {
    const db = await openDb();
    const t = db.transaction(storeName, "readwrite");
    t.objectStore(storeName).delete(key);
    await txDone(t);
  }
  async function putAll(storeName, records) {
    if (!records.length) return;
    const db = await openDb();
    const t = db.transaction(storeName, "readwrite");
    const store = t.objectStore(storeName);
    records.forEach((r) => store.put(r));
    await txDone(t);
  }
  async function clearAndPutAll(storeName, records) {
    const db = await openDb();
    const t = db.transaction(storeName, "readwrite");
    const store = t.objectStore(storeName);
    store.clear();
    records.forEach((r) => store.put(r));
    await txDone(t);
  }

  /* ------------------------------------------------------------------ *
   * Lectura
   * ------------------------------------------------------------------ */
  async function fetchAuditorias() { return getAll("auditorias"); }
  async function fetchHallazgos() { return getAll("hallazgos"); }

  /* ------------------------------------------------------------------ *
   * Escritura manual (formularios de edición) — id nuevo si no trae uno.
   * ------------------------------------------------------------------ */
  async function saveAuditoria(a) {
    const record = Object.assign({}, a, { id: a.id || crypto.randomUUID() });
    await putOne("auditorias", record);
    broadcast();
    return record;
  }
  async function deleteAuditoria(id) {
    await deleteOne("auditorias", id);
    // Los hallazgos vinculados quedan sin auditoría asociada (mismo
    // comportamiento que el ON DELETE SET NULL que tenía el esquema Supabase).
    const hallazgos = await getAll("hallazgos");
    const afectados = hallazgos.filter((h) => h.auditoriaVinculada === id);
    if (afectados.length) {
      afectados.forEach((h) => { h.auditoriaVinculada = null; });
      await putAll("hallazgos", afectados);
    }
    broadcast();
  }
  async function saveHallazgo(f) {
    const record = Object.assign({}, f, { id: f.id || crypto.randomUUID() });
    await putOne("hallazgos", record);
    broadcast();
    return record;
  }
  async function deleteHallazgo(id) {
    await deleteOne("hallazgos", id);
    broadcast();
  }

  /* ------------------------------------------------------------------ *
   * Vigencias (años). Cada auditoría y cada hallazgo lleva `anio` — la
   * vigencia del Excel de donde salió (hoja AUDITORIAS_<año>). Cargar un
   * Excel REEMPLAZA solo las vigencias que trae; las demás quedan intactas,
   * así se pueden tener 2024, 2025 y 2026 a la vez y compararlos.
   * ------------------------------------------------------------------ */

  /** Datos guardados antes de existir las vigencias no traen `anio`: se les
   * asigna el año más frecuente de sus fechas (una sola vez) para no perderlos. */
  async function migrateLegacy() {
    const [auditorias, hallazgos] = await Promise.all([getAll("auditorias"), getAll("hallazgos")]);
    const sinAnio = auditorias.filter((a) => !a.anio);
    if (!sinAnio.length && !hallazgos.some((h) => !h.anio)) return;
    const counts = new Map();
    sinAnio.forEach((a) => {
      const d = a.fechaProgramada || a.fechaEjecucionReal;
      if (d) { const y = new Date(d).getFullYear(); counts.set(y, (counts.get(y) || 0) + 1); }
    });
    let anio = new Date().getFullYear(), best = 0;
    counts.forEach((n, y) => { if (n > best) { best = n; anio = y; } });
    const anioDeAuditoria = new Map();
    auditorias.forEach((a) => { if (!a.anio) a.anio = anio; anioDeAuditoria.set(a.id, a.anio); });
    hallazgos.forEach((h) => { if (!h.anio) h.anio = anioDeAuditoria.get(h.auditoriaVinculada) || anio; });
    await putAll("auditorias", auditorias);
    await putAll("hallazgos", hallazgos);
    const legacy = await getOne("meta", "lastImport");
    if (legacy) { await putOne("meta", Object.assign({}, legacy, { key: "import_" + anio })); await deleteOne("meta", "lastImport"); }
  }

  /** Reemplaza las vigencias recibidas ({anio, audits, findings}[]) sin tocar
   * las demás. `meta` = { fileName, importedAt }. */
  async function replaceVigencias(vigencias, meta) {
    await migrateLegacy();
    const anios = new Set(vigencias.map((v) => v.anio));
    const [auditorias, hallazgos] = await Promise.all([getAll("auditorias"), getAll("hallazgos")]);
    const db = await openDb();
    const t = db.transaction(["auditorias", "hallazgos", "meta"], "readwrite");
    const sA = t.objectStore("auditorias"), sH = t.objectStore("hallazgos"), sM = t.objectStore("meta");
    auditorias.filter((a) => anios.has(a.anio)).forEach((a) => sA.delete(a.id));
    hallazgos.filter((h) => anios.has(h.anio)).forEach((h) => sH.delete(h.id));
    vigencias.forEach((v) => {
      v.audits.forEach((a) => sA.put(a));
      v.findings.forEach((h) => sH.put(h));
      sM.put(Object.assign({ key: "import_" + v.anio, anio: v.anio }, meta));
    });
    await txDone(t);
    broadcast();
  }

  /** Borra TODO lo guardado en este navegador (todas las vigencias) y deja la
   * app como recién instalada: la próxima vez pide cargar un Excel. */
  async function clearAll() {
    const db = await openDb();
    const t = db.transaction(["auditorias", "hallazgos", "meta"], "readwrite");
    t.objectStore("auditorias").clear();
    t.objectStore("hallazgos").clear();
    t.objectStore("meta").clear();
    await txDone(t);
    broadcast();
  }

  /** Metadatos de la última carga de cada vigencia: { [anio]: {fileName, importedAt} } */
  async function getImportMetaByYear() {
    const all = await getAll("meta");
    const out = {};
    all.filter((m) => /^import_\d{4}$/.test(m.key)).forEach((m) => { out[m.anio || Number(m.key.slice(7))] = m; });
    return out;
  }

  /* ------------------------------------------------------------------ *
   * Sincronización entre pestañas del MISMO navegador — no hay backend que
   * avise de cambios, BroadcastChannel es el equivalente local a lo que
   * antes hacía Supabase Realtime entre sesiones distintas.
   * ------------------------------------------------------------------ */
  const channel = ("BroadcastChannel" in window) ? new BroadcastChannel("qa-oma-dashboard") : null;
  function broadcast() { if (channel) channel.postMessage({ type: "changed", at: Date.now() }); }
  function subscribeToChanges(callback) {
    if (!channel) return () => {};
    const handler = () => callback();
    channel.addEventListener("message", handler);
    return () => channel.removeEventListener("message", handler);
  }

  return {
    fetchAuditorias, saveAuditoria, deleteAuditoria,
    fetchHallazgos, saveHallazgo, deleteHallazgo,
    subscribeToChanges,
    migrateLegacy, replaceVigencias, getImportMetaByYear, clearAll,
  };
})();
