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
        if (!db.objectStoreNames.contains("faaDocs")) db.createObjectStore("faaDocs", { keyPath: "id" });
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
  async function fetchFaaDocumentos() { return getAll("faaDocs"); }

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
   * Carga masiva desde Excel (ver js/excelImport.js): reemplaza TODO el
   * contenido de auditorias/hallazgos por lo que traiga el archivo — el
   * Excel es la fuente de verdad de cada carga, igual que en el modelo
   * original basado en archivos locales.
   * ------------------------------------------------------------------ */
  async function replaceAllFromExcel(auditorias, hallazgos, meta) {
    await clearAndPutAll("auditorias", auditorias);
    await clearAndPutAll("hallazgos", hallazgos);
    await putOne("meta", Object.assign({ key: "lastImport" }, meta));
    broadcast();
  }
  async function getLastImportMeta() { return getOne("meta", "lastImport"); }

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
    fetchFaaDocumentos,
    subscribeToChanges,
    replaceAllFromExcel, getLastImportMeta,
  };
})();
