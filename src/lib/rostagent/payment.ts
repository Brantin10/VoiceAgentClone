// Payment-negotiation agent (debt collection / inkasso).
//
// The agent NEVER computes money. A deterministic waterfall decides:
//   full -> downpayment+one -> settlement (<=20% off, <=3 payments)
//   -> plan (no discount, <=3 months). Hard floor: no single payment < 25%.
// The waterfall rules are configuration (RULES below), not model behaviour;
// the surface (Swedish inkasso, SEK, names) is localised for the demo.

import type { Engine, Locale } from './types';
import { agrees, declines, isFull, money, parseAmount } from './nlu';

interface Rules {
  minPaymentFraction: number;
  maxSettlementDiscount: number;
  maxSettlementPayments: number;
  maxPlanMonths: number;
  downpaymentAnchorFraction: number;
}

const RULES: Rules = {
  minPaymentFraction: 0.25,
  maxSettlementDiscount: 0.2,
  maxSettlementPayments: 3,
  maxPlanMonths: 3,
  downpaymentAnchorFraction: 0.6,
};

const CONFIG = { company: 'Nordisk Inkasso', agent: 'Robin', debtor: 'Johan', balance: 4500, currency: 'SEK' };

type Cadence = 'weekly' | 'biweekly' | 'monthly';
const SPACING: Record<Cadence, number> = { weekly: 7, biweekly: 14, monthly: 30 };
const round2 = (n: number) => Math.round(n * 100) / 100;

interface Installment {
  seq: number;
  amount: number;
  dueInDays: number;
}
interface Proposal {
  accepted: boolean;
  plan: 'full' | 'downpayment_plus_one' | 'settlement' | 'payment_plan';
  totalAmount: number;
  discount: number;
  installments: Installment[];
  cadence: Cadence | null;
  outcome: 'STRONG' | 'SETTLED' | 'PLAN' | 'NO_DEAL';
  reason: string;
}

function schedule(total: number, n: number, cadence: Cadence): Installment[] {
  const base = Math.floor((total / n) * 100) / 100;
  const items: Installment[] = [];
  let allocated = 0;
  for (let i = 0; i < n; i++) {
    const amount = i === n - 1 ? round2(total - allocated) : base;
    allocated = round2(allocated + amount);
    items.push({ seq: i + 1, amount, dueInDays: i * SPACING[cadence] });
  }
  return items;
}

const minPayment = (balance: number) => round2(balance * RULES.minPaymentFraction);

function negotiate(balance: number, userOffer: number | null): Proposal {
  const floor = minPayment(balance);
  const base = (o: Partial<Proposal>): Proposal =>
    ({ totalAmount: round2(balance), discount: 0, cadence: null, ...o }) as Proposal;

  if (userOffer === null)
    return base({ accepted: false, plan: 'full', installments: [{ seq: 1, amount: round2(balance), dueInDays: 0 }], outcome: 'STRONG', reason: 'counter_full' });

  const offer = round2(userOffer);
  if (offer >= balance)
    return base({ accepted: true, plan: 'full', installments: [{ seq: 1, amount: round2(balance), dueInDays: 0 }], outcome: 'STRONG', reason: 'accepted_full' });

  if (offer < floor)
    return base({ accepted: false, plan: 'payment_plan', installments: [{ seq: 1, amount: floor, dueInDays: 0 }], outcome: 'NO_DEAL', reason: 'below_floor' });

  const anchor = round2(balance * RULES.downpaymentAnchorFraction);
  if (offer >= anchor) {
    const remainder = round2(balance - offer);
    if (remainder >= floor || remainder === 0) {
      const installments =
        remainder === 0
          ? [{ seq: 1, amount: offer, dueInDays: 0 }]
          : [{ seq: 1, amount: offer, dueInDays: 0 }, { seq: 2, amount: remainder, dueInDays: SPACING.biweekly }];
      return base({ accepted: true, plan: 'downpayment_plus_one', installments, cadence: remainder === 0 ? null : 'biweekly', outcome: 'STRONG', reason: 'accepted_offer' });
    }
  }

  const minSettlement = round2(balance * (1 - RULES.maxSettlementDiscount));
  if (offer >= minSettlement)
    return base({ accepted: true, plan: 'settlement', totalAmount: offer, discount: round2(1 - offer / balance), installments: [{ seq: 1, amount: offer, dueInDays: 0 }], outcome: 'SETTLED', reason: 'accepted_offer' });

  for (let n = 1; n <= RULES.maxSettlementPayments; n++) {
    const each = round2(minSettlement / n);
    if (each < floor) continue;
    if (each <= offer)
      return base({ accepted: false, plan: 'settlement', totalAmount: minSettlement, discount: round2(1 - minSettlement / balance), installments: schedule(minSettlement, n, 'biweekly'), cadence: n === 1 ? null : 'biweekly', outcome: 'SETTLED', reason: 'counter_settlement' });
  }

  const maxByFloor = Math.floor(balance / floor);
  const counts: Record<Cadence, number> = {
    monthly: Math.min(maxByFloor, RULES.maxPlanMonths),
    biweekly: Math.min(maxByFloor, Math.floor((RULES.maxPlanMonths * 30) / SPACING.biweekly)),
    weekly: Math.min(maxByFloor, Math.floor((RULES.maxPlanMonths * 30) / SPACING.weekly)),
  };
  let best: { cadence: Cadence; n: number } | null = null;
  for (const c of ['monthly', 'biweekly', 'weekly'] as Cadence[]) {
    const n = Math.max(1, counts[c]);
    const each = round2(balance / n);
    if (each < floor) continue;
    if (offer >= each) {
      best = { cadence: c, n };
      break;
    }
    if (!best) best = { cadence: c, n };
  }
  const chosen = best ?? { cadence: 'monthly' as Cadence, n: RULES.maxPlanMonths };
  return base({ accepted: offer >= round2(balance / chosen.n), plan: 'payment_plan', installments: schedule(round2(balance), chosen.n, chosen.cadence), cadence: chosen.n === 1 ? null : chosen.cadence, outcome: 'PLAN', reason: 'counter_plan' });
}

/** The smallest-installment plan the rules allow (prefer more months, each ≥ floor). */
function proposePlan(balance: number): Proposal {
  const floor = minPayment(balance);
  for (let n = RULES.maxPlanMonths; n >= 1; n--) {
    const each = round2(balance / n);
    if (each >= floor) {
      return {
        accepted: false,
        plan: 'payment_plan',
        totalAmount: round2(balance),
        discount: 0,
        installments: schedule(round2(balance), n, 'monthly'),
        cadence: n === 1 ? null : 'monthly',
        outcome: 'PLAN',
        reason: 'counter_plan',
      };
    }
  }
  return {
    accepted: false,
    plan: 'payment_plan',
    totalAmount: round2(balance),
    discount: 0,
    installments: [{ seq: 1, amount: round2(balance), dueInDays: 0 }],
    cadence: null,
    outcome: 'PLAN',
    reason: 'counter_plan',
  };
}

// ── Conversational shell ────────────────────────────────────────────────────

interface PayState {
  pending: Proposal | null;
  done: boolean;
}

const SPLIT = /\b(dela upp|dela på|delbetal|avbetal|uppdelat|delas upp|omgångar|split|instal?lments?|in parts|over time|payment plan|monthly)\b/i;

const cadenceWord = (c: Cadence | null, l: Locale): string => {
  if (!c) return '';
  const map = {
    sv: { weekly: 'i veckan', biweekly: 'varannan vecka', monthly: 'i månaden' },
    en: { weekly: 'weekly', biweekly: 'every two weeks', monthly: 'monthly' },
  } as const;
  return map[l][c];
};

/** Render a negotiated proposal (from the waterfall) as a spoken sentence. */
function describe(p: Proposal, l: Locale): string {
  const c = CONFIG.currency;
  const m = (n: number) => money(n, c, l);
  if (p.installments.length === 1) {
    const only = p.installments[0].amount;
    if (p.plan === 'settlement') {
      return l === 'sv'
        ? `Då gör vi så här: ${m(only)} nu så är skulden på ${m(CONFIG.balance)} helt reglerad — en rabatt på ${Math.round(p.discount * 100)} %. Låter det bra?`
        : `Here's what we'll do: ${m(only)} now settles the full ${m(CONFIG.balance)} balance — a ${Math.round(p.discount * 100)}% discount. Sound good?`;
    }
    return l === 'sv'
      ? `Perfekt — ${m(only)} idag så är hela beloppet betalt. Ska jag boka in det?`
      : `Perfect — ${m(only)} today clears the whole balance. Shall I set that up?`;
  }
  const parts = p.installments.map((i) =>
    l === 'sv'
      ? `${m(i.amount)}${i.dueInDays === 0 ? ' nu' : ` om ${i.dueInDays} dagar`}`
      : `${m(i.amount)}${i.dueInDays === 0 ? ' now' : ` in ${i.dueInDays} days`}`,
  );
  const total = p.plan === 'settlement' ? p.totalAmount : CONFIG.balance;
  const joined = l === 'sv' ? parts.join(', sedan ') : parts.join(', then ');
  const disc =
    p.discount > 0
      ? l === 'sv'
        ? ` (totalt ${money(total, CONFIG.currency, l)}, ${Math.round(p.discount * 100)} % rabatt)`
        : ` (total ${money(total, CONFIG.currency, l)}, ${Math.round(p.discount * 100)}% off)`
      : l === 'sv'
        ? ` ${cadenceWord(p.cadence, l)} tills skulden är betald`
        : ` ${cadenceWord(p.cadence, l)} until the balance is cleared`;
  return l === 'sv'
    ? `Jag kan erbjuda ${joined}${disc}. Funkar det för dig?`
    : `I can offer ${joined}${disc}. Does that work for you?`;
}

/** Reply when a below-floor lowball is countered with the minimum allowed plan. */
function floorPlanReply(p: Proposal, l: Locale): string {
  const floor = money(minPayment(CONFIG.balance), CONFIG.currency, l);
  const n = p.installments.length;
  const each = money(p.installments[0].amount, CONFIG.currency, l);
  return l === 'sv'
    ? `Jag kan tyvärr inte ta emot mindre än ${floor} per gång. Men vi kan dela upp skulden på ${n} betalningar om ${each}. Funkar det?`
    : `I can't accept less than ${floor} per payment, I'm afraid. But we can split the balance into ${n} payments of ${each}. Does that work?`;
}

/** Reply when the debtor asks to split without naming a figure. */
function splitReply(p: Proposal, l: Locale): string {
  const n = p.installments.length;
  const each = money(p.installments[0].amount, CONFIG.currency, l);
  return l === 'sv'
    ? `Visst, vi kan dela upp det på ${n} betalningar om ${each}. Funkar det?`
    : `Sure, we can split it into ${n} payments of ${each}. Does that work?`;
}

const outcomeMeta: Record<Proposal['outcome'], { label: string; tone: 'good' | 'warn' | 'neutral' }> = {
  STRONG: { label: 'PAID IN FULL', tone: 'good' },
  SETTLED: { label: 'SETTLEMENT', tone: 'good' },
  PLAN: { label: 'PAYMENT PLAN', tone: 'neutral' },
  NO_DEAL: { label: 'NO DEAL', tone: 'warn' },
};

/** Localised CRM outcome label (the decision-panel label stays English, like the
 *  other engines' technical tags; the CRM ledger reads in the demo's language). */
const LEDGER_OUTCOME: Record<Proposal['outcome'], Record<Locale, string>> = {
  STRONG: { sv: 'BETALD', en: 'PAID IN FULL' },
  SETTLED: { sv: 'UPPGÖRELSE', en: 'SETTLEMENT' },
  PLAN: { sv: 'AVBETALNINGSPLAN', en: 'PAYMENT PLAN' },
  NO_DEAL: { sv: 'INGEN UPPGÖRELSE', en: 'NO DEAL' },
};

/** The 3-way outcome routing that lands in the CRM ledger. */
function routedMessage(outcome: Proposal['outcome'], amount: string, l: Locale): string {
  switch (outcome) {
    case 'STRONG':
    case 'SETTLED':
      return l === 'sv'
        ? `Uppgörelse klar → bekräftelse + betallänk skickad till ${CONFIG.debtor}.`
        : `Deal closed → confirmation + payment link sent to ${CONFIG.debtor}.`;
    case 'PLAN':
      return l === 'sv'
        ? `Avbetalningsplan (${amount}) upprättad → påminnelser schemalagda.`
        : `Payment plan (${amount}) created → reminders scheduled.`;
    case 'NO_DEAL':
      return l === 'sv'
        ? 'Ingen uppgörelse → ärendet flaggat för mänsklig handläggare.'
        : 'No agreement → case flagged for a human handler.';
  }
}

export const paymentEngine: Engine<PayState> = {
  id: 'payment',
  emoji: '⏳',
  label: { sv: 'Betalningsagenten', en: 'Payment agent' },
  blurb: {
    sv: 'Inkasso. Förhandlar enligt dina regler — 25 %-golv, max 20 % rabatt, max 3 delbetalningar — utan att någonsin räkna fel.',
    en: 'Collections. Negotiates by your rules — 25% floor, max 20% off, max 3 installments — without ever miscalculating.',
  },
  init: () => ({ pending: null, done: false }),
  greeting: (l) =>
    l === 'sv'
      ? `Hej, det här är ${CONFIG.agent} från ${CONFIG.company}. Jag ringer om en obetald faktura på ${money(CONFIG.balance, CONFIG.currency, l)} för ${CONFIG.debtor}. Hur mycket kan du betala idag?`
      : `Hi, this is ${CONFIG.agent} from ${CONFIG.company}. I'm calling about an unpaid invoice of ${money(CONFIG.balance, CONFIG.currency, l)} for ${CONFIG.debtor}. How much can you pay today?`,
  hints: (l) =>
    l === 'sv'
      ? ['Jag kan betala 2000', 'Kan jag dela upp det?', 'Jag betalar hela summan', 'Jag har bara råd med 500']
      : ['I can pay 2000', 'Can I split it up?', "I'll pay the full amount", 'I can only afford 500'],

  handle(state, input, l) {
    if (state.done) return { state, result: { reply: '', done: true } };

    const amount = parseAmount(input);
    const floor = minPayment(CONFIG.balance);
    const m = (n: number) => money(n, CONFIG.currency, l);

    // 0) Negation guard: "I can't pay the full amount" must never read as an
    //    offer to pay in full, and "can't pay 2000" is not an offer of 2000 —
    //    a negated turn skips the offer branches and is handled as a decline.
    const negated = declines(input);

    // 1) Whole balance / an offer at-or-above the balance → pay in full.
    if (!negated && (isFull(input) || (amount !== null && amount >= CONFIG.balance))) {
      const p = negotiate(CONFIG.balance, CONFIG.balance);
      return {
        state: { ...state, pending: p },
        result: {
          reply: describe(p, l),
          decision: {
            label: outcomeMeta[p.outcome].label,
            tone: outcomeMeta[p.outcome].tone,
            tool: 'negotiate(balance, offer)',
            rows: [
              { k: l === 'sv' ? 'Saldo' : 'Balance', v: m(CONFIG.balance) },
              { k: l === 'sv' ? 'Förslag' : 'Proposal', v: p.plan },
              { k: l === 'sv' ? 'Att betala' : 'To pay', v: m(CONFIG.balance) },
            ],
          },
          done: false,
        },
      };
    }

    // 2) A lowball below the 25% floor → counter with the smallest allowed plan
    //    (never a dead-end; the floor is shown, and "ja" then accepts the plan).
    if (!negated && amount !== null && amount < floor) {
      const p = proposePlan(CONFIG.balance);
      return {
        state: { ...state, pending: p },
        result: {
          reply: floorPlanReply(p, l),
          decision: {
            label: 'PAYMENT PLAN',
            tone: 'neutral',
            tool: 'proposePlan(balance)',
            rows: [
              { k: l === 'sv' ? 'Bud' : 'Offer', v: m(amount) },
              { k: l === 'sv' ? 'Golv (25 %)' : 'Floor (25%)', v: m(floor) },
              { k: l === 'sv' ? 'Plan' : 'Plan', v: `${p.installments.length} × ${m(p.installments[0].amount)}` },
            ],
          },
          done: false,
        },
      };
    }

    // 3) A concrete offer at or above the floor → run the waterfall.
    if (!negated && amount !== null) {
      const p = negotiate(CONFIG.balance, amount);
      const total = p.plan === 'settlement' ? p.totalAmount : CONFIG.balance;
      return {
        state: { ...state, pending: p },
        result: {
          reply: describe(p, l),
          decision: {
            label: outcomeMeta[p.outcome].label,
            tone: outcomeMeta[p.outcome].tone,
            tool: 'negotiate(balance, offer)',
            rows: [
              { k: l === 'sv' ? 'Bud' : 'Offer', v: m(amount) },
              { k: l === 'sv' ? 'Golv (25 %)' : 'Floor (25%)', v: m(floor) },
              { k: l === 'sv' ? 'Motbud' : 'Counter', v: m(total) },
              ...(p.discount > 0 ? [{ k: l === 'sv' ? 'Rabatt' : 'Discount', v: `${Math.round(p.discount * 100)}%` }] : []),
            ],
          },
          done: false,
        },
      };
    }

    // 4) Agreement to a pending proposal → close + route to CRM.
    //    agrees() is negation-safe: "det funkar inte" / "not okay" is NOT a yes.
    if (agrees(input) && state.pending) {
      const p = state.pending;
      const amt = m(p.plan === 'settlement' ? p.totalAmount : CONFIG.balance);
      return {
        state: { ...state, done: true },
        result: {
          reply:
            l === 'sv'
              ? `Tack ${CONFIG.debtor}! Då är det klart. Du får en bekräftelse direkt. Ha en fin dag.`
              : `Thank you, ${CONFIG.debtor}! That's all set — you'll get a confirmation right away. Have a good day.`,
          ledger: { outcome: LEDGER_OUTCOME[p.outcome][l], tone: outcomeMeta[p.outcome].tone, detail: routedMessage(p.outcome, amt, l), amount: amt },
          done: true,
        },
      };
    }

    // 5) Declining a pending proposal → no agreement, hand to a human.
    if (declines(input) && state.pending) {
      return {
        state: { ...state, done: true },
        result: {
          reply:
            l === 'sv'
              ? 'Jag förstår. Då lämnar jag över ärendet till en handläggare som återkommer. Ha en fin dag.'
              : "I understand. I'll hand this to a human handler who'll follow up. Have a good day.",
          decision: {
            label: 'NO DEAL',
            tone: 'warn',
            tool: 'escalateToHuman()',
            rows: [{ k: l === 'sv' ? 'Utfall' : 'Outcome', v: l === 'sv' ? 'ingen uppgörelse' : 'no agreement' }],
          },
          ledger: { outcome: LEDGER_OUTCOME.NO_DEAL[l], tone: 'warn', detail: routedMessage('NO_DEAL', '', l) },
          done: true,
        },
      };
    }

    // 5b) A decline with nothing yet on the table ("I can't pay the full
    //     amount") → counter with the smallest allowed plan, never a dead end.
    if (negated && !state.pending) {
      const p = proposePlan(CONFIG.balance);
      return {
        state: { ...state, pending: p },
        result: {
          reply: splitReply(p, l),
          decision: {
            label: 'PAYMENT PLAN',
            tone: 'neutral',
            tool: 'proposePlan(balance)',
            rows: [
              { k: l === 'sv' ? 'Saldo' : 'Balance', v: m(CONFIG.balance) },
              { k: l === 'sv' ? 'Plan' : 'Plan', v: `${p.installments.length} × ${m(p.installments[0].amount)}` },
            ],
          },
          done: false,
        },
      };
    }

    // 6) "Can I split it up?" with no figure → propose a plan.
    if (SPLIT.test(input)) {
      const p = proposePlan(CONFIG.balance);
      return {
        state: { ...state, pending: p },
        result: {
          reply: splitReply(p, l),
          decision: {
            label: 'PAYMENT PLAN',
            tone: 'neutral',
            tool: 'proposePlan(balance)',
            rows: [
              { k: l === 'sv' ? 'Saldo' : 'Balance', v: m(CONFIG.balance) },
              { k: l === 'sv' ? 'Plan' : 'Plan', v: `${p.installments.length} × ${m(p.installments[0].amount)}` },
              { k: l === 'sv' ? 'Rabatt' : 'Discount', v: l === 'sv' ? 'ingen' : 'none' },
            ],
          },
          done: false,
        },
      };
    }

    // 7) Not understood → re-prompt, and flag for the LLM layer.
    return {
      state,
      result: {
        reply:
          l === 'sv'
            ? 'Jag vill hjälpa dig hitta en lösning. Hur mycket kan du betala — en summa, eller vill du dela upp det?'
            : "I want to help you find a solution. How much can you pay — a figure, or would you like to split it up?",
        done: false,
        fallthrough: true,
      },
    };
  },
};
