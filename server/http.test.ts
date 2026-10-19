import { describe, expect, it } from 'vitest';
import { jsonResponse, withAppVersion } from './http.ts';

describe('withAppVersion', () => {
  it('adds the deployed commit as X-App-Version', async () => {
    const response = withAppVersion(jsonResponse({ ok: true }, 200), 'abc123');

    expect(response.headers.get('X-App-Version')).toBe('abc123');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it.each([undefined, '', '  '])('leaves the response unchanged for version %j', (version) => {
    const response = withAppVersion(jsonResponse({ ok: true }, 200), version);

    expect(response.headers.has('X-App-Version')).toBe(false);
  });
});
