'use client';

// Live, testable voice/chat demo of the agent — text-first, voice-optional.
//
// Brain: guard → deterministic engine → RAG+LLM fallback (see run-turn.ts). The
// engine makes every real decision; the LLM only helps understand messy input
// and chit-chat. Voice is the browser's own free Web Speech (STT + TTS); text
// always works as the primary path. Language (SV/EN) is switchable in-widget.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ENGINES, getEngine, type EngineId } from '@/lib/rostagent/scenarios';
import { runTurn, type TurnSource } from '@/lib/rostagent/run-turn';
import type { Decision, LedgerEntry, Locale } from '@/lib/rostagent/types';

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  }
}
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { results: { 0: { 0: { transcript: string } } } }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
}

type Msg = { id: number; who: 'agent' | 'user'; text: string };

const toneCls: Record<Decision['tone'], string> = {
  good: 'text-emerald-700 border-emerald-500/30 bg-emerald-500/[0.06]',
  warn: 'text-amber-700 border-amber-500/30 bg-amber-500/[0.06]',
  neutral: 'text-slate-600 border-slate-400/30 bg-slate-500/[0.05]',
};

/** Which layer produced the last reply — the hybrid architecture, made visible. */
const SOURCE_LABEL: Record<TurnSource, { sv: string; en: string }> = {
  engine: { sv: 'motor · direkt', en: 'engine · direct' },
  'llm+engine': { sv: 'AI tolkade → motorn beslutade', en: 'AI parsed → engine decided' },
  llm: { sv: 'AI · småprat', en: 'AI · small talk' },
  guard: { sv: 'guard · blockerad', en: 'guard · blocked' },
  fallback: { sv: 'motor · reserv', en: 'engine · fallback' },
};

const COPY = {
  sv: {
    eyebrow: 'Prova agenten live',
    title: 'Testa den själv — skriv eller prata',
    sub: 'Välj en agent, skriv eller prata. Panelen visar exakt vad koden beslutar för varje svar — AI:n pratar, men koden bestämmer.',
    guarantee: {
      booking: 'Kan aldrig dubbelboka',
      reception: 'Hittar aldrig på ett svar',
      payment: 'Räknar aldrig fel på pengar',
    } as Record<EngineId, string>,
    placeholder: 'Skriv ditt svar…',
    send: 'Skicka',
    restart: 'Börja om',
    tryPrefix: 'Prova:',
    panelTitle: 'Vad koden beslutar',
    panelIdle: 'Skriv något till agenten så visas beslutet här — verktyget som anropades och värdena det returnerade.',
    tool: 'Verktyg',
    crmTitle: 'Loggen (CRM)',
    crmIdle: 'Avslutade ärenden hamnar här — precis som de skulle landa i ditt system.',
    listening: 'Lyssnar…',
    micStart: 'Prata',
    voiceOn: 'Röst på',
    voiceOff: 'Röst av',
    voiceNote: 'Rösten bearbetas av din webbläsare (Web Speech). Inget skickas till oss.',
    micDenied: 'Mikrofonåtkomst nekad — skriv i stället, eller tillåt mikrofonen i webbläsaren.',
    micFailed: 'Röstinmatning misslyckades — skriv i stället.',
    thinking: 'skriver…',
    done: 'Samtalet är avslutat.',
    you: 'Du',
    agent: 'Agenten',
    langLabel: 'Språk',
  },
  en: {
    eyebrow: 'Try the agent live',
    title: 'Test it yourself — type or talk',
    sub: 'Pick an agent, type or talk. The panel shows exactly what the code decides for every reply — the AI speaks, but the code decides.',
    guarantee: {
      booking: 'Can never double-book',
      reception: 'Never invents an answer',
      payment: 'Never miscalculates money',
    } as Record<EngineId, string>,
    placeholder: 'Type your reply…',
    send: 'Send',
    restart: 'Restart',
    tryPrefix: 'Try:',
    panelTitle: 'What the code decides',
    panelIdle: 'Say something to the agent and the decision shows here — the tool it called and the values it returned.',
    tool: 'Tool',
    crmTitle: 'The log (CRM)',
    crmIdle: 'Closed cases land here — exactly as they would in your system.',
    listening: 'Listening…',
    micStart: 'Talk',
    voiceOn: 'Voice on',
    voiceOff: 'Voice off',
    voiceNote: 'Voice is processed by your browser (Web Speech). Nothing is sent to us.',
    micDenied: 'Microphone access denied — type instead, or allow the mic in your browser.',
    micFailed: 'Voice input failed — type instead.',
    thinking: 'typing…',
    done: 'The call has ended.',
    you: 'You',
    agent: 'Agent',
    langLabel: 'Language',
  },
} as const;

export function TryAgent({ locale }: { locale: Locale }) {
  const [lang, setLang] = useState<Locale>(locale);
  const c = COPY[lang];
  const [engineId, setEngineId] = useState<EngineId>('booking');
  const engine = useMemo(() => getEngine(engineId), [engineId]);

  const idRef = useRef(0);
  const nextId = () => ++idRef.current;

  const [messages, setMessages] = useState<Msg[]>(() => [
    { id: nextId(), who: 'agent', text: getEngine('booking').greeting(locale) },
  ]);
  const [input, setInput] = useState('');
  const [decision, setDecision] = useState<Decision | null>(null);
  const [lastSource, setLastSource] = useState<TurnSource | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [done, setDone] = useState(false);
  const [thinking, setThinking] = useState(false);

  const [voiceOn, setVoiceOn] = useState(false);
  const [listening, setListening] = useState(false);
  const [sttSupported, setSttSupported] = useState(false);
  const [ttsSupported, setTtsSupported] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);

  const stateRef = useRef<unknown>(engine.init());
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const decisionRef = useRef<HTMLDivElement>(null);
  const restartRef = useRef<HTMLButtonElement>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const busyRef = useRef(false);
  const voiceOnRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    voiceOnRef.current = voiceOn;
  }, [voiceOn]);

  // Feature-detect after mount (keeps SSR + first client render identical).
  useEffect(() => {
    mountedRef.current = true;
    if (typeof window !== 'undefined') {
      setSttSupported(!!(window.SpeechRecognition || window.webkitSpeechRecognition));
      setTtsSupported(typeof window.speechSynthesis !== 'undefined');
      const warm = () => {
        try {
          window.speechSynthesis?.getVoices();
        } catch {
          /* ignore */
        }
      };
      warm();
      if (typeof window.speechSynthesis !== 'undefined') {
        window.speechSynthesis.onvoiceschanged = warm;
      }
    }
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Autoscroll the transcript.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, thinking]);

  // Focus the Restart button when the conversation ends (keyboard/SR users).
  useEffect(() => {
    if (done) restartRef.current?.focus();
  }, [done]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      try {
        recRef.current?.abort();
        window.speechSynthesis?.cancel();
      } catch {
        /* ignore */
      }
    };
  }, []);

  const speak = useCallback(
    (text: string) => {
      if (!voiceOnRef.current || typeof window === 'undefined' || !window.speechSynthesis || !text) return;
      try {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = lang === 'sv' ? 'sv-SE' : 'en-US';
        // Rank voices instead of taking the first match: Chrome's network-backed
        // Google voices and the OS "natural/enhanced/premium" voices are far more
        // pleasant than the default first hit (often a robotic legacy voice).
        const pref = lang === 'sv' ? 'sv' : 'en';
        const cands = window.speechSynthesis.getVoices().filter((v) => v.lang?.toLowerCase().startsWith(pref));
        const match =
          cands.find((v) => /google/i.test(v.name) && v.localService === false) ??
          cands.find((v) => /natural|premium|enhanced|neural|siri/i.test(v.name)) ??
          cands.find((v) => v.localService === false) ??
          cands[0];
        if (match) u.voice = match;
        u.rate = 1.02;
        utteranceRef.current = u; // retain against Chrome's GC bug
        window.speechSynthesis.speak(u);
      } catch {
        /* ignore */
      }
    },
    [lang],
  );

  const scrollPanelIfMobile = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (!window.matchMedia('(min-width: 1024px)').matches) {
      requestAnimationFrame(() => decisionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
    }
  }, []);

  const start = useCallback(
    (id: EngineId, l: Locale) => {
      try {
        window.speechSynthesis?.cancel();
        recRef.current?.abort();
      } catch {
        /* ignore */
      }
      busyRef.current = false;
      setListening(false);
      setMicError(null);
      setEngineId(id);
      setLang(l);
      const eng = getEngine(id);
      stateRef.current = eng.init();
      setMessages([{ id: nextId(), who: 'agent', text: eng.greeting(l) }]);
      setDecision(null);
      setLastSource(null);
      setLedger([]);
      setDone(false);
      setThinking(false);
      setInput('');
    },
    [],
  );

  const send = async (raw?: string) => {
    const text = (raw ?? input).trim();
    if (!text || done || busyRef.current) return;
    setInput('');
    setMicError(null);
    setMessages((m) => [...m, { id: nextId(), who: 'user', text }]);

    const history = messages.map((m) => ({ role: m.who === 'user' ? ('user' as const) : ('assistant' as const), content: m.text }));
    busyRef.current = true;
    setThinking(true);
    try {
      const out = await runTurn({ engine, state: stateRef.current, input: text, locale: lang, history });
      if (!mountedRef.current) return;
      stateRef.current = out.state;
      const r = out.result;
      setLastSource(out.source);
      setMessages((m) => [...m, { id: nextId(), who: 'agent', text: r.reply }]);
      if (r.decision) setDecision(r.decision);
      if (r.ledger) setLedger((l) => [r.ledger as LedgerEntry, ...l]);
      if (r.done) setDone(true);
      speak(r.reply);
      if (r.decision) scrollPanelIfMobile();
    } finally {
      if (mountedRef.current) setThinking(false);
      busyRef.current = false;
    }
  };
  const sendRef = useRef(send);
  sendRef.current = send;

  const startListening = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR || listening) return;
    setMicError(null);
    try {
      const rec = new SR();
      rec.lang = lang === 'sv' ? 'sv-SE' : 'en-US';
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      rec.continuous = false;
      rec.onresult = (e) => {
        const transcript = e.results[0][0].transcript;
        if (transcript) sendRef.current(transcript);
      };
      // Only clear listening if THIS instance still owns the ref (avoids a
      // superseded instance's late onend flipping a newer one off).
      rec.onend = () => {
        if (recRef.current === rec) setListening(false);
      };
      rec.onerror = (e) => {
        if (recRef.current === rec) setListening(false);
        const err = e?.error;
        if (err === 'not-allowed' || err === 'service-not-allowed') setMicError(COPY[lang].micDenied);
        else if (err && err !== 'aborted' && err !== 'no-speech') setMicError(COPY[lang].micFailed);
      };
      recRef.current = rec;
      setListening(true);
      rec.start();
    } catch {
      setListening(false);
    }
  }, [lang, listening]);

  const stopListening = useCallback(() => {
    try {
      recRef.current?.stop();
    } catch {
      /* ignore */
    }
    setListening(false);
  }, []);

  const toggleVoice = useCallback(() => {
    setVoiceOn((prev) => {
      const next = !prev;
      if (next) {
        // Prime speechSynthesis inside this user gesture so iOS Safari unlocks it.
        try {
          const warm = new SpeechSynthesisUtterance(' ');
          warm.volume = 0;
          window.speechSynthesis?.speak(warm);
        } catch {
          /* ignore */
        }
      } else {
        window.speechSynthesis?.cancel();
      }
      return next;
    });
  }, []);

  const hints = useMemo(() => engine.hints(lang), [engine, lang]);

  return (
    <section className="mx-auto max-w-6xl px-6 lg:px-8">
      <style>{`
        @keyframes ra-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
        .ra-in { animation: ra-in .28s cubic-bezier(.23,1,.32,1) both; }
        @keyframes ra-blink { 0%,80%,100% { opacity:.25 } 40% { opacity:1 } }
        .ra-dot { animation: ra-blink 1.2s infinite both; }
        @media (prefers-reduced-motion: reduce) {
          .ra-in { animation: none; }
          .ra-dot { animation: none; opacity:.6; }
        }
      `}</style>

      <div className="overflow-hidden rounded-3xl border border-black/[0.08] bg-[var(--color-bg-elevated)] shadow-[0_24px_70px_-30px_rgba(24,18,12,0.35)]">
        {/* Header + language + scenario picker */}
        <div className="border-b border-black/[0.06] bg-[var(--color-bg-tinted)]/50 p-6 sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] font-semibold uppercase tracking-widest text-emerald-700">{c.eyebrow}</p>
              <h3 className="mt-2 text-xl font-semibold tracking-tight sm:text-2xl">{c.title}</h3>
            </div>
            {/* Language selector */}
            <div className="flex overflow-hidden rounded-full border border-black/[0.1] bg-[var(--color-bg)] text-sm" role="group" aria-label={c.langLabel}>
              {(['sv', 'en'] as Locale[]).map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => start(engineId, l)}
                  aria-pressed={lang === l}
                  className={
                    'px-3.5 py-1.5 font-medium transition-colors ' +
                    (lang === l ? 'bg-emerald-600 text-white' : 'text-[var(--color-warm-dim)] hover:text-[var(--color-warm)]')
                  }
                >
                  {l === 'sv' ? 'Svenska' : 'English'}
                </button>
              ))}
            </div>
          </div>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--color-warm-dim)]">{c.sub}</p>

          <div className="mt-5 flex flex-wrap gap-2">
            {ENGINES.map((e) => {
              const active = e.id === engineId;
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => start(e.id as EngineId, lang)}
                  aria-pressed={active}
                  className={
                    'inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-all ' +
                    (active
                      ? 'border-emerald-500/40 bg-emerald-600 text-white shadow-sm'
                      : 'border-black/[0.1] bg-[var(--color-bg)] text-[var(--color-warm-dim)] hover:border-emerald-500/30 hover:text-[var(--color-warm)]')
                  }
                >
                  <span aria-hidden>{e.emoji}</span>
                  {e.label[lang]}
                </button>
              );
            })}
          </div>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--color-warm-dim)]">{engine.blurb[lang]}</p>
          <p className="mt-1.5 flex items-center gap-1.5 text-[13px] font-medium text-emerald-700">
            <span aria-hidden>✓</span>
            {c.guarantee[engineId]}
          </p>
        </div>

        <div className="grid lg:grid-cols-[1.15fr_0.85fr]">
          {/* Conversation */}
          <div className="flex min-h-[420px] flex-col border-b border-black/[0.06] lg:border-b-0 lg:border-r">
            <div
              ref={scrollRef}
              role="log"
              aria-live="polite"
              aria-relevant="additions text"
              className="max-h-[340px] flex-1 space-y-3 overflow-y-auto p-5 sm:max-h-[440px] sm:p-6"
            >
              {messages.map((m) => (
                <div key={m.id} className={'ra-in flex ' + (m.who === 'user' ? 'justify-end' : 'justify-start')}>
                  <div
                    className={
                      'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ' +
                      (m.who === 'user'
                        ? 'rounded-br-md bg-emerald-600 text-white'
                        : 'rounded-bl-md border border-black/[0.07] bg-[var(--color-bg)] text-[var(--color-warm)]')
                    }
                  >
                    <span className="sr-only">{(m.who === 'user' ? c.you : c.agent) + ': '}</span>
                    {m.text}
                  </div>
                </div>
              ))}
              {thinking && (
                <div className="flex justify-start">
                  <div className="rounded-2xl rounded-bl-md border border-black/[0.07] bg-[var(--color-bg)] px-4 py-3">
                    <span className="flex gap-1" aria-label={c.thinking}>
                      <span className="ra-dot h-1.5 w-1.5 rounded-full bg-[var(--color-ash)]" />
                      <span className="ra-dot h-1.5 w-1.5 rounded-full bg-[var(--color-ash)]" style={{ animationDelay: '.2s' }} />
                      <span className="ra-dot h-1.5 w-1.5 rounded-full bg-[var(--color-ash)]" style={{ animationDelay: '.4s' }} />
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Suggestion chips */}
            {!done && (
              <div className="flex flex-wrap gap-1.5 px-5 pb-1 sm:px-6">
                {hints.map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => send(h)}
                    disabled={thinking}
                    className="rounded-full border border-black/[0.08] bg-[var(--color-bg)] px-2.5 py-1 text-[12px] text-[var(--color-warm-dim)] transition-colors hover:border-emerald-500/30 hover:text-emerald-700 disabled:opacity-50"
                  >
                    {c.tryPrefix} {h}
                  </button>
                ))}
              </div>
            )}

            {/* Input row */}
            <div className="border-t border-black/[0.06] p-3 sm:p-4">
              {done ? (
                <div role="status" className="flex items-center justify-between gap-3 rounded-xl bg-emerald-500/[0.07] px-4 py-3">
                  <span className="text-sm font-medium text-emerald-800">{c.done}</span>
                  <button
                    ref={restartRef}
                    type="button"
                    onClick={() => start(engineId, lang)}
                    className="rounded-full bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-500"
                  >
                    ↻ {c.restart}
                  </button>
                </div>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    send();
                  }}
                  className="flex items-center gap-2"
                >
                  {sttSupported && (
                    <button
                      type="button"
                      onClick={listening ? stopListening : startListening}
                      aria-label={listening ? c.listening : c.micStart}
                      title={listening ? c.listening : c.micStart}
                      className={
                        'flex h-11 w-11 flex-none items-center justify-center rounded-full border transition-all ' +
                        (listening
                          ? 'animate-pulse border-emerald-500 bg-emerald-600 text-white'
                          : 'border-black/[0.12] bg-[var(--color-bg)] text-[var(--color-warm-dim)] hover:border-emerald-500/40 hover:text-emerald-700')
                      }
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                        <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                        <path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4" />
                      </svg>
                    </button>
                  )}
                  <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder={listening ? c.listening : c.placeholder}
                    aria-label={c.placeholder}
                    className="h-11 flex-1 rounded-full border border-black/[0.12] bg-[var(--color-bg)] px-4 text-sm text-[var(--color-warm)] outline-none transition-colors placeholder:text-[var(--color-ash)] focus:border-emerald-500/50"
                  />
                  <button
                    type="submit"
                    disabled={!input.trim() || thinking}
                    className="h-11 flex-none rounded-full bg-emerald-600 px-5 text-sm font-semibold text-white transition-all hover:bg-emerald-500 disabled:opacity-40"
                  >
                    {c.send}
                  </button>
                </form>
              )}

              {ttsSupported && (
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 px-1">
                  <button
                    type="button"
                    onClick={toggleVoice}
                    aria-pressed={voiceOn}
                    className={
                      'inline-flex items-center gap-1.5 text-[12px] font-medium transition-colors ' +
                      (voiceOn ? 'text-emerald-700' : 'text-[var(--color-ash)] hover:text-[var(--color-warm-dim)]')
                    }
                  >
                    <span aria-hidden>{voiceOn ? '🔊' : '🔈'}</span>
                    {voiceOn ? c.voiceOn : c.voiceOff}
                  </button>
                  {(voiceOn || listening) && <span className="text-[11px] text-[var(--color-ash)]">{c.voiceNote}</span>}
                </div>
              )}
              {micError && (
                <p role="alert" className="mt-2 px-1 text-[12px] text-amber-700">
                  {micError}
                </p>
              )}
            </div>
          </div>

          {/* Decision + CRM panel — the money shot */}
          <div ref={decisionRef} className="space-y-5 bg-[var(--color-bg-tinted)]/30 p-5 sm:p-6">
            <div>
              <p className="flex items-baseline justify-between gap-2 font-mono text-[10px] font-semibold uppercase tracking-widest text-[var(--color-ash)]">
                <span>{c.panelTitle}</span>
                {lastSource && (
                  <span className="text-right text-[10px] font-medium text-emerald-700/80">
                    {SOURCE_LABEL[lastSource][lang]}
                  </span>
                )}
              </p>
              {decision ? (
                <div className={'mt-2 rounded-2xl border p-4 ' + toneCls[decision.tone]}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[13px] font-bold tracking-wide">{decision.label}</span>
                    <span aria-hidden className="text-lg">
                      {decision.tone === 'good' ? '✓' : decision.tone === 'warn' ? '⚠' : '•'}
                    </span>
                  </div>
                  <p className="mt-1 font-mono text-[11px] opacity-70">
                    {c.tool}: {decision.tool}
                  </p>
                  <dl className="mt-3 space-y-1.5">
                    {decision.rows.map((r) => (
                      <div key={r.k} className="flex items-baseline justify-between gap-3 border-t border-current/10 pt-1.5 first:border-t-0 first:pt-0">
                        <dt className="text-[12px] opacity-70">{r.k}</dt>
                        <dd className="text-right font-mono text-[13px] font-semibold tabular-nums">{r.v}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ) : (
                <p className="mt-2 rounded-2xl border border-dashed border-black/[0.12] p-4 text-[13px] leading-relaxed text-[var(--color-ash)]">
                  {c.panelIdle}
                </p>
              )}
            </div>

            <div>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-[var(--color-ash)]">
                {c.crmTitle}
              </p>
              {ledger.length > 0 ? (
                <ul className="mt-2 space-y-2">
                  {ledger.map((entry, i) => (
                    <li key={i} className={'ra-in rounded-xl border p-3 ' + toneCls[entry.tone]}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[12px] font-bold tracking-wide">{entry.outcome}</span>
                        {entry.amount && <span className="font-mono text-[12px] font-semibold tabular-nums">{entry.amount}</span>}
                      </div>
                      <p className="mt-1 text-[12px] leading-snug opacity-80">{entry.detail}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 rounded-2xl border border-dashed border-black/[0.12] p-4 text-[13px] leading-relaxed text-[var(--color-ash)]">
                  {c.crmIdle}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
