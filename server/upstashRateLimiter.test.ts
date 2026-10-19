import { describe, expect, it } from 'vitest';
import { UpstashRateLimiter, type WindowLimiter } from './upstashRateLimiter.ts';

const NOW = 1_000_000;

type WindowResult = Awaited<ReturnType<WindowLimiter['limit']>>;

/** Records the identifiers it is asked about and answers with a fixed result or error. */
function fakeWindow(result: WindowResult | Error) {
  const identifiers: string[] = [];
  const window: WindowLimiter = {
    limit(identifier) {
      identifiers.push(identifier);
      return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
    },
  };
  return { window, identifiers };
}

const allowed: WindowResult = { success: true, reset: NOW + 60_000 };

function limiterWith(...windows: WindowLimiter[]): UpstashRateLimiter {
  return new UpstashRateLimiter(windows, () => NOW);
}

describe('UpstashRateLimiter', () => {
  it('allows a request that every window allows', async () => {
    const minute = fakeWindow(allowed);
    const day = fakeWindow(allowed);

    await expect(limiterWith(minute.window, day.window).check('client-1')).resolves.toEqual({
      allowed: true,
    });
    expect(minute.identifiers).toEqual(['client-1']);
    expect(day.identifiers).toEqual(['client-1']);
  });

  it('blocks with the seconds until the window resets, rounded up', async () => {
    const minute = fakeWindow({ success: false, reset: NOW + 12_300 });
    const day = fakeWindow(allowed);

    await expect(limiterWith(minute.window, day.window).check('client-1')).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 13,
    });
    expect(day.identifiers).toHaveLength(0);
  });

  it('blocks when only the daily window is used up', async () => {
    const minute = fakeWindow(allowed);
    const day = fakeWindow({ success: false, reset: NOW + 3_600_000 });

    await expect(limiterWith(minute.window, day.window).check('client-1')).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 3_600,
    });
  });

  it('asks to retry after at least one second', async () => {
    const minute = fakeWindow({ success: false, reset: NOW - 500 });

    await expect(limiterWith(minute.window).check('client-1')).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 1,
    });
  });

  it('reports a store timeout instead of allowing the request silently', async () => {
    const minute = fakeWindow({ success: true, reset: 0, reason: 'timeout' });

    await expect(limiterWith(minute.window).check('client-1')).rejects.toThrow('timed out');
  });

  it('passes store errors on to the caller', async () => {
    const minute = fakeWindow(new Error('store unreachable'));

    await expect(limiterWith(minute.window).check('client-1')).rejects.toThrow('store unreachable');
  });
});
