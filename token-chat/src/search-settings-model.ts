import {
  defaultSearchProviderConfig,
  type SearchConfigView,
  type SearchProviderConfig,
  type SearchTestResult,
} from './web-search';

export interface SearchFormValues {
  get(name: string): FormDataEntryValue | null;
}

export interface SearchSettingsAdapter {
  getSnapshot(): SearchConfigView;
  save(config: SearchProviderConfig, apiKey?: string, clearApiKey?: boolean): Promise<SearchConfigView>;
  test(): Promise<SearchTestResult>;
}

function stringValue(values: SearchFormValues, name: string, fallback = ''): string {
  const value = values.get(name);
  return typeof value === 'string' ? value.trim() : fallback;
}

function rawStringValue(values: SearchFormValues, name: string, fallback = ''): string {
  const value = values.get(name);
  return typeof value === 'string' ? value : fallback;
}

function booleanValue(values: SearchFormValues, name: string): boolean {
  return ['true', '1', 'on'].includes(stringValue(values, name).toLowerCase());
}

function integerValue(
  values: SearchFormValues,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const rawValue = stringValue(values, name);
  if (!rawValue) return fallback;
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

export function searchConfigFromForm(
  values: SearchFormValues,
  previous: SearchProviderConfig,
): SearchProviderConfig {
  return {
    enabled: booleanValue(values, 'searchFeatureEnabled'),
    providerId: stringValue(values, 'searchProviderId', 'http-json') || 'http-json',
    baseUrl: stringValue(values, 'searchBaseUrl'),
    apiKeyHeader: stringValue(values, 'searchApiKeyHeader'),
    apiKeyPrefix: rawStringValue(values, 'searchApiKeyPrefix'),
    apiKeyQueryParam: stringValue(values, 'searchApiKeyQueryParam'),
    queryParam: stringValue(values, 'searchQueryParam', 'q') || 'q',
    resultCountParam: stringValue(values, 'searchCountParam'),
    languageParam: stringValue(values, 'searchLanguageParam'),
    regionParam: stringValue(values, 'searchRegionParam'),
    safeSearchParam: stringValue(values, 'searchSafeParam'),
    freshnessParam: stringValue(values, 'searchFreshnessParam'),
    resultsPath: stringValue(values, 'searchResultsPath'),
    titleField: stringValue(values, 'searchTitleField', 'title') || 'title',
    urlField: stringValue(values, 'searchUrlField', 'url') || 'url',
    snippetField: stringValue(values, 'searchSnippetField', 'snippet') || 'snippet',
    sourceField: stringValue(values, 'searchSourceField'),
    publishedAtField: stringValue(values, 'searchPublishedField'),
    extraHeadersJson: stringValue(values, 'searchExtraHeaders', '{}') || '{}',
    defaultMaxResults: integerValue(values, 'searchMaxResults', previous.defaultMaxResults, 1, 20),
    defaultLanguage: stringValue(values, 'searchLanguage', 'auto') || 'auto',
    defaultRegion: stringValue(values, 'searchRegion'),
    safeSearch: booleanValue(values, 'searchSafeSearch'),
    timeoutMs: integerValue(values, 'searchTimeout', previous.timeoutMs, 1000, 120000),
  };
}

export class SearchSettingsModel {
  private clearApiKeyRequested = false;

  constructor(private readonly adapter: SearchSettingsAdapter) {}

  requestApiKeyClear(): void {
    this.clearApiKeyRequested = true;
  }

  async save(values: SearchFormValues): Promise<SearchConfigView> {
    const config = searchConfigFromForm(values, this.adapter.getSnapshot().config);
    const apiKey = rawStringValue(values, 'searchApiKey');
    const view = await this.adapter.save(config, apiKey, this.clearApiKeyRequested);
    this.clearApiKeyRequested = false;
    return view;
  }

  async reset(): Promise<SearchConfigView> {
    this.clearApiKeyRequested = false;
    return this.adapter.save({ ...defaultSearchProviderConfig });
  }

  async testConnection(values: SearchFormValues): Promise<SearchTestResult> {
    await this.save(values);
    return this.adapter.test();
  }
}
