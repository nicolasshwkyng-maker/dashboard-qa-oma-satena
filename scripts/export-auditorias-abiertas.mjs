#!/usr/bin/env node
/**
 * scripts/export-auditorias-abiertas.mjs — exporta auditorías ejecutadas
 * ABIERTAS (según el rollup de cierre, ver js/statusEngine.js) a un .xlsx,
 * para revisión y actualización manual de cuáles ya cerraron.
 *
 * Uso: node --env-file=scripts/.env scripts/export-auditorias-abiertas.mjs
 * (variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const APP_DIR = path.resolve(__dirname, "..");
const XLSX = require(path.join(APP_DIR, "vendor/xlsx.full.min.js"));

const SUPABASE_URL = requireEnv("SUPABASE_URL");
const SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const OUTPUT_PATH = process.env.OUTPUT_PATH || path.join(APP_DIR, "Auditorias_Ejecutadas_Abiertas.xlsx");

function requireEnv(name) {
  const v = process.env[name];
  if (!v) { console.error(`Falta la variable de entorno ${name}.`); process.exit(1); }
  return v;
}

async function sbSelect(table, query) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  if (!res.ok) throw new Error(`Select en "${table}" falló (${res.status}): ${await res.text()}`);
  return res.json();
}

// Mismo criterio que js/statusEngine.js#computeAuditoriaRollup: una
// auditoria EJECUTADA sin hallazgos, o con al menos uno "Abierto"/"Cierre
// Parcial" y ninguno mezclado con "Cerrado" en los otros, cuenta como
// rollup ABIERTO — se replica aquí en vez de reusar el módulo del
// navegador para no depender de un DOM/window falso en Node.
function cierreRollup(estatus, hallazgos) {
  if ((estatus || "").trim().toUpperCase() !== "EJECUTADA") return null;
  const cierres = hallazgos.map(h => (h.estado_hallazgo || "").trim()).filter(Boolean);
  if (!cierres.length) return "ABIERTO";
  if (cierres.some(c => c === "Cierre Parcial")) return "CIERRE_PARCIAL";
  const todosCerrados = cierres.every(c => c === "Cerrado");
  const todosAbiertos = cierres.every(c => c === "Abierto");
  if (todosCerrados) return "CERRADO";
  if (todosAbiertos) return "ABIERTO";
  return "CIERRE_PARCIAL";
}

async function main() {
  console.log("Leyendo auditorías y hallazgos de Supabase…");
  const auditorias = await sbSelect("auditorias", "select=*&tipo_registro=eq.AUDITORIA&order=auditado");
  const hallazgos = await sbSelect("hallazgos", "select=auditoria_id,estado_hallazgo,condicion,descripcion,auditor_lider");

  const hallazgosPorAuditoria = new Map();
  hallazgos.forEach((h) => {
    if (!h.auditoria_id) return;
    if (!hallazgosPorAuditoria.has(h.auditoria_id)) hallazgosPorAuditoria.set(h.auditoria_id, []);
    hallazgosPorAuditoria.get(h.auditoria_id).push(h);
  });

  const abiertas = auditorias
    .map((a) => ({ ...a, _hallazgos: hallazgosPorAuditoria.get(a.id) || [] }))
    .filter((a) => cierreRollup(a.estatus, a._hallazgos) === "ABIERTO");

  console.log(`Encontradas ${abiertas.length} auditorías ejecutadas abiertas.`);

  const rows = abiertas.map((a) => ({
    "Auditado": a.auditado,
    "Clasificación": a.clasificacion_label,
    "Ciudad": a.ciudad || "",
    "Modalidad": a.modalidad || "",
    "Fecha Programada": a.fecha_programada || "",
    "Fecha Ejecución Real": a.fecha_ejecucion_real || "",
    "Auditor Responsable": a.auditor_responsable || "",
    "N° Hallazgos Vinculados": a._hallazgos.length,
    "¿Ya cerró? (Sí/No)": "",
    "Notas": "",
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [{ wch: 40 }, { wch: 30 }, { wch: 16 }, { wch: 12 }, { wch: 14 }, { wch: 16 }, { wch: 22 }, { wch: 12 }, { wch: 14 }, { wch: 40 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Ejecutadas Abiertas");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  fs.writeFileSync(OUTPUT_PATH, buf);
  console.log(`Listo: ${OUTPUT_PATH}`);
}

main().catch((err) => { console.error("Falló:", err); process.exit(1); });
