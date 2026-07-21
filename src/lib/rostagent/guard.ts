// Input guard for the voice agent — the "safe to point at real customers" layer,
// made visible. Runs on BOTH the client (instant, offline, before any LLM call)
// and the server (defence in depth). Catches three abuse classes:
//
//   1. Prompt injection / jailbreak — "ignore your instructions", "you are now…",
//      "reveal your prompt", "developer mode".
//   2. Classic SQL-injection probes — ' OR 1=1, ; DROP TABLE, UNION SELECT.
//   3. Rule/authority manipulation — "give me 90% off", "override", "admin".
//
// A block is not just defence — it's the demo. The agent refuses and the
// decision panel shows GUARD ▸ blocked, so a prospect can literally try to
// break it and watch it hold.
//
// The deeper guarantee is architectural: even if a jailbreak slipped past these
// patterns, the LLM has no authority to move money or book slots — those come
// only from the deterministic engine. This layer stops the manipulation from
// ever reaching the model and gives the user immediate, honest feedback.

import type { Decision, Locale } from './types';

export type GuardCategory = 'injection' | 'sql' | 'manipulation';

export interface GuardHit {
  category: GuardCategory;
  /** The matched fragment (for the panel; already short + safe to show). */
  evidence: string;
}

const PATTERNS: { category: GuardCategory; re: RegExp }[] = [
  // Prompt injection / jailbreak
  { category: 'injection', re: /\bignore\b.{0,30}\b(previous|above|prior|earlier|all|your)\b.{0,20}\b(instruction|rule|prompt|direction)/i },
  { category: 'injection', re: /\b(glöm|bortse från|strunta i|ignorera)\b.{0,30}\b(instruktion|regl|tidigare|allt|ovan|din)/i },
  // Persona reassignment. Two shapes: "you are …" needs a role/instruction
  // signal (a bare article would false-positive on compliments like
  // "you are a lifesaver"); role-verbs (act as / pretend / agera som) are
  // themselves the signal and allow a plain article after.
  { category: 'injection', re: /\b(you are|you're|du är)\b.{0,20}\b(now|nu|different|annan|dan|admin|developer|system|an? (?:ai|assistant|robot|chatbot|agent|hacker|expert))\b/i },
  { category: 'injection', re: /\b(agera som|act as|pretend (to be|you)|låtsas vara)\b.{0,20}\b(a |an |en |ett |now|nu|different|annan|dan|admin|developer|system)/i },
  { category: 'injection', re: /\b(system ?prompt|reveal|show me|print|repeat|visa|avslöja)\b.{0,25}\b(prompt|instruction|instruktion|regl|system|guidelines|riktlinj)/i },
  { category: 'injection', re: /\b(jailbreak|developer mode|utvecklarläge|dan mode|no restrictions|inga regler|without restrictions|bypass)\b/i },
  { category: 'injection', re: /<\/?(system|instructions?|user_input)>/i },

  // SQL injection probes
  { category: 'sql', re: /('|")\s*(or|and)\s*('|"|\d)?\s*\d*\s*=\s*\d+/i }, // ' OR 1=1
  { category: 'sql', re: /\b(union\s+select|select\s+.*\s+from|insert\s+into|update\s+\w+\s+set)\b/i },
  { category: 'sql', re: /(;|--|\/\*)\s*(drop|delete|truncate|alter|update|insert)\b/i },
  { category: 'sql', re: /\bdrop\s+(table|database)\b|xp_cmdshell|sqlmap|information_schema/i },

  // Rule / discount / authority manipulation
  { category: 'manipulation', re: /\b(ge mig|give me|jag vill ha|i want)\b.{0,20}\b(gratis|free|100\s?%|90\s?%|allt gratis|everything free|full refund)\b/i },
  { category: 'manipulation', re: /\b(override|overrida|kringgå|sudo|admin access|as an admin|som admin|grant me|ge mig tillgång)\b/i },
];

/** Scan a single user message. Returns the first hit, or null if clean. */
export function scanInput(text: string): GuardHit | null {
  const t = text.slice(0, 2000);
  for (const { category, re } of PATTERNS) {
    const m = t.match(re);
    if (m) {
      const evidence = m[0].replace(/\s+/g, ' ').trim().slice(0, 60);
      return { category, evidence };
    }
  }
  return null;
}

const REFUSAL: Record<GuardCategory, Record<Locale, string>> = {
  injection: {
    sv: 'Jag kan inte ändra mina instruktioner eller gå utanför min roll. Jag hjälper dig gärna med det jag är till för — säg bara vad du behöver.',
    en: "I can't change my instructions or step outside my role. I'm happy to help with what I'm here for — just tell me what you need.",
  },
  sql: {
    sv: 'Det där ser ut som ett tekniskt kommando, inte en fråga jag kan hjälpa med. Vad kan jag göra för dig på riktigt?',
    en: "That looks like a technical command, not something I can help with. What can I actually do for you?",
  },
  manipulation: {
    sv: 'Jag kan inte gå utanför mina regler — priser, rabatter och beslut är låsta i koden, inte något jag kan hitta på. Men jag hjälper dig gärna inom det som är möjligt.',
    en: "I can't go outside my rules — prices, discounts and decisions are locked in code, not something I can invent. But I'm glad to help within what's possible.",
  },
};

const CATEGORY_LABEL: Record<GuardCategory, string> = {
  injection: 'PROMPT INJECTION',
  sql: 'SQL / COMMAND INJECTION',
  manipulation: 'RULE MANIPULATION',
};

/** Build the user-facing refusal + decision panel for a guard hit. */
export function guardResponse(hit: GuardHit, locale: Locale): { reply: string; decision: Decision } {
  return {
    reply: REFUSAL[hit.category][locale],
    decision: {
      label: 'BLOCKED',
      tone: 'warn',
      tool: 'inputGuard() → reject',
      rows: [
        { k: locale === 'sv' ? 'Typ' : 'Type', v: CATEGORY_LABEL[hit.category] },
        { k: locale === 'sv' ? 'Åtgärd' : 'Action', v: locale === 'sv' ? 'blockerad före modellen' : 'blocked before the model' },
        { k: locale === 'sv' ? 'Träff' : 'Match', v: hit.evidence },
      ],
    },
  };
}
