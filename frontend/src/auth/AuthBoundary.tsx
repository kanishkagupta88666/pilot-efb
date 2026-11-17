import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { AUTH_ENABLED } from './runtime';
import { isExpired, readSession } from './session';
import './preview.css';
export function AuthBoundary({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [rejected, setRejected] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [, tick] = useState(0);
  useEffect(() => {
    const expire = () => setRejected(true);
    const update = () => { setOnline(navigator.onLine); tick(n => n + 1); };
    window.addEventListener('efb-auth-expired', expire);
    window.addEventListener('online', update); window.addEventListener('offline', update); window.addEventListener('storage', update);
    const timer = window.setInterval(update, 1000);
    return () => { clearInterval(timer); window.removeEventListener('efb-auth-expired', expire); window.removeEventListener('online', update); window.removeEventListener('offline', update); window.removeEventListener('storage', update); };
  }, []);
  if (!AUTH_ENABLED || location.pathname === '/sign-in') return <>{children}</>;
  const session = readSession();
  const reading = location.pathname.startsWith('/reader/') || location.pathname === '/open';
  const returnTo = encodeURIComponent(location.pathname + location.search + location.hash);
  if (!session && !reading && online) return <Navigate to={`/sign-in?returnTo=${returnTo}`} replace />;
  if ((location.pathname.startsWith('/author/') || location.pathname === '/audit') && (!session || isExpired(session) || session.user.role !== 'admin')) return <main className="auth-access"><h1>Access restricted</h1><p>This area requires an administrator account.</p><Link to="/">Back to manuals</Link></main>;
  return <>{(!session || isExpired(session) || rejected || !online) && <div className="auth-banner" role="status">{!online ? 'You are offline. Reading available documents remains open.' : 'Sign in to keep updates. Reading remains available.'} {online && <Link to={`/sign-in?returnTo=${returnTo}`}>Sign in</Link>}</div>}{children}</>;
}
