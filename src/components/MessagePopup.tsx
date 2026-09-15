'use client';

/**
 * Important and urgent messages, put in front of the person until they
 * acknowledge them.
 *
 * APPEARING IS NOT READING. The popup opening on its own after sign-in records
 * nothing — the office asked that a message count as read only when the person
 * opens it or acknowledges it, and a modal that happened to render is neither.
 * So this marks nothing on display; the Acknowledge button is what sets both
 * the acknowledgement and the read time.
 *
 * "Remind me later" hides a message for the rest of this browser session and
 * no longer — so it cannot be used to make an urgent notice go away for good,
 * and a clerk in the middle of keying a day is not trapped behind a modal.
 * Once acknowledged a message never pops up again; it stays in the history.
 */
import { useEffect, useMemo, useState } from 'react';
import { useInboxSummary, inbox } from '@/lib/notify/client';
import MessageView from './MessageView';

const LATER_KEY = 'crs.notify.later';

function readLater(): Set<number> {
  try {
    return new Set((JSON.parse(sessionStorage.getItem(LATER_KEY) ?? '[]') as number[]).map(Number));
  } catch {
    return new Set();
  }
}

function writeLater(ids: Set<number>) {
  try {
    sessionStorage.setItem(LATER_KEY, JSON.stringify([...ids]));
  } catch {
    /* private mode — the message will simply ask again */
  }
}

export default function MessagePopup() {
  const { popups } = useInboxSummary();
  const [later, setLater] = useState<Set<number>>(() => new Set());

  useEffect(() => setLater(readLater()), []);

  // Oldest first: a backlog is worked through in the order it was sent.
  const next = useMemo(() => popups.find((p) => !p.acknowledgedAt && !later.has(p.id)) ?? null, [popups, later]);

  if (!next) return null;
  return (
    <MessageView
      key={next.id}
      item={next}
      heading="Message from Admin"
      onClose={() => undefined}
      onAcknowledged={() => void inbox.refresh()}
      onLater={() => {
        const s = new Set(later);
        s.add(next.id);
        writeLater(s);
        setLater(s);
      }}
    />
  );
}
