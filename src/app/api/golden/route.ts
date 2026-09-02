/**
 * Development-only sink for the golden-snapshot harness.
 *
 * The Next.js conversion (branch next-conversion) must reproduce every
 * statement byte-for-byte. The harness drives the CURRENT engine in the
 * browser — stmtGetData() + buildSectionHTML() per shop per section — and
 * POSTs the rendered HTML here, which files it under golden/statements/.
 * Those files are the regression baseline the converted app is diffed against.
 *
 * Refuses to exist in production; it writes to the repo checkout.
 */
import { NextResponse } from 'next/server';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production.' }, { status: 404 });
  }

  let body: { snapshots?: { name: string; html: string }[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const snaps = body.snapshots ?? [];
  const dir = join(process.cwd(), 'golden', 'statements');
  mkdirSync(dir, { recursive: true });

  let written = 0;
  for (const s of snaps) {
    if (!s || typeof s.name !== 'string' || typeof s.html !== 'string') continue;
    const safe = s.name.replace(/[^a-z0-9_-]/gi, '_');
    writeFileSync(join(dir, `${safe}.html`), s.html, 'utf8');
    written++;
  }
  return NextResponse.json({ ok: true, written });
}
