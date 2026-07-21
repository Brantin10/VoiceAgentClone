// Retrieval knowledge base ("common sentences") for the RAG layer.
//
// When the deterministic engine doesn't understand a turn, the server retrieves
// the most relevant entries here and hands them to the LLM as grounding — so the
// model rephrases from approved facts + policy instead of inventing. Retrieval is
// plain token-overlap scoring: no embedding call, so it's instant and free.
//
// The LLM is never allowed to state a price, amount, slot or discount from these
// entries directly for the payment/booking flows — those still route back through
// the engine. The KB gives the model *tone, policy and phrasing*, not authority.

import type { EngineId } from './scenarios';
import type { Locale } from './types';

export interface KbEntry {
  tags: string[];
  text: Record<Locale, string>;
}

const KB: Record<EngineId, KbEntry[]> = {
  payment: [
    {
      tags: ['policy', 'rabatt', 'discount', 'lägst', 'lowest', 'minsta', 'floor', 'golv'],
      text: {
        sv: 'Regler: minsta enskilda betalning är 25 % av skulden. Max 20 % rabatt vid engångsuppgörelse. Avbetalning upp till 3 gånger. Dessa gränser är låsta — agenten kan inte gå under dem.',
        en: 'Rules: the smallest single payment is 25% of the balance. Max 20% discount on a one-off settlement. Installments up to 3 times. These limits are locked — the agent cannot go below them.',
      },
    },
    {
      tags: ['dela', 'upp', 'avbetal', 'split', 'installment', 'plan', 'månad', 'month', 'delbetal'],
      text: {
        sv: 'Om personen vill dela upp betalningen: erbjud en avbetalningsplan (upp till 3 delbetalningar, varje minst 25 % av skulden). Fråga hur mycket de kan betala per gång.',
        en: 'If the person wants to split the payment: offer an installment plan (up to 3 payments, each at least 25% of the balance). Ask how much they can pay each time.',
      },
    },
    {
      tags: ['inte', 'råd', 'afford', 'svårt', 'arbetslös', 'sjuk', 'ekonomi', 'hardship', 'kan', 'inte'],
      text: {
        sv: 'Om personen har det svårt ekonomiskt: var empatisk men tydlig. Föreslå den minsta möjliga avbetalningsplanen. Kan de inte klara ens golvet lämnas ärendet vidare till en mänsklig handläggare — hitta aldrig på ett undantag.',
        en: 'If the person is in financial hardship: be empathetic but clear. Suggest the smallest possible installment plan. If they cannot manage even the floor, the case goes to a human handler — never invent an exception.',
      },
    },
    {
      tags: ['bestrider', 'fel', 'inte min', 'dispute', 'wrong', 'not mine', 'inte betala', 'varför'],
      text: {
        sv: 'Om personen bestrider skulden eller säger att den är fel: hitta inte på detaljer om fakturan. Säg att du noterar invändningen och att en handläggare tar kontakt, och fråga om de vill lösa en del under tiden.',
        en: "If the person disputes the debt or says it's wrong: do not invent invoice details. Say you'll note the objection and a handler will be in touch, and ask if they'd like to settle part of it meanwhile.",
      },
    },
    {
      tags: ['arg', 'upprörd', 'angry', 'trött', 'stressad', 'ledsen', 'tone', 'artig'],
      text: {
        sv: 'Ton: lugn, respektfull och lösningsorienterad. Skäll aldrig, hota aldrig. Målet är en betalning personen faktiskt klarar, inom reglerna.',
        en: 'Tone: calm, respectful, solution-oriented. Never scold or threaten. The goal is a payment the person can actually manage, within the rules.',
      },
    },
    {
      tags: ['saldo', 'hur mycket', 'skuld', 'balance', 'owe', 'belopp', 'faktura', 'invoice'],
      text: {
        sv: 'Ärendet gäller en obetald faktura hos Nordisk Inkasso. Bekräfta beloppet men ändra det aldrig — själva skulden är fast, bara betalningssättet förhandlas.',
        en: 'The case is an unpaid invoice with Nordisk Inkasso. Confirm the amount but never change it — the debt itself is fixed, only the way of paying is negotiated.',
      },
    },
  ],
  booking: [
    {
      tags: ['tjänst', 'klipp', 'färg', 'service', 'cut', 'colour', 'behandling', 'vad', 'gör'],
      text: {
        sv: 'Studio Norr erbjuder klippning (ca 30 min, 450 kr) och färgning (ca 90 min, från 950 kr). Boka genom att välja tjänst och en ledig tid.',
        en: 'Studio Norr offers haircuts (~30 min, 450 kr) and colouring (~90 min, from 950 kr). Book by choosing a service and an open time.',
      },
    },
    {
      tags: ['tid', 'ledig', 'when', 'time', 'öppet', 'imorgon', 'fredag', 'boka'],
      text: {
        sv: 'Agenten föreslår bara tider som faktiskt är lediga och kan aldrig dubbelboka. Fråga vilken tjänst det gäller och erbjud nästa lediga tid.',
        en: 'The agent only offers times that are genuinely open and can never double-book. Ask which service it is and offer the next open slot.',
      },
    },
  ],
  reception: [
    {
      tags: ['öppet', 'tider', 'hours', 'pris', 'price', 'adress', 'parkering', 'betala'],
      text: {
        sv: 'Receptionen svarar bara från godkänd FAQ (öppettider, adress, parkering, priser, betalsätt). Utanför det gissar den aldrig — den tar ett meddelande.',
        en: 'Reception answers only from the approved FAQ (hours, address, parking, prices, payment). Beyond that it never guesses — it takes a message.',
      },
    },
  ],
};

const tokenize = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);

/** Return the top-k most relevant KB snippets (localised) for a query. */
export function retrieve(agentId: EngineId, query: string, locale: Locale, k = 4): string[] {
  const entries = KB[agentId] ?? [];
  const qTokens = new Set(tokenize(query));
  if (qTokens.size === 0) return entries.slice(0, k).map((e) => e.text[locale]);

  const scored = entries
    .map((e) => {
      const hay = new Set([...e.tags.map((t) => t.toLowerCase()), ...tokenize(e.text[locale]), ...tokenize(e.text.en)]);
      let score = 0;
      for (const q of qTokens) if (hay.has(q)) score += 1;
      return { e, score };
    })
    .sort((a, b) => b.score - a.score);

  const top = scored.filter((s) => s.score > 0).slice(0, k);
  // Always give the model at least the policy anchor so it never free-floats.
  const chosen = top.length > 0 ? top.map((s) => s.e) : entries.slice(0, Math.min(k, 2));
  return chosen.map((e) => e.text[locale]);
}
