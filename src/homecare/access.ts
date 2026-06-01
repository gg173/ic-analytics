import type { UserRole } from './types';

export type AppModule = 'analytics' | 'homecare' | 'epic';

export interface UserAccess {
  isAppAdmin: boolean;
  isUhn: boolean;
  isSpo: boolean;
  /** UHN billing rules / push destinations admin (UHN Admin or App Admin). */
  canManageHomecareRules: boolean;
  isUhnAdmin: boolean;
  canEdit: boolean;
  canAccessHomecare: boolean;
  canAccessAnalytics: boolean;
  canAccessEpic: boolean;
  defaultPath: string;
}

export function resolveUserAccess(
  role: UserRole | undefined,
  orgSlug: string | undefined
): UserAccess {
  const isAppAdmin = role === 'app_admin';
  const slug = orgSlug ?? '';

  const canAccessHomecare = isAppAdmin;
  const canAccessAnalytics = isAppAdmin;

  const canAccessEpic =
    isAppAdmin ||
    role === 'uhn_admin' ||
    role === 'uhn_editor' ||
    role === 'vha_admin' ||
    role === 'ic_lead_hcs';

  const isUhn = isAppAdmin || slug === 'uhn';
  const isSpo = slug === 'spo' && !isAppAdmin;
  const canManageHomecareRules = isAppAdmin || role === 'uhn_admin';
  const isUhnAdmin = canManageHomecareRules;
  const canEdit =
    isAppAdmin || (slug === 'uhn' && (role === 'uhn_editor' || role === 'uhn_admin'));

  let defaultPath = '/';
  if (canAccessAnalytics) defaultPath = '/analytics';
  else if (canAccessEpic) defaultPath = '/epic-conversion';
  else if (canAccessHomecare) defaultPath = '/homecare';

  return {
    isAppAdmin,
    isUhn,
    isSpo,
    canManageHomecareRules,
    isUhnAdmin,
    canEdit,
    canAccessHomecare,
    canAccessAnalytics,
    canAccessEpic,
    defaultPath,
  };
}

export function canAccessModule(access: UserAccess, module: AppModule): boolean {
  switch (module) {
    case 'analytics':
      return access.canAccessAnalytics;
    case 'homecare':
      return access.canAccessHomecare;
    case 'epic':
      return access.canAccessEpic;
    default:
      return false;
  }
}

export function resolvePostLoginPath(
  redirectFrom: string | undefined,
  access: UserAccess
): string {
  if (
    redirectFrom &&
    redirectFrom !== '/' &&
    redirectFrom !== '/homecare/login' &&
    pathAllowed(redirectFrom, access)
  ) {
    return redirectFrom;
  }
  return access.defaultPath;
}

export function hasAnyModuleAccess(access: UserAccess): boolean {
  return access.canAccessAnalytics || access.canAccessHomecare || access.canAccessEpic;
}

function pathAllowed(path: string, access: UserAccess): boolean {
  if (path.startsWith('/analytics')) return access.canAccessAnalytics;
  if (path.startsWith('/homecare')) return access.canAccessHomecare;
  if (path.startsWith('/epic-conversion')) return access.canAccessEpic;
  return false;
}
