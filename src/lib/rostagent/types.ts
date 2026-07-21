// Shared contract for the /rostagent live demo engines.
//
// The whole point of this demo: the *agent* only speaks; a deterministic
// engine makes every decision (amount, slot, answer). Each engine below
// dramatises one hard guarantee a normal chatbot can't give:
//   • payment   — never miscalculates money (bounded negotiation waterfall)
//   • booking   — never double-books (checks real open slots)
//   • reception — never invents an answer (approved FAQ or takes a message)
//
// Engines are pure reducers: handle(state, input, locale) -> {state, result}.
// The React component holds `state` in a ref and swaps it each turn. Nothing
// here touches the network, a key, or the LLM — it runs entirely in-browser.

export type Locale = 'sv' | 'en';

export type DecisionTone = 'good' | 'warn' | 'neutral';

/** One key/value row in the "what the code decided" telemetry panel. */
export interface DecisionRow {
  k: string;
  v: string;
}

/** The visible proof that a deterministic tool call — not the LLM — decided. */
export interface Decision {
  /** Short uppercase label, e.g. "SETTLEMENT", "BOOKED", "FAQ MATCH". */
  label: string;
  tone: DecisionTone;
  /** The tool name the "LLM" was allowed to call. */
  tool: string;
  rows: DecisionRow[];
}

/** A terminal outcome appended to the CRM-style ledger panel. */
export interface LedgerEntry {
  outcome: string;
  tone: DecisionTone;
  detail: string;
  amount?: string;
}

export interface EngineResult {
  /** What the agent says out loud / prints. */
  reply: string;
  /** Present when a deterministic tool call fired this turn (drives the panel). */
  decision?: Decision;
  /** Present when the conversation reached a terminal outcome (drives the CRM). */
  ledger?: LedgerEntry;
  /** True once the conversation is finished. */
  done: boolean;
  /**
   * True when the engine did NOT understand the input and produced only a
   * generic re-prompt. The client uses this to escalate the turn to the
   * RAG + LLM layer (natural-language understanding); the engine's own reply
   * is the graceful fallback if the LLM is unavailable. When escalating, the
   * returned `state` must be unchanged so the LLM's paraphrase can be re-run
   * from the same point.
   */
  fallthrough?: boolean;
}

export interface Engine<S = unknown> {
  id: 'payment' | 'booking' | 'reception';
  emoji: string;
  label: Record<Locale, string>;
  /** One-line description shown under the scenario picker. */
  blurb: Record<Locale, string>;
  /** Fresh conversation state. */
  init(): S;
  /** The agent's opening line (pure, SSR-safe — no browser APIs). */
  greeting(locale: Locale): string;
  /** Suggested things a visitor can say, to lower the "what do I type?" barrier. */
  hints(locale: Locale): string[];
  /** Advance the conversation by one user turn. */
  handle(state: S, input: string, locale: Locale): { state: S; result: EngineResult };
}
