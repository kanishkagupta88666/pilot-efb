import { logout } from './client';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { unsyncedCount } from '../utils/annotationStore';
import { clearSession, readSession } from './session';
import { AUTH_ENABLED, MOCK_AUTH } from './runtime';
export function AccountMenu() {
  const navigate = useNavigate(); const [open, setOpen] = useState(false); const [pending, setPending] = useState<number | null>(0); const [error, setError] = useState('');
  const session = readSession();
  if (!AUTH_ENABLED || !session) return null;
  return <><button className="button button--secondary" onClick={async () => { setOpen(true); try { setPending(await unsyncedCount()); } catch { setPending(null); } }}>{session.user.displayName}</button>{open && <div className="auth-overlay"><section className="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="account-title"><h2 id="account-title">Your account</h2><p>{session.user.employeeId} · {session.user.role} · {session.user.fleet}</p>{MOCK_AUTH && <p>Demo account · local prototype</p>}<p>{pending === null ? 'Unable to check for unsent notes. They will remain on this device.' : pending > 0 ? `${pending} unsent notes will remain on this device.` : 'Your local notes will remain on this device.'}</p>{error && <p role="alert">{error}</p>}<div className="auth-dialog-actions"><button autoFocus className="button button--secondary" onClick={() => setOpen(false)}>Cancel</button><button className="button button--primary" onClick={async () => { await logout(session); if (!clearSession()) { setError('Unable to remove saved sign-in. Please try again.'); return; } setOpen(false); navigate('/sign-in', {replace:true}); }}>Sign out</button></div></section></div>}</>;
}
