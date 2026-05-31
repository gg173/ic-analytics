import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

function initialsFromEmail(email: string): string {
  const local = email.split('@')[0] ?? email;
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
  }
  return local.slice(0, 2).toUpperCase();
}

function formatHeaderDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatHeaderTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function HeaderUserPanel() {
  const { user, organization, signOut, canManageHomecareRules } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const menuWrapRef = useRef<HTMLDivElement>(null);

  const email = user?.email ?? '';
  const initials = useMemo(() => initialsFromEmail(email || '?'), [email]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!menuWrapRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  if (!user) return null;

  return (
    <div className="hc-header-top-right">
      <div className="hc-header-clock" aria-live="polite">
        <span className="hc-header-clock-date">{formatHeaderDate(now)}</span>
        <span className="hc-header-clock-time">{formatHeaderTime(now)}</span>
      </div>

      <div className="hc-header-top-divider" aria-hidden />

      <div className="hc-header-user">
        <div className="hc-header-user-menu-wrap" ref={menuWrapRef}>
          <button
            type="button"
            className="hc-header-user-avatar"
            aria-label="Account menu"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {initials}
          </button>
          {menuOpen && (
            <div className="hc-header-user-menu" role="menu">
              {canManageHomecareRules && (
                <Link
                  to="/homecare/admin"
                  className="hc-header-user-menu-item"
                  role="menuitem"
                  onClick={() => setMenuOpen(false)}
                >
                  Admin
                </Link>
              )}
              <button
                type="button"
                className="hc-header-user-menu-item"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  void signOut();
                }}
              >
                Sign out
              </button>
            </div>
          )}
        </div>
        <div className="hc-header-user-text">
          <span className="hc-header-user-email">{email}</span>
          <span className="hc-header-user-org">{organization?.name ?? 'Unknown organization'}</span>
        </div>
      </div>
    </div>
  );
}
