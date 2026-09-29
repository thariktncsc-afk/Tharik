/**
 * Reading a photo of a POS screen or the FPS Allocation Report (office,
 * 2026-09-29) — server only.
 *
 * One photo per request, sent to Anthropic's Messages API with ONE tool the
 * model must answer through, so what comes back is a transcription in a fixed
 * shape: labels as printed (Tamil or English) and the figures. It is told to
 * copy, never to total, correct or guess. Which of our fields a label is gets
 * decided afterwards in src/lib/engine/photoExtract.ts, in code.
 *
 * The key is ANTHROPIC_API_KEY (server env only — .env.local and Vercel);
 * ANTHROPIC_OCR_MODEL overrides the model. Nothing is stored: the photo goes
 * to the API and the transcription back to the browser, which shows it as a
 * draft in the fields until the clerk presses Save.
 */
import type { AllotTranscript, CardTranscript } from '@/lib/engine/photoExtract';

export type OcrKind = 'cards' | 'allot';
export const OCR_KINDS: readonly OcrKind[] = ['cards', 'allot'];
export const OCR_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
/** The browser sends the photo already scaled down (≤ 2000 px); this is ~3.7 MB of JPEG. */
export const OCR_MAX_BASE64 = 5_000_000;
export const OCR_DEFAULT_MODEL = 'claude-sonnet-5-5';
const API_URL = 'https://api.anthropic.com/v1/messages';

const COMMON =
  'You transcribe photographs of Tamil Nadu public-distribution (ration shop) screens and reports for data entry. ' +
  'Copy exactly what is printed. Never add up, correct, round or guess a figure: if a figure or label cannot be read with confidence, leave that row or cell out. ' +
  'Labels may be Tamil or English — copy them as shown, Tamil in Tamil script. Numbers are digits only, without thousands separators; keep printed decimals. ' +
  'Answer only through the tool.';

const TOOLS = {
  cards: {
    name: 'record_card_details',
    description: 'Record the card-type rows visible in the photo.',
    input_schema: {
      type: 'object',
      properties: {
        rows: {
          type: 'array',
          description: 'One entry per card-type row visible, in the order shown. Do not include the total line here.',
          items: {
            type: 'object',
            properties: {
              rowNo: { type: ['integer', 'null'], description: 'The row serial number printed beside it, if any.' },
              label: { type: 'string', description: 'The card type exactly as printed, e.g. "அரிசி அட்டை", "LOF அரிசி அட்டை", "AAY அட்டை".' },
              count: { type: 'integer', description: 'The count printed for that card type.' },
            },
            required: ['label', 'count'],
          },
        },
        totalShown: { type: ['integer', 'null'], description: 'The total number of cards the screen prints (e.g. beside "மொத்த அட்டைகள்"), or null if not visible.' },
      },
      required: ['rows'],
    },
  },
  allot: {
    name: 'record_allotment',
    description: 'Record the allotment figures visible in the photo.',
    input_schema: {
      type: 'object',
      properties: {
        layout: { type: 'string', enum: ['fps_report', 'pos_screen', 'other'], description: 'fps_report: a table with one row per shop (FPS Code, FPS Name, one column per commodity). pos_screen: one shop\'s commodity list.' },
        month: { type: ['string', 'null'], description: 'The month the report or screen says it is for, as printed (e.g. "SEP"), or null.' },
        year: { type: ['integer', 'null'], description: 'The year it says it is for, or null.' },
        rows: {
          type: 'array',
          description: 'fps_report: one entry per shop row visible. pos_screen: a single entry with fpsCode/fpsName null unless printed.',
          items: {
            type: 'object',
            properties: {
              fpsCode: { type: ['string', 'null'], description: 'e.g. "22EA007PN", or null.' },
              fpsName: { type: ['string', 'null'], description: 'e.g. "Tncsc Crs 8", or null.' },
              cells: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    column: { type: 'string', description: 'The commodity heading or label exactly as printed, including any unit, e.g. "Rice (kg)", "PalmOil (Pkt)", "Police Rice (kg)", "துவரம் பருப்பு".' },
                    value: { type: 'number', description: 'The quantity printed for it.' },
                  },
                  required: ['column', 'value'],
                },
              },
            },
            required: ['cells'],
          },
        },
      },
      required: ['layout', 'rows'],
    },
  },
} as const;

const PROMPT: Record<OcrKind, string> = {
  cards:
    'This photo should show a POS "அட்டை விவரங்கள்" (card details) screen or a similar card report: rows of card type and card count, and possibly a total (மொத்த அட்டைகள்). ' +
    'Record every card-type row you can read, and the total if it is printed. Ignore anything else on the screen (beneficiary counts, phone numbers, footers).',
  allot:
    'This photo should show either an FPS Allocation Report — a table with one row per shop (FPS Code, FPS Name, then one column per commodity; the headings may be printed sideways) — or one shop\'s allotment on a POS screen. ' +
    'For a report, record EVERY shop row you can read, each with every commodity column heading as printed (with its unit) and that row\'s value; include police columns too. Record the month and year the report states.',
};

export function buildOcrRequest(kind: OcrKind, image: { mediaType: string; data: string }, model = OCR_DEFAULT_MODEL) {
  const tool = TOOLS[kind];
  return {
    model,
    max_tokens: 4096,
    system: COMMON,
    tools: [tool],
    tool_choice: { type: 'tool', name: tool.name },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } },
          { type: 'text', text: PROMPT[kind] },
        ],
      },
    ],
  };
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : v === null || v === undefined ? null : String(v).trim());
const num = (v: unknown) => {
  if (v === null || v === undefined || String(v).trim() === '') return null; // absent is not 0
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

/** The tool call's input, checked into the shape photoExtract expects. Anything else is dropped. */
export function parseOcrResponse(kind: OcrKind, body: unknown): CardTranscript | AllotTranscript | null {
  const content = (body as { content?: unknown })?.content;
  if (!Array.isArray(content)) return null;
  const call = content.find((b) => b && b.type === 'tool_use' && b.name === TOOLS[kind].name);
  const input = call?.input as Record<string, unknown> | undefined;
  if (!input || !Array.isArray(input.rows)) return null;
  if (kind === 'cards') {
    const rows = (input.rows as Record<string, unknown>[])
      .map((r) => ({ label: str(r?.label) ?? '', count: num(r?.count), rowNo: num(r?.rowNo) }))
      .filter((r): r is { label: string; count: number; rowNo: number | null } => !!r.label && r.count !== null);
    return { rows, totalShown: num(input.totalShown) };
  }
  const layout = ['fps_report', 'pos_screen'].includes(String(input.layout)) ? (input.layout as AllotTranscript['layout']) : 'other';
  const rows = (input.rows as Record<string, unknown>[]).map((r) => ({
    fpsCode: str(r?.fpsCode) || null,
    fpsName: str(r?.fpsName) || null,
    cells: (Array.isArray(r?.cells) ? (r.cells as Record<string, unknown>[]) : [])
      .map((c) => ({ column: str(c?.column) ?? '', value: num(c?.value) }))
      .filter((c): c is { column: string; value: number } => !!c.column && c.value !== null),
  }));
  return { layout, month: str(input.month) || null, year: num(input.year), rows };
}

export type OcrOutcome = { ok: true; transcript: CardTranscript | AllotTranscript } | { ok: false; status: number; error: string };

/** One photo → its transcription. `fetchImpl` is for the verify script. */
export async function readPhoto(
  kind: OcrKind,
  image: { mediaType: string; data: string },
  env: { key?: string; model?: string } = { key: process.env.ANTHROPIC_API_KEY, model: process.env.ANTHROPIC_OCR_MODEL },
  fetchImpl: typeof fetch = fetch,
): Promise<OcrOutcome> {
  if (!env.key) return { ok: false, status: 503, error: 'Reading photos is not set up on this server yet (ANTHROPIC_API_KEY). Enter the figures by hand for now.' };
  let r: Response;
  try {
    r = await fetchImpl(API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': env.key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(buildOcrRequest(kind, image, env.model || OCR_DEFAULT_MODEL)),
      signal: AbortSignal.timeout(50_000),
    });
  } catch (err) {
    const timeout = err instanceof Error && /timeout|abort/i.test(err.name + err.message);
    return { ok: false, status: 504, error: timeout ? 'Reading the photo took too long. Try again, or a clearer photo.' : 'Could not reach the photo reader. Check the connection and try again.' };
  }
  const body = await r.json().catch(() => null);
  if (!r.ok) {
    if (r.status === 401 || r.status === 403) return { ok: false, status: 502, error: 'The photo reader refused this server\'s key. An administrator needs to check ANTHROPIC_API_KEY.' };
    if (r.status === 429 || r.status === 529 || r.status >= 500) return { ok: false, status: 503, error: 'The photo reader is busy. Try again in a minute.' };
    if (r.status === 400 || r.status === 413) return { ok: false, status: 422, error: 'This photo could not be read. Try a JPG or PNG photo taken straight on.' };
    return { ok: false, status: 502, error: `The photo reader answered ${r.status}.` };
  }
  const transcript = parseOcrResponse(kind, body);
  if (!transcript) return { ok: false, status: 502, error: 'The photo reader gave no figures for this photo.' };
  return { ok: true, transcript };
}
