'use client';

/**
 * The extra question before மாத விற்பனை நிறைவு / Monthly Sales Close.
 *
 * Daily Sales Close sits right beside it and is pressed every trading day, so
 * closing a month by a slip of the finger was one click away. The month now
 * asks first, and nothing — no validation, no save — runs until the answer is
 * yes. Cancel, Escape, a click outside the box and the close all answer no.
 * Cancel also holds the focus, so a stray Enter cannot close a month either.
 *
 * Daily Sales Close is deliberately left without it.
 */
import { appConfirm } from '@/components/dialog';

export function confirmMonthlySalesClose(): Promise<boolean> {
  return appConfirm({
    title: 'மாத விற்பனையை நிறைவு செய்யவா?',
    message: 'இந்த மாதத்திற்கான விற்பனை விவரங்களை நிறைவு செய்ய உள்ளீர்கள். தொடர விரும்புகிறீர்களா?',
    cancelLabel: 'ரத்து / Cancel',
    confirmLabel: '✓ ஆம், மாத விற்பனையை நிறைவு செய் / Yes, Complete Monthly Sales',
    tone: 'warning',
    icon: '🔒',
    defaultCancel: true,
  });
}
