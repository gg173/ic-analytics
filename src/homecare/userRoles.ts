import type { UserRole } from './types';

export const USER_ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: 'app_admin', label: 'App Admin' },
  { value: 'uhn_admin', label: 'UHN Admin' },
  { value: 'uhn_editor', label: 'UHN Editor' },
  { value: 'vha_admin', label: 'VHA Admin' },
  { value: 'ic_lead_hcs', label: 'IC Lead (HCS)' },
  { value: 'spo_viewer', label: 'SPO Viewer' },
];

export function userRoleLabel(role: UserRole): string {
  return USER_ROLE_OPTIONS.find((o) => o.value === role)?.label ?? role;
}
