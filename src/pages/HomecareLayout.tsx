import { Link, Outlet, useLocation } from 'react-router-dom';
import { HeaderUserPanel } from '../homecare/components/HeaderUserPanel';
import { useAuth } from '../homecare/hooks/useAuth';
import { isSupabaseConfigured, supabaseKeyError } from '../lib/supabase';
import '../homecare/homecare.css';

const APP_LOGO_SRC = '/UHN-at-Home.svg';

export function HomecareLayout() {
  const { user, loading, canAccessAnalytics, canAccessHomecare, canAccessEpic } = useAuth();
  const location = useLocation();

  if (!isSupabaseConfigured) {
    return (
      <div className="hc-shell">
        <div className="hc-panel hc-error-panel">
          <h1>Supabase configuration error</h1>
          <p>{supabaseKeyError}</p>
          <p className="hc-muted">
            Copy <code>.env.example</code> to <code>.env.local</code>, then restart{' '}
            <code>npm run dev</code>.
          </p>
          <Link to="/" className="hc-btn hc-btn-secondary">
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="hc-shell">
        <p className="hc-muted">Loading…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="hc-shell hc-shell--gradient">
        <Outlet />
      </div>
    );
  }

  const isAnalytics = location.pathname.startsWith('/analytics');
  const isHomecare = location.pathname.startsWith('/homecare');
  const isEpicConversion = location.pathname.startsWith('/epic-conversion');

  return (
    <div className="hc-shell">
      <header className="hc-header">
        <div className="hc-header-top">
          <img src={APP_LOGO_SRC} alt="UHN at Home" className="hc-logo" />
          <HeaderUserPanel />
        </div>
        <div className="hc-header-bottom">
          <nav className="hc-nav" aria-label="Main">
            {canAccessAnalytics && (
              <Link
                to="/analytics"
                className={`hc-nav-link${isAnalytics ? ' hc-nav-link--active' : ''}`}
              >
                Analytics
              </Link>
            )}
            {canAccessHomecare && (
              <Link
                to="/homecare"
                className={`hc-nav-link${isHomecare ? ' hc-nav-link--active' : ''}`}
              >
                Homecare Billing
              </Link>
            )}
            {canAccessEpic && (
              <Link
                to="/epic-conversion"
                className={`hc-nav-link${isEpicConversion ? ' hc-nav-link--active' : ''}`}
              >
                Epic Conversion
              </Link>
            )}
          </nav>
        </div>
      </header>
      <main className="hc-main">
        <Outlet />
      </main>
    </div>
  );
}
