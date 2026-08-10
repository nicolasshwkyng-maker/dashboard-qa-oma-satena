/**
 * js/tables.js — Tablas dinámicas (DataTables) de Auditorías y Hallazgos
 * ============================================================================
 * Configura las dos tablas principales del dashboard con búsqueda, orden,
 * filtros y paginación (DataTables), y expone la exportación a Excel de lo
 * que esté actualmente visible/filtrado (vía SheetJS, sin depender de la
 * extensión Buttons de DataTables — un archivo menos que mantener).
 */

window.QA = window.QA || {};

QA.tables = (function () {
  const u = QA.utils;
  let dtAuditorias = null;
  let dtHallazgos = null;
  let dtFaa = null;

  const ESTADO_LABELS = {
    EJECUTADA: "Ejecutada", EN_EJECUCION: "En Ejecución", VENCIDA: "Vencida", PENDIENTE: "Pendiente",
  };
  const ESTADO_COLORS = {
    EJECUTADA: "#3B6D11", EN_EJECUCION: "#BA7517", VENCIDA: "#A32D2D", PENDIENTE: "#5F5E5A",
  };

  function badge(text, color, bg) {
    return `<span class="qa-badge" style="color:${color};background:${bg || color + "1a"}">${u.escapeHtml(text)}</span>`;
  }

  function estadoBadgeHtml(estadoCalculado) {
    const label = ESTADO_LABELS[estadoCalculado] || estadoCalculado || "—";
    const color = ESTADO_COLORS[estadoCalculado] || "#5F5E5A";
    return badge(label, color);
  }

  function categoriaBadgeHtml(clasificacionCanonica, label) {
    const colors = (QA.config.CATEGORY_COLORS && QA.config.CATEGORY_COLORS[clasificacionCanonica]) || ["#5F5E5A", "#F1EFE8"];
    return badge(label || clasificacionCanonica || "—", colors[0], colors[1]);
  }

  /* ------------------------------------------------------------------ *
   * Tabla de Auditorías
   * ------------------------------------------------------------------ */
  function auditoriasColumns() {
    return [
      { data: "auditado", title: "Nombre", render: (v) => u.escapeHtml(v || "—") },
      { data: "clasificacionLabel", title: "Clasificación", render: (v, t, row) => categoriaBadgeHtml(row.clasificacionCanonica, v) },
      { data: "tipoAuditoria", title: "Tipo", render: (v) => u.escapeHtml(v || "—") },
      { data: "modalidad", title: "Modalidad", render: (v) => u.escapeHtml(v || "No especificado") },
      { data: "ciudad", title: "Ubicación", render: (v) => u.escapeHtml(v || "No especificado") },
      { data: "fechaProgramada", title: "Fecha Programada", render: (v) => u.formatDate(v), type: "date" },
      { data: "ultimaFechaEvidencia", title: "Fecha Ejecución", render: (v, t, row) => u.formatDate(row.fechaEjecucionReal || v) },
      { data: "estadoCalculado", title: "Estado", render: (v) => estadoBadgeHtml(v) },
      { data: "auditorResponsable", title: "Responsable", render: (v) => u.escapeHtml(v || "—") },
      {
        data: null, title: "Evidencia", orderable: false,
        render: (row) => row.evidenciaTotalFiles ? `${row.evidenciaTotalFiles} archivo(s)` + (row.esExtraordinaria ? " · <em>extraordinaria</em>" : "") : "Sin evidencia",
      },
    ];
  }

  /** `onRowClick(auditoriaData)` — se llama al hacer clic en una fila, para
   * que app.js abra el formulario de edición. tables.js no conoce el modal
   * de edición: solo delega, para mantenerse como capa puramente visual. */
  function initAuditoriasTable(audits, onRowClick) {
    dtAuditorias = $("#tblAuditorias").DataTable({
      data: audits,
      columns: auditoriasColumns(),
      pageLength: 15,
      order: [[5, "desc"]],
      language: DT_LANG_ES,
      dom: "<'row mb-2'<'col-sm-6'l><'col-sm-6'f>>rt<'row mt-2'<'col-sm-5'i><'col-sm-7'p>>",
    });
    if (onRowClick) {
      $("#tblAuditorias tbody").on("click", "tr", function () {
        const data = dtAuditorias.row(this).data();
        if (data) onRowClick(data);
      });
    }
    return dtAuditorias;
  }

  function updateAuditoriasTable(audits, onRowClick) {
    if (!dtAuditorias) return initAuditoriasTable(audits, onRowClick);
    dtAuditorias.clear().rows.add(audits).draw();
  }

  /* ------------------------------------------------------------------ *
   * Tabla de Hallazgos — incluye TODAS las filas de la hoja "Hallazgos
   * Auditoria" (61), no solo las que tienen una No Conformidad u
   * Observación real: así es como el equipo QA cuenta los hallazgos
   * (cada fila registrada = un hallazgo), incluyendo auditorías cerradas
   * sin novedades (CONDICIÓN "N/A") y auditorías cuya determinación de
   * hallazgos todavía está pendiente (sin CONDICIÓN diligenciada).
   * ------------------------------------------------------------------ */
  function estadoEfectivoHallazgo(f) { return f.estadoHallazgo || f.estadoAuditoria || null; }

  function tipoHallazgoBadge(condicion) {
    if (condicion === "NC") return badge("No Conformidad", "#A32D2D");
    if (condicion === "OB") return badge("Observación", "#BA7517");
    if (condicion === "N/A") return badge("Sin hallazgo (cerrada)", "#5F5E5A", "#F1EFE8");
    return badge("Pendiente de determinar", "#185FA5", "#E6F1FB");
  }

  /** Fila expandible con la descripción completa del hallazgo (no cabe como
   * columna en la tabla principal sin romper el ancho); se despliega al
   * hacer clic en el ícono de la primera columna (patrón "child row" de
   * DataTables). */
  function hallazgoDescripcionHtml(row) {
    const desc = (row.descripcion && row.descripcion !== "N/A") ? row.descripcion : "Sin descripción registrada.";
    const req = (row.requisito && row.requisito !== "N/A") ? row.requisito : null;
    return `<div class="qa-finding-detail">
      <div><strong>Descripción:</strong> ${u.escapeHtml(desc)}</div>
      ${req ? `<div class="mt-1"><strong>Requisito:</strong> ${u.escapeHtml(req)}</div>` : ""}
    </div>`;
  }

  function hallazgosColumns() {
    return [
      { data: null, title: "", orderable: false, className: "qa-details-control text-center", render: () => "＋" },
      { data: "auditado", title: "Auditoría", render: (v) => u.escapeHtml(v || "—") },
      { data: null, title: "Código", render: (row) => u.escapeHtml(`${row.idAuditoria}-${row.numeroReporte}`) },
      { data: "condicion", title: "Tipo", render: (v) => tipoHallazgoBadge(v) },
      { data: null, title: "Estado", render: (row) => { const e = estadoEfectivoHallazgo(row); return e === "Cerrado" ? badge("Cerrado", "#3B6D11") : e === "Abierto" ? badge("Abierto", "#A32D2D") : u.escapeHtml("—"); } },
      { data: "auditorLider", title: "Responsable", render: (v) => u.escapeHtml(v || "—") },
      { data: "fechaInicio", title: "Fecha", render: (v) => u.formatDate(v), type: "date" },
      { data: "fechaCierreReporte", title: "Fecha de Cierre", render: (v) => u.formatDate(v), type: "date" },
      { data: "clasificacionReporte", title: "Causa raíz", render: (v) => u.escapeHtml((v && v !== "N/A") ? v : "—") },
    ];
  }

  /** `onRowClick(hallazgoData)` — clic en cualquier celda de la fila EXCEPTO
   * el ＋ de descripción (que sigue expandiendo/colapsando el detalle). */
  function initHallazgosTable(findings, onRowClick) {
    dtHallazgos = $("#tblHallazgos").DataTable({
      data: findings,
      columns: hallazgosColumns(),
      pageLength: 15,
      order: [[6, "desc"]],
      language: DT_LANG_ES,
      dom: "<'row mb-2'<'col-sm-6'l><'col-sm-6'f>>rt<'row mt-2'<'col-sm-5'i><'col-sm-7'p>>",
    });
    $("#tblHallazgos tbody").on("click", "td.qa-details-control", function () {
      const tr = $(this).closest("tr");
      const row = dtHallazgos.row(tr);
      if (row.child.isShown()) {
        row.child.hide();
        tr.removeClass("shown");
        $(this).text("＋");
      } else {
        row.child(hallazgoDescripcionHtml(row.data())).show();
        tr.addClass("shown");
        $(this).text("－");
      }
    });
    if (onRowClick) {
      $("#tblHallazgos tbody").on("click", "td:not(.qa-details-control)", function () {
        if ($(this).find(".qa-finding-detail").length) return; // clic dentro de la fila de descripción expandida: no abre edición
        const data = dtHallazgos.row($(this).closest("tr")).data();
        if (data) onRowClick(data);
      });
    }
    return dtHallazgos;
  }

  function updateHallazgosTable(findings, onRowClick) {
    if (!dtHallazgos) return initHallazgosTable(findings, onRowClick);
    dtHallazgos.clear().rows.add(findings).draw();
  }

  /* ------------------------------------------------------------------ *
   * Tabla del panel FAA Self Evaluation (lista de los 55 documentos)
   * ------------------------------------------------------------------ */
  function faaColumns() {
    return [
      { data: "categoryLabel", title: "Categoría", render: (v) => u.escapeHtml(v) },
      { data: "name", title: "Documento", render: (v) => u.escapeHtml(v) },
      { data: "lastModified", title: "Fecha del archivo", render: (v) => v ? u.formatDate(new Date(v)) : "—" },
      { data: "size", title: "Tamaño", render: (v) => v ? Math.round(v / 1024) + " KB" : "—" },
    ];
  }

  function initFaaTable(faaDocs) {
    dtFaa = $("#tblFaaDocs").DataTable({
      data: faaDocs,
      columns: faaColumns(),
      pageLength: 10,
      order: [[0, "asc"]],
      language: DT_LANG_ES,
      dom: "<'row mb-2'<'col-sm-6'l><'col-sm-6'f>>rt<'row mt-2'<'col-sm-5'i><'col-sm-7'p>>",
    });
    return dtFaa;
  }

  function updateFaaTable(faaDocs) {
    if (!dtFaa) return initFaaTable(faaDocs);
    dtFaa.clear().rows.add(faaDocs).draw();
  }

  /* ------------------------------------------------------------------ *
   * Exportación a Excel (SheetJS) de lo que está filtrado actualmente
   * ------------------------------------------------------------------ */
  function exportAuditoriasExcel() {
    if (!dtAuditorias) return;
    const rows = dtAuditorias.rows({ search: "applied" }).data().toArray();
    const plain = rows.map(a => ({
      "Nombre": a.auditado, "Clasificación": a.clasificacionLabel, "Tipo": a.tipoAuditoria,
      "Modalidad": a.modalidad || "No especificado", "Ubicación": a.ciudad || "No especificado",
      "Fecha Programada": u.formatDate(a.fechaProgramada), "Fecha Ejecución": u.formatDate(a.fechaEjecucionReal || a.ultimaFechaEvidencia),
      "Estado": ESTADO_LABELS[a.estadoCalculado] || a.estadoCalculado, "Extraordinaria": a.esExtraordinaria ? "Sí" : "No",
      "Archivos de Evidencia": a.evidenciaTotalFiles,
      "Hallazgos Vinculados": a.hallazgosVinculados || 0,
    }));
    downloadAsExcel(plain, "Auditorias", `Auditorias_QA_OMA_${dateStamp()}.xlsx`);
  }

  const TIPO_HALLAZGO_LABEL = { NC: "No Conformidad", OB: "Observación", "N/A": "Sin hallazgo (auditoría cerrada)" };

  function exportHallazgosExcel() {
    if (!dtHallazgos) return;
    const rows = dtHallazgos.rows({ search: "applied" }).data().toArray();
    const plain = rows.map(f => ({
      "Auditoría": f.auditado, "Código": `${f.idAuditoria}-${f.numeroReporte}`,
      "Tipo": TIPO_HALLAZGO_LABEL[f.condicion] || "Pendiente de determinar",
      "Estado": estadoEfectivoHallazgo(f) || "—", "Responsable": f.auditorLider || "—", "Fecha": u.formatDate(f.fechaInicio),
      "Fecha de Cierre": u.formatDate(f.fechaCierreReporte), "Causa raíz": (f.clasificacionReporte && f.clasificacionReporte !== "N/A") ? f.clasificacionReporte : "—",
      "Descripción": (f.descripcion && f.descripcion !== "N/A") ? f.descripcion : "",
    }));
    downloadAsExcel(plain, "Hallazgos", `Hallazgos_QA_OMA_${dateStamp()}.xlsx`);
  }

  function dateStamp() {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  }

  function downloadAsExcel(plainRows, sheetName, filename) {
    const ws = XLSX.utils.json_to_sheet(plainRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    XLSX.writeFile(wb, filename);
  }

  const DT_LANG_ES = {
    search: "Buscar:", lengthMenu: "Mostrar _MENU_ registros", info: "Mostrando _START_ a _END_ de _TOTAL_ registros",
    infoEmpty: "Sin registros", infoFiltered: "(filtrado de _MAX_ registros totales)", zeroRecords: "No se encontraron coincidencias",
    paginate: { first: "Primero", last: "Último", next: "Siguiente", previous: "Anterior" },
  };

  return {
    initAuditoriasTable, updateAuditoriasTable, initHallazgosTable, updateHallazgosTable, initFaaTable, updateFaaTable,
    exportAuditoriasExcel, exportHallazgosExcel, estadoBadgeHtml, categoriaBadgeHtml,
    get auditoriasTable() { return dtAuditorias; }, get hallazgosTable() { return dtHallazgos; },
  };
})();
