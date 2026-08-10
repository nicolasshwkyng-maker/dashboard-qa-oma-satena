#!/usr/bin/env node
/**
 * scripts/generate-comparison-report.mjs — comparativo Excel 2026 vs Supabase
 * ============================================================================
 * Cruza AUDITORIAS_2026 + HALLAZGOS_2026 (el Excel único y definitivo)
 * contra lo que quedó publicado en Supabase después de migrate-2026.mjs, y
 * genera un .xlsx con varias hojas para auditar visualmente la migración y
 * detectar campos en blanco/incompletos.
 *
 * Uso: node --env-file=scripts/.env scripts/generate-comparison-report.mjs
 * (variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, EXCEL_2026_PATH)
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const APP_DIR = path.resolve(__dirname, "..");

const SUPABASE_URL = requireEnv("SUPABASE_URL");
const SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const EXCEL_2026_PATH = requireEnv("EXCEL_2026_PATH");
const OUTPUT_PATH = process.env.OUTPUT_PATH || path.join(APP_DIR, "Comparativo_Migracion_QA_OMA.xlsx");

function requireEnv(name) {
  const v = process.env[name];
  if (!v) { console.error(`Falta la variable de entorno ${name}.`); process.exit(1); }
  return v;
}

global.window = globalThis;
global.XLSX = require(path.join(APP_DIR, "vendor/xlsx.full.min.js"));
function nodeFileHandle(filePath) {
  return { async arrayBuffer() { const buf = await fsp.readFile(filePath); return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength); } };
}
require(path.join(APP_DIR, "data.js"));
require(path.join(APP_DIR, "js/utils.js"));
require(path.join(APP_DIR, "js/excelParser.js"));
const QA = global.QA;
const XLSX = global.XLSX;

async function sbSelect(table, query) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  if (!res.ok) throw new Error(`Select en "${table}" falló (${res.status}): ${await res.text()}`);
  return res.json();
}

function fmt(v) {
  if (v === null || v === undefined || v === "") return "";
  if (v instanceof Date) return isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10);
  return String(v).trim();
}
function eq(a, b) { return fmt(a) === fmt(b); }
function si(b) { return b ? "Sí" : "NO"; }
function blank(v) { return v === null || v === undefined || v === "" || (typeof v === "string" && v.trim() === ""); }

async function main() {
  console.log("Leyendo Excel original (AUDITORIAS_2026 + HALLAZGOS_2026)…");
  const excelAuditorias = await QA.excelParser.parseAuditorias2026(nodeFileHandle(EXCEL_2026_PATH));
  const excelHallazgos = await QA.excelParser.parseHallazgos2026(nodeFileHandle(EXCEL_2026_PATH));
  console.log(`  ${excelAuditorias.length} filas AUDITORIAS_2026, ${excelHallazgos.length} filas HALLAZGOS_2026.`);

  console.log("Leyendo datos publicados en Supabase…");
  const dbAuditorias = await sbSelect("auditorias", "select=*&order=auditado");
  const dbHallazgos = await sbSelect("hallazgos", "select=*&order=auditado");
  console.log(`  ${dbAuditorias.length} auditorías/inspecciones, ${dbHallazgos.length} hallazgos publicados.`);

  const auditoriasByIdCrono = new Map();
  dbAuditorias.forEach((a) => { if (a.id_auditado_crono) auditoriasByIdCrono.set(String(a.id_auditado_crono), a); });

  const hallazgosByLegacyKey = new Map();
  dbHallazgos.forEach((h) => {
    const key = `${h.id_auditoria_legacy}::${h.numero_reporte}`;
    if (!hallazgosByLegacyKey.has(key)) hallazgosByLegacyKey.set(key, []);
    hallazgosByLegacyKey.get(key).push(h);
  });

  /* ---------------- Auditorías/Inspecciones: comparativo ---------------- */
  const usedAuditoriaIds = new Set();
  const auditoriasComparativo = excelAuditorias.map((row) => {
    const db = auditoriasByIdCrono.get(String(row.idAuditado));
    if (db) usedAuditoriaIds.add(db.id);
    const cmp = (dbVal, excelVal) => eq(dbVal, excelVal);
    return {
      "ID (Excel)": row.idAuditado,
      "Publicado en la app": si(!!db),
      "Auditado (Excel)": row.auditado, "Auditado (App)": db ? db.auditado : "", "Coincide Auditado": db ? si(cmp(db.auditado, row.auditado)) : "N/A",
      "Estatus (Excel)": row.estatus, "Estatus (App)": db ? db.estatus : "", "Coincide Estatus": db ? si(cmp(db.estatus, row.estatus)) : "N/A",
      "Tipo (Excel)": row.tipoRegistro, "Tipo (App)": db ? db.tipo_registro : "", "Coincide Tipo": db ? si(db.tipo_registro === row.tipoRegistro) : "N/A",
      "Ciudad (Excel)": row.ciudad, "Ciudad (App)": db ? db.ciudad : "", "Coincide Ciudad": db ? si(cmp(db.ciudad, row.ciudad)) : "N/A",
      "Modalidad (Excel)": row.modalidad, "Modalidad (App)": db ? db.modalidad : "", "Coincide Modalidad": db ? si(cmp(db.modalidad, row.modalidad)) : "N/A",
      "Fecha Programada (Excel)": fmt(row.fechaProgramada), "Fecha Programada (App)": db ? fmt(db.fecha_programada) : "", "Coincide Fecha Programada": db ? si(eq(db.fecha_programada, row.fechaProgramada)) : "N/A",
      "Fecha Ejecución Real (Excel)": fmt(row.fechaEjecucionReal), "Fecha Ejecución Real (App)": db ? fmt(db.fecha_ejecucion_real) : "", "Coincide Fecha Ejecución": db ? si(eq(db.fecha_ejecucion_real, row.fechaEjecucionReal)) : "N/A",
    };
  });

  const auditoriasSinPublicar = auditoriasComparativo.filter(r => r["Publicado en la app"] === "NO");
  const auditoriasConDiferencias = auditoriasComparativo.filter(r =>
    r["Publicado en la app"] === "Sí" && Object.entries(r).some(([k, v]) => k.startsWith("Coincide") && v === "NO"));

  /* ---------------- Hallazgos: comparativo ---------------- */
  const usedHallazgoIds = new Set();
  const hallazgosComparativo = excelHallazgos.map((f) => {
    const key = `${f.idAuditoria}::${f.numeroReporte}`;
    const candidates = hallazgosByLegacyKey.get(key) || [];
    const db = candidates.find(h => !usedHallazgoIds.has(h.id));
    if (db) usedHallazgoIds.add(db.id);
    const cmp = (dbVal, excelVal) => eq(dbVal, excelVal);
    return {
      "ID Auditoría (Excel)": f.idAuditoria, "N° Reporte (Excel)": f.numeroReporte,
      "Publicado en la app": si(!!db),
      "Auditado (Excel)": f.auditado, "Auditado (App)": db ? db.auditado : "", "Coincide Auditado": db ? si(cmp(db.auditado, f.auditado)) : "N/A",
      "Estado (Excel)": f.estadoHallazgo, "Estado (App)": db ? db.estado_hallazgo : "", "Coincide Estado": db ? si(cmp(db.estado_hallazgo, f.estadoHallazgo)) : "N/A",
      "Descripción (Excel)": f.descripcion, "Descripción (App)": db ? db.descripcion : "", "Coincide Descripción": db ? si(cmp(db.descripcion, f.descripcion)) : "N/A",
      "Vinculado a Auditoría (App)": db ? si(!!db.auditoria_id) : "N/A",
    };
  });

  const hallazgosSinPublicar = hallazgosComparativo.filter(r => r["Publicado en la app"] === "NO");
  const hallazgosConDiferencias = hallazgosComparativo.filter(r =>
    r["Publicado en la app"] === "Sí" && Object.entries(r).some(([k, v]) => k.startsWith("Coincide") && v === "NO"));
  const hallazgosSinVincular = dbHallazgos.filter(h => !h.auditoria_id).map(h => ({
    "Auditado": h.auditado, "ID Auditoría (legacy)": h.id_auditoria_legacy, "N° Reporte": h.numero_reporte,
  }));

  /* ---------------- Campos incompletos ---------------- */
  const auditoriasIncompletas = dbAuditorias.map((a) => {
    const faltantes = [];
    if (blank(a.auditor_responsable)) faltantes.push("Auditor Responsable");
    if (blank(a.ciudad)) faltantes.push("Ciudad");
    if (blank(a.modalidad)) faltantes.push("Modalidad");
    if (a.es_extraordinaria && blank(a.fecha_ejecucion_real)) faltantes.push("Fecha Ejecución Real (es extraordinaria)");
    return faltantes.length ? { "Auditado": a.auditado, "Tipo": a.tipo_registro, "Campos faltantes": faltantes.join(", ") } : null;
  }).filter(Boolean);

  const hallazgosIncompletos = dbHallazgos.map((h) => {
    const faltantes = [];
    if (blank(h.descripcion) || h.descripcion === "N/A") faltantes.push("Descripción");
    if (blank(h.clasificacion_reporte) || h.clasificacion_reporte === "N/A") faltantes.push("Causa raíz");
    if (blank(h.auditor_lider)) faltantes.push("Auditor Líder");
    if (blank(h.estado_hallazgo)) faltantes.push("Estado");
    if (!h.auditoria_id) faltantes.push("Sin vincular a ninguna Auditoría");
    return faltantes.length ? { "Auditado": h.auditado, "N° Reporte": h.numero_reporte, "Campos faltantes": faltantes.join(", ") } : null;
  }).filter(Boolean);

  const resumen = [
    { "Indicador": "Registros en el Excel (AUDITORIAS_2026)", "Valor": excelAuditorias.length },
    { "Indicador": "Registros publicados en la app (total)", "Valor": dbAuditorias.length },
    { "Indicador": "  — Auditorías", "Valor": dbAuditorias.filter(a => a.tipo_registro === "AUDITORIA").length },
    { "Indicador": "  — Inspecciones", "Valor": dbAuditorias.filter(a => a.tipo_registro === "INSPECCION").length },
    { "Indicador": "Filas del Excel que NO quedaron publicadas", "Valor": auditoriasSinPublicar.length },
    { "Indicador": "Registros publicados con alguna diferencia vs el Excel", "Valor": auditoriasConDiferencias.length },
    { "Indicador": "Registros con campos incompletos (a completar a mano)", "Valor": auditoriasIncompletas.length },
    { "Indicador": "", "Valor": "" },
    { "Indicador": "Hallazgos en el Excel (HALLAZGOS_2026)", "Valor": excelHallazgos.length },
    { "Indicador": "Hallazgos publicados en la app", "Valor": dbHallazgos.length },
    { "Indicador": "Hallazgos del Excel que NO quedaron publicados", "Valor": hallazgosSinPublicar.length },
    { "Indicador": "Hallazgos publicados con alguna diferencia vs el Excel", "Valor": hallazgosConDiferencias.length },
    { "Indicador": "Hallazgos sin vincular a ninguna auditoría", "Valor": hallazgosSinVincular.length },
    { "Indicador": "Hallazgos con campos incompletos (a completar a mano)", "Valor": hallazgosIncompletos.length },
  ];

  console.log("Generando Excel…");
  const wb = XLSX.utils.book_new();
  const addSheet = (name, rows) => {
    const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ "(sin registros)": "" }]);
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  };
  addSheet("Resumen", resumen);
  addSheet("Auditorias - Comparativo", auditoriasComparativo);
  addSheet("Auditorias - Con diferencias", auditoriasConDiferencias);
  addSheet("Auditorias - Sin publicar", auditoriasSinPublicar);
  addSheet("Auditorias - Incompletas", auditoriasIncompletas);
  addSheet("Hallazgos - Comparativo", hallazgosComparativo);
  addSheet("Hallazgos - Con diferencias", hallazgosConDiferencias);
  addSheet("Hallazgos - Sin publicar", hallazgosSinPublicar);
  addSheet("Hallazgos - Sin vincular", hallazgosSinVincular);
  addSheet("Hallazgos - Incompletos", hallazgosIncompletos);

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  fs.writeFileSync(OUTPUT_PATH, buf);
  console.log(`\nListo: ${OUTPUT_PATH}`);
  console.log(`Diferencias: ${auditoriasConDiferencias.length} registros, ${hallazgosConDiferencias.length} hallazgos.`);
  console.log(`Incompletos: ${auditoriasIncompletas.length} registros, ${hallazgosIncompletos.length} hallazgos.`);
}

main().catch((err) => { console.error("Falló:", err); process.exit(1); });
