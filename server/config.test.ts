import { describe, expect, it } from 'vitest';
import { DEFAULT_LLM_MODEL, loadConfig } from './config.ts';
import { HttpError } from './errors.ts';

const SECRET = 'test-key-1234567890';

const STORE_TOKEN = 'upstash-token-0987654321';

const validEnv = {
  LLM_API_KEY: SECRET,
  ALLOWED_ORIGIN: 'https://devtomaszstoklosa.github.io',
  UPSTASH_REDIS_REST_URL: 'https://example-db.upstash.io',
  UPSTASH_REDIS_REST_TOKEN: STORE_TOKEN,
};

function loadError(env: Record<string, string | undefined>): unknown {
  try {
    loadConfig(env);
  } catch (error) {
    return error;
  }
  throw new Error('Expected loadConfig to throw');
}

describe('loadConfig', () => {
  it('reads a valid environment with the default model', () => {
    const config = loadConfig(validEnv);

    expect(config.llmApiKey).toBe(SECRET);
    expect(config.llmModel).toBe(DEFAULT_LLM_MODEL);
    expect([...config.allowedOrigins]).toEqual(['https://devtomaszstoklosa.github.io']);
    expect(config.rateLimitStore).toEqual({
      url: 'https://example-db.upstash.io',
      token: STORE_TOKEN,
    });
  });

  it('uses LLM_MODEL when set', () => {
    expect(loadConfig({ ...validEnv, LLM_MODEL: 'gemini-3.5-flash-lite' }).llmModel).toBe(
      'gemini-3.5-flash-lite',
    );
  });

  it('treats an empty LLM_MODEL as not set', () => {
    expect(loadConfig({ ...validEnv, LLM_MODEL: '  ' }).llmModel).toBe(DEFAULT_LLM_MODEL);
  });

  it('parses a comma-separated list of origins', () => {
    const config = loadConfig({
      ...validEnv,
      ALLOWED_ORIGIN: ' https://devtomaszstoklosa.github.io , http://localhost:5173 ,',
    });

    expect([...config.allowedOrigins]).toEqual([
      'https://devtomaszstoklosa.github.io',
      'http://localhost:5173',
    ]);
  });

  it.each<[string, Record<string, string | undefined>]>([
    ['a missing API key', { ...validEnv, LLM_API_KEY: undefined }],
    ['a blank API key', { ...validEnv, LLM_API_KEY: '   ' }],
    ['a missing origin list', { ...validEnv, ALLOWED_ORIGIN: undefined }],
    ['an empty origin list', { ...validEnv, ALLOWED_ORIGIN: ' , ' }],
    ['an origin with a path', { ...validEnv, ALLOWED_ORIGIN: 'https://example.com/app' }],
    ['an origin with a trailing slash', { ...validEnv, ALLOWED_ORIGIN: 'https://example.com/' }],
    ['a wildcard origin', { ...validEnv, ALLOWED_ORIGIN: '*' }],
    ['a missing Upstash URL', { ...validEnv, UPSTASH_REDIS_REST_URL: undefined }],
    ['a plain-HTTP Upstash URL', { ...validEnv, UPSTASH_REDIS_REST_URL: 'http://db.upstash.io' }],
    ['an invalid Upstash URL', { ...validEnv, UPSTASH_REDIS_REST_URL: 'example-db.upstash.io' }],
    ['a missing Upstash token', { ...validEnv, UPSTASH_REDIS_REST_TOKEN: undefined }],
    ['a blank Upstash token', { ...validEnv, UPSTASH_REDIS_REST_TOKEN: ' ' }],
  ])('rejects %s without revealing values', (_case, env) => {
    const error = loadError(env);

    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ code: 'SERVER_MISCONFIGURED', status: 500 });
    for (const secret of [SECRET, STORE_TOKEN]) {
      expect(JSON.stringify((error as HttpError).toBody())).not.toContain(secret);
      expect((error as HttpError).message).not.toContain(secret);
    }
  });
});
