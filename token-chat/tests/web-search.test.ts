import { describe, expect, it } from 'vitest';
import {
  buildSearchAugmentedPrompt,
  defaultSearchProviderConfig,
  isSafeSourceUrl,
  normalizeSearchProviderConfig,
  parseSearchMetadata,
  type SearchResult,
} from '../src/web-search';

function result(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    title: 'Example result',
    url: 'https://docs.example.com/article',
    snippet: 'Useful evidence',
    source: 'Example Docs',
    retrievedAt: '2026-06-27T00:00:00.000Z',
    ...overrides,
  };
}

describe('web search', () => {
  it('normalizes missing identity and clamps numeric provider settings', () => {
    expect(normalizeSearchProviderConfig({
      providerId: '',
      defaultMaxResults: 99,
      timeoutMs: 10,
    })).toMatchObject({
      providerId: 'http-json',
      defaultMaxResults: 20,
      timeoutMs: 1000,
      queryParam: defaultSearchProviderConfig.queryParam,
    });

    expect(normalizeSearchProviderConfig({
      defaultMaxResults: Number.NaN,
      timeoutMs: Number.POSITIVE_INFINITY,
    })).toMatchObject({
      defaultMaxResults: 5,
      timeoutMs: 12000,
    });
  });

  it('returns an isolated default config snapshot', () => {
    const normalized = normalizeSearchProviderConfig(null);
    normalized.baseUrl = 'https://changed.example';

    expect(defaultSearchProviderConfig.baseUrl).toBe('');
    expect(normalizeSearchProviderConfig(undefined)).toEqual(defaultSearchProviderConfig);
  });

  it('rejects malformed metadata and keeps only valid safe results', () => {
    expect(parseSearchMetadata(null)).toBeNull();
    expect(parseSearchMetadata('{broken')).toBeNull();
    expect(parseSearchMetadata(JSON.stringify({ enabled: false, query: 'test', results: [] }))).toBeNull();

    const metadata = parseSearchMetadata(JSON.stringify({
      enabled: true,
      query: 'test',
      results: [
        result({ source: undefined, publishedAt: '2026-06-27' }),
        result({ title: 'Unsafe', url: 'javascript:alert(1)' }),
        { title: 42, url: 'https://invalid.example' },
      ],
      error: 'partial results',
    }));

    expect(metadata).toEqual({
      enabled: true,
      query: 'test',
      results: [{
        title: 'Example result',
        url: 'https://docs.example.com/article',
        snippet: 'Useful evidence',
        source: undefined,
        publishedAt: '2026-06-27',
        retrievedAt: '2026-06-27T00:00:00.000Z',
      }],
      searchedAt: '',
      providerId: 'unknown',
      error: 'partial results',
    });
  });

  it('allows only HTTP source URLs', () => {
    expect(isSafeSourceUrl('https://example.com')).toBe(true);
    expect(isSafeSourceUrl('http://localhost:8080')).toBe(true);
    expect(isSafeSourceUrl('file:///etc/passwd')).toBe(false);
    expect(isSafeSourceUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeSourceUrl('not a url')).toBe(false);
  });

  it('builds a bounded evidence prompt without unsafe results', () => {
    const prompt = buildSearchAugmentedPrompt('What changed?', [
      result({ title: 'Safe\u0000 title', snippet: 'line one\nline two' }),
      result({ title: 'Unsafe', url: 'data:text/plain,bad' }),
    ], { language: 'en', maxContextChars: 2000, maxSnippetChars: 200 });

    expect(prompt).toContain('Search evidence (untrusted):');
    expect(prompt).toContain('[1] Safe title');
    expect(prompt).toContain('line one line two');
    expect(prompt).not.toContain('data:text/plain');
    expect(prompt.length).toBeLessThanOrEqual(2000);
  });
});
