-- ============================================================================
-- Dashboard QA-OMA — migración aditiva: fuente de datos 2026
-- ============================================================================
-- Corre esto UNA VEZ en el SQL Editor de Supabase, después de schema.sql.
-- Agrega 2 columnas nuevas a "auditorias" para reflejar la estructura del
-- Excel "CONTROL_CRONOGRAMA_HALLAZGOS_AUDITORIAS_2026.xlsx":
--   - estatus: el campo "Estatus" de la hoja AUDITORIAS_2026, mantenido a
--     mano por el equipo QA (Por Ejecutar / Ejecutada / No Ejecutada /
--     Cancelada) — reemplaza el cálculo de estado basado en evidencia de
--     carpetas, que ya no aplica.
--   - tipo_registro: distingue Auditorías de Inspecciones (columna "Tipo"
--     del Excel: "Auditoria QA" / "Inspección"), para poder mostrarlas en
--     secciones separadas del dashboard.
-- ============================================================================

alter table public.auditorias add column if not exists estatus text;
alter table public.auditorias add column if not exists tipo_registro text;

comment on column public.auditorias.estatus is 'Por Ejecutar | Ejecutada | No Ejecutada | Cancelada (mantenido a mano, fuente de verdad del estado)';
comment on column public.auditorias.tipo_registro is 'AUDITORIA | INSPECCION';

create index if not exists idx_auditorias_tipo_registro on public.auditorias(tipo_registro);
create index if not exists idx_auditorias_estatus on public.auditorias(estatus);
