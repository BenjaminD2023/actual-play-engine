'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { VttCanvas } from '@actualplay/vtt';
import type { ProjectedLiveScene } from '@actualplay/protocol';

interface Frame {
  sequence: number;
  at: string;
  type: string;
  summary: string;
  category: string;
  commandId: string;
  unconfirmed?: boolean;
  error?: string | null;
}

export default function ReplayPage() {
  const [frames, setFrames] = useState<Frame[]>([]);
  const [filter, setFilter] = useState('all');
  const [cursor, setCursor] = useState(0);
  const [live, setLive] = useState<ProjectedLiveScene | null>(null);
  const [playing, setPlaying] = useState(false);
  const [liveMutated, setLiveMutated] = useState(false);
  const timer = useRef<number | null>(null);

  const filtered = frames.filter((frame) => filter === 'all' || frame.category === filter);
  const current = filtered[cursor] ?? filtered[filtered.length - 1];

  const loadFrames = useCallback(async () => {
    const response = await fetch('/api/actualplay/vtt/replay', { credentials: 'include' });
    const body = (await response.json()) as { frames?: Frame[]; liveMutated?: boolean };
    setFrames(body.frames ?? []);
    setLiveMutated(Boolean(body.liveMutated));
    if ((body.frames ?? []).length) setCursor((body.frames ?? []).length - 1);
  }, []);

  const loadAt = useCallback(async (sequence: number) => {
    const response = await fetch(`/api/actualplay/vtt/replay?at=${sequence}`, { credentials: 'include' });
    const body = (await response.json()) as { live?: ProjectedLiveScene | null; liveMutated?: boolean };
    setLive(body.live ?? null);
    setLiveMutated(Boolean(body.liveMutated));
  }, []);

  useEffect(() => {
    void loadFrames();
  }, [loadFrames]);

  useEffect(() => {
    if (current) void loadAt(current.sequence);
  }, [current, loadAt]);

  useEffect(() => {
    if (!playing) {
      if (timer.current) window.clearInterval(timer.current);
      return;
    }
    timer.current = window.setInterval(() => {
      setCursor((value) => Math.min(value + 1, Math.max(filtered.length - 1, 0)));
    }, 400);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [playing, filtered.length]);

  return (
    <div className="board replay">
      <div className="canvas-wrap">
        <p className="status replay-banner" data-testid="replay-readonly">
          Read-only reconstruction. Live session is not mutated{liveMutated ? ' — ERROR live mutated' : ''}.
        </p>
        <VttCanvas live={live} camera={live?.camera} interactive={false} />
      </div>
      <aside className="side">
        <h1 data-testid="view-title">Replay</h1>
        <p className="status">
          {filtered.length} events · cursor {current?.sequence ?? 0}
        </p>
        <label>
          Filter
          <select value={filter} onChange={(event) => { setFilter(event.target.value); setCursor(0); setPlaying(false); }}>
            <option value="all">all</option>
            <option value="scene">scene</option>
            <option value="token">token</option>
            <option value="map">map</option>
            <option value="combat">combat</option>
            <option value="poll">poll</option>
            <option value="qlab">qlab</option>
            <option value="recovery">recovery</option>
            <option value="show">show</option>
          </select>
        </label>
        <div className="toolbar wrap">
          <button type="button" data-testid="replay-play" onClick={() => setPlaying(true)}>
            play
          </button>
          <button type="button" data-testid="replay-pause" onClick={() => setPlaying(false)}>
            pause
          </button>
          <button type="button" data-testid="replay-back" onClick={() => { setPlaying(false); setCursor((value) => Math.max(0, value - 1)); }}>
            step back
          </button>
          <button type="button" data-testid="replay-forward" onClick={() => { setPlaying(false); setCursor((value) => Math.min(filtered.length - 1, value + 1)); }}>
            step forward
          </button>
        </div>
        <input
          data-testid="replay-scrub"
          type="range"
          min={0}
          max={Math.max(filtered.length - 1, 0)}
          value={cursor}
          onChange={(event) => {
            setPlaying(false);
            setCursor(Number(event.target.value));
          }}
        />
        <ol className="timeline">
          {filtered.map((frame, index) => (
            <li key={frame.sequence}>
              <button
                type="button"
                className={index === cursor ? 'active' : ''}
                onClick={() => { setPlaying(false); setCursor(index); }}
              >
                {frame.sequence} {frame.category} {frame.type}
                {frame.unconfirmed ? ' unconfirmed' : ''}
                {frame.error ? ` ${frame.error}` : ''}
              </button>
            </li>
          ))}
        </ol>
        <p>
          <a href="/api/actualplay/vtt/replay/export?format=json">JSON</a>
          {' · '}
          <a href="/api/actualplay/vtt/replay/export?format=csv">CSV</a>
          {' · '}
          <a href="/api/actualplay/vtt/replay/export?format=markers">chapter markers</a>
        </p>
      </aside>
    </div>
  );
}
