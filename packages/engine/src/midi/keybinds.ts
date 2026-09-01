import { isTriggeringMidiNote } from '../live/combat.js';
import type { MidiEvent, MidiKeybind } from './protocol.js';

export const DEFAULT_MIDI_DEDUPE_MS = 500;

export class MidiDedupe {
  private recent = new Map<string, number>();

  constructor(private readonly windowMs = DEFAULT_MIDI_DEDUPE_MS) {}

  shouldSkip(actionType: string, channel: unknown, data1: unknown, now = Date.now()): boolean {
    for (const [key, timestamp] of this.recent) {
      if (now - timestamp > this.windowMs) this.recent.delete(key);
    }
    const key = `${actionType}:${typeof channel === 'number' ? channel : 'unknown'}:${typeof data1 === 'number' ? data1 : 'unknown'}`;
    const previous = this.recent.get(key);
    if (previous && now - previous <= this.windowMs) return true;
    this.recent.set(key, now);
    return false;
  }
}

export function matchKeybind(event: MidiEvent, keybinds: MidiKeybind[]): MidiKeybind | null {
  if (!isTriggeringMidiNote(event.midiType, event.velocity, event.data2)) return null;
  if (typeof event.channel !== 'number' || typeof event.data1 !== 'number') return null;

  return (
    keybinds.find(
      (bind) =>
        bind.is_active &&
        bind.midi_type === event.midiType &&
        bind.midi_channel === event.channel &&
        bind.midi_data1 === event.data1
    ) ?? null
  );
}
