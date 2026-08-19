-- ============================================================================
-- Dashboard QA-OMA — acceso público (sin login)
-- ============================================================================
-- Reemplaza las políticas de supabase/schema.sql que exigían sesión iniciada
-- (auth.uid() is not null) por políticas abiertas: cualquiera con la anon key
-- del proyecto (la misma que ya viaja en el frontend, ver js/config.js) puede
-- leer y escribir. El login (Supabase Auth) ya no existe en la app.
--
-- Cómo aplicar: pega este archivo completo en el SQL Editor del proyecto
-- Supabase (Dashboard > SQL Editor > New query) y ejecútalo una sola vez.
-- ============================================================================

drop policy if exists "auditorias_all_authenticated" on public.auditorias;
drop policy if exists "hallazgos_all_authenticated" on public.hallazgos;
drop policy if exists "control_satdsg_all_authenticated" on public.control_satdsg;
drop policy if exists "faa_docs_all_authenticated" on public.faa_self_eval_documentos;

create policy "auditorias_public_access" on public.auditorias
  for all using (true) with check (true);

create policy "hallazgos_public_access" on public.hallazgos
  for all using (true) with check (true);

create policy "control_satdsg_public_access" on public.control_satdsg
  for all using (true) with check (true);

create policy "faa_docs_public_access" on public.faa_self_eval_documentos
  for all using (true) with check (true);

-- El rol "anon" (el que usa la anon key del frontend) necesita permiso a
-- nivel de tabla además de la política de RLS — Supabase lo concede por
-- defecto a las tablas nuevas, pero se deja explícito por si el proyecto
-- tiene privilegios por defecto distintos.
grant select, insert, update, delete on public.auditorias to anon;
grant select, insert, update, delete on public.hallazgos to anon;
grant select, insert, update, delete on public.control_satdsg to anon;
grant select, insert, update, delete on public.faa_self_eval_documentos to anon;
