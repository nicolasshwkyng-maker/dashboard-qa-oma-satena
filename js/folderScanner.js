/**
 * js/folderScanner.js — Escaneo de la carpeta de evidencias
 * ============================================================================
 * Recorre recursivamente la carpeta de evidencias seleccionada por el
 * usuario (AUD_EXT / AUD_INT / INSP / Self Evaluation Completadas) y
 * construye un índice de "carpetas hoja" de auditoría: cualquier carpeta
 * que contenga directamente al menos una de las 5 sub-carpetas estándar
 * (01_AVI, 02_REA, 03_SEG, 04_CIE, 05_EVI), sin importar la profundidad a
 * la que se encuentre (el proyecto INSP, por ejemplo, mezcla niveles
 * mes -> base -> fecha con mes -> [directo]).
 *
 * Para cada carpeta hoja se cuenta, de forma RECURSIVA, cuántos archivos
 * hay dentro de cada una de las 5 sub-carpetas — así no importa si dentro
 * de "03_SEG" hay más subcarpetas por fecha o por persona (caso real:
 * "03_SEG/Caja de Herramientas/<nombre>/...").
 *
 * La carpeta especial "Self Evaluation Completadas" (autoevaluaciones FAA)
 * NO sigue el patrón 01_AVI..05_EVI: se procesa aparte (ver
 * scanFaaSelfEval) y se agrupa por categoría "Limited ...".
 */

window.QA = window.QA || {};

QA.folderScanner = (function () {
  const cfg = QA.config;

  /** Ejecuta el escaneo completo. Devuelve { leafFolders, faaSelfEval, allPaths }. */
  async function scan() {
    const entries = [];
    await QA.fileAccess.walkEvidenceTree((entry) => entries.push(entry));

    const dirPaths = new Set();
    const filesByPath = []; // { path, size, lastModified }
    entries.forEach(e => {
      if (e.kind === "directory") dirPaths.add(e.path);
      else filesByPath.push({ path: e.path, size: e.size || 0, lastModified: e.lastModified || 0 });
    });

    const faaFolderName = cfg.evidence.FAA_SELF_EVAL_FOLDER;
    const faaFiles = filesByPath.filter(f => f.path === faaFolderName || f.path.startsWith(faaFolderName + "/"));
    const regularFiles = filesByPath.filter(f => !(f.path === faaFolderName || f.path.startsWith(faaFolderName + "/")));
    const regularDirs = new Set([...dirPaths].filter(p => !(p === faaFolderName || p.startsWith(faaFolderName + "/"))));

    const leafFolders = buildLeafFolders(regularDirs, regularFiles);
    const faaSelfEval = QA.faaSelfEval.scan(faaFiles, [...dirPaths].filter(p => p.startsWith(faaFolderName + "/")));

    return { leafFolders, faaSelfEval, totalFilesScanned: filesByPath.length, totalFoldersScanned: dirPaths.size };
  }

  function buildLeafFolders(dirPaths, files) {
    const STD = cfg.evidence.STANDARD_SUBFOLDERS;
    const leaves = [];

    dirPaths.forEach((dirPath) => {
      const isLeaf = STD.some(sub => dirPaths.has(dirPath + "/" + sub));
      if (!isLeaf) return;

      const topCategory = dirPath.split("/")[0];
      const counts = {};
      const fileDates = [];
      let totalFiles = 0;

      STD.forEach((sub) => {
        const prefix = dirPath + "/" + sub + "/";
        const exact = dirPath + "/" + sub;
        const matching = files.filter(f => f.path === exact || f.path.startsWith(prefix));
        counts[sub] = matching.length;
        totalFiles += matching.length;
        matching.forEach(f => { if (f.lastModified) fileDates.push(f.lastModified); });
      });

      leaves.push({
        path: dirPath,
        name: dirPath.split("/").pop(),
        topCategory,
        counts,
        totalFiles,
        firstFileDate: fileDates.length ? new Date(Math.min(...fileDates)) : null,
        lastFileDate: fileDates.length ? new Date(Math.max(...fileDates)) : null,
      });
    });

    // Ordena por ruta para una salida estable y predecible.
    leaves.sort((a, b) => a.path.localeCompare(b.path));
    return leaves;
  }

  return { scan };
})();
