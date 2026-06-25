import { invoke } from '@tauri-apps/api/core';
import type {
  SearchConfigView,
  SearchOptions,
  SearchProviderConfig,
  SearchResponse,
  SearchTestResult,
} from '../web-search';

export function getSearchConfig(): Promise<SearchConfigView> {
  return invoke<SearchConfigView>('get_search_config');
}

export function saveSearchConfig(input: {
  config: SearchProviderConfig;
  apiKey?: string;
  clearApiKey: boolean;
}): Promise<SearchConfigView> {
  return invoke<SearchConfigView>('save_search_config', {
    input: {
      config: input.config,
      apiKey: input.apiKey?.trim() || null,
      clearApiKey: input.clearApiKey,
    },
  });
}

export function testSearchConnection(): Promise<SearchTestResult> {
  return invoke<SearchTestResult>('test_search_connection');
}

export function searchWeb(query: string, options: SearchOptions): Promise<SearchResponse> {
  return invoke<SearchResponse>('search_web', { query, options });
}

export function cancelSearch(): Promise<void> {
  return invoke('cancel_search');
}
