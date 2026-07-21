// Booking agent (salon / clinic / garage). The agent NEVER invents a time — it
// only offers slots the code says are genuinely open, and can never double-book:
// one slot is pre-taken, so asking for it shows the guarantee in action.

import type { Engine, Locale } from './types';
import { matchAny } from './nlu';

interface Slot {
  id: string;
  day: Record<Locale, string>;
  time: string;
  taken: boolean;
}

interface Service {
  id: 'cut' | 'color';
  name: Record<Locale, string>;
  minutes: number;
  match: RegExp[];
}

const BUSINESS = { name: 'Studio Norr' };

const SERVICES: Service[] = [
  { id: 'cut', name: { sv: 'Klippning', en: 'Haircut' }, minutes: 30, match: [/klipp|klippning|haircut|\bcut\b|trim|snagg/i] },
  { id: 'color', name: { sv: 'Färgning', en: 'Colour' }, minutes: 90, match: [/färg|slinga|toning|colou?r|dye|highlight/i] },
];

// The demo's world. s2 is pre-booked — the whole point of the guarantee.
const INITIAL_SLOTS: Slot[] = [
  { id: 's1', day: { sv: 'imorgon', en: 'tomorrow' }, time: '09:00', taken: false },
  { id: 's2', day: { sv: 'imorgon', en: 'tomorrow' }, time: '11:30', taken: true },
  { id: 's3', day: { sv: 'imorgon', en: 'tomorrow' }, time: '14:00', taken: false },
  { id: 's4', day: { sv: 'på fredag', en: 'on Friday' }, time: '10:00', taken: false },
];

interface BookState {
  slots: Slot[];
  service: Service['id'] | null;
  offered: string | null; // slot id currently on the table
  rejected: string[]; // slot ids the caller has turned down (so we don't re-offer)
  done: boolean;
}

const YES = /\b(ja|japp|absolut|okej|ok(?:ay)?|visst|kör|funkar|låter bra|tar den|boka|book it|yes|yeah|sure|works|sounds good|that one|take it|perfect)\b/i;
const OTHER = /\b(annan|annat|senare|tidigare|nästa|inte den|något annat|another|other|later|earlier|next|different|else)\b/i;
// Negation — checked so an embedded yes-word ("boka inte den", "funkar inte")
// can never confirm a booking.
const NO = /\b(nej|nä|näe|inte|ej|icke|no|not|don'?t)\b/i;
const slotLabel = (s: Slot, l: Locale) => `${s.day[l]} ${s.time}`;
const firstOpen = (slots: Slot[]) => slots.find((s) => !s.taken) ?? null;

/** Did the user name a specific clock time, e.g. "11:30" / "kl 11" / "11.30"? */
function namedTime(input: string): string | null {
  const m = input.match(/\b(\d{1,2})[.:](\d{2})\b/) || input.match(/\bkl\.?\s*(\d{1,2})\b/i) || input.match(/\b(\d{1,2})\s*(?:o'?clock)\b/i);
  if (!m) return null;
  const h = m[1].padStart(2, '0');
  const min = m[2] ?? '00';
  return `${h}:${min}`;
}

export const bookingEngine: Engine<BookState> = {
  id: 'booking',
  emoji: '🗓️',
  label: { sv: 'Bokningsagenten', en: 'Booking agent' },
  blurb: {
    sv: 'Frisör, verkstad, fysio. Kollar dina riktiga lediga tider, erbjuder dem, bokar — och kan aldrig dubbelboka.',
    en: 'Salon, garage, physio. Checks your real open slots, offers them, books — and can never double-book.',
  },
  init: () => ({ slots: INITIAL_SLOTS.map((s) => ({ ...s })), service: null, offered: null, rejected: [], done: false }),
  greeting: (l) =>
    l === 'sv'
      ? `Hej och välkommen till ${BUSINESS.name}! Vill du boka en tid? Vi har klippning och färgning.`
      : `Hi and welcome to ${BUSINESS.name}! Would you like to book a time? We do haircuts and colouring.`,
  hints: (l) =>
    l === 'sv'
      ? ['Jag vill boka en klippning', 'Har ni något imorgon?', 'Kan jag få 11:30?', 'Ja, boka den']
      : ['I want to book a haircut', 'Anything tomorrow?', 'Can I get 11:30?', 'Yes, book it'],

  handle(state, input, l) {
    if (state.done) return { state, result: { reply: '', done: true } };
    const slots = state.slots;

    // Resolve / confirm the service first.
    let service = state.service;
    if (!service) {
      const found = SERVICES.find((s) => matchAny(input, s.match));
      if (found) service = found.id;
    }
    const svc = SERVICES.find((s) => s.id === service);

    // (a) The user asked for a specific clock time.
    const asked = namedTime(input);
    if (asked) {
      const slot = slots.find((s) => s.time === asked);
      if (slot?.taken) {
        const alt = firstOpen(slots);
        return {
          state: { ...state, service, offered: alt?.id ?? null },
          result: {
            reply: alt
              ? l === 'sv'
                ? `${asked} är tyvärr redan bokad — den kan jag inte ge bort. Men jag har ${slotLabel(alt, l)}. Vill du ha den istället?`
                : `${asked} is already booked, I'm afraid — I can't give that one away. But I have ${slotLabel(alt, l)}. Want that instead?`
              : l === 'sv'
                ? `${asked} är tyvärr redan bokad, och jag har inga andra tider kvar just nu.`
                : `${asked} is already booked, I'm afraid, and I have no other times left right now.`,
            decision: {
              label: 'SLOT TAKEN',
              tone: 'warn',
              tool: 'checkAvailability(time)',
              rows: [
                { k: l === 'sv' ? 'Begärd tid' : 'Requested', v: asked },
                { k: l === 'sv' ? 'Status' : 'Status', v: l === 'sv' ? 'upptagen' : 'taken' },
                { k: l === 'sv' ? 'Erbjuds istället' : 'Offered instead', v: alt ? slotLabel(alt, l) : '—' },
              ],
            },
            done: false,
          },
        };
      }
      if (slot && !slot.taken) {
        return {
          state: { ...state, service, offered: slot.id },
          result: {
            reply:
              l === 'sv'
                ? `${slotLabel(slot, l)} är ledig! Vill du att jag bokar den${svc ? ` för ${svc.name.sv.toLowerCase()}` : ''}?`
                : `${slotLabel(slot, l)} is open! Want me to book it${svc ? ` for a ${svc.name.en.toLowerCase()}` : ''}?`,
            decision: {
              label: 'SLOT OPEN',
              tone: 'good',
              tool: 'checkAvailability(time)',
              rows: [
                { k: l === 'sv' ? 'Begärd tid' : 'Requested', v: asked },
                { k: l === 'sv' ? 'Status' : 'Status', v: l === 'sv' ? 'ledig' : 'open' },
              ],
            },
            done: false,
          },
        };
      }
      // Named a time we simply don't run.
      const open = firstOpen(slots);
      return {
        state: { ...state, service, offered: open?.id ?? null },
        result: {
          reply: open
            ? l === 'sv'
              ? `Den tiden har vi tyvärr inte. Närmast lediga är ${slotLabel(open, l)}. Passar det?`
              : `We don't have that time, unfortunately. The nearest open one is ${slotLabel(open, l)}. Does that suit you?`
            : l === 'sv'
              ? 'Vi har tyvärr inga lediga tider kvar just nu.'
              : "We have no open times left right now, unfortunately.",
          done: false,
        },
      };
    }

    // (b) Confirming the slot on the table → book it (mark taken, no double-book).
    //     Negation-guarded: "boka inte den" / "funkar inte" must NOT confirm.
    if (state.offered && YES.test(input) && !NO.test(input)) {
      const idx = slots.findIndex((s) => s.id === state.offered);
      const slot = slots[idx];
      if (slot && !slot.taken) {
        const nextSlots = slots.map((s, i) => (i === idx ? { ...s, taken: true } : s));
        const ref = `SN-${slot.id.toUpperCase()}`;
        return {
          state: { ...state, slots: nextSlots, done: true },
          result: {
            reply:
              l === 'sv'
                ? `Klart! Jag har bokat ${svc ? svc.name.sv.toLowerCase() : 'din tid'} ${slotLabel(slot, l)}. Du får en bekräftelse. Vi ses!`
                : `Done! I've booked your ${svc ? svc.name.en.toLowerCase() : 'appointment'} ${slotLabel(slot, l)}. You'll get a confirmation. See you!`,
            decision: {
              label: 'BOOKED',
              tone: 'good',
              tool: 'bookSlot(slotId)',
              rows: [
                { k: l === 'sv' ? 'Tjänst' : 'Service', v: svc ? svc.name[l] : '—' },
                { k: l === 'sv' ? 'Tid' : 'Time', v: slotLabel(slot, l) },
                { k: l === 'sv' ? 'Referens' : 'Reference', v: ref },
              ],
            },
            ledger: {
              outcome: l === 'sv' ? 'BOKAD' : 'BOOKED',
              tone: 'good',
              detail:
                l === 'sv'
                  ? `${svc ? svc.name.sv : 'Tid'} ${slotLabel(slot, l)} → kalender + bekräftelse skickad.`
                  : `${svc ? svc.name.en : 'Appointment'} ${slotLabel(slot, l)} → calendar + confirmation sent.`,
              amount: ref,
            },
            done: true,
          },
        };
      }
    }

    // (c) User wants a different time → offer the next open slot, remembering
    //     the ones already turned down so we exhaust the list instead of
    //     ping-ponging between two slots.
    if (OTHER.test(input) || (state.offered && NO.test(input))) {
      const rejected = state.offered ? [...state.rejected, state.offered] : state.rejected;
      const open = slots.filter((s) => !s.taken && !rejected.includes(s.id));
      const next = open[0] ?? null;
      return {
        state: { ...state, service, offered: next?.id ?? null, rejected },
        result: {
          reply: next
            ? l === 'sv'
              ? `Inga problem. Jag har också ${slotLabel(next, l)}. Vill du ha den?`
              : `No problem. I also have ${slotLabel(next, l)}. Want that one?`
            : l === 'sv'
              ? 'Det var tyvärr de tider jag har kvar just nu.'
              : "Those were the only times I have left right now, unfortunately.",
          done: false,
        },
      };
    }

    // (d) Default: we know the service (or not) → offer the first open slot
    //     the caller hasn't already turned down.
    const open = slots.find((s) => !s.taken && !state.rejected.includes(s.id)) ?? null;
    if (!open) {
      return {
        state: { ...state, service },
        result: { reply: l === 'sv' ? 'Vi är tyvärr fullbokade just nu.' : "We're fully booked right now, unfortunately.", done: false },
      };
    }
    return {
      state: { ...state, service, offered: open.id },
      result: {
        reply: svc
          ? l === 'sv'
            ? `${svc.name.sv} tar ca ${svc.minutes} min. Närmast lediga tid är ${slotLabel(open, l)}. Ska jag boka den?`
            : `A ${svc.name.en.toLowerCase()} takes about ${svc.minutes} min. The nearest open time is ${slotLabel(open, l)}. Shall I book it?`
          : l === 'sv'
            ? `Jag har en ledig tid ${slotLabel(open, l)}. Vill du boka den — och gäller det klippning eller färgning?`
            : `I have an open slot ${slotLabel(open, l)}. Want to book it — and is it a haircut or colouring?`,
        decision: {
          label: 'SLOT OFFERED',
          tone: 'neutral',
          tool: 'nextAvailable()',
          rows: [
            { k: l === 'sv' ? 'Tjänst' : 'Service', v: svc ? svc.name[l] : l === 'sv' ? '(ej vald)' : '(not set)' },
            { k: l === 'sv' ? 'Erbjuds' : 'Offered', v: slotLabel(open, l) },
            { k: l === 'sv' ? 'Lediga kvar' : 'Open left', v: String(slots.filter((s) => !s.taken).length) },
          ],
        },
        done: false,
      },
    };
  },
};
