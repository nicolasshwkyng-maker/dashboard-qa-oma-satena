# Dashboard QA-OMA — SATENA M.R.O.

Aplicación web para visualizar y **editar en vivo** el estado de ejecución
real del Programa Anual de Auditorías de Aseguramiento de la Calidad de la
OMA SATENA. Los datos viven en **Supabase** (Postgres en la nube) y se
despliega como sitio estático en **GitHub Pages**: cualquier edición desde
el dashboard (o desde otra sesión) se refleja en vivo en KPIs, gráficas y
tablas vía Supabase Realtime, sin depender de volver a cargar archivos
Excel cada vez.

> Versión anterior: hasta agosto de 2026 la app era 100% local (sin
> backend) y leía un cronograma y una carpeta de evidencias directamente
> del disco cada vez que se abría, vía la File System Access API del
> navegador. Ese modelo se retiró — ver `git log` para el historial — pero
> su lógica de negocio (cruce cronograma↔evidencia, reglas de
> clasificación) se conserva y se reutiliza en el script de migración
> única (`scripts/migrate-to-supabase.mjs`).

## Arquitectura

- **Frontend**: HTML/CSS/JS plano (sin build step), Bootstrap 5, Chart.js,
  DataTables — servido como sitio estático desde GitHub Pages.
- **Backend**: Supabase (Postgres + Realtime). El navegador habla directo
  con Supabase (`vendor/supabase.min.js`), sin servidor propio.
- **Acceso**: público, sin login — cualquiera con el enlace puede ver y
  editar (ver `supabase/schema_open_access.sql`). No hay pantalla de
  inicio de sesión ni usuarios de Supabase Auth en uso.

## Puesta en marcha (una sola vez)

1. **Crear el proyecto Supabase**: [supabase.com](https://supabase.com) →
   New Project.
2. **Crear el esquema**: pega el contenido de `supabase/schema.sql` en el
   SQL Editor del proyecto y ejecútalo, y a continuación
   `supabase/schema_open_access.sql` (deja las tablas de lectura/escritura
   pública, sin exigir sesión iniciada).
3. **Configurar el frontend**: copia `js/config.example.js` a `js/config.js`
   y completa `SUPABASE_URL` / `SUPABASE_ANON_KEY` (Project Settings → API
   → la *anon public key*, no la *service_role*). `js/config.js` está en
   `.gitignore`, nunca se commitea.
4. **(Opcional) Migrar los datos históricos**: ver
   [`scripts/migrate-to-supabase.mjs`](scripts/migrate-to-supabase.mjs) —
   copia `scripts/.env.example` a `scripts/.env`, complétalo, y corre
   `node scripts/migrate-to-supabase.mjs`. Solo hace falta una vez.
5. **Abrir la app**: `index.html` directamente en el navegador (o servido
   por cualquier servidor estático) — se ve el dashboard directo, sin login.
6. **Desplegar a GitHub Pages**: ver `.github/workflows/deploy.yml` —
   agrega los secrets `SUPABASE_URL` y `SUPABASE_ANON_KEY` en Settings →
   Secrets and variables → Actions, activa Pages con "Source: GitHub
   Actions", y cada push a `main` publica la app automáticamente.

## Estructura del proyecto

```
SATENA_QA_Dashboard/
├── index.html                Estructura y layout de toda la app
├── styles.css                 Sistema visual (paleta corporativa, responsive, impresión)
├── data.js                     Configuración visual (colores por categoría, KPI.PROXIMOS_DIAS)
├── README.md                     Este archivo
├── .gitignore                     js/config.js y scripts/.env nunca se commitean
├── supabase/
│   ├── schema.sql                  Tablas + Row Level Security (correr una vez en Supabase)
│   └── schema_open_access.sql       Abre las políticas RLS a acceso público (sin login)
├── scripts/
│   ├── migrate-to-supabase.mjs      Migración única Excel/carpetas -> Supabase (Node)
│   └── .env.example                  Plantilla de variables para el script de migración
├── .github/workflows/
│   └── deploy.yml                     Publica a GitHub Pages en cada push a main
├── assets/
│   ├── logo_satena_blanco.png
│   └── fonts/                 IBM Plex Sans/Mono autoalojadas (sin depender de Google Fonts)
├── vendor/                Librerías de terceros ya descargadas (sin CDN externo en runtime)
│   Bootstrap 5 · Chart.js 4 · SheetJS (xlsx, solo para exportar) · DataTables + jQuery
│   · jsPDF · html2canvas · FileSaver · Supabase JS SDK
└── js/
    ├── config.example.js       Plantilla de credenciales Supabase (copiar a config.js)
    ├── utils.js                  Normalización de texto, fechas, formato — funciones puras
    ├── supabaseClient.js           Inicialización del cliente Supabase
    ├── dataService.js                Fuente de datos: fetch/save/delete + Realtime
    ├── statusEngine.js                 Cálculo del estado real de cada auditoría
    ├── kpiEngine.js                      Cálculo de KPIs y agregaciones para gráficos
    ├── charts.js                          Renderizado de todos los gráficos (Chart.js)
    ├── tables.js                            Tablas dinámicas (DataTables) + export a Excel
    ├── filters.js                            Filtros globales
    ├── exportPdf.js                           Exportación del dashboard a PDF
    └── app.js                                  Orquestación: carga, edición, render
```

Los archivos retirados de `index.html` (`fileAccess.js`, `excelParser.js`,
`folderScanner.js`, `matching.js`, `faaSelfEval.js`) siguen existiendo en
`js/` porque `scripts/migrate-to-supabase.mjs` los reutiliza tal cual (en
un contexto Node) para la migración única — no se tocan salvo que cambie
esa lógica de negocio.

## Modelo de datos (Supabase)

Ver `supabase/schema.sql` para el detalle completo de columnas. Resumen:

| Tabla | Contenido |
|---|---|
| `auditorias` | Programa de auditorías (antes "CRONO DEF") + estado de evidencia editable a mano (conteos por carpeta `01_AVI`..`05_EVI`, ya no escaneados de disco). |
| `hallazgos` | No Conformidades / Observaciones, con `auditoria_id` como FK real hacia `auditorias` (antes se adivinaba por similitud de nombre; ahora se elige explícitamente en el formulario). |
| `control_satdsg` | Bitácora de comunicaciones oficiales (Aviso/Informe/Seguimiento/Cierre) — solo trazabilidad. |
| `faa_self_eval_documentos` | Metadatos de documentos de autoevaluación FAA (categoría, nombre, fecha, tamaño) — **no** se sube el archivo, solo su registro. |

### ¿Cuándo se considera "ejecutada" una auditoría?

Editable en `js/statusEngine.js` (función `computeEstado`):

- **Ejecutada**: `evidencia_counts.02_REA` o `evidencia_counts.04_CIE` > 0.
- **En Ejecución**: solo hay conteo en `01_AVI`, `03_SEG` o `05_EVI`.
- **Vencida**: la fecha programada ya pasó y no hay ningún conteo de evidencia.
- **Pendiente**: la fecha programada todavía no llega y no hay evidencia.
- **Cancelada** / **Reprogramada**: se toman del campo manual del
  cronograma (`estatus_manual_crono`) y de `fecha_reprogramacion`.

### Auditorías extraordinarias (no programadas)

`es_extraordinaria = true` cuando no había fecha en el cronograma
originalmente aprobado, o cuando se agrega evidencia de una auditoría que
nunca estuvo en el cronograma (incluye las categorías FAA Self
Evaluation). Estas auditorías **suman al % de cumplimiento** contra el
total programado al inicio del año — el indicador puede superar el 100%
si además de cumplirse todo lo proyectado se ejecutan auditorías
adicionales no programadas (ver `js/kpiEngine.js#computeKpis`).

Su fecha de ejecución real (usada en el gráfico "Programadas vs Ejecutadas
por Mes") es el campo editable `fecha_ejecucion_real` — deliberadamente
**no** se infiere de metadatos de archivo (la fecha de modificación de
documentos sincronizados desde la nube no refleja la fecha real de
ejecución), así que hay que cargarla a mano desde el formulario de
auditoría cuando se confirme la fecha real.

## Mantenimiento futuro

- **Nuevo proveedor/área auditada**: crear la auditoría desde el botón
  "+ Nueva Auditoría" del dashboard — no requiere tocar código ni Excel.
- **Cambiar la regla de "ejecutada"**: editar únicamente
  `js/statusEngine.js` (función `computeEstado`).
- **Volver a exigir login**: el acceso hoy es público (políticas RLS
  `using (true)` en `supabase/schema_open_access.sql`). Para restringir de
  nuevo, vuelve a aplicar `supabase/schema.sql` (políticas
  `auth.uid() is not null`) y restaura la pantalla de login en `index.html`
  / `js/app.js` (ver historial de git antes de este cambio).
