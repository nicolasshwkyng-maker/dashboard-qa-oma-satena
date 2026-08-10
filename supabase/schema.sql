-- ============================================================================
-- Dashboard QA-OMA — esquema Supabase (Postgres)
-- ============================================================================
-- Reemplaza a los 2 archivos Excel + la carpeta de evidencias como fuente de
-- datos de la app. Los nombres de columna son la versión snake_case de los
-- campos que ya produce js/excelParser.js + js/matching.js + js/statusEngine.js
-- (ver README.md de la app para el detalle de cada regla de negocio).
--
-- Cómo aplicar: pega este archivo completo en el SQL Editor del proyecto
-- Supabase (Dashboard > SQL Editor > New query) y ejecútalo una sola vez.
-- ============================================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------------------ --
-- auditorias — reemplaza la hoja "CRONO DEF" + el cruce con la carpeta de
-- evidencias (matching.js). evidencia_counts guarda el mismo objeto
-- {01_AVI, 02_REA, 03_SEG, 04_CIE, 05_EVI} -> número de archivos que hoy
-- calcula js/folderScanner.js, pero se edita a mano desde la app en vez de
-- escanear una carpeta local.
-- ------------------------------------------------------------------------ --
create table if not exists public.auditorias (
  id uuid primary key default gen_random_uuid(),
  id_auditado_crono text,                 -- "ID AUDITADO" original del Excel (trazabilidad, opcional)
  auditado text not null,
  clasificacion_canonica text,            -- OMA, OMA_EXT, PROVEEDOR, AREA_INTERNA, INSPECCION, ...
  clasificacion_label text,
  tipo_auditoria text,
  tipo_amplio text,                       -- Proveedor / Área Interna / Inspección
  ciudad text,
  modalidad text,
  auditor_responsable text,
  fecha_programada date,                  -- null si es extraordinaria/no programada
  es_no_programada_en_crono boolean not null default false,
  es_extraordinaria boolean not null default false,
  -- Fecha real de ejecución para las extraordinarias/no programadas: se
  -- edita a mano en el formulario (ya NO se infiere de la fecha de
  -- modificación de archivo, que resultó no ser confiable — ver historial).
  fecha_ejecucion_real date,
  estatus_manual_crono text,
  estado_cierre_hallazgos_manual_crono text,
  fecha_reprogramacion date,
  especificacion_servicio text,
  evidencia_counts jsonb not null default '{}'::jsonb,
  evidencia_total_files integer not null default 0,
  primera_fecha_evidencia date,
  ultima_fecha_evidencia date,
  notas text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) default auth.uid()
);

-- ------------------------------------------------------------------------ --
-- hallazgos — reemplaza la hoja "Hallazgos Auditoria". auditoria_id es un FK
-- REAL (a diferencia de hoy, donde matching.js#linkFindingsToAudits adivina
-- el vínculo por similitud de nombre porque los Excel no comparten ID).
-- ------------------------------------------------------------------------ --
create table if not exists public.hallazgos (
  id uuid primary key default gen_random_uuid(),
  auditoria_id uuid references public.auditorias(id) on delete set null,
  id_auditoria_legacy text,               -- "ID AUDITORIA" original del Excel (trazabilidad)
  numero_reporte text,
  tipo_auditoria text,                    -- Externa / Interna
  modalidad text,                         -- Presencial / Remota
  clasificacion_raw text,
  sub_clasificacion_proveedor text,
  auditado text,
  sub_area_reporte text,
  proceso_reporte text,
  auditor_lider text,
  auditor_observador text,
  auditor_apoyo text,
  fecha_inicio date,
  fecha_terminacion date,
  ciudad_ejecucion text,
  fecha_notificacion date,
  consecutivo_notificacion text,
  fecha_limite_respuesta_informe date,
  fecha_respuesta_informe date,
  fecha_seguimiento_satena date,
  proximo_seguimiento date,
  fecha_cierre_final_auditoria date,
  auditor_cierre text,
  estado_auditoria text,                  -- Abierto/Cerrado a nivel de auditoría completa
  condicion text,                         -- NC / OB / N/A
  requisito text,
  descripcion text,
  clasificacion_reporte text,             -- causa raíz
  barreras text,
  probabilidad text,
  severidad text,
  combinacion_prob_severidad numeric,
  fecha_limite_cumplimiento date,
  fecha_cierre_reporte date,
  estado_hallazgo text,                   -- Abierto/Cerrado a nivel del hallazgo individual
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) default auth.uid()
);

-- ------------------------------------------------------------------------ --
-- control_satdsg — bitácora de comunicaciones oficiales (Aviso/Informe/
-- Seguimiento/Cierre). Solo trazabilidad, no alimenta KPIs de hallazgos.
-- ------------------------------------------------------------------------ --
create table if not exists public.control_satdsg (
  id uuid primary key default gen_random_uuid(),
  fecha_auditoria date,
  id_satdsg text,
  tipo_documento text,
  clasificacion_raw text,
  auditado text,
  estado_envio text,
  consecutivos_respuestas text,
  observaciones text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) default auth.uid()
);

-- ------------------------------------------------------------------------ --
-- faa_self_eval_documentos — metadatos de "Self Evaluation Completadas"
-- (solo metadatos, NO se sube el archivo real — decisión confirmada).
-- ------------------------------------------------------------------------ --
create table if not exists public.faa_self_eval_documentos (
  id uuid primary key default gen_random_uuid(),
  categoria_key text not null,
  categoria_label text not null,
  nombre_documento text not null,
  fecha_documento date,
  tamano_bytes bigint,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) default auth.uid()
);

-- ------------------------------------------------------------------------ --
-- updated_at automático
-- ------------------------------------------------------------------------ --
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_auditorias_updated_at on public.auditorias;
create trigger trg_auditorias_updated_at
  before update on public.auditorias
  for each row execute function public.set_updated_at();

drop trigger if exists trg_hallazgos_updated_at on public.hallazgos;
create trigger trg_hallazgos_updated_at
  before update on public.hallazgos
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------------ --
-- Row Level Security — todo el acceso requiere sesión iniciada (Supabase
-- Auth). No hay registro público habilitado: el único usuario se crea a
-- mano desde el Dashboard de Supabase (Authentication > Users > Add user),
-- así que "cualquier usuario autenticado" equivale hoy a "el único usuario
-- autorizado". Si más adelante se agregan más usuarios con distintos
-- niveles de acceso, estas políticas son el lugar para restringir por
-- auth.uid() específico o por un claim de rol.
-- ------------------------------------------------------------------------ --
alter table public.auditorias enable row level security;
alter table public.hallazgos enable row level security;
alter table public.control_satdsg enable row level security;
alter table public.faa_self_eval_documentos enable row level security;

create policy "auditorias_all_authenticated" on public.auditorias
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

create policy "hallazgos_all_authenticated" on public.hallazgos
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

create policy "control_satdsg_all_authenticated" on public.control_satdsg
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

create policy "faa_docs_all_authenticated" on public.faa_self_eval_documentos
  for all using (auth.uid() is not null) with check (auth.uid() is not null);

-- Índices útiles para los filtros/joins que hace el dashboard.
create index if not exists idx_hallazgos_auditoria_id on public.hallazgos(auditoria_id);
create index if not exists idx_auditorias_fecha_programada on public.auditorias(fecha_programada);
create index if not exists idx_auditorias_es_extraordinaria on public.auditorias(es_extraordinaria);
