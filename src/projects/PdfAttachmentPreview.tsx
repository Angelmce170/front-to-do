import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

type Props = {
  dataUrl: string;
};

function dataUrlToBytes(dataUrl: string) {
  const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

export default function PdfAttachmentPreview({ dataUrl }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let loadingTask: pdfjsLib.PDFDocumentLoadingTask | null = null;

    async function renderPdf() {
      const container = containerRef.current;
      if (!container) return;

      setLoading(true);
      setError("");
      container.innerHTML = "";

      try {
        loadingTask = pdfjsLib.getDocument({ data: dataUrlToBytes(dataUrl) });
        const pdf = await loadingTask.promise;

        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          if (cancelled) return;

          const page = await pdf.getPage(pageNumber);
          const baseViewport = page.getViewport({ scale: 1 });
          const availableWidth = Math.max(container.clientWidth - 24, 280);
          const scale = Math.min(Math.max(availableWidth / baseViewport.width, 0.8), 1.6);
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement("canvas");
          const context = canvas.getContext("2d");

          if (!context) continue;

          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.className = "pdf-page-canvas";
          container.appendChild(canvas);

          await page.render({ canvas, canvasContext: context, viewport }).promise;
        }

        if (!cancelled) setLoading(false);
      } catch {
        if (!cancelled) {
          setLoading(false);
          setError("No se pudo visualizar este PDF dentro de la app.");
        }
      }
    }

    void renderPdf();

    return () => {
      cancelled = true;
      loadingTask?.destroy();
    };
  }, [dataUrl]);

  return (
    <div className="pdf-preview">
      {loading && <p className="inline-message">Cargando PDF...</p>}
      {error && <p className="inline-message">{error}</p>}
      <div ref={containerRef} className="pdf-pages" />
    </div>
  );
}
