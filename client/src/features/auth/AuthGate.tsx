import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { LockKeyhole } from 'lucide-react';
import { backupMaxBytes } from '@libra/shared/library';
import { getJson, sendJson } from '../../api/client';
import styles from './AuthGate.module.css';

interface Session { required: boolean; authenticated: boolean; backupMaxBytes?: number }
const AccessContext = createContext({ required: false, maxBackupBytes: backupMaxBytes, logout: async () => {} });
export const useAccess = () => useContext(AccessContext);

export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    getJson<Session>('/api/auth', controller.signal).then(setSession).catch(cause => {
      if (!controller.signal.aborted) setError(cause.message);
    });
    const expire = () => { setSession(value => value ? { ...value, authenticated: false } : null); setPassword(''); };
    window.addEventListener('libra:auth-required', expire);
    return () => { controller.abort(); window.removeEventListener('libra:auth-required', expire); };
  }, [retry]);
  if (session?.authenticated) return <AccessContext.Provider value={{
    required: session.required, maxBackupBytes: session.backupMaxBytes ?? backupMaxBytes,
    logout: async () => { await sendJson('/api/auth/logout', 'POST', {}); setSession({ ...session, authenticated: false }); },
  }}>{children}</AccessContext.Provider>;

  return <main className={styles.page}>
    <section className={styles.card} aria-labelledby="sign-in-title">
      <img src="/favicon.svg" width="40" height="40" alt="" /><span className={styles.brand}>libra</span>
      <LockKeyhole size={26} className={styles.lock} aria-hidden="true" />
      <h1 id="sign-in-title">Your own little library.</h1>
      {!session ? <><p>{error ? 'Could not connect to your library.' : 'Opening your library…'}</p>{error && <button onClick={() => { setError(''); setRetry(value => value + 1); }}>Try again</button>}</> : <>
        <p>Sign in to pick up where you left off.</p>
        <form onSubmit={async event => {
          event.preventDefault(); if (busy) return; setBusy(true); setError('');
          try { await sendJson('/api/auth/login', 'POST', { password }); setPassword(''); setSession({ ...session, authenticated: true }); }
          catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not sign in. Try again.'); }
          finally { setBusy(false); }
        }}>
          <label htmlFor="library-password">Library password</label>
          <input id="library-password" name="password" type="password" autoComplete="current-password" required maxLength={256} value={password} onChange={event => setPassword(event.target.value)} disabled={busy} />
          <button disabled={busy}>{busy ? 'Signing in…' : 'Open my library'}</button>
        </form>
        <p className={styles.hint}>Stay signed in on this device for 30 days.</p>
      </>}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </section>
  </main>;
}
