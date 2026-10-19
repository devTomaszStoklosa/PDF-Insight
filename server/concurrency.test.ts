import { describe, expect, it } from 'vitest';
import { mapWithConcurrency } from './concurrency.ts';

interface Deferred {
  readonly item: number;
  readonly resolve: (value: string) => void;
  readonly reject: (error: Error) => void;
}

/** A task whose calls stay pending until the test settles them, in any order. */
function controllableTask(): {
  run: (item: number) => Promise<string>;
  pending: Deferred[];
  started: number[];
} {
  const pending: Deferred[] = [];
  const started: number[] = [];
  return {
    pending,
    started,
    run: (item) =>
      new Promise<string>((resolve, reject) => {
        started.push(item);
        pending.push({ item, resolve, reject });
      }),
  };
}

/** Lets the pool start the next calls after a settled one. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('mapWithConcurrency', () => {
  it('returns the results in item order, whatever order the calls finish in', async () => {
    const task = controllableTask();
    const result = mapWithConcurrency([1, 2, 3], 3, task.run);

    for (const call of [...task.pending].reverse()) {
      call.resolve(`wynik ${String(call.item)}`);
    }

    await expect(result).resolves.toEqual(['wynik 1', 'wynik 2', 'wynik 3']);
  });

  it('runs at most `limit` calls at once and starts the next one when a call ends', async () => {
    const task = controllableTask();
    const result = mapWithConcurrency([1, 2, 3, 4, 5], 2, task.run);

    expect(task.started).toEqual([1, 2]);
    task.pending.shift()?.resolve('a');
    await flush();
    expect(task.started).toEqual([1, 2, 3]);

    while (task.pending.length > 0) {
      task.pending.shift()?.resolve('b');
      await flush();
    }
    await expect(result).resolves.toHaveLength(5);
    expect(task.started).toEqual([1, 2, 3, 4, 5]);
  });

  it('rejects with the first failure and starts no further items', async () => {
    const task = controllableTask();
    const result = mapWithConcurrency([1, 2, 3, 4, 5], 2, task.run);
    const failure = new Error('niedostępne');

    task.pending.shift()?.reject(failure);
    await expect(result).rejects.toBe(failure);
    task.pending.shift()?.resolve('b');
    await flush();

    expect(task.started).toEqual([1, 2]);
  });

  it('handles fewer items than the limit, and no items', async () => {
    await expect(mapWithConcurrency([7], 3, (item) => Promise.resolve(item * 2))).resolves.toEqual([
      14,
    ]);
    await expect(mapWithConcurrency([], 3, () => Promise.resolve(0))).resolves.toEqual([]);
  });
});
