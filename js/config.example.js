/**
 * js/config.example.js — plantilla de configuración de Supabase
 * ============================================================================
 * Copia este archivo a "js/config.js" (ese nombre está en .gitignore, nunca
 * se sube al repo) y reemplaza los dos valores con los de tu proyecto
 * Supabase: Dashboard > Project Settings > API.
 *
 * La "anon public key" es segura de exponer en el frontend — no es un
 * secreto: la protección real de los datos la da Row Level Security (ver
 * supabase/schema.sql), no la confidencialidad de esta key. NUNCA pongas
 * aquí la "service_role key" (esa sí es secreta y solo se usa en el script
 * de migración local, scripts/migrate-to-supabase.mjs).
 *
 * En el despliegue a GitHub Pages, este archivo lo genera automáticamente
 * el workflow (.github/workflows/deploy.yml) a partir de GitHub Actions
 * Secrets — no hace falta commitear valores reales en ningún lado.
 */
window.QA_CONFIG = {
  SUPABASE_URL: "https://TU-PROYECTO.supabase.co",
  SUPABASE_ANON_KEY: "TU-ANON-PUBLIC-KEY",
};
