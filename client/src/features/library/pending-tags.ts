export interface PendingTags { id: string; tagIds: string[] }
const key = 'libra.pending-tags.v1';

// Reload recovery is tab-scoped; no titles or library metadata are stored here.
export function readPendingTags(): PendingTags[] {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(key) ?? '[]');
    return Array.isArray(value) ? value.filter((entry): entry is PendingTags =>
      Boolean(entry && typeof entry === 'object' && typeof entry.id === 'string' && Array.isArray(entry.tagIds)
        && entry.tagIds.length <= 50 && entry.tagIds.every((id: unknown) => typeof id === 'string')),
    ) : [];
  } catch { return []; }
}

export function writePendingTags(value: PendingTags[]) {
  try {
    if (value.length) sessionStorage.setItem(key, JSON.stringify(value));
    else sessionStorage.removeItem(key);
  } catch { /* Storage can be unavailable; lifecycle keepalive still provides a best-effort flush. */ }
}
