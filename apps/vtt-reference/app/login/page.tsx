'use client';

import { useState } from 'react';

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
    window.location.href = '/director';
  }
  return (
    <div className="login">
      <form className="card" onSubmit={onSubmit}>
        <h1>Login</h1>
        <p>Reference console. Seed admin/admin (password hashed at boot).</p>
        <p>
          <label>
            username
            <input name="username" defaultValue="admin" />
          </label>
        </p>
        <p>
          <label>
            password
            <input name="password" type="password" defaultValue="admin" />
          </label>
        </p>
        <button type="submit">enter</button>
        <p>{error}</p>
      </form>
    </div>
  );
}
