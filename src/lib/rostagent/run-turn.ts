// One conversational turn, client-side. Order of authority:
//   1. Guard   — injection/SQL/manipulation blocked instantly, before anything.
//   2. Engine  — deterministic decision (money, slot, FAQ). Instant + free.
//   3. LLM     — only if the engine didn't understand (fallthrough). The LLM
//                either speaks conversationally OR forwards a cleaned paraphrase
//                back through the engine, so decisions stay deterministic.
// If the network/LLM is unavailable, the engine's own re-prompt is the fallback,
// so the demo never hard-fails.

import { guardResponse, scanInput } from './guard';
import type { Engine, EngineResult, Locale } from './types';

export type TurnSource = 'guard' | 'engine' | 'llm' | 'llm+engine' | 'fallback';

export interface TurnOutput {
  state: unknown;
  result: EngineResult;
  source: TurnSource;
}

interface HistoryMsg {
  role: 'user' | 'assistant';
  content: string;
}

export async function runTurn(params: {
  engine: Engine<unknown>;
  state: unknown;
  input: string;
  locale: Locale;
  history: HistoryMsg[];
}): Promise<TurnOutput> {
  const { engine, state, input, locale, history } = params;

  // 1) Guard — instant, no network, no engine advance.
  const hit = scanInput(input);
  if (hit) {
    const g = guardResponse(hit, locale);
    return { state, result: { reply: g.reply, decision: g.decision, done: false }, source: 'guard' };
  }

  // 2) Deterministic engine.
  const first = engine.handle(state, input, locale);
  if (!first.result.fallthrough) {
    return { state: first.state, result: first.result, source: 'engine' };
  }

  // 3) LLM fallback (engine didn't understand). Re-run from the ORIGINAL state
  //    if the model forwards a cleaned paraphrase. Hard 6s timeout: a slow or
  //    hung LLM degrades to the engine's own re-prompt instead of freezing the
  //    conversation.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch('/api/rostagent/turn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        agentId: engine.id,
        locale,
        messages: [...history, { role: 'user', content: input }].slice(-24),
      }),
    });
    const data = (await res.json()) as { source?: string; reply?: string | null; forwardToEngine?: string };

    if (data.source === 'llm') {
      const forward = (data.forwardToEngine ?? '').trim();
      if (forward) {
        const second = engine.handle(state, forward, locale);
        // If even the paraphrase falls through, prefer a natural LLM line if we got one.
        if (second.result.fallthrough && (data.reply ?? '').trim()) {
          return { state, result: { reply: (data.reply as string).trim(), done: false }, source: 'llm' };
        }
        return { state: second.state, result: second.result, source: 'llm+engine' };
      }
      if ((data.reply ?? '').trim()) {
        return { state: first.state, result: { reply: (data.reply as string).trim(), done: false }, source: 'llm' };
      }
    }
  } catch {
    /* fall through to the engine's own re-prompt */
  } finally {
    clearTimeout(timer);
  }

  // 4) Graceful fallback — the engine's deterministic re-prompt.
  return { state: first.state, result: first.result, source: 'fallback' };
}
