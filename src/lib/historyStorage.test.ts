import { describe, expect, it } from 'vitest';
import { createInsight } from '../test/insightFixture.ts';
import { createMemoryStorage, type KeyValueStorage } from './browserStorage.ts';
import { createHistoryStore, HISTORY_LIMIT } from './historyStorage.ts';

const STORAGE_KEY = 'pdf-insight:history:v1';

function createStore(storage: KeyValueStorage = createMemoryStorage()) {
  let counter = 0;
  return createHistoryStore(storage, {
    now: () => new Date('2026-10-19T12:00:00.000Z'),
    createId: () => {
      counter += 1;
      return `entry-${String(counter)}`;
    },
  });
}

function failingStorage(): KeyValueStorage {
  const fail = (): never => {
    throw new DOMException('Blocked', 'SecurityError');
  };
  return { getItem: fail, setItem: fail, removeItem: fail };
}

describe('createHistoryStore', () => {
  it('starts empty', () => {
    expect(createStore().load()).toEqual([]);
  });

  it('saves an analysis and loads it back after a reload', () => {
    const storage = createMemoryStorage();
    const insight = createInsight();

    createStore(storage).add(insight);

    expect(createStore(storage).load()).toEqual([
      { id: 'entry-1', savedAt: '2026-10-19T12:00:00.000Z', insight },
    ]);
  });

  it(`keeps only the ${String(HISTORY_LIMIT)} newest analyses, newest first`, () => {
    const store = createStore();
    for (const fileName of ['a.pdf', 'b.pdf', 'c.pdf', 'd.pdf']) {
      store.add(createInsight({ fileName }));
    }

    expect(store.load().map((entry) => entry.insight.document.fileName)).toEqual([
      'd.pdf',
      'c.pdf',
      'b.pdf',
    ]);
  });

  it('replaces an older analysis of the same file', () => {
    const store = createStore();
    store.add(createInsight({ fileName: 'a.pdf', pages: 1 }));
    store.add(createInsight({ fileName: 'b.pdf' }));

    const entries = store.add(createInsight({ fileName: 'a.pdf', pages: 4 }));

    expect(
      entries.map((entry) => [entry.insight.document.fileName, entry.insight.document.pages]),
    ).toEqual([
      ['a.pdf', 4],
      ['b.pdf', 2],
    ]);
  });

  it('returns the same insight object it was given, so the UI can match the active entry', () => {
    const insight = createInsight();

    expect(createStore().add(insight)[0]?.insight).toBe(insight);
  });

  it('skips stored entries that no longer match the schema', () => {
    const storage = createMemoryStorage();
    const valid = { id: 'ok', savedAt: '2026-10-19T12:00:00.000Z', insight: createInsight() };
    storage.setItem(STORAGE_KEY, JSON.stringify([{ id: 'broken' }, valid]));

    expect(createStore(storage).load()).toEqual([valid]);
  });

  it('ignores stored data that is not valid JSON', () => {
    const storage = createMemoryStorage();
    storage.setItem(STORAGE_KEY, '{not json');

    expect(createStore(storage).load()).toEqual([]);
  });

  it('clears the history', () => {
    const storage = createMemoryStorage();
    createStore(storage).add(createInsight());

    createStore(storage).clear();

    expect(createStore(storage).load()).toEqual([]);
  });

  it('keeps working when storage throws', () => {
    const store = createStore(failingStorage());

    expect(store.load()).toEqual([]);
    expect(store.add(createInsight())).toHaveLength(1);
    expect(() => {
      store.clear();
    }).not.toThrow();
  });
});
