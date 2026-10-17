/**
 * Payment Management — what /api/payment-management/** does, against a small
 * store interface, so the same handlers run on Supabase (storageStore.ts, the
 * routes) and on an in-memory store (tools/verify-payment-mgmt.mjs).
 *
 * Each handler answers `{ status, body }`; the route turns that into a
 * response. EVERY administrator's handler checks the role itself — a route
 * forgetting to would still be refused here. A shop user's shop comes from
 * their session only, never from what the browser sends.
 *
 * The rules are core.ts's. No next/* or supabase import here: delivery of a
 * reminder, the activity log and the clock come in as `deps`.
 */
import {
  MAX_SOUNDS,
  PAYEE_MAX,
  REFERENCE_MAX,
  TITLE_MAX,
  VOID_REASON_MAX,
  acknowledgedDraft,
  assetPath,
  balanceOf,
  buildLinks,
  canFetchAsset,
  cleanName,
  cleanText,
  createdDraft,
  deletedDraft,
  dueBelowPaidSentence,
  duplicateSentence,
  emptyMedia,
  fullyPaidSentence,
  isAdmin,
  mediaCheck,
  mediaDraft,
  mediaUrl,
  mineLists,
  newId,
  newObligationInput,
  obligationId,
  overBalanceSentence,
  overlapOf,
  overlapSentence,
  paidOf,
  parseRupees,
  paymentCorrectedDraft,
  paymentInput,
  paymentRecordedDraft,
  paymentVoidedDraft,
  reminderDetails,
  reminderLink,
  reminderMessage,
  reminderSentDraft,
  reminderTitle,
  toView,
  upiDraft,
  updatedDraft,
  validCrs,
  validObligationId,
  viewOrder,
  type PmActorSession,
  type Refusal,
} from './core';
import { formatRupees } from '@/lib/payments/pricing';
import { looksLikeVpa } from '@/lib/payments/upi';
import type { ActivityDraft } from '@/lib/activityLog/core';
import type { Detail } from '@/lib/notify/core';
import type { PmAsset, PmMedia, PmObligation, PmPayment, PmPaymentFields, PmReminder, PmUpiConfig, PmView } from './types';

export type Actor = PmActorSession;

export type Stored = { ob: PmObligation; version: number };

/** A change under the record's version: the next record, or an answer that stops it (read fresh, so it is never stale). */
export type Step<T> = { next: T } | { stop: Answer };

export type PmStore = {
  /** Every obligation of every shop. */
  listObligations(): Promise<Stored[]>;
  /** One shop's obligations only (by the record's own crsId). */
  listShop(crsId: number): Promise<Stored[]>;
  getObligation(id: string): Promise<Stored | null>;
  /** A new record; null when that id already exists (one Monthly / PV / Previous Balance per shop and month). */
  insertObligation(ob: PmObligation, by: string): Promise<Stored | null>;
  /** Read → fn → write only if nobody wrote in between (else read again). Null when the record is gone. */
  changeObligation(id: string, by: string, fn: (cur: PmObligation) => Step<PmObligation>): Promise<Stored | { stop: Answer } | null>;
  /** Removes it if `guard` (on the fresh record) says nothing against it. */
  removeObligation(id: string, guard: (cur: PmObligation) => Answer | null): Promise<'removed' | 'gone' | { stop: Answer }>;
  getMedia(): Promise<PmMedia>;
  changeMedia(by: string, fn: (cur: PmMedia) => Step<PmMedia>): Promise<PmMedia | { stop: Answer }>;
  putFile(path: string, bytes: Uint8Array, mime: string): Promise<void>;
  removeFile(path: string): Promise<void>;
  readFile(path: string): Promise<Uint8Array | null>;
  /** The office's UPI ID and payee name (payment_settings id 1); null when that table or row is missing. */
  getUpi(): Promise<PmUpiConfig | null>;
  /** Writes ONLY the UPI ID and payee name. Throws `{ status: 503 }` when payment_settings is missing. */
  setUpi(upi: PmUpiConfig, by: string): Promise<void>;
};

export type Answer = { status: number; body: Record<string, unknown> };
const fail = (status: number, error: string): Answer => ({ status, body: { error } });
const refused = (r: Refusal): Answer => fail(r.status, r.error);
const ok = (body: Record<string, unknown>): Answer => ({ status: 200, body });

export type NotifyInput = {
  sender: { userId: number | null; name: string; role: string; crsId: number | null };
  crsId: number;
  title: string;
  message: string;
  details: Detail[];
  link: string;
  obligationId: string;
};

export type Deps = {
  /** Delivers a reminder to that shop's own active staff. Throws `{ status, message }` when it cannot. */
  notifyShop(input: NotifyInput): Promise<{ notificationId: number | null; recipients: number }>;
  /** Never throws. */
  recordActivity(drafts: ActivityDraft[]): void | Promise<void>;
  /** OK pressed: the person's own copy of the notification is acknowledged too. Failures are ignored. */
  ackNotification(userId: number, notificationId: number): Promise<void>;
  /** Today in India, ISO YYYY-MM-DD. */
  today(): string;
  /** Now, ISO timestamp. */
  now(): string;
  shopName(crsId: number): string;
};

const NOT_SIGNED_IN = 'Not signed in.';
const ADMINS_ONLY = 'Payment Management is for administrators only.';
const SHOPS_ONLY = 'For shop users.';
const NOT_FOUND = 'That payment record was not found (it may have been deleted).';

/** Administrators only — every handler below that changes or lists money starts here. */
function adminGate(a: Actor | null): Answer | null {
  if (!a) return fail(401, NOT_SIGNED_IN);
  if (!isAdmin(a)) return fail(403, ADMINS_ONLY);
  return null;
}

const byName = (a: Actor) => a.name || 'Administrator';
const stamp = (a: Actor, at: string) => ({ by: Number.isInteger(a.userId) ? a.userId : null, byName: byName(a), at });
const isStop = <T>(x: T | { stop: Answer }): x is { stop: Answer } => !!x && typeof x === 'object' && 'stop' in (x as object);
const view = (deps: Deps, s: Stored): PmView => toView(s.ob, s.version, deps.shopName(s.ob.crsId));

async function log(deps: Deps, drafts: (ActivityDraft | null)[]) {
  const d = drafts.filter((x): x is ActivityDraft => !!x);
  if (d.length) await deps.recordActivity(d);
}

// ── Obligations ─────────────────────────────────────────────────────────────

/** GET /obligations — every shop's (the screen filters). */
export async function listObligations(store: PmStore, deps: Deps, a: Actor | null): Promise<Answer> {
  const g = adminGate(a);
  if (g) return g;
  const rows = await store.listObligations();
  const obligations = rows.sort((x, y) => viewOrder(x.ob, y.ob)).map((s) => view(deps, s));
  return ok({ obligations });
}

/** POST /obligations — a new obligation, with any money already received as its first payment. */
export async function createObligation(store: PmStore, deps: Deps, a: Actor | null, body: unknown): Promise<Answer> {
  const g = adminGate(a);
  if (g) return g;
  const v = newObligationInput(body, deps.today());
  if ('error' in v) return refused(v);
  const f = v.fields;
  const now = deps.now();
  const who = stamp(a!, now);
  const payments: PmPayment[] = f.initial ? [{ ...f.initial, id: newId('p'), at: now, by: who.by, byName: who.byName, edits: [], voided: null }] : [];
  const ob: PmObligation = {
    id: obligationId(f.crsId, f.year, f.month, f.type),
    crsId: f.crsId,
    month: f.month,
    year: f.year,
    type: f.type,
    title: f.title,
    reference: f.reference,
    duePaise: f.duePaise,
    payments,
    reminders: [],
    createdAt: now,
    createdBy: who.by,
    createdByName: who.byName,
    updatedAt: now,
    updatedBy: who.by,
    updatedByName: who.byName,
  };
  // A part already billed for this shop-month (a Monthly Statement, and now
  // "Monthly + PV"): refused, so nothing is billed twice.
  const clash = overlapOf((await store.listShop(f.crsId)).map((s) => s.ob), ob);
  if (clash) return fail(409, overlapSentence(ob, clash));
  const saved = await store.insertObligation(ob, byName(a!));
  if (!saved) return fail(409, duplicateSentence(ob));
  await log(deps, [createdDraft(saved.ob), f.initial ? paymentRecordedDraft(saved.ob, f.initial) : null]);
  return ok({ obligation: view(deps, saved) });
}

/** PATCH /obligations/<id> — the amount due, the reference and (Other) the title. */
export async function updateObligation(store: PmStore, deps: Deps, a: Actor | null, id: string, body: unknown): Promise<Answer> {
  const g = adminGate(a);
  if (g) return g;
  if (!validObligationId(id)) return fail(404, NOT_FOUND);
  const b = (body ?? {}) as Record<string, unknown>;
  const has = (k: string) => b[k] !== undefined && b[k] !== null;
  if (!has('dueRupees') && !has('reference') && !has('title')) return fail(400, 'Nothing to change.');

  let due: number | null = null;
  if (has('dueRupees')) {
    due = parseRupees(b.dueRupees);
    if (due === null) return fail(400, 'Enter the total amount due in rupees, for example 350 or 350.50.');
    if (due <= 0) return fail(400, 'The amount due must be more than ₹0.00.');
  }
  const reference = has('reference') ? cleanText(b.reference, REFERENCE_MAX) : undefined;
  if (reference === null) return fail(400, `The reference may be at most ${REFERENCE_MAX} characters.`);
  const title = has('title') ? cleanText(b.title, TITLE_MAX) : undefined;
  if (title === null) return fail(400, `The title may be at most ${TITLE_MAX} characters.`);

  // Set inside the change (read fresh there); `as` keeps TypeScript from narrowing it to null.
  let before = null as PmObligation | null;
  const r = await store.changeObligation(id, byName(a!), (cur) => {
    before = cur;
    const next: PmObligation = { ...cur };
    if (due !== null) {
      const paid = paidOf(cur);
      if (due < paid) return { stop: fail(409, dueBelowPaidSentence(paid)) };
      next.duePaise = due;
    }
    if (reference !== undefined) next.reference = reference;
    // Only an Other obligation has a title; the others are named by their type.
    if (title !== undefined && cur.type === 'other') {
      if (!title) return { stop: fail(400, 'Say what the Other payment is for (the title).') };
      next.title = title;
    }
    if (next.duePaise === cur.duePaise && next.reference === cur.reference && next.title === cur.title) return { stop: { status: 200, body: { unchanged: true } } };
    const who = stamp(a!, deps.now());
    return { next: { ...next, updatedAt: who.at, updatedBy: who.by, updatedByName: who.byName } };
  });
  if (!r) return fail(404, NOT_FOUND);
  if (isStop(r)) {
    if (r.stop.status !== 200) return r.stop;
    const cur = await store.getObligation(id);
    return cur ? ok({ obligation: view(deps, cur) }) : fail(404, NOT_FOUND);
  }
  await log(deps, [updatedDraft(before!, r.ob)]);
  return ok({ obligation: view(deps, r) });
}

/** DELETE /obligations/<id> — only while nothing has happened on it: no payment (voided ones included) and no reminder. */
export async function deleteObligation(store: PmStore, deps: Deps, a: Actor | null, id: string): Promise<Answer> {
  const g = adminGate(a);
  if (g) return g;
  if (!validObligationId(id)) return fail(404, NOT_FOUND);
  let removed = null as PmObligation | null;
  const r = await store.removeObligation(id, (cur) => {
    removed = cur;
    if (cur.payments.length) return fail(409, 'Payments are recorded on it, so it cannot be deleted. Void a payment entered in error instead.');
    if (cur.reminders.length) return fail(409, 'A reminder has been sent for it, so it cannot be deleted.');
    return null;
  });
  if (r === 'gone') return fail(404, NOT_FOUND);
  if (r !== 'removed') return r.stop;
  await log(deps, [deletedDraft(removed!)]);
  return ok({ ok: true });
}

// ── Payments ────────────────────────────────────────────────────────────────

/** POST /obligations/<id>/payments — one more entry; never more than what is outstanding. */
export async function recordPayment(store: PmStore, deps: Deps, a: Actor | null, id: string, body: unknown): Promise<Answer> {
  const g = adminGate(a);
  if (g) return g;
  if (!validObligationId(id)) return fail(404, NOT_FOUND);
  const v = paymentInput(body, deps.today());
  if ('error' in v) return refused(v);
  const r = await store.changeObligation(id, byName(a!), (cur) => {
    const balance = balanceOf(cur);
    if (balance === 0) return { stop: fail(409, fullyPaidSentence(cur)) };
    if (v.fields.amountPaise > balance) return { stop: fail(409, overBalanceSentence(balance)) };
    const who = stamp(a!, deps.now());
    const p: PmPayment = { ...v.fields, id: newId('p'), at: who.at, by: who.by, byName: who.byName, edits: [], voided: null };
    return { next: { ...cur, payments: [...cur.payments, p], updatedAt: who.at, updatedBy: who.by, updatedByName: who.byName } };
  });
  if (!r) return fail(404, NOT_FOUND);
  if (isStop(r)) return r.stop;
  await log(deps, [paymentRecordedDraft(r.ob, v.fields)]);
  return ok({ obligation: view(deps, r) });
}

/**
 * PATCH /obligations/<id>/payments/<pid> — correct an entry (it keeps what it
 * replaced) or void it (kept, with the reason). Neither removes anything.
 */
export async function changePayment(store: PmStore, deps: Deps, a: Actor | null, id: string, paymentId: string, body: unknown): Promise<Answer> {
  const g = adminGate(a);
  if (g) return g;
  if (!validObligationId(id)) return fail(404, NOT_FOUND);
  const b = (body ?? {}) as Record<string, unknown>;
  const gone = fail(404, 'That payment is not recorded on this obligation.');

  if (b.action === 'void') {
    const reason = cleanText(b.reason, VOID_REASON_MAX);
    if (reason === null) return fail(400, `The reason may be at most ${VOID_REASON_MAX} characters.`);
    if (!reason) return fail(400, 'Say why the payment is being voided.');
    let voided = null as PmPaymentFields | null;
    const r = await store.changeObligation(id, byName(a!), (cur) => {
      const p = cur.payments.find((x) => x.id === paymentId);
      if (!p) return { stop: gone };
      if (p.voided) return { stop: fail(409, 'That payment is already voided.') };
      const who = stamp(a!, deps.now());
      voided = { date: p.date, amountPaise: p.amountPaise, method: p.method, utr: p.utr, remarks: p.remarks };
      const payments = cur.payments.map((x) => (x.id === paymentId ? { ...x, voided: { at: who.at, by: who.by, byName: who.byName, reason } } : x));
      return { next: { ...cur, payments, updatedAt: who.at, updatedBy: who.by, updatedByName: who.byName } };
    });
    if (!r) return fail(404, NOT_FOUND);
    if (isStop(r)) return r.stop;
    await log(deps, [paymentVoidedDraft(r.ob, voided!, reason)]);
    return ok({ obligation: view(deps, r) });
  }

  if (b.action !== 'correct') return fail(400, 'Say whether the payment is corrected or voided.');
  const v = paymentInput(b, deps.today());
  if ('error' in v) return refused(v);
  let before = null as PmPaymentFields | null;
  const r = await store.changeObligation(id, byName(a!), (cur) => {
    const p = cur.payments.find((x) => x.id === paymentId);
    if (!p) return { stop: gone };
    if (p.voided) return { stop: fail(409, 'A voided payment cannot be corrected.') };
    const old: PmPaymentFields = { date: p.date, amountPaise: p.amountPaise, method: p.method, utr: p.utr, remarks: p.remarks };
    const nu = v.fields;
    if (old.date === nu.date && old.amountPaise === nu.amountPaise && old.method === nu.method && old.utr === nu.utr && old.remarks === nu.remarks) {
      return { stop: { status: 200, body: { unchanged: true } } };
    }
    // This entry may grow only into what is still outstanding.
    const room = balanceOf(cur) + p.amountPaise;
    if (nu.amountPaise > room) return { stop: fail(409, `The payments would then be more than the ${formatRupees(cur.duePaise)} due — this entry can be at most ${formatRupees(room)}.`) };
    before = old;
    const who = stamp(a!, deps.now());
    const payments = cur.payments.map((x) =>
      x.id === paymentId ? { ...x, ...nu, edits: [...x.edits, { at: who.at, by: who.by, byName: who.byName, before: old }] } : x,
    );
    return { next: { ...cur, payments, updatedAt: who.at, updatedBy: who.by, updatedByName: who.byName } };
  });
  if (!r) return fail(404, NOT_FOUND);
  if (isStop(r)) {
    if (r.stop.status !== 200) return r.stop;
    const cur = await store.getObligation(id);
    return cur ? ok({ obligation: view(deps, cur) }) : fail(404, NOT_FOUND);
  }
  await log(deps, [paymentCorrectedDraft(r.ob, before!, v.fields)]);
  return ok({ obligation: view(deps, r) });
}

// ── Reminders ───────────────────────────────────────────────────────────────

/**
 * POST /obligations/<id>/remind — one reminder to THAT shop's own staff. Sent
 * first, then recorded with its notification id; each send is a new reminder
 * carrying the figures it was sent with. Payments are never touched.
 */
export async function sendReminder(store: PmStore, deps: Deps, a: Actor | null, id: string): Promise<Answer> {
  const g = adminGate(a);
  if (g) return g;
  if (!validObligationId(id)) return fail(404, NOT_FOUND);
  const got = await store.getObligation(id);
  if (!got) return fail(404, NOT_FOUND);
  const ob = got.ob;
  const balance = balanceOf(ob);
  if (balance === 0) return fail(409, fullyPaidSentence(ob));

  let sent: { notificationId: number | null; recipients: number };
  try {
    sent = await deps.notifyShop({
      sender: { userId: Number.isInteger(a!.userId) ? a!.userId : null, name: byName(a!), role: a!.role, crsId: null },
      crsId: ob.crsId,
      title: reminderTitle(ob.crsId),
      message: reminderMessage(ob),
      details: reminderDetails(ob),
      link: reminderLink(ob.id),
      obligationId: ob.id,
    });
  } catch (e) {
    const err = e as { status?: number; message?: string };
    if (err?.status === 400 || err?.status === 503) return fail(err.status, String(err.message ?? 'The reminder could not be sent.'));
    console.error('[payment-management] reminder not sent:', err?.message ?? e);
    return fail(500, 'Unable to send the reminder. Please try again.');
  }

  const who = stamp(a!, deps.now());
  const reminder: PmReminder = {
    id: newId('r'),
    at: who.at,
    by: who.by,
    byName: who.byName,
    duePaise: ob.duePaise,
    paidPaise: paidOf(ob),
    balancePaise: balance,
    notificationId: sent.notificationId,
    recipients: sent.recipients,
    ackAt: null,
    ackBy: null,
    ackName: null,
  };
  let r: Stored | { stop: Answer } | null = null;
  let why = 'the obligation is no longer saved';
  try {
    r = await store.changeObligation(id, byName(a!), (cur) => ({ next: { ...cur, reminders: [...cur.reminders, reminder] } }));
  } catch (e) {
    why = e instanceof Error ? e.message : String(e);
  }
  if (!r || isStop(r)) {
    // It reached the shop but is not on the record: whoever maintains the system must be able to see that.
    console.error(`[payment-management] reminder ${reminder.id} REACHED CRS ${ob.crsId} (notification ${sent.notificationId}) but was not recorded on ${ob.id}: ${why}`);
    return fail(500, `The reminder reached CRS ${ob.crsId}, but it could not be recorded here. Please refresh before sending another.`);
  }
  await log(deps, [reminderSentDraft(r.ob, reminder)]);
  return ok({ obligation: view(deps, r), reminder });
}

// ── Settings: UPI ID, QR image, reminder sound ─────────────────────────────

const SAMPLE_PAISE = 100;

async function settingsBody(store: PmStore): Promise<Record<string, unknown>> {
  const [upi, media] = await Promise.all([store.getUpi(), store.getMedia()]);
  return { upi, media, sampleLinks: buildLinks(upi, SAMPLE_PAISE, 'TNCSC-TEST', 'Test payment') };
}

/** GET /settings */
export async function getSettings(store: PmStore, _deps: Deps, a: Actor | null): Promise<Answer> {
  const g = adminGate(a);
  if (g) return g;
  return ok(await settingsBody(store));
}

/**
 * PUT /settings — ONLY the UPI ID and the payee name. The same payment_settings
 * row the paid downloads use: the tariff and the charging switch are not
 * touched. An empty UPI ID is refused, because it would make every paid
 * download free.
 */
export async function saveUpi(store: PmStore, deps: Deps, a: Actor | null, body: unknown): Promise<Answer> {
  const g = adminGate(a);
  if (g) return g;
  const b = (body ?? {}) as Record<string, unknown>;
  const vpa = String(b.vpa ?? '').trim();
  if (!vpa) return fail(400, 'Enter the office UPI ID (for example office@okaxis). It cannot be left empty: paid downloads use it too.');
  if (!looksLikeVpa(vpa)) return fail(400, 'That is not a valid UPI ID. It looks like name@bank, for example office@okaxis.');
  const payeeName = cleanText(b.payeeName, PAYEE_MAX);
  if (payeeName === null) return fail(400, `The payee name may be at most ${PAYEE_MAX} characters.`);
  const before = await store.getUpi();
  const next = { vpa, payeeName };
  if (before?.vpa !== next.vpa || before?.payeeName !== next.payeeName) {
    await store.setUpi(next, byName(a!));
    await log(deps, [upiDraft(before, next)]);
  }
  return ok(await settingsBody(store));
}

/**
 * POST /media?kind=qr|sound&name=… — the file itself as the body. What it is
 * comes from its own bytes; a QR upload replaces the previous QR (its file is
 * removed once the record no longer names it).
 */
export async function uploadMedia(store: PmStore, deps: Deps, a: Actor | null, req: { kind: unknown; name: unknown; bytes: Uint8Array }): Promise<Answer> {
  const g = adminGate(a);
  if (g) return g;
  const kind = req.kind === 'qr' || req.kind === 'sound' ? req.kind : null;
  if (!kind) return fail(400, 'Say whether the file is the QR image or a reminder sound.');
  const c = mediaCheck(kind, req.bytes);
  if ('error' in c) return refused(c);
  const who = stamp(a!, deps.now());
  const asset: PmAsset = {
    id: newId('a'),
    kind,
    name: cleanName(req.name) || (kind === 'qr' ? 'UPI QR' : 'Reminder sound'),
    mime: c.mime,
    size: req.bytes.length,
    at: who.at,
    by: who.by,
    byName: who.byName,
  };
  if (kind === 'sound') {
    const cur = await store.getMedia();
    if (cur.sounds.length >= MAX_SOUNDS) return fail(409, `At most ${MAX_SOUNDS} sounds are kept — remove one first.`);
  }
  const path = assetPath(asset);
  await store.putFile(path, req.bytes, asset.mime);
  let oldQr = null as PmAsset | null;
  let media: PmMedia | { stop: Answer };
  try {
    media = await store.changeMedia(byName(a!), (cur) => {
      if (kind === 'qr') {
        oldQr = cur.qr;
        return { next: { ...cur, qr: asset } };
      }
      if (cur.sounds.length >= MAX_SOUNDS) return { stop: fail(409, `At most ${MAX_SOUNDS} sounds are kept — remove one first.`) };
      return { next: { ...cur, sounds: [...cur.sounds, asset] } };
    });
  } catch (e) {
    // The record does not name it: the file must not linger unlisted.
    await store.removeFile(path).catch(() => undefined);
    throw e;
  }
  if (isStop(media)) {
    await store.removeFile(path).catch(() => undefined);
    return media.stop;
  }
  const replaced = oldQr;
  if (replaced) await dropFile(store, replaced);
  await log(deps, [kind === 'qr' ? mediaDraft(replaced ? 'qr-replaced' : 'qr-uploaded', asset, replaced) : mediaDraft('sound-uploaded', asset)]);
  return ok({ media });
}

/** A file the record no longer names: removed; one left behind is only disk space. */
async function dropFile(store: PmStore, asset: PmAsset) {
  try {
    await store.removeFile(assetPath(asset));
  } catch (e) {
    console.error('[payment-management] leftover file not removed:', assetPath(asset), e instanceof Error ? e.message : e);
  }
}

/** PATCH /media { activeSoundId } — which uploaded sound the shops hear; null = the plain beep. */
export async function setActiveSound(store: PmStore, deps: Deps, a: Actor | null, body: unknown): Promise<Answer> {
  const g = adminGate(a);
  if (g) return g;
  const raw = (body ?? {}) as Record<string, unknown>;
  if (!('activeSoundId' in raw)) return fail(400, 'Choose the sound.');
  const want = raw.activeSoundId == null || raw.activeSoundId === '' ? null : String(raw.activeSoundId);
  let before = null as PmAsset | null;
  let after = null as PmAsset | null;
  let changed = false as boolean;
  const media = await store.changeMedia(byName(a!), (cur) => {
    after = want ? (cur.sounds.find((s) => s.id === want) ?? null) : null;
    if (want && !after) return { stop: fail(404, 'That sound is no longer uploaded.') };
    before = cur.sounds.find((s) => s.id === cur.activeSoundId) ?? null;
    if (cur.activeSoundId === want) return { stop: { status: 200, body: {} } };
    changed = true;
    return { next: { ...cur, activeSoundId: want } };
  });
  if (isStop(media)) {
    if (media.stop.status !== 200) return media.stop;
    return ok({ media: await store.getMedia() });
  }
  if (changed) await log(deps, [mediaDraft('sound-active', after, before)]);
  return ok({ media });
}

/** DELETE /media/<id> — the QR image, or a sound that is not the active one. The record first, then the file. */
export async function removeMedia(store: PmStore, deps: Deps, a: Actor | null, assetId: string): Promise<Answer> {
  const g = adminGate(a);
  if (g) return g;
  let gone = null as PmAsset | null;
  const media = await store.changeMedia(byName(a!), (cur) => {
    if (cur.qr?.id === assetId) {
      gone = cur.qr;
      return { next: { ...cur, qr: null } };
    }
    const s = cur.sounds.find((x) => x.id === assetId);
    if (!s) return { stop: fail(404, 'That file is not uploaded (it may already have been removed).') };
    if (cur.activeSoundId === assetId) return { stop: fail(409, 'Choose another active sound first.') };
    gone = s;
    return { next: { ...cur, sounds: cur.sounds.filter((x) => x.id !== assetId) } };
  });
  if (isStop(media)) return media.stop;
  const removed = gone;
  if (removed) {
    await dropFile(store, removed);
    await log(deps, [mediaDraft(removed.kind === 'qr' ? 'qr-removed' : 'sound-removed', removed)]);
  }
  return ok({ media });
}

/**
 * GET /media/<id> — the file's bytes. Administrators: any uploaded file. A
 * shop: only the current QR and the active sound; anything else answers as if
 * it did not exist.
 */
export async function mediaFile(store: PmStore, _deps: Deps, a: Actor | null, assetId: string): Promise<{ status: number; error?: string; mime?: string; bytes?: Uint8Array }> {
  if (!a) return { status: 401, error: NOT_SIGNED_IN };
  const missing = { status: 404, error: 'That file is not available.' };
  const media = await store.getMedia();
  const asset = canFetchAsset(media, String(assetId ?? ''), isAdmin(a));
  if (!asset) return missing;
  const bytes = await store.readFile(assetPath(asset));
  if (!bytes) return missing;
  return { status: 200, mime: asset.mime, bytes };
}

// ── A shop user ─────────────────────────────────────────────────────────────

/** The signed-in shop, from the session only. Null for anyone who is not a shop user. */
function shopOf(a: Actor): number | null {
  const crsId = Number(a.crsId);
  return a.crsId != null && validCrs(crsId) ? crsId : null;
}

/** GET /mine — this shop's reminded obligations, and how to pay. */
export async function mine(store: PmStore, deps: Deps, a: Actor | null): Promise<Answer> {
  if (!a) return fail(401, NOT_SIGNED_IN);
  if (isAdmin(a)) return fail(403, SHOPS_ONLY);
  const crsId = shopOf(a);
  if (crsId === null) return fail(403, 'Your account is not assigned to a CRS shop.');
  // The UPI ID failing to read must not hide the reminder itself: it then shows without links.
  const [rows, upiRow, media] = await Promise.all([store.listShop(crsId), store.getUpi().catch(() => null), store.getMedia()]);
  // The store asked for this shop's records only; checked again here all the same.
  const obs = rows.map((r) => r.ob).filter((o) => o.crsId === crsId);
  const upi = upiRow && upiRow.vpa.trim() ? upiRow : null;
  const { pending, all } = mineLists(obs, upi);
  const active = media.sounds.find((s) => s.id === media.activeSoundId) ?? null;
  return ok({
    crsId,
    shopName: deps.shopName(crsId),
    pending,
    all,
    upi,
    qrUrl: media.qr ? mediaUrl(media.qr.id) : null,
    soundUrl: active ? mediaUrl(active.id) : null,
  });
}

/**
 * POST /mine/ack { obligationId } — OK on the reminder: every reminder of it
 * still waiting is acknowledged by this person (the first OK wins; a second is
 * harmless). Another shop's obligation answers as if it did not exist. No
 * money is touched.
 */
export async function acknowledge(store: PmStore, deps: Deps, a: Actor | null, body: unknown): Promise<Answer> {
  if (!a) return fail(401, NOT_SIGNED_IN);
  if (isAdmin(a)) return fail(403, SHOPS_ONLY);
  const crsId = shopOf(a);
  if (crsId === null) return fail(403, 'Your account is not assigned to a CRS shop.');
  const id = String(((body ?? {}) as Record<string, unknown>).obligationId ?? '');
  const notHere = fail(404, 'That reminder was not found.');
  if (!validObligationId(id)) return notHere;
  const got = await store.getObligation(id);
  if (!got || got.ob.crsId !== crsId) return notHere;

  let stamped: PmReminder[] = [];
  const r = await store.changeObligation(id, a.name || 'shop', (cur) => {
    if (cur.crsId !== crsId) return { stop: notHere };
    const at = deps.now();
    stamped = [];
    const reminders = cur.reminders.map((x) => {
      if (x.ackAt) return x;
      const y = { ...x, ackAt: at, ackBy: Number.isInteger(a.userId) ? a.userId : null, ackName: a.name || '' };
      stamped.push(y);
      return y;
    });
    if (!stamped.length) return { stop: { status: 200, body: { ok: true, acknowledged: 0 } } };
    return { next: { ...cur, reminders } };
  });
  if (!r) return notHere;
  if (isStop(r)) return r.stop;

  for (const x of stamped) {
    if (x.notificationId != null) await deps.ackNotification(a.userId, x.notificationId).catch(() => undefined);
  }
  await log(deps, [acknowledgedDraft(r.ob, stamped.length)]);
  return ok({ ok: true, acknowledged: stamped.length });
}

// ── The in-memory store ─────────────────────────────────────────────────────

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** An in-memory store — the verify script's database. Stores copies, as the database would. */
export function memoryStore(init: { upi?: PmUpiConfig | null; settingsMissing?: boolean } = {}): PmStore & {
  rows: Map<string, Stored>;
  files: Map<string, { bytes: Uint8Array; mime: string }>;
  media: { value: PmMedia; version: number };
  upi: { value: PmUpiConfig | null; missing: boolean; writes: { vpa: string; payeeName: string; by: string }[] };
} {
  const rows = new Map<string, Stored>();
  const files = new Map<string, { bytes: Uint8Array; mime: string }>();
  const media = { value: emptyMedia(), version: 0 };
  const upi = { value: init.upi ?? null, missing: !!init.settingsMissing, writes: [] as { vpa: string; payeeName: string; by: string }[] };
  const copy = (s: Stored): Stored => ({ ob: clone(s.ob), version: s.version });
  return {
    rows,
    files,
    media,
    upi,
    async listObligations() {
      return [...rows.values()].map(copy);
    },
    async listShop(crsId) {
      return [...rows.values()].filter((s) => s.ob.crsId === crsId).map(copy);
    },
    async getObligation(id) {
      const s = rows.get(id);
      return s ? copy(s) : null;
    },
    async insertObligation(ob) {
      if (rows.has(ob.id)) return null;
      rows.set(ob.id, { ob: clone(ob), version: 1 });
      return copy(rows.get(ob.id)!);
    },
    async changeObligation(id, _by, fn) {
      const s = rows.get(id);
      if (!s) return null;
      const step = fn(clone(s.ob));
      if ('stop' in step) return step;
      rows.set(id, { ob: clone(step.next), version: s.version + 1 });
      return copy(rows.get(id)!);
    },
    async removeObligation(id, guard) {
      const s = rows.get(id);
      if (!s) return 'gone';
      const stop = guard(clone(s.ob));
      if (stop) return { stop };
      rows.delete(id);
      return 'removed';
    },
    async getMedia() {
      return clone(media.value);
    },
    async changeMedia(_by, fn) {
      const step = fn(clone(media.value));
      if ('stop' in step) return step;
      media.value = clone(step.next);
      media.version++;
      return clone(media.value);
    },
    async putFile(path, bytes, mime) {
      if (files.has(path)) throw new Error(`${path} already exists`);
      files.set(path, { bytes: new Uint8Array(bytes), mime });
    },
    async removeFile(path) {
      files.delete(path);
    },
    async readFile(path) {
      const f = files.get(path);
      return f ? new Uint8Array(f.bytes) : null;
    },
    async getUpi() {
      return upi.missing || !upi.value ? null : { ...upi.value };
    },
    async setUpi(next, by) {
      if (upi.missing) throw Object.assign(new Error('payment_settings missing'), { status: 503, plain: 'Payment settings are not installed (run 0004_payments.sql).' });
      upi.value = { ...next };
      upi.writes.push({ ...next, by });
    },
  };
}
