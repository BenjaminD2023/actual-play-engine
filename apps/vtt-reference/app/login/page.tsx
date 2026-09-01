'use client';

import { useState } from 'react';

const HOME: Record<string, string> = {
  admin: '/director',
  dm: '/director',
  player: '/player',
  audience: '/audience',
};

export default function LoginPage() {
  const [error, setError] = useState('');
  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const response = await fetch('/api/actualplay/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: data.get('username'), password: data.get('password') }),
    });
    if (!response.ok) {
      setError('Login failed');
      return;
    }
    const body = (await response.json()) as { user?: { role?: string } };
    window.location.href = HOME[body.user?.role ?? 'admin'] ?? '/director';
  }
  return (
    <div className="login">
      <form className="card" onSubmit={onSubmit}>
        <h1>Login</h1>
        <p>Seeds: admin/admin, dm/dm, p1/p1, p2/p2, audience/audience</p>
        <p>
          <label>
            username
            <input name="username" defaultValue="admin" autoComplete="username" />
          </label>
        </p>
        <p>
          <label>
            password
            <input name="password" type="password" defaultValue="admin" autoComplete="current-password" />
          </label>
        </p>
        <button type="submit">enter</button>
        <p>{error}</p>
      </form>
    </div>
  );
}
