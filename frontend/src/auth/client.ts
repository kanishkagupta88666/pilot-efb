import { isSession, isExpired } from './session';
import type { Session } from './session';
export class AuthError extends Error { constructor(public status: number, message: string) { super(message); } }
export type Transport = typeof fetch;
export async function login(employeeId: string, password: string, transport: Transport = fetch): Promise<Session> {
  const response = await transport('/api/auth/login/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ employeeId, password }) });
  if (!response.ok) throw new AuthError(response.status, response.status === 401 ? 'Unable to sign in. Check your ID and password.' : 'Sign-in is unavailable. Please try again.');
  const data: unknown = await response.json();
  if (!isSession(data) || isExpired(data)) throw new Error('The server returned an invalid sign-in response.');
  return data;
}
export async function authenticatedFetch(path: string, session: Session | null, init: RequestInit = {}, transport: Transport = fetch): Promise<Response> {
  if (!path.startsWith('/api/') || /[\\\u0000-\u0020]/.test(path)) throw new Error('Only same-origin API paths are allowed.');
  const headers = new Headers(init.headers);
  headers.delete('Authorization');
  if (session && !isExpired(session)) headers.set('Authorization', `Bearer ${session.token}`);
  const response = await transport(path, { ...init, headers, redirect: 'error' });
  if (response.status === 401) throw new AuthError(401, 'Sign in to keep updates. Saved manuals remain available.');
  if (response.status === 403) throw new AuthError(403, 'Your account is not allowed to access this resource.');
  return response;
}
