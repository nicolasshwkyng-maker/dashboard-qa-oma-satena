#!/usr/bin/env node
/**
 * scripts/apply-cierre-manual.mjs — aplica el Excel de cierre manual
 * (completado a partir de scripts/export-auditorias-abiertas.mjs) a
 * Supabase: para cada fila marcada "Sí" en "¿Ya cerró? (Sí/No)":
 *   - si la auditoría no tiene hallazgos vinculados, inserta uno con
 *     condicion "N/A" y estado "Cerrado" (mismo patrón que usa la app para
 *     "auditoría cerrada sin no conformidades/observaciones").
 *   - si ya tenía hallazgos (todos "Abierto"), los actualiza a "Cerrado".
 * Esto hace que el rollup de cierre (js/statusEngine.js) recalcule esa
 * auditoría como Cerrada.
 *
 * Uso: node --env-file=scripts/.env scripts/apply-cierre-manual.mjs
 * (variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CIERRE_XLSX_PATH)
 */

import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const APP_DIR = path.resolve(__dirname, "..");
const XLSX = require(path.join(APP_DIR, "vendor/xlsx.full.min.js"));

const SUPABASE_URL = requireEnv("SUPABASE_URL");
const SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const CIERRE_XLSX_PATH = requireEnv("CIERRE_XLSX_PATH");

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
async function sbInsert(table, row) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify([row]),
  });
  if (!res.ok) throw new Error(`Insert en "${table}" falló (${res.status}): ${await res.text()}`);
  return (await res.json())[0];
}
async function sbUpdate(table, id, patch) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: "PATCH",
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`Update en "${table}" falló (${res.status}): ${await res.text()}`);
  return (await res.json())[0];
}

function today() { return new Date().toISOString().slice(0, 10); }

async function main() {
  console.log("Leyendo Excel de cierre manual…");
  const buf = await fsp.readFile(CIERRE_XLSX_PATH);
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null });
  const cerradas = rows.filter(r => (r["¿Ya cerró? (Sí/No)"] || "").toString().trim().toUpperCase().startsWith("S"));
  console.log(`${cerradas.length} de ${rows.length} filas marcadas como cerradas.`);

  console.log("Leyendo auditorías y hallazgos actuales de Supabase…");
  const auditorias = await sbSelect("auditorias", "select=id,auditado&tipo_registro=eq.AUDITORIA");
  const hallazgos = await sbSelect("hallazgos", "select=id,auditoria_id,estado_hallazgo");
  const auditoriaByName = new Map(auditorias.map(a => [a.auditado.trim(), a]));
  const hallazgosPorAuditoria = new Map();
  hallazgos.forEach((h) => {
    if (!h.auditoria_id) return;
    if (!hallazgosPorAuditoria.has(h.auditoria_id)) hallazgosPorAuditoria.set(h.auditoria_id, []);
    hallazgosPorAuditoria.get(h.auditoria_id).push(h);
  });

  let insertados = 0, actualizados = 0, sinCoincidencia = [];
  for (const row of cerradas) {
    const nombre = (row["Auditado"] || "").toString().trim();
    const audit = auditoriaByName.get(nombre);
    if (!audit) { sinCoincidencia.push(nombre); continue; }
    const existentes = hallazgosPorAuditoria.get(audit.id) || [];
    const notas = (row["Notas"] || "").toString().trim();

    if (!existentes.length) {
      await sbInsert("hallazgos", {
        auditoria_id: audit.id,
        auditado: nombre,
        condicion: "N/A",
        estado_hallazgo: "Cerrado",
        estado_auditoria: "Cerrado",
        descripcion: notas || "Auditoría ejecutada sin no conformidades/observaciones — cierre confirmado manualmente.",
        fecha_cierre_reporte: today(),
      });
      insertados++;
      console.log(`  + Insertado cierre N/A: ${nombre}`);
    } else {
      for (const h of existentes) {
        if (h.estado_hallazgo === "Cerrado") continue;
        await sbUpdate("hallazgos", h.id, { estado_hallazgo: "Cerrado", fecha_cierre_reporte: today() });
        actualizados++;
      }
      console.log(`  ~ Actualizados ${existentes.length} hallazgo(s) a Cerrado: ${nombre}`);
    }
  }

  console.log(`\nListo. ${insertados} hallazgos de cierre insertados, ${actualizados} hallazgos existentes actualizados a Cerrado.`);
  if (sinCoincidencia.length) console.log("Sin coincidencia en Supabase (revisar nombre):", sinCoincidencia.join("; "));
}

main().catch((err) => { console.error("Falló:", err); process.exit(1); });
