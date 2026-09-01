export type EngineEventType =
  | 'qlab.health'
  | 'command.fired'
  | 'combat.updated'
  | 'poll.updated'
  | 'player.updated'
  | 'session.updated'
  | 'midi.event'
  | 'display.announcement';

export interface EngineEvent<T = unknown> {
  id: number;
  type: EngineEventType;
  at: string;
  payload: T;
}

type Listener = (event: EngineEvent) => void;

export class EngineEventBus {
  private listeners = new Set<Listener>();
  private nextId = 1;

  emit<T>(type: EngineEventType, payload: T): EngineEvent<T> {
    const event: EngineEvent<T> = {
      id: this.nextId++,
      type,
      at: new Date().toISOString(),
      payload,
    };
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // SSE listeners must not break the bus.
      }
    }
    return event;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
