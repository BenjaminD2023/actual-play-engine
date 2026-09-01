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
    for (const event of events) {
      if (event.sequence === this.lastEventSequence + 1) this.lastEventSequence = event.sequence;
      else if (event.sequence > this.lastEventSequence + 1) {
        await this.loadSnapshot();
        return events;
      }
    }
    return events;
  }

  connect(onEvent: (event: unknown) => void): () => void {
    this.source = new EventSource(`${this.base}/events`);
    this.source.onmessage = (message) => {
      onEvent(JSON.parse(message.data) as unknown);
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
