import { describe, expect, it, vi } from 'vitest';
import { SearchSettingsModel, searchConfigFromForm } from '../src/search-settings-model';
import {
  defaultSearchProviderConfig,
  type SearchConfigView,
  type SearchProviderConfig,
  type SearchTestResult,
} from '../src/web-search';

function formValues(values: Record<string, string>): URLSearchParams {
  return new URLSearchParams(values);
}

describe('search settings model', () => {
  it('projects one form snapshot into a normalized provider config', () => {
    const values = formValues({
      searchFeatureEnabled: 'true',
      searchProviderId: '',
      searchBaseUrl: ' https://search.example.test ',
      searchApiKeyHeader: ' X-Key ',
      searchApiKeyPrefix: 'Token ',
      searchQueryParam: '',
      searchExtraHeaders: '',
      searchMaxResults: '99',
      searchLanguage: '',
      searchSafeSearch: 'false',
      searchTimeout: '200',
    });

    expect(searchConfigFromForm(values, defaultSearchProviderConfig)).toMatchObject({
      enabled: true,
      providerId: 'http-json',
      baseUrl: 'https://search.example.test',
      apiKeyHeader: 'X-Key',
      apiKeyPrefix: 'Token ',
      queryParam: 'q',
      extraHeadersJson: '{}',
      defaultMaxResults: 20,
      defaultLanguage: 'auto',
      safeSearch: false,
      timeoutMs: 1000,
    });
  });

  it('saves before testing and consumes an API key clear request once', async () => {
    let snapshot: SearchConfigView = {
      config: { ...defaultSearchProviderConfig },
      hasApiKey: true,
    };
    const save = vi.fn(async (
      config: SearchProviderConfig,
      apiKey?: string,
      clearApiKey?: boolean,
    ) => {
      snapshot = { config, hasApiKey: clearApiKey ? false : Boolean(apiKey) || snapshot.hasApiKey };
      return snapshot;
    });
    const testResult: SearchTestResult = {
      success: true,
      latencyMs: 12,
      resultCount: 1,
      results: [],
    };
    const test = vi.fn(async () => testResult);
    const model = new SearchSettingsModel({
      getSnapshot: () => snapshot,
      save,
      test,
    });
    const values = formValues({ searchApiKey: '', searchTimeout: '12000' });

    model.requestApiKeyClear();
    await model.testConnection(values);
    expect(save).toHaveBeenNthCalledWith(1, expect.any(Object), '', true);
    expect(test).toHaveBeenCalledOnce();
    expect(save.mock.invocationCallOrder[0]).toBeLessThan(test.mock.invocationCallOrder[0]);

    await model.save(values);
    expect(save).toHaveBeenNthCalledWith(2, expect.any(Object), '', false);
  });

  it('resets provider fields to defaults without clearing a stored key', async () => {
    const save = vi.fn(async (config: SearchProviderConfig) => ({ config, hasApiKey: true }));
    const model = new SearchSettingsModel({
      getSnapshot: () => ({ config: { ...defaultSearchProviderConfig }, hasApiKey: true }),
      save,
      test: async () => ({ success: true, latencyMs: 0, resultCount: 0, results: [] }),
    });

    await model.reset();
    expect(save).toHaveBeenCalledWith(defaultSearchProviderConfig);
  });
});
