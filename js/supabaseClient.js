/**
 * js/supabaseClient.js — inicialización del cliente Supabase
 * ============================================================================
 * Lee la configuración de window.QA_CONFIG (ver js/config.example.js) y crea
 * el cliente único que usa el resto de la app (js/dataService.js). Si falta
 * la configuración, deja QA.supabaseClient en null y QA.supabaseConfigError
 * con el motivo, para que app.js pueda mostrar un mensaje claro en vez de
 * fallar en silencio con errores de red crípticos.
 */

window.QA = window.QA || {};

QA.supabaseConfigError = null;
QA.supabaseClient = (function () {
  const cfg = window.QA_CONFIG;
  if (!cfg || !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
    QA.supabaseConfigError = "Falta js/config.js con las credenciales de Supabase. Copia js/config.example.js a js/config.js y completa SUPABASE_URL / SUPABASE_ANON_KEY.";
    return null;
  }
  if (cfg.SUPABASE_URL.includes("TU-PROYECTO") || cfg.SUPABASE_ANON_KEY.includes("TU-ANON")) {
    QA.supabaseConfigError = "js/config.js todavía tiene los valores de ejemplo. Reemplázalos por los de tu proyecto Supabase (Project Settings > API).";
    return null;
  }
  return window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
})();
