import type { DurableEvent, VttSnapshot } from '@actualplay/protocol';

export class VttConnection {
  snapshot: VttSnapshot | null = null;
  lastEventSequence = 0;
  private source: EventSource | null = null;

  constructor(private readonly base = '/api/actualplay') {}

  async loadSnapshot(): Promise<VttSnapshot> {
    const response = await fetch(`${this.base}/vtt/snapshot`, { credentials: 'include' });
    if (!response.ok) throw new Error(`snapshot ${response.status}`);
    this.snapshot = (await response.json()) as VttSnapshot;
    this.lastEventSequence = this.snapshot.lastEventSequence;
    return this.snapshot;
  }

  async fillGap(): Promise<DurableEvent[]> {
    const response = await fetch(`${this.base}/vtt/events?after=${this.lastEventSequence}`, { credentials: 'include' });
    if (!response.ok) throw new Error(`events ${response.status}`);
    const body = (await response.json()) as { events: DurableEvent[] };
    const events = body.events ?? [];
    let expected = this.lastEventSequence + 1;
    for (const event of events) {
      if (event.sequence === expected) {
        this.lastEventSequence = event.sequence;
        expected += 1;
        continue;
      }
      if (event.sequence > expected) {
        await this.loadSnapshot();
        return events;
      }
    }
    return events;
  }

  applyHello(replay: DurableEvent[], lastEventSequence: number): void {
    if (replay.length === 0) {
      this.lastEventSequence = Math.max(this.lastEventSequence, lastEventSequence);
      return;
    }
    for (const event of replay) {
      if (event.sequence === this.lastEventSequence + 1) this.lastEventSequence = event.sequence;
      else if (event.sequence > this.lastEventSequence + 1) {
        this.lastEventSequence = lastEventSequence;
        return;
      }
    }
  }

  connect(onEvent: (event: unknown) => void): () => void {
    const url = `${this.base}/vtt/stream`;
    this.source = new EventSource(url);
    this.source.onmessage = (message) => {
      const payload = JSON.parse(message.data) as {
        type?: string;
        replay?: DurableEvent[];
        lastEventSequence?: number;
        event?: DurableEvent;
      };
      if (payload.type === 'hello') {
        this.applyHello(payload.replay ?? [], payload.lastEventSequence ?? this.lastEventSequence);
      } else if (payload.event?.sequence !== undefined) {
        if (payload.event.sequence === this.lastEventSequence + 1) {
          this.lastEventSequence = payload.event.sequence;
        } else if (payload.event.sequence > this.lastEventSequence + 1) {
          void this.fillGap();
        }
      }
      onEvent(payload);
    };
    this.source.onerror = () => {
      void this.fillGap();
    };
    return () => this.source?.close();
  }

  async command(body: unknown): Promise<unknown> {
    const response = await fetch(`${this.base}/vtt/commands`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error((data as { message?: string }).message || 'command failed');
    return data;
  }
}
