import { TryAgent } from '@/components/rostagent-demo/TryAgent';

export default function Home() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <header className="mb-8">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-ash)]">
          Live demo · three agents · sv/en · voice optional
        </p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-[var(--color-warm)]">
          The AI speaks. <span className="text-[var(--color-ember)]">The code decides.</span>
        </h1>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-[var(--color-warm-dim)]">
          Every number, slot and fact below is decided by a deterministic engine — the LLM only
          interprets messy input and never has authority over money. Try to talk the debt-collection
          agent below its floor, double-book the salon, or prompt-inject any of them.
        </p>
      </header>
      <TryAgent locale="en" />
    </main>
  );
}
