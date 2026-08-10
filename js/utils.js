/**
 * js/utils.js — Funciones utilitarias compartidas
 * ============================================================================
 * Funciones puras (sin estado) usadas por el resto de los módulos: normalización
 * de texto para comparaciones difusas, formato de fechas, helpers de DOM, etc.
 */

window.QA = window.QA || {};

QA.utils = (function () {

  /**
   * Normaliza texto para comparaciones: mayúsculas, sin tildes/diacríticos,
   * sin comillas "curvas", espacios múltiples colapsados y recortados.
   * Es la base de todo el motor de cruce (matching.js) y de los mapeos de
   * clasificación (data.js).
   */
  function normalize(text) {
    if (text === null || text === undefined) return "";
    return String(text)
      .normalize("NFD").replace(/[̀-ͯ]/g, "") // quita tildes
      .replace(/[‘’‚‹›]/g, "'") // comillas simples curvas
      .replace(/[“”„«»]/g, '"') // comillas dobles curvas
      .replace(/["']/g, "") // quita comillas
      .toUpperCase()
      .replace(/[.,;:_/\\()-]+/g, " ") // separadores comunes (incluye paréntesis y guion) -> espacio
      .replace(/\s+/g, " ")
      .trim();
  }

  /** Convierte texto a slug ascii (para IDs de DOM, claves de mapas, etc.) */
  function slugify(text) {
    return normalize(text).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  }

  /**
   * Similitud simple entre dos textos normalizados, pensada para nombres de
   * empresas/áreas (no para prosa larga). Combina:
   *  - bono fuerte si uno contiene literalmente al otro,
   *  - solapamiento de tokens (palabras) tipo Jaccard.
   * Devuelve un valor entre 0 y 1.
   */
  /** Extrae siglas entre paréntesis, ej. "Comercializadora ... (CBPAL)" -> ["CBPAL"]. */
  function extractParentheticalAcronyms(text) {
    const matches = String(text || "").match(/\(([^)]+)\)/g) || [];
    return matches.map(m => normalize(m.replace(/[()]/g, ""))).filter(t => t && t.length <= 12);
  }

  function textSimilarity(a, b) {
    const na = normalize(a);
    const nb = normalize(b);
    if (!na || !nb) return 0;
    if (na === nb) return 1;
    let containScore = 0;
    if (na.includes(nb) || nb.includes(na)) {
      const shorter = Math.min(na.length, nb.length);
      const longer = Math.max(na.length, nb.length);
      containScore = 0.7 + 0.3 * (shorter / longer); // 0.7 - 1.0
    }
    // Muchos nombres traen la sigla comercial entre paréntesis, ej.
    // "...(CBPAL)" o "...(ASMC SAS)": si la sigla de uno aparece como
    // palabra dentro del otro nombre, es una señal muy fuerte de que es
    // la misma entidad aunque el resto del texto no se parezca en nada.
    let acronymScore = 0;
    const acronymsA = extractParentheticalAcronyms(a);
    const acronymsB = extractParentheticalAcronyms(b);
    const bTokens = new Set(nb.split(" "));
    const aTokens = new Set(na.split(" "));
    acronymsA.forEach(acr => { if (nb.includes(acr) || acr.split(" ").every(t => bTokens.has(t))) acronymScore = Math.max(acronymScore, 0.9); });
    acronymsB.forEach(acr => { if (na.includes(acr) || acr.split(" ").every(t => aTokens.has(t))) acronymScore = Math.max(acronymScore, 0.9); });
    const stop = new Set(["S", "A", "SAS", "SA", "LTDA", "LLC", "INC", "CORP", "CO", "DE", "DEL", "LA", "EL", "Y", "COMPANY", "GROUP"]);
    const tokensA = na.split(" ").filter(t => t && !stop.has(t));
    const tokensB = nb.split(" ").filter(t => t && !stop.has(t));
    let jaccard = 0;
    if (tokensA.length && tokensB.length) {
      const setA = new Set(tokensA);
      const setB = new Set(tokensB);
      let inter = 0;
      setA.forEach(t => { if (setB.has(t)) inter++; });
      const union = new Set([...setA, ...setB]).size;
      jaccard = union ? inter / union : 0;
    }
    return Math.max(containScore, jaccard, acronymScore);
  }

  /** Intenta interpretar un valor de celda de Excel como Date. Devuelve null si no aplica. */
  function toDateOrNull(value) {
    if (value === null || value === undefined || value === "") return null;
    if (value instanceof Date && !isNaN(value.getTime())) return value;
    if (typeof value === "number") {
      // Fecha serial de Excel (días desde 1899-12-30)
      const d = new Date(Math.round((value - 25569) * 86400 * 1000));
      return isNaN(d.getTime()) ? null : d;
    }
    if (typeof value === "string") {
      const s = value.trim();
      if (!s || /^n\/?a$/i.test(s) || /no programada/i.test(s)) return null;
      const d = new Date(s);
      if (!isNaN(d.getTime())) return d;
    }
    return null;
  }

  /** true si el valor de la celda de fecha es literalmente texto "No programada" (o vacío/NA) */
  function isUnscheduledMarker(value) {
    if (value === null || value === undefined || value === "") return true;
    if (typeof value === "string") {
      return /no programada/i.test(value.trim()) || /^n\/?a$/i.test(value.trim());
    }
    return false;
  }

  function formatDate(d, opts) {
    if (!d) return "—";
    const date = (d instanceof Date) ? d : toDateOrNull(d);
    if (!date) return "—";
    opts = opts || {};
    const dd = String(date.getDate()).padStart(2, "0");
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const yyyy = date.getFullYear();
    return opts.short ? `${dd}/${mm}/${String(yyyy).slice(2)}` : `${dd}/${mm}/${yyyy}`;
  }

  const MONTH_NAMES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  const MONTH_ABBR = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

  function monthName(idx, abbr) { return (abbr ? MONTH_ABBR : MONTH_NAMES)[idx] || ""; }

  function daysBetween(d1, d2) {
    if (!d1 || !d2) return null;
    const ms = d2.setHours(0,0,0,0) - d1.setHours(0,0,0,0);
    return Math.round(ms / 86400000);
  }

  /** Debounce estándar para inputs de filtro/búsqueda. */
  function debounce(fn, wait) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  /** Escapa texto para insertarlo como HTML seguro. */
  function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  /** Une segmentos de ruta con "/" evitando dobles separadores. */
  function joinPath(...parts) {
    return parts.filter(Boolean).join("/").replace(/\/+/g, "/");
  }

  function uid(prefix) {
    return (prefix || "id") + "_" + Math.random().toString(36).slice(2, 10);
  }

  return {
    normalize, slugify, textSimilarity, toDateOrNull, isUnscheduledMarker,
    formatDate, monthName, MONTH_NAMES, MONTH_ABBR, daysBetween, debounce,
    escapeHtml, joinPath, uid,
  };
})();
