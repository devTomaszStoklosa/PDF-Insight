import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { clientIdOf } from './rateLimit.ts';

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

describe('clientIdOf', () => {
  it('hashes the address from x-real-ip', () => {
    const headers = new Headers({
      'X-Real-IP': '203.0.113.7',
      'X-Forwarded-For': '198.51.100.1',
    });

    expect(clientIdOf(headers)).toBe(sha256('203.0.113.7'));
  });

  it('falls back to the first address in x-forwarded-for', () => {
    const headers = new Headers({ 'X-Forwarded-For': ' 198.51.100.1 , 10.0.0.1' });

    expect(clientIdOf(headers)).toBe(sha256('198.51.100.1'));
  });

  it('puts requests without an address into one shared bucket', () => {
    expect(clientIdOf(new Headers())).toBe(clientIdOf(new Headers({ 'X-Real-IP': ' ' })));
  });

  it('never returns the address itself', () => {
    const id = clientIdOf(new Headers({ 'X-Real-IP': '203.0.113.7' }));

    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(id).not.toContain('203.0.113.7');
  });
});
