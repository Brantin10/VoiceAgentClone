// Tiny deterministic intent parser (SV + EN). No LLM — this is exactly the
// point of the demo: the classification + the decision are code, not the model.

/**
 * Extract the intended monetary value from free text. Handles "500", "500 kr",
 * "$500", "1 000", "1,000", "1.000", and — critically — ignores non-amount
 * leading numbers ("Om 3 dagar kan jag betala 400" → 400, not 3): a number
 * next to a currency marker wins, otherwise the largest number wins (dates,
 * ordinals and durations are small; the payment figure is the big one).
 */
export function parseAmount(raw: string): number | null {
  const compact = raw.replace(/\s+/g, '');
  const tokens = [...compact.matchAll(/\d[\d.,]*\d|\d/g)];
  if (tokens.length === 0) return null;

  const norm = (s: string): number | null => {
    // Strip thousands separators (. or , before exactly 3 digits + boundary),
    // then treat any remaining comma as a decimal comma.
    const cleaned = s.replace(/[.,](?=\d{3}(?:[.,]|$))/g, '').replace(',', '.');
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  };

  // 1) A number adjacent to a currency marker ($, €, kr, kronor, usd, sek, eur).
  for (const t of tokens) {
    const i = t.index ?? 0;
    const before = compact.slice(Math.max(0, i - 1), i);
    const after = compact.slice(i + t[0].length, i + t[0].length + 6);
    if (before === '$' || before === '€' || /^(kr|kronor|usd|sek|eur|€|\$)/i.test(after)) {
      const n = norm(t[0]);
      if (n !== null) return n;
    }
  }

  // 2) Otherwise the largest number wins.
  let best: number | null = null;
  for (const t of tokens) {
    const n = norm(t[0]);
    if (n !== null && (best === null || n > best)) best = n;
  }
  return best;
}

const RE = {
  yes: /\b(ja|japp|jajemen|javisst|absolut|okej|okey|ok(?:ay)?|visst|kör|klart|det funkar|funkar|låter bra|jag tar|tar det|deal|yes|yeah|yep|sure|okay|sounds good|that works|works for me|i'?ll take|take it|agreed|great|perfect)\b/i,
  no: /\b(nej|nope|näe|nää|no thanks|nej tack|not now|inte nu|kan inte|can'?t|för mycket|too much|för dyrt|too expensive)\b/i,
  full: /\b(hela|allt|alltihop|hela beloppet|hela summan|hela skulden|full|whole|everything|entire|in full|full amount|the lot)\b/i,
  // Negation particles that flip an embedded yes-word into a rejection.
  // Bare "no"/"nej" are deliberately excluded here (so "no problem, book it"
  // isn't misread) — isNo/declines handles those explicitly.
  negation: /\b(inte|ej|icke|aldrig|not|n['’]t|never|nope)\b/i,
};

export const isYes = (t: string) => RE.yes.test(t);
export const isNo = (t: string) => RE.no.test(t);
export const isFull = (t: string) => RE.full.test(t);

/** True only for a genuine agreement — an embedded yes-word inside a negated
 *  phrase ("det funkar inte", "absolut inte", "not okay") does NOT count. */
export function agrees(t: string): boolean {
  if (RE.negation.test(t)) return false;
  return RE.yes.test(t);
}

/** True for an explicit rejection (negation particle or a "no" word). */
export function declines(t: string): boolean {
  return RE.no.test(t) || RE.negation.test(t) || /\b(nej|no)\b/i.test(t);
}

/** True if any of the given patterns match. */
export function matchAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

/** Currency formatter used across the demo panels. */
export function money(amount: number, currency: string, locale: 'sv' | 'en'): string {
  try {
    return new Intl.NumberFormat(locale === 'sv' ? 'sv-SE' : 'en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
    }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}
