import type { LibraryEntry } from '@libra/shared/library';

export const TAG_SAVE_DELAY = 5_000;
export interface TagSaveState { phase: 'pending' | 'saving' | 'error'; error?: string }
interface Batch {
  tagIds: string[];
  version: number;
  timer?: ReturnType<typeof setTimeout>;
  inFlight?: Promise<void>;
  due: boolean;
  error?: string;
}

// One fixed window per entry. A later window can collect edits while a save is in flight.
export class TagSaveQueue {
  private batches = new Map<string, Batch>();
  constructor(
    private persist: (id: string, tagIds: string[]) => Promise<{ entry: LibraryEntry }>,
    private onSaved: (entry: LibraryEntry, desired: string[]) => void,
    private onChange: () => void,
  ) {}

  desired(id: string): string[] | undefined { return this.batches.get(id)?.tagIds; }
  pending(): { id: string; tagIds: string[] }[] {
    return [...this.batches].map(([id, batch]) => ({ id, tagIds: [...batch.tagIds] }));
  }
  states(): Record<string, TagSaveState> {
    return Object.fromEntries([...this.batches].map(([id, batch]) => [id, {
      phase: batch.error ? 'error' : batch.inFlight ? 'saving' : 'pending',
      ...(batch.error ? { error: batch.error } : {}),
    }]));
  }
  enqueue(id: string, tagIds: string[]) {
    let batch = this.batches.get(id);
    if (!batch) {
      batch = { tagIds: [], version: 0, due: false };
      this.batches.set(id, batch);
    }
    batch.tagIds = [...new Set(tagIds)];
    batch.version++;
    batch.error = undefined;
    if (!batch.timer && !batch.due) {
      batch.timer = setTimeout(() => {
        batch.timer = undefined;
        batch.due = true;
        if (!batch.inFlight) void this.save(id, batch).catch(() => {});
      }, TAG_SAVE_DELAY);
    }
    this.onChange();
  }

  async flush(id: string): Promise<void> {
    // Keep draining if a user edits during a requested flush (backup/export, retry, unload).
    while (this.batches.has(id)) {
      const batch = this.batches.get(id)!;
      await (batch.inFlight ?? this.save(id, batch));
    }
  }
  async flushAll(): Promise<void> {
    const results = await Promise.allSettled([...this.batches.keys()].map((id) => this.flush(id)));
    const failure = results.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
  }
  discard(id: string) {
    const batch = this.batches.get(id);
    if (!batch) return;
    clearTimeout(batch.timer);
    this.batches.delete(id);
    this.onChange();
  }
  removeTag(tagId: string) {
    for (const [id, batch] of this.batches) {
      if (batch.tagIds.includes(tagId)) this.enqueue(id, batch.tagIds.filter((value) => value !== tagId));
    }
  }
  clearTimers() {
    for (const batch of this.batches.values()) {
      clearTimeout(batch.timer);
      batch.timer = undefined;
    }
  }

  private save(id: string, batch: Batch): Promise<void> {
    clearTimeout(batch.timer);
    batch.timer = undefined;
    batch.due = false;
    batch.error = undefined;
    const version = batch.version;
    const tagIds = [...batch.tagIds];
    batch.inFlight = this.persist(id, tagIds).then(({ entry }) => {
      if (this.batches.get(id) !== batch) return;
      this.onSaved(entry, batch.tagIds);
      if (batch.version === version) this.batches.delete(id);
    }).catch((cause: unknown) => {
      if (this.batches.get(id) !== batch) return;
      clearTimeout(batch.timer);
      batch.timer = undefined;
      batch.due = false;
      batch.error = cause instanceof Error ? cause.message : 'Could not save your tags. Please try again.';
      throw cause;
    }).finally(() => {
      batch.inFlight = undefined;
      this.onChange();
      if (this.batches.get(id) === batch && batch.due && !batch.error) void this.save(id, batch).catch(() => {});
    });
    this.onChange();
    return batch.inFlight;
  }
}
