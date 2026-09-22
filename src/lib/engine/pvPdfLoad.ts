'use client';

/**
 * An uploaded PDF → positioned text, page by page, for pvPdfParse.ts.
 *
 * pdf.js (Mozilla's PDF reader, the one inside Firefox) is loaded only when
 * someone actually uploads a PDF, and its worker is bundled with the app —
 * nothing is fetched from elsewhere. It only READS the text layer; a scanned
 * page has none and is refused by the parser for want of headings.
 */
import type { TextItem } from '@/lib/engine/pvPdfParse';

export async function pdfPages(file: File): Promise<{ file: string; items: TextItem[] }[]> {
  const pdfjs = await import('pdfjs-dist');
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
  }
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data, verbosity: 0 }).promise;
  const out: { file: string; items: TextItem[] }[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      const items: TextItem[] = [];
      for (const it of tc.items) {
        if (!('str' in it) || !it.str.trim()) continue;
        // y measured from the TOP, as the page reads.
        items.push({ str: it.str, x: it.transform[4], y: vp.height - it.transform[5], w: it.width });
      }
      out.push({ file: doc.numPages > 1 ? `${file.name} (page ${n})` : file.name, items });
    }
  } finally {
    void doc.destroy();
  }
  return out;
}
