#!/usr/bin/env node
/**
 * scripts/migrate-2026.mjs — reemplazo completo con la fuente 2026
 * ============================================================================
 * Borra TODO el contenido actual de "auditorias" y "hallazgos" en Supabase
 * y lo vuelve a cargar desde el Excel único y definitivo
 * CONTROL_CRONOGRAMA_HALLAZGOS_AUDITORIAS_2026.xlsx (hojas AUDITORIAS_2026 +
 * HALLAZGOS_2026). Confirmado explícitamente con el usuario — incluye las
 * extraordinarias FAA/evidencia de la migración anterior, que no existen en
 * este archivo y por tanto desaparecen del dashboard (los documentos FAA en
 * la tabla faa_self_eval_documentos NO se tocan).
 *
 * A diferencia de scripts/migrate-to-supabase.mjs, aquí NO hace falta
 * escanear ninguna carpeta de evidencias ni cruzar con un cronograma
 * separado: cada fila de AUDITORIAS_2026 YA ES el registro final de
 * auditoría/inspección. Solo se reutiliza js/matching.js para 2 cosas
 * puntuales que sí siguen aplicando: resolver la categoría canónica desde
 * el texto de "Clasificacion", y vincular cada hallazgo a su auditoría por
 * similitud de nombre (los hallazgos no traen un ID compartido).
 *
 * Uso:
 *   1. Copia scripts/.env.example a scripts/.env, agrega EXCEL_2026_PATH
 *      (ruta al .xlsx nuevo) y completa el resto de variables.
 *   2. node --env-file=scripts/.env scripts/migrate-2026.mjs
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

function requireEnv(name) {
  const v = process.env[name];
  if (!v) { console.error(`Falta la variable de entorno ${name}. Ver scripts/.env.example.`); process.exit(1); }
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
require(path.join(APP_DIR, "js/matching.js"));
const QA = global.QA;

/* ------------------------------------------------------------------ *
 * REST mínimo contra Supabase (PostgREST) — sin dependencias npm.
 * ------------------------------------------------------------------ */
async function sbDeleteAll(table) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=not.is.null`, {
    method: "DELETE",
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  if (!res.ok) throw new Error(`Delete en "${table}" falló (${res.status}): ${await res.text()}`);
}
async function sbInsert(table, rows) {
  if (!rows.length) return [];
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json", Prefer: "return=representation",
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`Insert en "${table}" falló (${res.status}): ${await res.text()}`);
  return res.json();
}
async function sbInsertBatched(table, rows, batchSize = 200) {
  const out = [];
  for (let i = 0; i < rows.length; i += batchSize) {
    const inserted = await sbInsert(table, rows.slice(i, i + batchSize));
    out.push(...inserted);
    console.log(`  ${table}: ${Math.min(i + batchSize, rows.length)}/${rows.length}`);
  }
  return out;
}

function toDateStr(v) {
  if (!v) return null;
  const d = (v instanceof Date) ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ *
 * Clasificación canónica + tipo amplio (mismo criterio que
 * js/matching.js, que no exporta estas 2 tablas — se replican aquí,
 * son solo 9 categorías conocidas).
 * ------------------------------------------------------------------ */
const TIPO_AMPLIO_BY_CATEGORY = {
  OMA: "Proveedor", OMA_EXT: "Proveedor", PROVEEDOR: "Proveedor",
  LABORATORIO_CALIBRACION: "Proveedor", MANTENIMIENTO_ETAA: "Proveedor", CIAC: "Proveedor",
  AREA_INTERNA: "Área Interna", AUMENTO_CAPACIDADES: "Área Interna",
  INSPECCION: "Inspección",
};

function auditoriaToDbRow(a) {
  return {
    id_auditado_crono: String(a.idAuditado),
    auditado: a.auditado,
    clasificacion_canonica: a.clasificacionCanonica || null,
    clasificacion_label: a.clasificacionLabel || null,
    tipo_auditoria: null,
    tipo_amplio: a.tipoAmplio || null,
    estatus: a.estatus || null,
    tipo_registro: a.tipoRegistro,
    ciudad: a.ciudad || null,
    modalidad: a.modalidad || null,
    auditor_responsable: null,
    fecha_programada: toDateStr(a.fechaProgramada),
    es_no_programada_en_crono: !!a.esNoProgramadaEnCrono,
    es_extraordinaria: !!a.esNoProgramadaEnCrono,
    fecha_ejecucion_real: toDateStr(a.fechaEjecucionReal),
    especificacion_servicio: a.especificacionServicio || null,
    evidencia_counts: {},
    evidencia_total_files: 0,
    notas: null,
  };
}

function hallazgoToDbRow(f, auditoriaId) {
  return {
    auditoria_id: auditoriaId || null,
    id_auditoria_legacy: f.idAuditoria != null ? String(f.idAuditoria) : null,
    numero_reporte: f.numeroReporte != null ? String(f.numeroReporte) : null,
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
    consecutivo_notificacion: f.consecutivoNotificacion != null ? String(f.consecutivoNotificacion) : null,
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
    combinacion_prob_severidad: (typeof f.combinacionProbSeveridad === "number") ? f.combinacionProbSeveridad : null,
    fecha_limite_cumplimiento: toDateStr(f.fechaLimiteCumplimiento),
    fecha_cierre_reporte: toDateStr(f.fechaCierreReporte),
    estado_hallazgo: f.estadoHallazgo || null,
  };
}

async function main() {
  console.log("1/5 Leyendo AUDITORIAS_2026 y HALLAZGOS_2026…");
  const rawAuditorias = await QA.excelParser.parseAuditorias2026(nodeFileHandle(EXCEL_2026_PATH));
  const findings = await QA.excelParser.parseHallazgos2026(nodeFileHandle(EXCEL_2026_PATH));
  console.log(`   ${rawAuditorias.length} auditorías/inspecciones, ${findings.length} hallazgos.`);

  console.log("2/5 Resolviendo clasificación canónica y vinculando hallazgos por nombre…");
  const audits = rawAuditorias.map((a) => {
    const categoria = QA.matching.resolveCategory(a.clasificacionRaw);
    return {
      ...a,
      id: "A-" + a.idAuditado, // id local temporal, solo para el cruce con hallazgos
      clasificacionCanonica: categoria,
      clasificacionLabel: (categoria && QA.config.CANONICAL_CATEGORIES[categoria]) || a.clasificacionRaw,
      tipoAmplio: a.tipoRegistro === "INSPECCION" ? "Inspección" : (TIPO_AMPLIO_BY_CATEGORY[categoria] || "Proveedor"),
    };
  });
  QA.matching.linkFindingsToAudits(findings, audits);
  const sinVincular = findings.filter(f => !f.auditoriaVinculada);
  console.log(`   ${findings.length - sinVincular.length}/${findings.length} hallazgos vinculados a una auditoría.`);
  if (sinVincular.length) {
    console.log("   Sin vincular:", sinVincular.map(f => `${f.auditado} (${f.idAuditoria}-${f.numeroReporte})`).join("; "));
  }

  console.log("3/5 Borrando datos actuales en Supabase (hallazgos primero, luego auditorias)…");
  await sbDeleteAll("hallazgos");
  await sbDeleteAll("auditorias");

  console.log("4/5 Insertando auditorías/inspecciones (una por una, para mapear IDs reales)…");
  const localIdToSupabaseId = new Map();
  for (let i = 0; i < audits.length; i++) {
    const a = audits[i];
    const [inserted] = await sbInsert("auditorias", [auditoriaToDbRow(a)]);
    localIdToSupabaseId.set(a.id, inserted.id);
    if ((i + 1) % 20 === 0 || i === audits.length - 1) console.log(`  auditorias: ${i + 1}/${audits.length}`);
  }

  console.log("5/5 Insertando hallazgos…");
  const hallazgoRows = findings.map(f => hallazgoToDbRow(f, f.auditoriaVinculada ? localIdToSupabaseId.get(f.auditoriaVinculada) : null));
  await sbInsertBatched("hallazgos", hallazgoRows);

  const porTipo = audits.reduce((acc, a) => { acc[a.tipoRegistro] = (acc[a.tipoRegistro] || 0) + 1; return acc; }, {});
  console.log(`\nListo. Migrados: ${audits.length} registros (${porTipo.AUDITORIA || 0} auditorías, ${porTipo.INSPECCION || 0} inspecciones), ${hallazgoRows.length} hallazgos.`);
}

main().catch((err) => { console.error("\nLa migración falló:", err); process.exit(1); });
