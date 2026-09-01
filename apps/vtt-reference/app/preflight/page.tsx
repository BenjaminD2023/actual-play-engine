'use client';

import { useEffect, useState } from 'react';

export default function PreflightPage() {
  const [data, setData] = useState<unknown>(null);
  useEffect(() => {
    void fetch('/api/actualplay/vtt/preflight', { credentials: 'include' })
      .then((response) => response.json())
      .then(setData);
  }, []);
  return (
    <main className="side">
      <h1 data-testid="view-title">Preflight</h1>
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </main>
  );
}
