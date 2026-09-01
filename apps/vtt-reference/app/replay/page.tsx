'use client';

import { useEffect, useState } from 'react';

export default function ReplayPage() {
  const [frames, setFrames] = useState<Array<{ sequence: number; type: string; at: string }>>([]);
  useEffect(() => {
    void fetch('/api/actualplay/vtt/replay', { credentials: 'include' })
      .then((response) => response.json())
      .then((body: { frames?: Array<{ sequence: number; type: string; at: string }> }) => setFrames(body.frames ?? []));
  }, []);
  return (
    <main className="side">
      <h1 data-testid="view-title">Replay</h1>
      <ol>
        {frames.map((frame) => (
          <li key={frame.sequence}>
            {frame.sequence} {frame.type} {frame.at}
          </li>
        ))}
      </ol>
    </main>
  );
}
