// See the briefing PDF inside the app before sending it (crew feedback #37). The PDF is drawn page by page with
// PDF.js, so it works the same in Safari, the home-screen app and Android, where opening a PDF file is hit or miss.
// PDF.js is loaded only when someone opens a preview.
import { useEffect, useRef, useState } from "react";
import { Loader2, Share2, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

async function render(blob: Blob, host: HTMLDivElement, isCancelled: () => boolean) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const worker = (await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
  const width = host.clientWidth || 340;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  for (let i = 1; i <= doc.numPages; i++) {
    if (isCancelled()) break;
    const page = await doc.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: (width / base.width) * dpr });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height);
    canvas.style.width = "100%"; canvas.style.height = "auto";
    canvas.className = "block rounded-md bg-white shadow-sm ring-1 ring-border";
    canvas.setAttribute("data-testid", `pdf-preview-page-${i}`);
    host.appendChild(canvas);
    await page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport: vp } as any).promise;
  }
  return doc.numPages;
}

export function PdfPreviewDialog({ blob, open, onOpenChange, onSend, title }: { blob: Blob | null; open: boolean; onOpenChange: (o: boolean) => void; onSend: () => void; title: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [pages, setPages] = useState(0);
  useEffect(() => {
    if (!open || !blob) return;
    let cancelled = false;
    setState("loading");
    // wait a frame so the dialog has its width
    const t = setTimeout(() => {
      if (!host.current) return;
      host.current.innerHTML = "";
      render(blob, host.current, () => cancelled).then((n) => { if (!cancelled) { setPages(n); setState("ready"); } })
        .catch(() => { if (!cancelled) setState("failed"); });
    }, 50);
    return () => { cancelled = true; clearTimeout(t); };
  }, [open, blob]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[92dvh] max-w-lg flex-col gap-0 overflow-hidden p-0 [&>button]:hidden" data-testid="dialog-pdf-preview">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <DialogTitle className="truncate text-sm font-semibold">{title}</DialogTitle>
            <p className="text-[11px] text-muted-foreground">{state === "ready" ? `PDF preview · ${pages} page${pages === 1 ? "" : "s"}` : "PDF preview"}</p>
          </div>
          <button type="button" onClick={() => onOpenChange(false)} aria-label="Close preview" className="grid h-9 w-9 shrink-0 place-items-center rounded-full hover-elevate" data-testid="button-pdf-preview-close"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto bg-muted/50 p-3">
          {state === "loading" && <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Drawing the pages…</p>}
          {state === "failed" && <p className="py-10 text-center text-sm text-muted-foreground" data-testid="text-pdf-preview-failed">Couldn't show the preview on this device. Share PDF still works.</p>}
          <div ref={host} className="space-y-3" />
        </div>
        <div className="grid grid-cols-2 gap-2 border-t border-border p-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
          <button type="button" onClick={() => onOpenChange(false)} className="h-11 rounded-full border border-border text-sm font-medium hover-elevate" data-testid="button-pdf-preview-edit">Keep editing</button>
          <button type="button" onClick={() => { onOpenChange(false); onSend(); }} className="h-11 rounded-full taxi-sign text-sm font-semibold inline-flex items-center justify-center gap-1.5 hover-elevate" data-testid="button-pdf-preview-send"><Share2 className="h-4 w-4" />Share PDF</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
