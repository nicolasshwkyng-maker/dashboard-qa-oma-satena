/**
 * data.js — Configuración y reglas de negocio del Dashboard QA-OMA SATENA MRO
 * ============================================================================
 * Este archivo NO contiene datos de auditorías (esos se leen en vivo desde los
 * archivos Excel y la carpeta de evidencias, tal como lo exige el proyecto).
 * Contiene únicamente las REGLAS de configuración que le permiten a la app
 * interpretar y cruzar la información:
 *
 *   1. Categorías canónicas de clasificación y sus variantes de texto
 *      (el cronograma, la hoja de Hallazgos y Control SATDSG usan
 *      redacciones distintas para lo mismo).
 *   2. Mapeo de cada categoría canónica a su(s) carpeta(s) de evidencia.
 *   3. Reglas específicas para el bucket "Áreas y Talleres Internos"
 *      (son muchas sub-áreas con carpetas propias).
 *   4. Tabla de códigos de base/aeropuerto -> ciudad.
 *   5. Overrides manuales de vinculación carpeta <-> fila del cronograma,
 *      para los casos donde el nombre de la carpeta no se parece al nombre
 *      del auditado (siglas, apodos, etc.) y el algoritmo automático de
 *      texto no puede resolverlos con confianza.
 *   6. Configuración especial del panel "FAA Self Evaluation".
 *
 * MANTENIMIENTO: éste es el ÚNICO archivo que debe tocarse para:
 *   - Agregar una nueva categoría de clasificación.
 *   - Corregir o agregar una vinculación manual carpeta<->cronograma.
 *   - Agregar una nueva base auxiliar o código de ciudad.
 *   - Ajustar las reglas de la auditoría FAA Self Evaluation.
 * El resto del código (js/matching.js, js/statusEngine.js, etc.) es lógica
 * genérica que LEE esta configuración; no debería requerir cambios cuando el
 * programa de auditorías evolucione.
 */

window.QA = window.QA || {};

QA.config = {

  /* ------------------------------------------------------------------ *
   * 0. Rutas y nombres esperados dentro de la carpeta de evidencias
   * ------------------------------------------------------------------ */
  evidence: {
    // Sub-carpetas estándar dentro de cada carpeta "hoja" de auditoría, en
    // el orden del ciclo de vida real de una auditoría.
    STANDARD_SUBFOLDERS: ["01_AVI", "02_REA", "03_SEG", "04_CIE", "05_EVI"],
    // Carpetas de primer nivel reconocidas como "categorías" de auditoría.
    TOP_CATEGORIES: ["AUD_EXT", "AUD_INT", "INSP"],
    // Nombre exacto (se compara normalizado) de la carpeta de autoevaluaciones FAA.
    FAA_SELF_EVAL_FOLDER: "Self Evaluation Completadas",
    // Carpetas/archivos que deben ignorarse por completo al escanear (config del propio proyecto, metadatos de Windows, etc.)
    IGNORE_NAMES: [".claude", "desktop.ini", "thumbs.db", ".git"],
  },

  /* ------------------------------------------------------------------ *
   * 1. Categorías canónicas
   * ------------------------------------------------------------------ */
  // Clave interna -> etiqueta legible en español para toda la UI.
  CANONICAL_CATEGORIES: {
    OMA: "Organización de Mantenimiento Aprobada (OMA)",
    OMA_EXT: "OMA - Exterior (T.A.R.E)",
    PROVEEDOR: "Otros Proveedores",
    AREA_INTERNA: "Áreas y Talleres Internos",
    LABORATORIO_CALIBRACION: "Laboratorio de Calibración",
    MANTENIMIENTO_ETAA: "Mantenimiento Equipo ETAA",
    AUMENTO_CAPACIDADES: "Aumento de Capacidades",
    CIAC: "Centro de Instrucción de Aeronáutica Civil (CIAC)",
    INSPECCION: "Inspección de Actividades de Mantenimiento",
  },

  // Texto EXACTO (tal como aparece en cada fuente, ya normalizado a
  // mayúsculas sin tildes por QA.utils.normalize) -> categoría canónica.
  // Si un valor nuevo no está aquí, el motor de cruce cae a las reglas por
  // palabra clave (CLASSIFICATION_KEYWORD_RULES) como segunda red de seguridad.
  CLASSIFICATION_EXACT_MAP: {
    // --- CRONO DEF (Directorio_Auditados) ---
    "AREAS Y TALLERES INTERNOS": "AREA_INTERNA",
    "INSPECCION DE ACTIVIDADES DE MANTENIMIENTO (TURNO 3)": "INSPECCION",
    "ORGANIZACION DE MANTENIMIENTO APROBADA (OMA) - EXTERIOR": "OMA_EXT",
    "ORGANIZACION DE MANTENIMIENTO APROBADA (OMA)": "OMA",
    "OTROS PROVEEDORES": "PROVEEDOR",
    "AUMENTO DE CAPACIDADES": "AUMENTO_CAPACIDADES",
    "LABORATORIO DE CALIBRACION": "LABORATORIO_CALIBRACION",
    "CENTRO DE INSTRUCCION DE AERONAUTICA CIVIL (CIAC)": "CIAC",
    "MANTENIMIENTO EQUIPO ETAA": "MANTENIMIENTO_ETAA",
    // --- Hallazgos Auditoria / Control SATDSG (vocabulario distinto) ---
    "OMA": "OMA",
    "T.A.R.E": "OMA_EXT",
    "TARE": "OMA_EXT",
    "LABORATORIOS DE CALIBRACION": "LABORATORIO_CALIBRACION",
    "BASE AUXILIAR": "AREA_INTERNA",
  },

  // Segunda red de seguridad: si el texto normalizado CONTIENE alguna de
  // estas palabras clave, se asigna la categoría. Se evalúan en orden.
  CLASSIFICATION_KEYWORD_RULES: [
    { contains: "AUMENTO", category: "AUMENTO_CAPACIDADES" },
    { contains: "EXTERIOR", category: "OMA_EXT" },
    { contains: "TARE", category: "OMA_EXT" },
    { contains: "OMA", category: "OMA" },
    { contains: "CALIBRACION", category: "LABORATORIO_CALIBRACION" },
    { contains: "ETAA", category: "MANTENIMIENTO_ETAA" },
    { contains: "CIAC", category: "CIAC" },
    { contains: "INSTRUCCION AERONAUTICA", category: "CIAC" },
    { contains: "INSPECCION", category: "INSPECCION" },
    { contains: "PROVEEDOR", category: "PROVEEDOR" },
    { contains: "BASE AUXILIAR", category: "AREA_INTERNA" },
    { contains: "AREAS Y TALLERES", category: "AREA_INTERNA" },
    { contains: "INTERN", category: "AREA_INTERNA" },
  ],

  /* ------------------------------------------------------------------ *
   * 2. Categoría canónica -> ruta(s) de carpeta de evidencia
   * ------------------------------------------------------------------ */
  CATEGORY_FOLDER_PATHS: {
    OMA: ["AUD_EXT/OMA"],
    OMA_EXT: ["AUD_EXT/OMA-E"],
    PROVEEDOR: ["AUD_EXT/PROV"],
    LABORATORIO_CALIBRACION: ["AUD_EXT/LABCAL"],
    MANTENIMIENTO_ETAA: ["AUD_EXT/ETAAEXT"],
    CIAC: ["AUD_EXT/CIAC"],
    AUMENTO_CAPACIDADES: ["AUD_INT/AUMCAP"],
    INSPECCION: ["INSP"],
    // AREA_INTERNA se resuelve con reglas más finas (ver abajo) porque
    // agrupa muchas sub-carpetas distintas dentro de AUD_INT.
    AREA_INTERNA: [
      "AUD_INT/ALMACEN", "AUD_INT/CTRLPROD", "AUD_INT/ELEC", "AUD_INT/ENTRENA",
      "AUD_INT/ESTR", "AUD_INT/ETAA", "AUD_INT/HYD", "AUD_INT/INSPCAL",
      "AUD_INT/BASEPPAL/AAAES", "AUD_INT/BASEPPAL/FAA",
      "AUD_INT/BASESAUX/ADZ", "AUD_INT/BASESAUX/BAQ", "AUD_INT/BASESAUX/CLO",
      "AUD_INT/BASESAUX/EOH", "AUD_INT/BASESAUX/VVC",
    ],
  },

  /* ------------------------------------------------------------------ *
   * 3. Reglas específicas para "Áreas y Talleres Internos"
   * ------------------------------------------------------------------ *
   * El nombre del AUDITADO en el cronograma (ej. "Área de Mantenimiento -
   * Taller de Soporte: Eléctricos") rara vez coincide textualmente con el
   * nombre de la carpeta (ej. "ELEC"), así que se resuelve por palabra
   * clave presente en el nombre del auditado.
   * Se evalúan en orden; la primera regla que haga match gana.
   * "city" (opcional) exige además que la ciudad del cronograma corresponda
   * a la de la carpeta (usado para distinguir bases auxiliares).
   */
  AREA_INTERNA_RULES: [
    { contains: "ALMACEN", folder: "AUD_INT/ALMACEN" },
    { contains: "CONTROL PRODUCCION", folder: "AUD_INT/CTRLPROD" },
    { contains: "INSPECCION Y CALIDAD", folder: "AUD_INT/INSPCAL" },
    { contains: "APOYO: ETAA", folder: "AUD_INT/ETAA" },
    { contains: "APOYO ETAA", folder: "AUD_INT/ETAA" },
    { contains: "ELECTRIC", folder: "AUD_INT/ELEC" },
    { contains: "HIDRAULIC", folder: "AUD_INT/HYD" },
    { contains: "ESTRUCTURA", folder: "AUD_INT/ESTR" },
    { contains: "COMPUESTO", folder: "AUD_INT/ESTR" },
    { contains: "ENTRENAMIENTO", folder: "AUD_INT/ENTRENA" },
    { contains: "AAAES", folder: "AUD_INT/BASEPPAL/AAAES" },
    // Auditorías "Limited ... FAA" NO se buscan en AUD_INT/BASEPPAL/FAA:
    // la evidencia real vive en la carpeta especial "Self Evaluation
    // Completadas" (ver FAA_SELF_EVAL más abajo). Esta regla queda
    // documentada aquí para que quede explícito que es una excepción
    // intencional y no un olvido.
    { contains: "LIMITED", folder: null, note: "Ver FAA_SELF_EVAL — no usa carpeta BASEPPAL/FAA" },
    // Bases auxiliares: requieren coincidencia adicional de ciudad.
    { contains: "BASE AUXILIAR", folder: "AUD_INT/BASESAUX/ADZ", city: "SAN ANDRES" },
    { contains: "BASE AUXILIAR", folder: "AUD_INT/BASESAUX/BAQ", city: "BARRANQUILLA" },
    { contains: "BASE AUXILIAR", folder: "AUD_INT/BASESAUX/CLO", city: "CALI" },
    { contains: "BASE AUXILIAR", folder: "AUD_INT/BASESAUX/EOH", city: "MEDELLIN" },
    { contains: "BASE AUXILIAR", folder: "AUD_INT/BASESAUX/VVC", city: "VILLAVICENCIO" },
  ],

  /* ------------------------------------------------------------------ *
   * 4. Código de base/aeropuerto -> ciudad (solo para mostrar etiquetas
   *    legibles; son los códigos IATA usados como nombre de carpeta en
   *    AUD_INT/BASESAUX y en INSP).
   * ------------------------------------------------------------------ */
  BASE_CODE_TO_CITY: {
    BOG: "Bogotá D.C. (Base Principal)",
    ADZ: "San Andrés",
    BAQ: "Barranquilla",
    CLO: "Cali",
    EOH: "Medellín",
    VVC: "Villavicencio",
  },

  /* ------------------------------------------------------------------ *
   * 4.5. Registro OFICIAL de aliases (fuente de verdad prioritaria)
   * ------------------------------------------------------------------ *
   * Transcrito de la herramienta interna ya existente
   * "_TRANS\APP\TRANS_APP_BUSCADOR_ALIAS_v1.html" (67 auditados
   * indexados) y su documentación "TRANS_DOC_Guia_QA_MRO_v1.html". Esa
   * herramienta es EL estándar que el propio equipo QA_MRO usa a diario
   * para nombrar carpetas y archivos, así que es una fuente mucho más
   * confiable que cualquier coincidencia de texto automática entre el
   * nombre del auditado (cronograma) y el nombre de la carpeta.
   *
   * matching.js la usa como PRIMER intento de vinculación (antes de la
   * similitud difusa genérica): busca la carpeta hoja cuyo nombre de
   * alias coincida, toma el "nombre original" registrado aquí, y lo
   * compara (ya con similitud difusa, que ahora sí puntúa alto) contra la
   * columna AUDITADO del cronograma.
   *
   * Nota de nomenclatura: la guía documenta la categoría de OMA-Exterior
   * como "TARE", pero la carpeta real en disco se llama "OMA-E" (se
   * verificó directamente contra la carpeta de evidencias) — aquí se usa
   * la ruta REAL. Igualmente la guía documenta el alias "HID" para el
   * taller de hidráulicos, pero la carpeta real es "HYD".
   *
   * Aliases documentados sin carpeta aún creada en la evidencia 2026
   * (08_AASERV, JEFEMANTTO, SGC, 06_CIAC_CIAC) se dejan igual listados
   * por completitud, pero no tendrán carpeta que vincular hasta que se
   * cree.
   */
  OFFICIAL_ALIAS_REGISTRY: [
    // --- OMA ---
    { folderPath: "AUD_EXT/OMA/01_AEROHELICES", nombreOriginal: "Aerohelices S.A.S" },
    { folderPath: "AUD_EXT/OMA/02_AEROTURBO", nombreOriginal: "Aeroturbo De Colombia S.A.S" },
    { folderPath: "AUD_EXT/OMA/03_CIAC_OMA", nombreOriginal: "Corporacion de la Industria Aeronautica Colombiana CIAC (OMA)" },
    { folderPath: "AUD_EXT/OMA/04_DMARCO", nombreOriginal: "D'Marco Aereo S.A.S" },
    { folderPath: "AUD_EXT/OMA/05_ASMC", nombreOriginal: "Aviation Support & Maintenance Company SAS" },
    { folderPath: "AUD_EXT/OMA/06_ELAVIAC", nombreOriginal: "Electronica de Aviacion S.A.S." },
    { folderPath: "AUD_EXT/OMA/07_SAE_OMA", nombreOriginal: "Servicio Aeronautico Especializado S.A.S (OMA)" },
    { folderPath: "AUD_EXT/OMA/08_SAE_OTROS", nombreOriginal: "Servicio Aeronautico Especializado S.A.S (Otros Servicios)" },
    { folderPath: "AUD_EXT/OMA/09_ISOTEC", nombreOriginal: "Inspeccion y Diagnostico Tecnico ISOTEC S.A.S" },
    { folderPath: "AUD_EXT/OMA/10_AUREO", nombreOriginal: "Aureo Company S.A.S" },
    { folderPath: "AUD_EXT/OMA/11_CENTRALAERO", nombreOriginal: "Central Aerospace S.A.S" },
    { folderPath: "AUD_EXT/OMA/12_INSPECOL", nombreOriginal: "Inspecciones Aeronauticas de Colombia S.A.S." },
    // 13_CRAFT_PROP: alta posterior a la guía, no documentada aún allí.
    { folderPath: "AUD_EXT/OMA/13_CRAFT_PROP", nombreOriginal: "Craft Propeller" },
    // --- OMA-E (documentada como "TARE" en la guía; carpeta real "OMA-E") ---
    { folderPath: "AUD_EXT/OMA-E/01_AEROMECH", nombreOriginal: "Aeromech Incorporated" },
    { folderPath: "AUD_EXT/OMA-E/02_PROPTECH", nombreOriginal: "Proptech Aero Ltd" },
    { folderPath: "AUD_EXT/OMA-E/03_AVIAAERO", nombreOriginal: "Avia Aero, Llc" },
    { folderPath: "AUD_EXT/OMA-E/04_MEDAIR", nombreOriginal: "Med Air, Inc" },
    { folderPath: "AUD_EXT/OMA-E/05_APAS", nombreOriginal: "APAS (A SIP Company)" },
    { folderPath: "AUD_EXT/OMA-E/06_PENIEL", nombreOriginal: "Peniel Group Llc" },
    { folderPath: "AUD_EXT/OMA-E/07_AVSUPPCTR", nombreOriginal: "Aviation Support Center Co" },
    { folderPath: "AUD_EXT/OMA-E/08_RAMAE", nombreOriginal: "Ram Aerospace And Defense Solutions" },
    { folderPath: "AUD_EXT/OMA-E/09_MERIDIAN", nombreOriginal: "Meridian Aero Services, LLC" },
    { folderPath: "AUD_EXT/OMA-E/10_GLOBALAERO", nombreOriginal: "Global Aerospace Corporation" },
    { folderPath: "AUD_EXT/OMA-E/11_ATR", nombreOriginal: "ATR Americas, Inc." },
    { folderPath: "AUD_EXT/OMA-E/12_SAHAR", nombreOriginal: "Sahar Group" },
    { folderPath: "AUD_EXT/OMA-E/13_ROLLSROYCE", nombreOriginal: "Rolls Royce Corporation" },
    { folderPath: "AUD_EXT/OMA-E/14_DAS", nombreOriginal: "Diverse Aircraft Services, Corp. (DAS)" },
    { folderPath: "AUD_EXT/OMA-E/15_WORLDBIZ", nombreOriginal: "World Business Aerospace INC" },
    { folderPath: "AUD_EXT/OMA-E/16_PW", nombreOriginal: "Pratt & Whitney Canada Corp" },
    // 17-20: altas posteriores a la guía, no documentadas aún allí.
    { folderPath: "AUD_EXT/OMA-E/17_APS", nombreOriginal: "Aircraft Propeller Service, LLC (APS)" },
    { folderPath: "AUD_EXT/OMA-E/18_PPS LLC", nombreOriginal: "Piedmont Propulsion System LLC" },
    { folderPath: "AUD_EXT/OMA-E/19_MERCAEREO", nombreOriginal: "Mercaereo" },
    { folderPath: "AUD_EXT/OMA-E/20_PENIEL_GORUP", nombreOriginal: "Peniel Group (posible duplicado de 06_PENIEL, revisar)" },
    // --- PROV ---
    { folderPath: "AUD_EXT/PROV/01_SERVIOXIG", nombreOriginal: "Comercializadora De Gases Y Soldaduras Servioxigeno S.A.S" },
    { folderPath: "AUD_EXT/PROV/02_CBPAL", nombreOriginal: "Cbpal Maintenance S.A.S" },
    { folderPath: "AUD_EXT/PROV/03_TRATTERM", nombreOriginal: "Tratamientos Termicos S.A.S." },
    { folderPath: "AUD_EXT/PROV/04_AIRSERVIR", nombreOriginal: "Air Servir Express S.A.S" },
    { folderPath: "AUD_EXT/PROV/05_AEROTAPIZ", nombreOriginal: "Aerotapiz S.A.S." },
    { folderPath: "AUD_EXT/PROV/06_TRIMCO", nombreOriginal: "Trimco S.A.S" },
    { folderPath: "AUD_EXT/PROV/07_GLBLOGIS", nombreOriginal: "Global Logistics Support S.A.S" },
    { folderPath: "AUD_EXT/PROV/08_SKYWAYS", nombreOriginal: "Skyways Technics Americas LLC" },
    // 09_TRAFERROT: alta posterior a la guía, no documentada aún allí.
    { folderPath: "AUD_EXT/PROV/09_TRAFERROT", nombreOriginal: "Tratamientos Ferrotermicos" },
    // --- LABCAL ---
    { folderPath: "AUD_EXT/LABCAL/01_TEXASOIL", nombreOriginal: "Texas Oiltech Laboratories Colombia Ltda." },
    { folderPath: "AUD_EXT/LABCAL/02_CONAMET", nombreOriginal: "Compania Nacional De Metrologia S.A.S" },
    { folderPath: "AUD_EXT/LABCAL/03_SERVIHOY", nombreOriginal: "Servihoy Laboratorio De Metrologia S.A.S" },
    { folderPath: "AUD_EXT/LABCAL/04_CIMA_LAB", nombreOriginal: "Compania Internacional de Mantenimiento CIMA S.A.S. (Lab)" },
    { folderPath: "AUD_EXT/LABCAL/05_CONCRELAB", nombreOriginal: "Concrelab S.A.S" },
    { folderPath: "AUD_EXT/LABCAL/06_SUMINCOL", nombreOriginal: "Suministros Industriales de Colombia S.A.S" },
    { folderPath: "AUD_EXT/LABCAL/07_SAE_LAB", nombreOriginal: "Servicio Aeronautico Especializado S.A.S (Lab. Calibracion)" },
    // 08_AASERV: alias reservado, sin carpeta creada todavía.
    // --- ETAAEXT ---
    { folderPath: "AUD_EXT/ETAAEXT/01_SAEXCOL", nombreOriginal: "Saexcol S.A.S" },
    { folderPath: "AUD_EXT/ETAAEXT/02_CIMA_ETAA", nombreOriginal: "Compania Internacional de Mantenimiento CIMA S.A.S. (ETAA)" },
    { folderPath: "AUD_EXT/ETAAEXT/03_ETAACOL", nombreOriginal: "Etaa de Colombia S.A.S" },
    { folderPath: "AUD_EXT/ETAAEXT/04_OAR", nombreOriginal: "Oar Industrial S.A.S." },
    // 05-06: altas posteriores a la guía, no documentadas aún allí.
    { folderPath: "AUD_EXT/ETAAEXT/05_ILS", nombreOriginal: "International Logistic Services S.A.S" },
    // --- CIAC ---
    { folderPath: "AUD_EXT/CIAC/01_CIMA_CIAC", nombreOriginal: "Compania Internacional de Mantenimiento CIMA S.A.S. (CIAC)" },
    { folderPath: "AUD_EXT/CIAC/02_CAC", nombreOriginal: "Centro Aeronautico De Colombia" },
    { folderPath: "AUD_EXT/CIAC/03_INDOAMERI", nombreOriginal: "Corporacion Educativa Indoamericana" },
    { folderPath: "AUD_EXT/CIAC/04_DREAMFLY", nombreOriginal: "Escuela de Aviacion Dream Fly S.A.S." },
    { folderPath: "AUD_EXT/CIAC/05_EIA", nombreOriginal: "Escuela de Instruccion Aeronautica Ltda EIA" },
    // 06_CIAC_CIAC: alias reservado, sin carpeta creada todavía.
  ],

  /* ------------------------------------------------------------------ *
   * 5. Overrides manuales de vinculación carpeta <-> AUDITADO (cronograma)
   * ------------------------------------------------------------------ *
   * Se usan cuando el nombre de carpeta no tiene similitud textual
   * suficiente con el nombre del auditado para que el algoritmo genérico
   * (js/matching.js) lo vincule con confianza (siglas, marcas comerciales,
   * error de tipeo histórico, etc.). Cada entrada fue verificada cruzando
   * el cronograma con la hoja de Hallazgos y/o Control SATDSG.
   *
   * folderPath: ruta relativa a la carpeta de evidencias (con /).
   * auditadoMatch: subcadena (normalizada) que identifica de forma única
   *                la fila del cronograma en la columna AUDITADO.
   *
   * Si en el futuro cambia el nombre de una carpeta o aparece un caso
   * nuevo no resuelto automáticamente, agréguelo aquí — no hace falta
   * tocar el motor de cruce.
   *
   * NOTA: la mayoría de los casos que antes requerían un override manual
   * ya quedaron resueltos por OFFICIAL_ALIAS_REGISTRY (arriba), que es la
   * fuente correcta para las categorías OMA/OMA-E/PROV/LABCAL/ETAAEXT/CIAC.
   * Lo que queda aquí es exclusivamente "Aumento de Capacidades"
   * (AUD_INT/AUMCAP), cuyas carpetas se nombran por número de parte/
   * referencia técnica y NO tienen alias oficial registrado todavía.
   * Los 3 casos con mayor ambigüedad (04, 05 y 08) se dejaron SIN
   * override a propósito — dos posibles interpretaciones con confianza
   * similar es peor que dejarlo visible en el panel de diagnóstico para
   * que el equipo QA lo confirme.
   *
   * IMPORTANTE — orden: matching.js usa el PRIMER override cuyo
   * "auditadoMatch" aparezca dentro del nombre del auditado (Array.find).
   * Cuando dos patrones podrían coincidir con la misma fila (ej. "EOH" es
   * subcadena de "EOH (HSI TWIN OTTER)"), el más ESPECÍFICO debe ir
   * ANTES que el más genérico, o el genérico lo capturará primero por
   * error. Se verificó con datos reales (ver _selftest/test.html).
   */
  MANUAL_MATCH_OVERRIDES: [
    { folderPath: "AUD_INT/AUMCAP/06_AUMCAP_HSI_PT6-A34_EOH_BOG", auditadoMatch: "EOH (HSI TWIN OTTER)" },
    { folderPath: "AUD_INT/AUMCAP/01_AUMCAP_6C_CHECK_DHC_6_EOH_BOG", auditadoMatch: "AUMENTO DE CAPACIDADES EOH" },
    { folderPath: "AUD_INT/AUMCAP/02_AUMCAP_B_CHECK_DHC_A_CHECK_ATR_VVC", auditadoMatch: "AUMENTO DE CAPACIDADES  VVC" },
    { folderPath: "AUD_INT/AUMCAP/07_AUMCAP_PN_416526_A320_BOG", auditadoMatch: "BATERIAS A320" },
    { folderPath: "AUD_INT/AUMCAP/03_AUTOIN_ESIS_BATTERY_PN_501-1719-02_BOG", auditadoMatch: "TALLER DE SOPORTE: ELECTRICOS" },
  ],

  /* ------------------------------------------------------------------ *
   * 6. Panel especial "FAA Self Evaluation"
   * ------------------------------------------------------------------ *
   * Contexto (indicado por el usuario): las 9 auditorías "Limited ... FAA"
   * del cronograma (filas cuyo AUDITADO empieza con "SATENA M.R.O (Limited")
   * NO se evidencian como auditorías individuales: en cambio, el equipo QA
   * realiza AUTOEVALUACIONES por referencia/parte dentro de cada categoría
   * ("limited category"), archivadas como PDFs sueltos dentro de
   * "Self Evaluation Completadas\<categoría>". A la fecha del análisis:
   * 55 documentos repartidos en 9 sub-carpetas + 1 documento general
   * (MIL-DTL-5541F.pdf) en la raíz = 10 categorías/grupos en total.
   *
   * Regla de negocio (definida explícitamente por el usuario): cada
   * categoría cuenta como UNA auditoría ejecutada para efectos de las
   * cifras generales del programa, y siempre se contabiliza como
   * "No Programada" / extraordinaria (independientemente de que 9 de las
   * 10 categorías sí tengan una fila equivalente en el cronograma) porque
   * la ejecución real ocurre por documento/parte en fechas dispersas, no
   * como una auditoría única programada.
   *
   * Si el año siguiente cambia el número de categorías (SATENA agrega o
   * quita un "limited rating"), NO hace falta tocar el código: el
   * escáner (js/folderScanner.js) detecta automáticamente cualquier
   * sub-carpeta nueva dentro de "Self Evaluation Completadas" y la trata
   * como una categoría más, usando su propio nombre de carpeta como
   * etiqueta si no está en esta lista.
   */
  FAA_SELF_EVAL: {
    enabled: true,
    folderName: "Self Evaluation Completadas",
    // Auditado sintético que se muestra en tablas/tarjetas para cada
    // categoría cuando no hay una coincidencia más específica.
    labelPrefix: "SATENA M.R.O. — Autoevaluación FAA",
    // Documentos sueltos en la raíz de la carpeta (no dentro de una
    // sub-carpeta de categoría) se agrupan en esta categoría "general".
    generalCategoryKey: "general",
    generalCategoryLabel: "General / Documentos base (sin categoría específica)",
    categories: [
      { key: "electrical", folderName: "Limited Accesories - Electrical", label: "Limited Accessories — Electrical", cronogramaAuditadoMatch: "LIMITED ACCESSORIES \"ELECTRICAL\"" },
      { key: "mechanical", folderName: "Limited Accessories “Mechanical”", label: "Limited Accessories — Mechanical", cronogramaAuditadoMatch: "LIMITED ACCESSORIES \"MECHANICAL\"" },
      { key: "airframe", folderName: "Limited Airframe", label: "Limited Airframe", cronogramaAuditadoMatch: "LIMITED AIRFRAME" },
      { key: "emergency_equipment", folderName: "Limited Emergency Equipment", label: "Limited Emergency Equipment", cronogramaAuditadoMatch: "LIMITED EMERGENCY EQUIPMENT" },
      { key: "engine", folderName: "Limited Engine", label: "Limited Engine", cronogramaAuditadoMatch: "LIMITED ENGINE" },
      { key: "instruments", folderName: "Limited Instruments", label: "Limited Instruments", cronogramaAuditadoMatch: "LIMITED INSTRUMENTS" },
      { key: "propeller", folderName: "Limited Propeller", label: "Limited Propeller", cronogramaAuditadoMatch: "LIMITED PROPELLER" },
      { key: "radio", folderName: "Limited Radio", label: "Limited Radio", cronogramaAuditadoMatch: "LIMITED RADIO" },
      { key: "other_metallic", folderName: "Other Metallic and Composite Components", label: "Other Metallic and Composite Components", cronogramaAuditadoMatch: "OTHER METALLIC AND COMPOSITE COMPONENTS" },
    ],
  },

  /* ------------------------------------------------------------------ *
   * 6.5 Paleta de colores por categoría — se reutiliza EXACTAMENTE la
   * paleta ya usada por las otras herramientas del ecosistema QA_MRO
   * (Buscador de Aliases / Guía Operativa) para que las tres apps se
   * vean como parte de un mismo sistema. [texto, fondo claro]
   * ------------------------------------------------------------------ */
  CATEGORY_COLORS: {
    OMA: ["#185FA5", "#E6F1FB"],
    OMA_EXT: ["#0F6E56", "#E1F5EE"],
    PROVEEDOR: ["#534AB7", "#EEEDFE"],
    LABORATORIO_CALIBRACION: ["#BA7517", "#FAEEDA"],
    MANTENIMIENTO_ETAA: ["#993556", "#FBEAF0"],
    CIAC: ["#3B6D11", "#EAF3DE"],
    AREA_INTERNA: ["#5F5E5A", "#F1EFE8"],
    AUMENTO_CAPACIDADES: ["#B5541C", "#FBEADD"],
    INSPECCION: ["#1D7A9E", "#DFF3F9"],
  },

  /* ------------------------------------------------------------------ *
   * 7. Vocabulario de estados (tal como aparece en las fuentes, para
   *    normalizarlo de forma consistente).
   * ------------------------------------------------------------------ */
  STATUS_TEXT: {
    EJECUTADA: ["EJECUTADA", "EJECUTADAS"],
    NO_EJECUTADA: ["NO EJECUTADA", "NO EJECUTADAS"],
    POR_EJECUTAR: ["POR EJECUTAR"],
    REVISAR: ["REVISAR"],
    CANCELADA: ["CANCELADA", "CANCELADAS"],
  },

  /* ------------------------------------------------------------------ *
   * 8. Umbral de confianza mínimo para aceptar un match automático
   *    (0 a 1). Por debajo de este valor, la auditoría queda marcada
   *    "sin vincular" y aparece en el panel de diagnóstico.
   * ------------------------------------------------------------------ */
  MATCH_CONFIDENCE_THRESHOLD: 0.55,

  /* ------------------------------------------------------------------ *
   * 9. Ventanas de tiempo usadas por los KPIs
   * ------------------------------------------------------------------ */
  KPI: {
    PROXIMOS_DIAS: 30, // "Auditorías programadas para los próximos 30 días"
  },
};
