import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TopBar } from '../components/TopBar';
import { LogoMark, PersonIcon, LockIcon, EyeIcon, EyeOffIcon, InfoIcon } from '../components/Icons';
import './preview.css';
import { MOCK_AUTH } from './runtime';
import { setProfile } from '../utils/deviceIdentity';

import { login } from './client';
import { mockTransport } from './mock';
import { clearSession, isExpired, readSession, safeReturnPath, saveSession } from './session';
import '../styles.css';
export function AuthSignInPage({ standalone = false }: { standalone?: boolean }) {
  const navigate = useNavigate();
  const [session, setSession] = useState(readSession);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [signOutOpen, setSignOutOpen] = useState(false);
  useEffect(() => { if (signOutOpen) dialogRef.current?.showModal(); else dialogRef.current?.close(); }, [signOutOpen]);
  const [showPassword, setShowPassword] = useState(false);
  const mock = MOCK_AUTH || (standalone && new URLSearchParams(location.search).get('mock') === '1');
  return <main className="sign-in-page auth-preview"><TopBar title={session ? "Your account" : "Sign in"} /><div className="sign-in-scene"><div aria-hidden="true" className="sign-in-photo" /><section className="sign-in"><p className="sign-in__brand"><LogoMark />Pilot EFB</p><h1>{session && !isExpired(session) ? "Ready for your next flight" : "Sign in to Pilot EFB"}</h1><p className="intro">Your manuals. Your fleet. Ready when you are.</p>

    {error && <p className="auth-error" role="alert">{error}</p>}
    {session && <section className="auth-profile" aria-label="Signed-in account">
      <div className="auth-profile-heading"><span className="auth-avatar"><PersonIcon /></span><div><span className="auth-eyebrow">SIGNED IN AS</span><h2>{session.user.displayName}</h2></div><span className="auth-session-badge">{isExpired(session) ? 'Expired' : 'Signed in'}</span></div>
      <dl className="auth-profile-details"><div><dt>Employee ID</dt><dd>{session.user.employeeId}</dd></div><div><dt>Role</dt><dd className="auth-role">{session.user.role}</dd></div><div><dt>Fleet</dt><dd>{session.user.fleet}</dd></div></dl>
      {isExpired(session) && <p>Sign in to keep updates. Saved manuals remain available.</p>}
    </section>}
    <dialog className="auth-signout-dialog" ref={dialogRef} onCancel={() => setSignOutOpen(false)} onClose={() => setSignOutOpen(false)}>
      <span className="auth-dialog-icon"><LockIcon /></span><h2>Sign out of Pilot EFB?</h2><p>You’ll need to sign in again to receive account updates. Your notes will stay on this device, including any that haven’t synced.</p>
      <div className="auth-dialog-actions"><button autoFocus className="button button--secondary" onClick={() => setSignOutOpen(false)}>Stay signed in</button><button className="button button--primary" onClick={() => { if (!clearSession()) { setError('Unable to clear saved sign-in. Please try again.'); setSignOutOpen(false); return; } setSession(null); setSignOutOpen(false); }}>Sign out</button></div>
    </dialog>
    {(!session || isExpired(session)) && <form className="sign-in__form" onSubmit={async event => {
      event.preventDefault(); if (busy) return;
      const data = new FormData(event.currentTarget); setBusy(true); setError('');
      try { const next = await login(String(data.get('employeeId')), String(data.get('password')), mock ? mockTransport : fetch); if (!saveSession(next)) setError('Signed in for this visit. This browser could not save your session.'); setSession(next); setProfile({ name: next.user.employeeId, role: next.user.role === 'admin' ? 'administrator' : 'pilot' }); if (!standalone) navigate(safeReturnPath(new URLSearchParams(location.search).get('returnTo')), {replace:true}); }
      catch (e) { setError(e instanceof TypeError ? 'Unable to reach sign-in. Check your connection and try again.' : e instanceof Error ? e.message : 'Unable to sign in.'); } finally { setBusy(false); }
    }}><label htmlFor="employee-id">Employee ID</label><div className="sign-in__field"><PersonIcon /><input id="employee-id" name="employeeId" placeholder="Employee ID" autoComplete="username" autoCapitalize="characters" spellCheck={false} required /></div><label htmlFor="password">Password</label><div className="sign-in__field"><LockIcon /><input id="password" name="password" placeholder="Password" type={showPassword ? "text" : "password"} autoComplete="current-password" required /><button className="sign-in__reveal" type="button" aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOffIcon /> : <EyeIcon />}</button></div><button className="button button--primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button></form>}
    <p className="auth-reader-link"><a className={session ? "button button--primary auth-continue" : undefined} href={safeReturnPath(new URLSearchParams(location.search).get('returnTo'))}>Continue to reader →</a></p>{session && <button className="button button--secondary auth-signout" onClick={() => setSignOutOpen(true)}>Sign out</button>}<div className="sign-in__notice"><InfoIcon /><p><strong>Ready when you need it.</strong> Sign-in keeps your account ready for updates. Offline manual availability depends on documents saved to this device.</p></div>{mock && !session && <details className="auth-demo"><summary>Prototype demo accounts</summary><p>Employee ID: P-100, P-200, M-001 or A-001<br />Password: demo-only</p><p>Demo sign-in does not authenticate the live API.</p></details>}<p className="sign-in__help">Can’t sign in? Contact your flight operations administrator.</p>
  </section></div></main>;
}
