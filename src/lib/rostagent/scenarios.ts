// Registry of the three demo engines. The component picks one by id.
import { bookingEngine } from './booking';
import { paymentEngine } from './payment';
import { receptionEngine } from './reception';
import type { Engine } from './types';

// Order = the story we want a visitor to walk: book → ask → collect.
export const ENGINES: Engine<unknown>[] = [
  bookingEngine as Engine<unknown>,
  receptionEngine as Engine<unknown>,
  paymentEngine as Engine<unknown>,
];

export type EngineId = Engine['id'];

export function getEngine(id: EngineId): Engine<unknown> {
  return ENGINES.find((e) => e.id === id) ?? ENGINES[0];
}

export * from './types';
