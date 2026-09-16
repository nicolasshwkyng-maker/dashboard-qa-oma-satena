# Dashboard QA-OMA — SATENA M.R.O.

Aplicación web para visualizar el estado de ejecución del Programa Anual de
Auditorías de Aseguramiento de la Calidad de la OMA SATENA. **Sin backend,
sin login, sin credenciales**: los datos se cargan subiendo el Excel de
control (hojas `AUDITORIAS_2026` + `HALLAZGOS_2026`) y quedan guardados en
el navegador de quien la abre (IndexedDB). Para actualizarla, se vuelve a
cargar el Excel — reemplaza todo lo que había, igual que la primera versión
de la app (100% local, sin backend), pero ahora desplegada en la web.

> Historial: la app pasó por una versión intermedia con Supabase (Postgres
> en la nube, login, edición en vivo multi-dispositivo) entre agosto y
> septiembre de 2026. Se retiró — ver `git log` — porque requería mantener
> un proyecto Supabase aparte; el modelo actual vuelve a "el Excel es la
> fuente de verdad", adaptado para funcionar desplegado en la web.

## Arquitectura

- **Frontend**: HTML/CSS/JS plano (sin build step), Bootstrap 5, Chart.js,
  DataTables, SheetJS — servido como sitio estático (GitHub Pages / Vercel).
- **Datos**: IndexedDB, en el propio navegador (`js/dataService.js`). No
  hay servidor, no hay credenciales que configurar. Limitación real: los
  datos NO se sincronizan entre dispositivos — si se abre la app en otro
  computador o celular, hay que volver a cargar el Excel ahí también.
- **Carga de datos**: botón "📂 Cargar Excel" (o la pantalla inicial si
  todavía no hay nada cargado) — sube el `.xlsx` con las hojas
  `AUDITORIAS_2026` y `HALLAZGOS_2026`, lo procesa en el navegador
  (`js/excelParser.js` + `js/matching.js` + `js/excelImport.js`, misma
  lógica que antes corría en Node contra Supabase) y reemplaza todo el
  contenido guardado.
- **Edición puntual**: los formularios "+ Nueva Auditoría/Inspección/
  Hallazgo" y el clic sobre una fila siguen disponibles para ajustes entre
  una carga de Excel y la siguiente — se guardan en IndexedDB igual que la
  carga masiva.

## Puesta en marcha

No hay ningún paso de configuración: se abre `index.html` (local o
desplegado) y la propia app pide el Excel la primera vez.

**Desplegar a GitHub Pages**: ver `.github/workflows/deploy.yml` — activa
Pages con "Source: GitHub Actions" en Settings → Pages, y cada push a
`main` publica la app automáticamente (sin secrets que configurar).

**Desplegar a Vercel**: en [vercel.com](https://vercel.com), "Add New… →
Project" → importa este repo de GitHub. Es un sitio 100% estático (sin
framework, sin build command) — Vercel lo detecta solo. Se puede desplegar
en paralelo a GitHub Pages sin conflicto (mismo repo, dos URLs distintas).

## Estructura del proyecto

```
SATENA_QA_Dashboard/
├── index.html                Estructura y layout de toda la app
├── styles.css                 Sistema visual (paleta corporativa, responsive, impresión)
├── data.js                     Configuración visual (colores por categoría, reglas de clasificación)
├── README.md                     Este archivo
├── .github/workflows/
│   └── deploy.yml                  Publica a GitHub Pages en cada push a main
├── assets/fonts/               IBM Plex Sans/Mono autoalojadas (sin depender de Google Fonts)
├── vendor/                Librerías de terceros ya descargadas (sin CDN externo en runtime)
│   Bootstrap 5 · Chart.js 4 · SheetJS (xlsx) · DataTables + jQuery · jsPDF · html2canvas · FileSaver
└── js/
    ├── utils.js                  Normalización de texto, fechas, formato — funciones puras
    ├── excelParser.js              Lee las hojas AUDITORIAS_2026 / HALLAZGOS_2026 del Excel
    ├── matching.js                   Clasificación canónica + vínculo hallazgo->auditoría por nombre
    ├── excelImport.js                  Junta lo anterior en objetos listos para guardar
    ├── dataService.js                    Fuente de datos: IndexedDB (fetch/save/delete)
    ├── statusEngine.js                     Cálculo del estado real de cada auditoría
    ├── kpiEngine.js                          Cálculo de KPIs y agregaciones para gráficos
    ├── charts.js                              Renderizado de todos los gráficos (Chart.js)
    ├── tables.js                                Tablas dinámicas (DataTables) + export a Excel
    ├── filters.js                                Filtros globales
    ├── exportPdf.js                               Exportación del dashboard a PDF
    └── app.js                                      Orquestación: carga, edición, render
```

## Modelo de datos

El Excel de control tiene 2 hojas (ver `js/excelParser.js` para el detalle
exacto de columnas):

| Hoja | Contenido |
|---|---|
| `AUDITORIAS_2026` | Una fila por auditoría/inspección: Estatus, Programada/No programada, Tipo (Auditoria QA / Inspección), Clasificación, Auditado, Ciudad, Modalidad, Fecha Proyectada, Ejecución Reprogramada, Servicios. |
| `HALLAZGOS_2026` | Una fila por hallazgo (NC/OB), vinculado a su auditoría por similitud de nombre (no comparten ID) — condición, estado (Abierto/Cerrado/Cierre Parcial), causa raíz, fechas de notificación/cierre, etc. |

### ¿Cuándo se considera "ejecutada" una auditoría?

Ya no se infiere de nada: viene directo de la columna **Estatus** del
Excel (`Por Ejecutar` / `Ejecutada` / `No Ejecutada` / `Cancelada`) — ver
`js/statusEngine.js#computeEstado`.

### Auditorías extraordinarias (no programadas)

Columna **Programada** = "No programada" en el Excel. Estas auditorías
**suman al % de avance total** contra el total programado al inicio del
año — el indicador puede superar el 100% (ver
`js/kpiEngine.js#computeKpis`, tarjetas "% Cumplimiento Cronograma
Original" vs "% Avance Total del Programa").

### Fecha de referencia de cada auditoría

Columna **Ejecución Reprogramada** si tiene valor: si no, columna **Fecha
Proyectada** (ver `js/statusEngine.js#computeFechaReferencia`) — aplica
igual a programadas y extraordinarias.

## Mantenimiento futuro

- **Actualizar el progreso**: botón "📂 Cargar Excel" con la versión más
  reciente del archivo de control — reemplaza TODO lo que había.
- **Ajuste puntual entre cargas**: formularios "+ Nueva Auditoría/
  Inspección/Hallazgo" o clic sobre una fila de la tabla.
- **Cambiar la regla de "ejecutada"**: editar únicamente
  `js/statusEngine.js` (función `computeEstado`).
- **Multi-dispositivo / colaboración en equipo**: no hay sincronización
  entre navegadores. El flujo recomendado es mantener el Excel de control
  compartido con el equipo (ej. OneDrive) y cargarlo en la app cuando se
  quiera ver el progreso actualizado.
