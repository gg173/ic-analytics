import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { canAccessModule, type AppModule } from '../homecare/access';
import { useAuth } from '../homecare/hooks/useAuth';

export function ProtectedModuleRoute({ module }: { module: AppModule }) {
  const auth = useAuth();
  const location = useLocation();

  if (auth.loading) return <p className="hc-muted">Loading…</p>;
  if (!auth.user || !auth.profile) {
    return <Navigate to="/" state={{ from: location.pathname }} replace />;
  }

  if (!canAccessModule(auth, module)) {
    if (auth.defaultPath && auth.defaultPath !== '/') {
      return <Navigate to={auth.defaultPath} replace />;
    }
    return (
      <div className="hc-panel hc-unauthorized-panel">
        <h2>Access not available</h2>
        <p className="hc-muted">
          Your account does not have permission to open this section. Contact an App Admin if you
          need access.
        </p>
      </div>
    );
  }

  return <Outlet />;
}
