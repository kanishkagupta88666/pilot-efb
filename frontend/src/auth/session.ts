export interface User { employeeId: string; displayName: string; role: 'pilot' | 'management' | 'admin'; fleet: string }
export interface Session { token: string; expiresAt: string; user: User }
const KEY = import.meta.env.VITE_AUTH_MODE === 'mock' ? 'efb.auth.demo-session.v1' : 'efb.auth.session.v1';
let transientSession: Session | null = null;
export function isSession(value: unknown): value is Session {
  if (!value || typeof value !== 'object') return false;
  const s = value as Session;
  return typeof s.token === 'string' && s.token.length > 0 && typeof s.expiresAt === 'string' && Number.isFinite(Date.parse(s.expiresAt)) && !!s.user && typeof s.user.employeeId === 'string' && typeof s.user.displayName === 'string' && typeof s.user.fleet === 'string' && ['pilot', 'management', 'admin'].includes(s.user.role);
}
export function readSession(): Session | null {
  try { const value: unknown = JSON.parse(localStorage.getItem(KEY) || 'null'); return isSession(value) ? value : transientSession; } catch { return transientSession; }
}
export function saveSession(session: Session): boolean {
  if (!isSession(session)) return false;
  transientSession = session;
  try { localStorage.setItem(KEY, JSON.stringify(session)); transientSession = null; return true; } catch { return false; }
}
export function clearSession(): boolean {
  try { localStorage.removeItem(KEY); transientSession = null; return true; } catch { return false; }
}
export function isExpired(session: Session, now = Date.now()): boolean { return Date.parse(session.expiresAt) <= now; }
export function safeReturnPath(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020]/.test(value)) return '/';
  return value;
}
export function readingAccess(session: Session | null, cached: boolean): 'read' | 'sign-in' {
  return cached || (session !== null && !isExpired(session)) ? 'read' : 'sign-in';
}
