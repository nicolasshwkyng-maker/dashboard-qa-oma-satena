#!/usr/bin/env node
/**
 * scripts/migrate-to-supabase.mjs — migración única Excel/carpetas -> Supabase
 * ============================================================================
 * Corre UNA sola vez, localmente, para poblar la base de datos nueva con los
 * datos reales que hoy viven en los 2 Excel + la carpeta de evidencias
 * V2026. Reutiliza EXACTAMENTE la misma lógica de negocio ya validada de la
 * app (data.js, js/utils.js, js/excelParser.js, js/folderScanner.js,
 * js/matching.js, js/faaSelfEval.js, js/statusEngine.js) cargándola en un
 * contexto Node con pequeños "shims" para las 2 únicas APIs que en el
 * navegador son del DOM/File System Access API y en Node se resuelven con
 * `fs` normal (que sí tiene acceso irrestricto al disco, a diferencia del
 * navegador). No reimplementa ninguna regla de negocio.
 *
 * Requiere Node 18+ (usa fetch nativo) y NO instala dependencias npm: usa
 * directamente vendor/xlsx.full.min.js (ya vendorizado para la app) y la
 * API REST de Supabase (PostgREST) con la service_role key.
 *
 * Uso:
 *   1. Copia scripts/.env.example a scripts/.env y completa las 5 variables.
 *   2. node --env-file=scripts/.env scripts/migrate-to-supabase.mjs
 *      (si tu Node es más viejo que 20.6, exporta las variables a mano en
 *      vez de --env-file, o usa `set -a; source scripts/.env; set +a`).
 *
 * La service_role key es SECRETA (bypassa RLS) — solo se usa aquí, en tu
 * máquina, una vez. Nunca la pongas en js/config.js ni la subas a GitHub.
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const APP_DIR = path.resolve(__dirname, "..");

/* ------------------------------------------------------------------ *
 * Configuración (variables de entorno)
 * ------------------------------------------------------------------ */
const SUPABASE_URL = requireEnv("SUPABASE_URL");
const SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const CRONO_XLSX_PATH = requireEnv("CRONO_XLSX_PATH");         // 2025_Directorio_Auditados_v1.xlsx
const HALLAZGOS_XLSX_PATH = requireEnv("HALLAZGOS_XLSX_PATH"); // Base de datos QA.xlsx
const EVIDENCE_FOLDER_PATH = requireEnv("EVIDENCE_FOLDER_PATH"); // carpeta V2026

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Falta la variable de entorno ${name}. Ver scripts/.env.example.`);
    process.exit(1);
  }
  return v;
}

/* ------------------------------------------------------------------ *
 * Carga de la lógica de negocio ya escrita de la app, en Node.
 * ------------------------------------------------------------------ */
global.window = globalThis; // los archivos de la app hacen "window.QA = window.QA || {}"
global.XLSX = require(path.join(APP_DIR, "vendor/xlsx.full.min.js"));

// Shim de lectura de Excel: excelParser.js llama a file.arrayBuffer() (API
// de navegador) — en Node basta con leer el archivo del disco.
function nodeFileHandle(filePath) {
  return {
    async arrayBuffer() {
      const buf = await fsp.readFile(filePath);
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    },
  };
}

// Shim de escaneo de carpeta: folderScanner.js espera QA.fileAccess.walkEvidenceTree(cb),
// que en el navegador recorre un directory handle de la File System Access
// API. En Node se recorre con fs normal, produciendo el mismo formato de
// entrada: { kind: "file"|"directory", path, size, lastModified }.
async function walkEvidenceTreeNode(rootDir, onEntry) {
  async function walk(dir, relPrefix) {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        onEntry({ kind: "directory", path: rel });
        await walk(abs, rel);
      } else if (entry.isFile()) {
        const st = await fsp.stat(abs);
        onEntry({ kind: "file", path: rel, size: st.size, lastModified: st.mtimeMs });
      }
    }
  }
  await walk(rootDir, "");
}

require(path.join(APP_DIR, "data.js"));
require(path.join(APP_DIR, "js/utils.js"));
global.QA.fileAccess = { walkEvidenceTree: (cb) => walkEvidenceTreeNode(EVIDENCE_FOLDER_PATH, cb) };
require(path.join(APP_DIR, "js/excelParser.js"));
require(path.join(APP_DIR, "js/faaSelfEval.js"));
require(path.join(APP_DIR, "js/folderScanner.js"));
require(path.join(APP_DIR, "js/matching.js"));
require(path.join(APP_DIR, "js/statusEngine.js"));
const QA = global.QA;

/* ------------------------------------------------------------------ *
 * REST mínimo contra Supabase (PostgREST) — sin dependencias npm.
 * ------------------------------------------------------------------ */
async function sbInsert(table, rows) {
  if (!rows.length) return [];
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`Insert en "${table}" falló (${res.status}): ${await res.text()}`);
  return res.json();
}

/** Inserta en lotes para no exceder límites de tamaño de request. */
async function sbInsertBatched(table, rows, batchSize = 200) {
  const out = [];
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const inserted = await sbInsert(table, chunk);
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
 * Mapeo camelCase (objetos de la app) -> snake_case (Supabase), espejo de
 * js/dataService.js#toDbAuditoria / #toDbHallazgo — se repite aquí (en vez
 * de compartir código con el navegador) porque este script corre en Node,
 * fuera de la app.
 * ------------------------------------------------------------------ */
function auditoriaToDbRow(a) {
  return {
    id_auditado_crono: a.idAuditado != null ? String(a.idAuditado) : null,
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
    // Deliberadamente NO se pre-llena con la fecha de evidencia (mtime de
    // archivo) — ya se confirmó que no es confiable (sync de nube). Queda
    // en null para que el equipo QA la cargue a mano por el formulario de
    // edición, con la fecha real verificada.
    fecha_ejecucion_real: null,
    estatus_manual_crono: a.estatusManualCrono || null,
    estado_cierre_hallazgos_manual_crono: a.estadoCierreHallazgosManualCrono || null,
    fecha_reprogramacion: toDateStr(a.fechaReprogramacion),
    especificacion_servicio: a.especificacionServicio || null,
    evidencia_counts: a.evidenciaCounts || {},
    evidencia_total_files: a.evidenciaTotalFiles || 0,
    primera_fecha_evidencia: toDateStr(a.primeraFechaEvidencia),
    ultima_fecha_evidencia: toDateStr(a.ultimaFechaEvidencia),
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

/* ------------------------------------------------------------------ *
 * Migración
 * ------------------------------------------------------------------ */
async function main() {
  console.log("1/6 Leyendo cronograma (CRONO DEF)…");
  const cronoRows = await QA.excelParser.parseCronoDef(nodeFileHandle(CRONO_XLSX_PATH));
  console.log(`   ${cronoRows.length} filas de cronograma.`);

  console.log("2/6 Leyendo hallazgos y Control SATDSG…");
  const findings = await QA.excelParser.parseHallazgos(nodeFileHandle(HALLAZGOS_XLSX_PATH));
  const controlSatdsg = await QA.excelParser.parseControlSatdsg(nodeFileHandle(HALLAZGOS_XLSX_PATH));
  console.log(`   ${findings.length} hallazgos, ${controlSatdsg.length} filas de Control SATDSG.`);

  console.log("3/6 Escaneando carpeta de evidencias (puede tardar)…");
  const scan = await QA.folderScanner.scan();
  console.log(`   ${scan.leafFolders.length} carpetas de auditoría, ${scan.faaSelfEval.totalFiles} documentos FAA.`);

  console.log("4/6 Cruzando cronograma con evidencia y calculando estados…");
  const { audits } = QA.matching.buildUnifiedAudits({
    cronoRows, leafFolders: scan.leafFolders, faaScanResult: scan.faaSelfEval,
  });
  // El motor de estado simplificado (js/statusEngine.js) ya no distingue
  // orígenes especiales (FAA_SELF_EVAL / EVIDENCE_ONLY) — solo mira
  // evidencia_counts["02_REA"/"04_CIE"]. Los registros que antes se
  // consideraban "ejecutados" solo por su origen especial (autoevaluación
  // FAA, o una carpeta de evidencia suelta sin fila de cronograma) se
  // migran registrando sus archivos como realización (02_REA), para que
  // sigan contando como ejecutados con la regla nueva.
  audits.forEach((a) => {
    const yaEjecutada = (a.evidenciaCounts && (a.evidenciaCounts["02_REA"] > 0 || a.evidenciaCounts["04_CIE"] > 0));
    const esCasoEspecial = a.origenEspecial === "FAA_SELF_EVAL" || a.origen === "EVIDENCE_ONLY";
    if (!yaEjecutada && esCasoEspecial && a.evidenciaTotalFiles > 0) {
      a.evidenciaCounts = { ...(a.evidenciaCounts || {}), "02_REA": a.evidenciaTotalFiles };
    }
  });
  QA.statusEngine.applyAll(audits);
  QA.matching.linkFindingsToAudits(findings, audits);

  const ejecutadas = audits.filter(a => a.estadoCalculado === "EJECUTADA").length;
  console.log(`   ${audits.length} auditorías unificadas (${ejecutadas} ejecutadas).`);

  console.log("5/6 Insertando en Supabase…");
  // Auditorías se insertan UNA POR UNA (no en lote): necesitamos el id real
  // que asigna Supabase para cada una, para poder vincular sus hallazgos
  // (auditoria_id) a continuación — PostgREST no garantiza que el orden de
  // las filas devueltas en un insert masivo coincida con el orden enviado,
  // así que un mapeo por posición sería frágil. Es más lento (una request
  // por auditoría) pero esto corre una sola vez.
  const localIdToSupabaseId = new Map();
  for (let i = 0; i < audits.length; i++) {
    const a = audits[i];
    const [inserted] = await sbInsert("auditorias", [auditoriaToDbRow(a)]);
    localIdToSupabaseId.set(a.id, inserted.id);
    if ((i + 1) % 20 === 0 || i === audits.length - 1) console.log(`  auditorias: ${i + 1}/${audits.length}`);
  }

  const hallazgoRows = findings.map(f => hallazgoToDbRow(f, f.auditoriaVinculada ? localIdToSupabaseId.get(f.auditoriaVinculada) : null));
  await sbInsertBatched("hallazgos", hallazgoRows);

  const controlRows = controlSatdsg.map(c => ({
    fecha_auditoria: toDateStr(c.fechaAuditoria), id_satdsg: c.idSatdsg != null ? String(c.idSatdsg) : null,
    tipo_documento: c.tipoDocumento || null, clasificacion_raw: c.clasificacionRaw || null, auditado: c.auditado || null,
    estado_envio: c.estadoEnvio || null, consecutivos_respuestas: c.consecutivosRespuestas != null ? String(c.consecutivosRespuestas) : null,
    observaciones: c.observaciones || null,
  }));
  await sbInsertBatched("control_satdsg", controlRows);

  const faaDocRows = [];
  [...scan.faaSelfEval.categories, scan.faaSelfEval.general].forEach((cat) => {
    cat.files.forEach((f) => {
      faaDocRows.push({
        categoria_key: cat.key, categoria_label: cat.label,
        nombre_documento: f.path.split("/").pop(),
        fecha_documento: f.lastModified ? toDateStr(new Date(f.lastModified)) : null,
        tamano_bytes: f.size || 0,
      });
    });
  });
  await sbInsertBatched("faa_self_eval_documentos", faaDocRows);

  console.log("6/6 Listo.");
  console.log(`Migradas: ${audits.length} auditorías, ${hallazgoRows.length} hallazgos, ${controlRows.length} filas de Control SATDSG, ${faaDocRows.length} documentos FAA.`);
  console.log("\nRecuerda: revisa y completa manualmente \"Fecha Ejecución Real\" en las auditorías extraordinarias desde la app (quedó vacía a propósito).");
}

main().catch((err) => {
  console.error("\nLa migración falló:", err);
  process.exit(1);
});
