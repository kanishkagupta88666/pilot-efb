import { readSession, isExpired } from './session';
export const AUTH_ENABLED = import.meta.env.VITE_AUTH_MODE === 'mock' || import.meta.env.VITE_AUTH_MODE === 'api';
export const MOCK_AUTH = import.meta.env.DEV && import.meta.env.VITE_AUTH_MODE === 'mock';
export function authHeaders(): Record<string, string> {
  const session = readSession();
  // Demo tokens must never reach the team's real backend.
  return AUTH_ENABLED && !MOCK_AUTH && session && !isExpired(session) ? { Authorization: `Token ${session.token}` } : {};
}
export function notifyUnauthorized(): void { window.dispatchEvent(new Event('efb-auth-expired')); }
