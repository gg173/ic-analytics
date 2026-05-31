import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../homecare/hooks/useAuth';

export function ProtectedHomecareRoute() {
  const { user, profile, loading } = useAuth();
  const location = useLocation();

  if (loading) return <p className="hc-muted">Loading…</p>;
  if (!user || !profile) {
    return <Navigate to="/" state={{ from: location.pathname }} replace />;
  }

  return <Outlet />;
}
