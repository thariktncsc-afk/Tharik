/**
 * Putting one person's unsaved changes on top of what someone else just saved.
 *
 * Every shop's day sheets live in ONE crs_state row (entryStore), and the same
 * is true of every month store. Two shops saving within the same few seconds
 * therefore write the same row. The version check stops the second write from
 * overwriting the first — correctly — but the client used to answer that 409 by
 * reloading, which replaced the second shop's store with the server's copy: the
 * sheet the clerk had just watched save was silently gone. Live sync makes the
 * race routine, because every open screen now takes other people's writes as
 * they land.
 *
 * So a conflict is REBASED instead. The records this client changed since it
 * last read the row (local against base) are laid over the row as it now stands
 * (remote), and the result is saved under the new version. A record is the
 * store's own unit — a day sheet, a shop-month, a receipt row — so two shops, or
 * two days of one shop, never collide. The same record changed on both sides
 * keeps this client's copy, which is what "I pressed save last" means; the
 * server's guards then judge the result like any other write.
 */

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const has = (o: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** receiptStore rows are records by id; a row without one is compared whole. */
const idOf = (row: unknown): string | null => (isObj(row) && row.id !== undefined && row.id !== null ? String(row.id) : null);

function rebaseRows(base: unknown[], local: unknown[], remote: unknown[]): unknown[] {
  const byId = (rows: unknown[]) => {
    const m = new Map<string, unknown>();
    for (const r of rows) {
      const id = idOf(r);
      if (id !== null) m.set(id, r);
    }
    return m;
  };
  const b = byId(base);
  const l = byId(local);
  const out = [...remote];
  const at = new Map<string, number>();
  out.forEach((r, i) => {
    const id = idOf(r);
    if (id !== null) at.set(id, i);
  });

  const removed = new Set<string>();
  for (const id of new Set([...b.keys(), ...l.keys()])) {
    if (same(l.get(id), b.get(id))) continue; // not ours to say
    if (!l.has(id)) {
      removed.add(id);
      continue;
    }
    const i = at.get(id);
    if (i === undefined) out.push(l.get(id));
    else out[i] = l.get(id);
  }
  // Rows without an id: keep the ones this client added, never resurrect one
  // the base already had (the remote dropping it was somebody's decision).
  for (const r of local) {
    if (idOf(r) !== null) continue;
    if (base.some((x) => same(x, r)) || out.some((x) => same(x, r))) continue;
    out.push(r);
  }
  return out.filter((r) => {
    const id = idOf(r);
    return id === null || !removed.has(id);
  });
}

/**
 * `base` is the store as this client last read it, `local` what it holds now,
 * `remote` what the server holds now. Returns what to save.
 */
export function rebaseStore(store: string, base: unknown, local: unknown, remote: unknown): unknown {
  if (same(local, base)) return remote; // nothing of ours to keep
  if (remote === undefined) return local;

  if (Array.isArray(local) && Array.isArray(remote)) {
    return rebaseRows(Array.isArray(base) ? base : [], local, remote);
  }

  if (isObj(local) && isObj(remote)) {
    const b = isObj(base) ? base : {};
    const out: Record<string, unknown> = { ...remote };
    for (const k of new Set([...Object.keys(b), ...Object.keys(local)])) {
      if (same(local[k], b[k])) continue; // untouched here — theirs stands
      if (!has(local, k)) {
        delete out[k]; // removed here
        continue;
      }
      // Counters only ever move up. Two receipts numbered at the same moment
      // must not hand the next one a number that is already taken.
      if (store === '__counters' && typeof local[k] === 'number' && typeof remote[k] === 'number') {
        out[k] = Math.max(local[k] as number, remote[k] as number);
      } else {
        out[k] = local[k];
      }
    }
    return out;
  }

  return local;
}
