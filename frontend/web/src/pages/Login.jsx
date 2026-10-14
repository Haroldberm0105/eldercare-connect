import React, { useState } from 'react';
import { login } from '../api';
import { Logo } from '../components/Shell';
import { DEMO, DEMO_PASSWORD } from '../demoAccounts';


export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);

  async function signIn(u, p, key) {
    setBusy(key);
    setError('');
    try {
      await login(u, p); // App reacts to the identity change and opens the right home page
    } catch (err) {
      setError(err.message);
      setBusy(null);
    }
  }

  return (
    <div className="login">
      <section className="login-story">
        <div className="brand brand-lg">
          <Logo size={36} />
          <span>ElderCare Connect</span>
        </div>
        <h1>Care at home, seen by the health center the same minute.</h1>
        <p>
          Caregivers log daily vitals. Families get alerts wherever they are. Nurses see who needs a visit first,
          including when heat or a typhoon puts frail patients at risk.
        </p>
        <ul className="story-points">
          <li><strong>Daily check-ins</strong> from the app, the web, or a plain text message</li>
          <li><strong>Instant alerts</strong> to family by SMS when readings are abnormal</li>
          <li><strong>One risk queue</strong> for the clinic, ranked by health and weather risk</li>
        </ul>
      </section>

      <section className="login-panel">
        <form className="login-form" onSubmit={(e) => { e.preventDefault(); signIn(username, password, 'form'); }}>
          <h2>Sign in</h2>
          <label className="field">
            <span>Username</span>
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" required />
          </label>
          <label className="field">
            <span>Password</span>
            <div className="input-with-action">
              <input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
              <button type="button" className="input-action" onClick={() => setShowPassword(!showPassword)} aria-pressed={showPassword}>
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </label>
          {error && <div className="note note-error" role="alert">{error}</div>}
          <button className="btn btn-primary btn-block" disabled={!!busy}>{busy === 'form' ? 'Signing in…' : 'Sign in'}</button>
        </form>

        {import.meta.env.DEV && (
          <div className="demo">
            <h3>Demo accounts</h3>
            <p className="muted small">One click signs you in. All demo passwords are {DEMO_PASSWORD}.</p>
            <div className="demo-grid">
              {DEMO.map((d) => (
                <button key={d.username} type="button" className="demo-tile" disabled={!!busy} onClick={() => signIn(d.username, DEMO_PASSWORD, d.username)}>
                  <strong>{d.role}</strong>
                  <span>{busy === d.username ? 'Signing in…' : d.does}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
