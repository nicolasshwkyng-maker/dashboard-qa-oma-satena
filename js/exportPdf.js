/**
 * js/exportPdf.js — Exportación del dashboard a PDF e impresión
 * ============================================================================
 * Usa html2canvas para capturar cada sección del dashboard como imagen y
 * jsPDF para componer un PDF de varias páginas (una por sección), en
 * orientación horizontal (los tableros son más anchos que altos). La
 * impresión optimizada se maneja aparte con una hoja de estilos @media
 * print en styles.css; aquí solo se dispara window.print().
 */

window.QA = window.QA || {};

QA.exportPdf = (function () {

  function dateStamp() {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  }

  /**
   * Fuerza que un elemento sea visible temporalmente (aunque esté en una
   * pestaña oculta) para poder capturarlo con html2canvas. Las secciones
   * ocultas usan la clase `.d-none` de Bootstrap (`display:none !important`),
   * así que una anulación por estilo en línea NO sirve (!important siempre
   * gana) — hay que quitar la clase, no solo cambiar `style.display`.
   */
  function withTemporaryVisibility(el, fn) {
    const hadDNone = el.classList.contains("d-none");
    const needsPositionOverride = hadDNone || el.offsetParent === null;
    const prevPosition = el.style.position, prevLeft = el.style.left, prevTop = el.style.top;
    if (hadDNone) el.classList.remove("d-none");
    if (needsPositionOverride) {
      // Se saca del flujo visual (sin taparlo con el layout actual) pero
      // dejándolo con tamaño real para que html2canvas pueda medirlo.
      el.style.position = "absolute";
      el.style.left = "-99999px";
      el.style.top = "0";
    }
    return Promise.resolve(fn()).finally(() => {
      if (hadDNone) el.classList.add("d-none");
      if (needsPositionOverride) { el.style.position = prevPosition; el.style.left = prevLeft; el.style.top = prevTop; }
    });
  }

  /**
   * @param {string[]} sectionIds - IDs de los contenedores a exportar, en orden.
   * @param {object} opts - { title, onProgress(index, total) }
   */
  async function exportDashboardToPdf(sectionIds, opts) {
    opts = opts || {};
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    let pageAdded = false;

    for (let i = 0; i < sectionIds.length; i++) {
      const el = document.getElementById(sectionIds[i]);
      if (!el) continue;
      if (opts.onProgress) opts.onProgress(i, sectionIds.length);

      await withTemporaryVisibility(el, async () => {
        const canvas = await html2canvas(el, { scale: 1.6, backgroundColor: "#ffffff", useCORS: true });
        const imgData = canvas.toDataURL("image/png");
        const margin = 24;
        const availW = pageW - margin * 2, availH = pageH - margin * 2 - 20;
        const ratio = Math.min(availW / canvas.width, availH / canvas.height, 1);
        const w = canvas.width * ratio, h = canvas.height * ratio;
        if (pageAdded) pdf.addPage();
        pdf.setFontSize(10);
        pdf.setTextColor("#5F5E5A");
        pdf.text(`${opts.title || "Dashboard QA-OMA SATENA MRO"} — ${new Date().toLocaleDateString("es-CO")}`, margin, margin);
        pdf.addImage(imgData, "PNG", (pageW - w) / 2, margin + 12, w, h);
        pageAdded = true;
      });
    }

    pdf.save(`Dashboard_QA_OMA_${dateStamp()}.pdf`);
  }

  function print() { window.print(); }

  return { exportDashboardToPdf, print };
})();
