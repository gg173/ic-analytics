import { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { resolvePostLoginPath } from '../homecare/access';
import { useAuth } from '../homecare/hooks/useAuth';

const APP_LOGO_SRC = '/UHN-at-Home.svg';

export function LoginPage() {
  const auth = useAuth();
  const { user, profile, signIn } = auth;
  const location = useLocation();
  const redirectFrom = (location.state as { from?: string } | null)?.from;
  const from = resolvePostLoginPath(redirectFrom, auth);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canSubmit = email.trim().length > 0 && password.length > 0;

  if (user && profile) return <Navigate to={from} replace />;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await signIn(email, password);
    if (result.error) setError(result.error);
    setBusy(false);
  };

  return (
    <div className="hc-login">
      <div className="hc-panel hc-login-panel">
        <div className="hc-login-brand">
          <img src={APP_LOGO_SRC} alt="UHN at Home" className="hc-login-logo" />
        </div>
        <p className="hc-muted">
          Sign in with your organization email account to access the UHN@Home Digital Program
          Workspace
        </p>

        <form onSubmit={handleSubmit} className="hc-form">
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </label>

          {error && <p className="hc-form-error">{error}</p>}

          <button type="submit" className="hc-btn hc-btn-primary" disabled={busy || !canSubmit}>
            {busy ? 'Please wait…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
