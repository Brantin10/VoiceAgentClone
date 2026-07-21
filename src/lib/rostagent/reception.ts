// Reception agent. The agent NEVER invents an answer: it replies only from an
// approved FAQ. Ask something outside it and — instead of hallucinating — it
// says so and takes a message. That refusal is the guarantee, made visible.
// Fully deterministic (no LLM): "never invents" is a code guarantee, not a hope.

import type { Engine, Locale } from './types';
import { matchAny } from './nlu';

const BUSINESS = { name: 'Studio Norr' };

interface FaqEntry {
  id: string;
  match: RegExp[];
  answer: Record<Locale, string>;
}

const FAQ: FaqEntry[] = [
  {
    id: 'hours',
    // "closing" kept, bare "close" dropped so "parking close by" doesn't match.
    match: [/öppet|öppettid|öppnar|stänger|open(?:ing)?|hours|closing/i],
    answer: {
      sv: 'Vi har öppet måndag–fredag 09–18 och lördag 10–15. Söndagar stängt.',
      en: "We're open Monday–Friday 9–18 and Saturday 10–15. Closed Sundays.",
    },
  },
  {
    id: 'address',
    // "var ligger/finns/är" must be followed by the business as subject, so
    // "var finns toaletten" no longer wrongly returns the address.
    match: [/adress|var (?:ligger|finns|är) (?:ni|du|salongen|ert|er|studio)|vägen (?:till|dit)|hitta (?:hit|er|dit)|address|where are you|your location|located|find you/i],
    answer: {
      sv: 'Vi ligger på Storgatan 12 i Malmö, mitt emot torget.',
      en: "We're at Storgatan 12 in Malmö, right across from the square.",
    },
  },
  {
    id: 'parking',
    match: [/parker|parking|\bp-plats|garage/i],
    answer: {
      sv: 'Det finns gratis parkering direkt utanför salongen, samt ett p-hus 100 m bort.',
      en: "There's free parking right outside the salon, plus a car park 100 m away.",
    },
  },
  {
    id: 'price',
    match: [/kostar|pris|priser|hur mycket|avgift|price|cost|how much|charge/i],
    answer: {
      sv: 'En klippning kostar 450 kr och färgning från 950 kr. Studentrabatt 15 %.',
      en: 'A haircut is 450 kr and colouring from 950 kr. 15% student discount.',
    },
  },
  {
    id: 'payment',
    match: [/betal|swish|kort|kontant|faktura|pay|card|cash|invoice/i],
    answer: {
      sv: 'Du kan betala med kort, Swish eller kontant. Vi tar tyvärr inte faktura.',
      en: "You can pay by card, Swish, or cash. We don't take invoices, sorry.",
    },
  },
];

interface RecepState {
  answered: number;
  takingMessage: boolean;
  done: boolean;
}

// Signals a real question (vs. small talk / greeting). Bare "var" is excluded —
// in Swedish it usually means "was", not "where", and genuine "where" questions
// are already covered by the address FAQ ("var ligger ni").
const QUESTION = /\?|\b(hur|vad|när|vilken|vilka|kan ni|har ni|gör ni|kostar|why|how|what|when|where|do you|can you|are you|is there)\b/i;
const GREETING = /^\s*(hej|tjena|hallå|god\s?(morgon|dag|kväll)|hi|hello|hey|yo)\b[\s!.]*$/i;

export const receptionEngine: Engine<RecepState> = {
  id: 'reception',
  emoji: '📞',
  label: { sv: 'Receptionsagenten', en: 'Reception agent' },
  blurb: {
    sv: 'Svarar på vanliga frågor — men bara från en godkänd FAQ. Vet den inte, gissar den inte: den tar ett meddelande.',
    en: "Answers common questions — but only from an approved FAQ. If it doesn't know, it doesn't guess: it takes a message.",
  },
  init: () => ({ answered: 0, takingMessage: false, done: false }),
  greeting: (l) =>
    l === 'sv'
      ? `Hej, du har kommit till ${BUSINESS.name}. Vad kan jag hjälpa dig med?`
      : `Hi, you've reached ${BUSINESS.name}. How can I help you?`,
  hints: (l) =>
    l === 'sv'
      ? ['Vilka öppettider har ni?', 'Vad kostar en klippning?', 'Var ligger ni?', 'Gör ni bröllopsuppsättningar?']
      : ['What are your opening hours?', 'How much is a haircut?', 'Where are you located?', 'Do you do wedding hair?'],

  handle(state, input, l) {
    if (state.done) return { state, result: { reply: '', done: true } };

    // 1) Approved FAQ match FIRST — so a recognized question is always answered,
    //    even if we were mid "take a message" (a still-visible chip can't get
    //    swallowed as the note or end the call early).
    const hit = FAQ.find((e) => matchAny(input, e.match));
    if (hit) {
      return {
        state: { ...state, answered: state.answered + 1, takingMessage: false },
        result: {
          reply:
            hit.answer[l] +
            (l === 'sv' ? ' Är det något mer jag kan hjälpa dig med?' : ' Anything else I can help with?'),
          decision: {
            label: 'FAQ MATCH',
            tone: 'good',
            tool: 'answerFromFaq(id)',
            rows: [
              { k: l === 'sv' ? 'Källa' : 'Source', v: `FAQ · ${hit.id}` },
              { k: l === 'sv' ? 'Hittat på?' : 'Made up?', v: l === 'sv' ? 'nej' : 'no' },
            ],
          },
          done: false,
        },
      };
    }

    // 2) We asked for their message last turn, and this isn't an FAQ → capture it.
    if (state.takingMessage) {
      const note = input.trim();
      return {
        state: { ...state, done: true },
        result: {
          reply:
            l === 'sv'
              ? 'Tack, jag har noterat det och ser till att någon återkommer till dig. Ha en fin dag!'
              : "Thanks, I've noted that and someone will get back to you. Have a great day!",
          decision: {
            label: 'MESSAGE TAKEN',
            tone: 'neutral',
            tool: 'takeMessage(note)',
            rows: [{ k: l === 'sv' ? 'Meddelande' : 'Message', v: note.length > 40 ? note.slice(0, 40) + '…' : note || '—' }],
          },
          ledger: {
            outcome: l === 'sv' ? 'MEDDELANDE' : 'MESSAGE',
            tone: 'neutral',
            detail:
              l === 'sv'
                ? 'Fråga utanför FAQ → meddelande vidarebefordrat till personal (ingen gissning).'
                : 'Out-of-FAQ question → message forwarded to staff (no guessing).',
          },
          done: true,
        },
      };
    }

    // 3) Pure greeting / small talk → nudge, don't fall through to take-a-message.
    if (GREETING.test(input) || !QUESTION.test(input)) {
      return {
        state,
        result: {
          reply:
            l === 'sv'
              ? 'Absolut — fråga gärna om öppettider, priser, var vi ligger eller hur du betalar.'
              : 'Of course — ask me about opening hours, prices, where we are, or how to pay.',
          done: false,
        },
      };
    }

    // 4) A real question we have NO approved answer for → refuse to guess, take a message.
    return {
      state: { ...state, takingMessage: true },
      result: {
        reply:
          l === 'sv'
            ? 'Det där har jag inget säkert svar på, och jag vill inte gissa. Om du lämnar ditt namn och ärende ser jag till att någon i personalen återkommer.'
            : "I don't have a confirmed answer for that, and I won't guess. If you leave your name and question, I'll make sure a staff member gets back to you.",
        decision: {
          label: 'NO FAQ MATCH',
          tone: 'warn',
          tool: 'answerFromFaq(id) → null',
          rows: [
            { k: l === 'sv' ? 'Åtgärd' : 'Action', v: l === 'sv' ? 'gissar inte' : 'refuse to guess' },
            { k: l === 'sv' ? 'Nästa' : 'Next', v: l === 'sv' ? 'ta meddelande' : 'take a message' },
          ],
        },
        done: false,
      },
    };
  },
};
