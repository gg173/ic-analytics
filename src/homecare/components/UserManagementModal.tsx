import { useCallback, useEffect, useState } from 'react';
import { readEdgeFunctionError } from '../../lib/functionErrors';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import type { UserRole } from '../types';
import { USER_ROLE_OPTIONS } from '../userRoles';

export interface ManagedUser {
  id: string;
  email: string;
  role: UserRole;
  display_name: string | null;
  organization_id: string;
  organization_slug: string;
  organization_name: string;
  created_at: string;
}

interface UserManagementModalProps {
  open: boolean;
  onClose: () => void;
}

function parseUsersPayload(data: unknown): ManagedUser[] {
  if (!data || typeof data !== 'object') return [];
  if (Array.isArray(data)) return data as ManagedUser[];
  if ('error' in data && (data as { error?: string }).error) return [];
  return [];
}

async function provisionSignIn(email: string): Promise<string | null> {
  const { data, error } = await supabase.functions.invoke('provision-auth-user', {
    body: { email: email.trim().toLowerCase() },
  });
  return readEdgeFunctionError(error, data);
}

export function UserManagementModal({ open, onClose }: UserManagementModalProps) {
  const { profile } = useAuth();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('uhn_editor');
  const [adding, setAdding] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('admin_list_profiles');
    setLoading(false);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    const payload = data as { error?: string } | ManagedUser[] | null;
    if (payload && typeof payload === 'object' && !Array.isArray(payload) && payload.error) {
      setError(payload.error);
      setUsers([]);
      return;
    }

    setUsers(parseUsersPayload(payload));
  }, []);

  useEffect(() => {
    if (!open) return;
    setMessage(null);
    setError(null);
    void loadUsers();
  }, [open, loadUsers]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  const handleAddUser = async (event: React.FormEvent) => {
    event.preventDefault();
    setAdding(true);
    setError(null);
    setMessage(null);

    const { data, error: rpcError } = await supabase.rpc('admin_create_user', {
      p_email: newEmail.trim(),
      p_role: newRole,
    });

    setAdding(false);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    const result = data as { error?: string; profile?: ManagedUser } | null;
    if (result?.error) {
      setError(result.error);
      return;
    }

    const addedEmail = newEmail.trim().toLowerCase();

    if (result?.profile) {
      setUsers((prev) =>
        [...prev, result.profile!].sort((a, b) => a.email.localeCompare(b.email))
      );
    } else {
      await loadUsers();
    }

    const provisionMessage = await provisionSignIn(addedEmail);
    if (provisionMessage) {
      setError(
        `User profile created but sign-in setup failed: ${provisionMessage}. Redeploy Edge Functions if this persists.`
      );
      setNewEmail('');
      setNewRole('uhn_editor');
      return;
    }

    setNewEmail('');
    setNewRole('uhn_editor');
    setMessage('User added and ready to sign in');
  };

  const handleRoleChange = async (userId: string, role: UserRole) => {
    setPendingId(userId);
    setError(null);
    setMessage(null);

    const { data, error: rpcError } = await supabase.rpc('admin_update_user_role', {
      p_profile_id: userId,
      p_role: role,
    });

    setPendingId(null);

    if (rpcError) {
      setError(rpcError.message);
      void loadUsers();
      return;
    }

    const result = data as { error?: string; profile?: ManagedUser } | null;
    if (result?.error) {
      setError(result.error);
      void loadUsers();
      return;
    }

    if (result?.profile) {
      setUsers((prev) => prev.map((u) => (u.id === userId ? result.profile! : u)));
      setMessage('Role updated');
    }
  };

  const handleProvisionSignIn = async (user: ManagedUser) => {
    setPendingId(user.id);
    setError(null);
    setMessage(null);

    const provisionMessage = await provisionSignIn(user.email);
    setPendingId(null);

    if (provisionMessage) {
      setError(`Sign-in setup failed for ${user.email}: ${provisionMessage}`);
      return;
    }

    setMessage(`Sign-in ready for ${user.email}`);
  };

  const handleRemove = async (user: ManagedUser) => {
    const confirmed = window.confirm(
      `Remove access for ${user.email}? They will no longer be able to sign in.`
    );
    if (!confirmed) return;

    setPendingId(user.id);
    setError(null);
    setMessage(null);

    const { data, error: rpcError } = await supabase.rpc('admin_delete_user', {
      p_profile_id: user.id,
    });

    setPendingId(null);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    const result = data as { error?: string; ok?: boolean } | null;
    if (result?.error) {
      setError(result.error);
      return;
    }

    setUsers((prev) => prev.filter((u) => u.id !== user.id));
    setMessage('User removed');
  };

  return (
    <div className="hc-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="hc-modal hc-user-mgmt-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hc-user-mgmt-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="hc-modal-header">
          <h2 id="hc-user-mgmt-title">User Management</h2>
          <button type="button" className="hc-btn hc-btn-ghost hc-modal-close" onClick={onClose}>
            Close
          </button>
        </header>

        {message && <p className="hc-info">{message}</p>}
        {error && <p className="hc-form-error">{error}</p>}

        <form className="hc-user-mgmt-add hc-form hc-form--inline" onSubmit={handleAddUser}>
          <label>
            Email
            <input
              type="email"
              required
              autoComplete="off"
              placeholder="user@example.com"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
            />
          </label>
          <label>
            Role
            <select value={newRole} onChange={(e) => setNewRole(e.target.value as UserRole)}>
              {USER_ROLE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="hc-btn hc-btn-primary" disabled={adding}>
            {adding ? 'Adding…' : 'Add user'}
          </button>
        </form>

        <div className="hc-table-wrap hc-user-mgmt-table-wrap">
          {loading ? (
            <p className="hc-muted">Loading users…</p>
          ) : users.length === 0 ? (
            <p className="hc-muted">No registered users found.</p>
          ) : (
            <table className="hc-table hc-user-mgmt-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Organization</th>
                  <th>Role</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {users.map((user) => {
                  const isSelf = user.id === profile?.id;
                  const busy = pendingId === user.id;

                  return (
                    <tr key={user.id}>
                      <td>{user.email}</td>
                      <td>{user.organization_name}</td>
                      <td>
                        <select
                          className="hc-user-mgmt-role-select"
                          value={user.role}
                          disabled={isSelf || busy}
                          aria-label={`Role for ${user.email}`}
                          onChange={(e) =>
                            void handleRoleChange(user.id, e.target.value as UserRole)
                          }
                        >
                          {USER_ROLE_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="hc-user-mgmt-actions">
                        <button
                          type="button"
                          className="hc-btn hc-btn-ghost"
                          disabled={busy}
                          onClick={() => void handleProvisionSignIn(user)}
                        >
                          Set up sign-in
                        </button>
                        <button
                          type="button"
                          className="hc-btn hc-btn-ghost hc-btn-danger"
                          disabled={isSelf || busy}
                          onClick={() => void handleRemove(user)}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
