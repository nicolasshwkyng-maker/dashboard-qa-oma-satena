/**
 * js/fileAccess.js — Acceso a archivos y carpetas locales
 * ============================================================================
 * Este módulo resuelve el problema central de una app 100% estática (sin
 * servidor, abierta con doble clic sobre index.html): un navegador NUNCA
 * puede leer carpetas o archivos del disco por sí solo, sin que el usuario
 * los seleccione explícitamente (es una restricción de seguridad del
 * navegador, no una limitación de esta app).
 *
 * Estrategia (dos motores intercambiables, con la misma interfaz de salida):
 *
 *  1) File System Access API (Chrome/Edge): el usuario elige UNA vez la
 *     carpeta de evidencias y los 2 Excel. Los "handles" se guardan en
 *     IndexedDB, así que en aperturas futuras solo hace falta un clic en
 *     "Reconectar" (se vuelve a pedir permiso, ya no hay que volver a
 *     navegar carpetas). Es el motor recomendado (Edge es el navegador
 *     por defecto en Windows 11).
 *
 *  2) Fallback <input webkitdirectory> / <input type=file> para
 *     navegadores sin soporte de la API anterior (Firefox, Safari). No se
 *     puede persistir el permiso entre sesiones (limitación del propio
 *     navegador): hay que volver a seleccionar carpeta/archivos cada vez
 *     que se abre la app.
 *
 * Ambos motores exponen la MISMA interfaz hacia el resto de la app:
 *   - walkEvidenceTree(): recorre recursivamente la carpeta de evidencias
 *     y entrega {path, name, kind, size, lastModified} por cada entrada.
 *   - getExcelFile(key): entrega un objeto File listo para leer con SheetJS.
 */

window.QA = window.QA || {};

QA.fileAccess = (function () {

  const DB_NAME = "qa_satena_dashboard";
  const DB_STORE = "handles";
  const HANDLE_KEYS = { EVIDENCE: "evidenceRoot", CRONO: "cronoExcel", HALLAZGOS: "hallazgosExcel" };

  const supportsFSAPI = typeof window.showDirectoryPicker === "function" && typeof window.showOpenFilePicker === "function";

  // Estado en memoria de la sesión actual (independiente del motor usado).
  const state = {
    mode: supportsFSAPI ? "fsapi" : "fallback",
    evidenceHandle: null,     // FileSystemDirectoryHandle (modo fsapi)
    evidenceFileList: null,   // FileList (modo fallback, de <input webkitdirectory>)
    excelHandles: {},         // { crono: FileSystemFileHandle|File, hallazgos: FileSystemFileHandle|File }
  };

  /* ------------------------------------------------------------------ *
   * IndexedDB — persistencia mínima de handles (solo aplica en modo fsapi)
   * ------------------------------------------------------------------ */
  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbSet(key, value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function idbGet(key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readonly");
      const req = tx.objectStore(DB_STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  /* ------------------------------------------------------------------ *
   * Selección inicial (primer uso, o cuando el usuario quiere cambiar de
   * carpeta/archivo). Requiere gesto del usuario (clic de un botón).
   * ------------------------------------------------------------------ */

  async function pickEvidenceFolder() {
    if (state.mode === "fsapi") {
      const handle = await window.showDirectoryPicker({ id: "qa-evidence-root", mode: "read" });
      state.evidenceHandle = handle;
      await idbSet(HANDLE_KEYS.EVIDENCE, handle);
      return { ok: true, name: handle.name };
    }
    // Fallback: dispara un <input webkitdirectory> oculto y espera el evento change.
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.webkitdirectory = true;
      input.multiple = true;
      input.style.display = "none";
      document.body.appendChild(input);
      input.addEventListener("change", () => {
        state.evidenceFileList = Array.from(input.files);
        document.body.removeChild(input);
        const rootName = state.evidenceFileList[0] ? state.evidenceFileList[0].webkitRelativePath.split("/")[0] : "";
        resolve({ ok: state.evidenceFileList.length > 0, name: rootName });
      });
      input.click();
    });
  }

  async function pickExcelFile(key) {
    if (state.mode === "fsapi") {
      const [handle] = await window.showOpenFilePicker({
        id: "qa-excel-" + key,
        types: [{ description: "Excel", accept: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"], "application/vnd.ms-excel.sheet.macroEnabled.12": [".xlsm"] } }],
        multiple: false,
      });
      state.excelHandles[key] = handle;
      await idbSet(key === "crono" ? HANDLE_KEYS.CRONO : HANDLE_KEYS.HALLAZGOS, handle);
      return { ok: true, name: handle.name };
    }
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".xlsx,.xlsm";
      input.style.display = "none";
      document.body.appendChild(input);
      input.addEventListener("change", () => {
        const file = input.files[0] || null;
        state.excelHandles[key] = file;
        document.body.removeChild(input);
        resolve({ ok: !!file, name: file ? file.name : null });
      });
      input.click();
    });
  }

  /* ------------------------------------------------------------------ *
   * Reconexión silenciosa (al abrir la app, sin picker de navegación)
   * ------------------------------------------------------------------ */

  /** Intenta recuperar handles guardados. Devuelve qué falta reconectar. */
  async function tryRestore() {
    if (state.mode !== "fsapi") {
      return { restored: false, needsReconnect: true, reason: "fallback-mode" };
    }
    try {
      const [evidence, crono, hallazgos] = await Promise.all([
        idbGet(HANDLE_KEYS.EVIDENCE), idbGet(HANDLE_KEYS.CRONO), idbGet(HANDLE_KEYS.HALLAZGOS),
      ]);
      if (!evidence || !crono || !hallazgos) return { restored: false, needsReconnect: true, reason: "no-saved-handles" };
      state.evidenceHandle = evidence;
      state.excelHandles.crono = crono;
      state.excelHandles.hallazgos = hallazgos;
      return { restored: true, needsPermission: true };
    } catch (e) {
      return { restored: false, needsReconnect: true, reason: String(e) };
    }
  }

  /** Debe llamarse desde un clic de usuario: re-solicita permiso de lectura sobre los handles ya guardados. */
  async function confirmPermissions() {
    const handles = [state.evidenceHandle, state.excelHandles.crono, state.excelHandles.hallazgos];
    if (handles.some(h => !h)) return { ok: false, reason: "missing-handles" };
    for (const h of handles) {
      let perm = await h.queryPermission({ mode: "read" });
      if (perm !== "granted") perm = await h.requestPermission({ mode: "read" });
      if (perm !== "granted") return { ok: false, reason: "denied" };
    }
    return { ok: true };
  }

  function hasCompleteSelection() {
    if (state.mode === "fsapi") {
      return !!(state.evidenceHandle && state.excelHandles.crono && state.excelHandles.hallazgos);
    }
    return !!(state.evidenceFileList && state.evidenceFileList.length && state.excelHandles.crono && state.excelHandles.hallazgos);
  }

  /* ------------------------------------------------------------------ *
   * Lectura de archivos ya seleccionados
   * ------------------------------------------------------------------ */

  async function getExcelFile(key) {
    const h = state.excelHandles[key];
    if (!h) throw new Error(`No hay archivo Excel seleccionado para "${key}"`);
    // FileSystemFileHandle tiene getFile(); un File normal no.
    if (typeof h.getFile === "function") return await h.getFile();
    return h;
  }

  /* ------------------------------------------------------------------ *
   * Recorrido recursivo de la carpeta de evidencias -> lista plana de
   * entradas {path, name, kind, size, lastModified}. "path" es siempre
   * relativa a la raíz seleccionada y usa "/" como separador.
   * ------------------------------------------------------------------ */

  async function walkEvidenceTree(onEntry) {
    if (state.mode === "fsapi") {
      if (!state.evidenceHandle) throw new Error("No hay carpeta de evidencias seleccionada.");
      await walkFsHandle(state.evidenceHandle, "", onEntry);
      return;
    }
    if (!state.evidenceFileList) throw new Error("No hay carpeta de evidencias seleccionada.");
    const rootPrefix = state.evidenceFileList[0].webkitRelativePath.split("/")[0] + "/";
    for (const file of state.evidenceFileList) {
      let rel = file.webkitRelativePath;
      if (rel.startsWith(rootPrefix)) rel = rel.slice(rootPrefix.length);
      if (!rel) continue;
      onEntry({ path: rel, name: file.name, kind: "file", size: file.size, lastModified: file.lastModified, file });
    }
  }

  const IGNORE = () => (QA.config && QA.config.evidence.IGNORE_NAMES) || [];

  async function walkFsHandle(dirHandle, prefix, onEntry) {
    for await (const [name, handle] of dirHandle.entries()) {
      if (IGNORE().includes(name) || name.startsWith(".")) continue;
      const path = prefix ? prefix + "/" + name : name;
      if (handle.kind === "directory") {
        onEntry({ path, name, kind: "directory" });
        await walkFsHandle(handle, path, onEntry);
      } else {
        let size = 0, lastModified = 0;
        try {
          const f = await handle.getFile();
          size = f.size; lastModified = f.lastModified;
        } catch (e) { /* archivo bloqueado/ilegible: se cuenta igual, tamaño 0 */ }
        onEntry({ path, name, kind: "file", size, lastModified, handle });
      }
    }
  }

  return {
    supportsFSAPI,
    get mode() { return state.mode; },
    pickEvidenceFolder, pickExcelFile,
    tryRestore, confirmPermissions, hasCompleteSelection,
    getExcelFile, walkEvidenceTree,
  };
})();
