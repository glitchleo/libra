import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryEntry } from '@libra/shared/library';
import { TagSaveQueue } from './tag-save-queue';

const entry = { id: 'entry' } as LibraryEntry;
function setup() {
  const persist = vi.fn(async (_id: string, _tagIds: string[]) => ({ entry }));
  const saved = vi.fn();
  return { persist, saved, queue: new TagSaveQueue(persist, saved, vi.fn()) };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('tag save batching', () => {
  it('saves all selections five seconds after the first click, without extending the window', async () => {
    const { queue, persist } = setup();
    queue.enqueue('entry', ['a']);
    await vi.advanceTimersByTimeAsync(4_000);
    queue.enqueue('entry', ['a', 'b']);
    expect(queue.desired('entry')).toEqual(['a', 'b']);
    await vi.advanceTimersByTimeAsync(999);
    expect(persist).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(persist).toHaveBeenCalledExactlyOnceWith('entry', ['a', 'b']);
    expect(queue.states()).toEqual({});
  });

  it('serializes newer batches when their five-second window ends during an earlier request', async () => {
    const { queue, persist, saved } = setup();
    let finish!: (value: { entry: LibraryEntry }) => void;
    persist.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    queue.enqueue('entry', ['a']);
    await vi.advanceTimersByTimeAsync(5_000);
    queue.enqueue('entry', ['b']);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(persist).toHaveBeenCalledTimes(1);
    finish({ entry });
    await vi.advanceTimersByTimeAsync(0);
    expect(saved).toHaveBeenNthCalledWith(1, entry, ['b']);
    expect(persist).toHaveBeenNthCalledWith(2, 'entry', ['b']);
    expect(queue.states()).toEqual({});
  });

  it('keeps failed choices for an explicit retry and reports a failed export flush', async () => {
    const { queue, persist } = setup();
    persist.mockRejectedValueOnce(new Error('Database offline.'));
    queue.enqueue('entry', ['a', 'b']);
    await expect(queue.flushAll()).rejects.toThrow('Database offline.');
    expect(queue.desired('entry')).toEqual(['a', 'b']);
    expect(queue.states()).toEqual({ entry: { phase: 'error', error: 'Database offline.' } });
    await queue.flush('entry');
    expect(persist).toHaveBeenCalledTimes(2);
    expect(queue.states()).toEqual({});
    await vi.advanceTimersByTimeAsync(10_000);
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it('allows editing after a failed save and saves the latest choices in a new window', async () => {
    const { queue, persist } = setup();
    persist.mockRejectedValueOnce(new Error('Offline.'));
    queue.enqueue('entry', ['a']);
    await vi.advanceTimersByTimeAsync(5_000);
    queue.enqueue('entry', ['b']);
    expect(queue.states()).toEqual({ entry: { phase: 'pending' } });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(persist).toHaveBeenLastCalledWith('entry', ['b']);
    expect(queue.states()).toEqual({});
  });

  it('flushes each entry and drains new edits before resolving a backup flush', async () => {
    const { queue, persist } = setup();
    let finish!: (value: { entry: LibraryEntry }) => void;
    persist.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    queue.enqueue('entry', ['a']);
    queue.enqueue('other', ['c']);
    const flushed = queue.flushAll();
    queue.enqueue('entry', ['b']);
    finish({ entry });
    await flushed;
    expect(persist).toHaveBeenCalledTimes(3);
    expect(persist).toHaveBeenLastCalledWith('entry', ['b']);
    expect(queue.states()).toEqual({});
  });

  it('ignores late responses for an entry removed while a save was in flight', async () => {
    const { queue, persist, saved } = setup();
    let finish!: (value: { entry: LibraryEntry }) => void;
    persist.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    queue.enqueue('entry', ['a']);
    await vi.advanceTimersByTimeAsync(5_000);
    queue.discard('entry');
    finish({ entry });
    await vi.advanceTimersByTimeAsync(0);
    expect(saved).not.toHaveBeenCalled();
    expect(queue.states()).toEqual({});
  });
});
