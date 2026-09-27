import { useId, useState } from 'react';
import { Plus } from 'lucide-react';
import styles from './Tags.module.css';

export function TagCreateForm({ onCreate, disabled = false, assign = false }: { onCreate(name: string): Promise<unknown>; disabled?: boolean; assign?: boolean }) {
  const id = useId();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  return <form className={styles.create} onSubmit={async (event) => {
    event.preventDefault();
    if (busy || disabled || !name.trim()) return;
    setBusy(true); setError(''); setMessage('');
    try { await onCreate(name); setName(''); setMessage(assign ? 'Tag created and assigned.' : 'Tag ready to use.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not create this tag. Please try again.'); }
    finally { setBusy(false); }
  }}>
    <label className={styles.field} htmlFor={id}>New tag<input id={id} className={styles.input} placeholder="e.g. Cozy evenings" maxLength={40} required value={name} disabled={busy || disabled} onChange={(event) => { setName(event.target.value); setMessage(''); }} /></label>
    <button className={styles.button} type="submit" disabled={busy || disabled || !name.trim()}><Plus size={14} aria-hidden="true" />{busy ? 'Creating…' : assign ? 'Create & assign' : 'Create tag'}</button>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {message && <p className={styles.message} role="status">{message}</p>}
  </form>;
}
