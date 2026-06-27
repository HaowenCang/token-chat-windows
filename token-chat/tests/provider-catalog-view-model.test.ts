import { describe, expect, it } from 'vitest';
import type { Model, Provider } from '../src/state';
import {
  getProviderDetailView,
  getProviderListItems,
  getProviderModels,
} from '../src/provider-catalog-view-model';

const providers: Provider[] = [
  { id: 'p1', name: 'OpenAI', base_url: 'https://api.openai.com/v1', created_at: 1, updated_at: 1 },
  { id: 'p2', name: 'Local', base_url: 'http://localhost:11434', created_at: 1, updated_at: 1 },
];

const models: Model[] = [
  {
    id: 'm1',
    provider_id: 'p1',
    model_name: 'gpt-a',
    display_name: 'GPT A',
    temperature: 1,
    context_window: 128000,
    uncached_input_nanos_per_million: 1,
    cache_read_nanos_per_million: 1,
    output_nanos_per_million: 1,
    currency: 'USD',
  },
  {
    id: 'm2',
    provider_id: 'p1',
    model_name: 'gpt-b',
    display_name: 'GPT B',
    temperature: 1,
    context_window: 128000,
    uncached_input_nanos_per_million: 1,
    cache_read_nanos_per_million: 1,
    output_nanos_per_million: 1,
    currency: 'USD',
  },
];

describe('provider catalog view model', () => {
  it('counts models and marks the selected provider for the list', () => {
    expect(getProviderListItems({
      providers,
      models,
      selectedProviderId: 'p2',
    })).toEqual([
      {
        id: 'p1',
        name: 'OpenAI',
        modelCount: 2,
        isActive: false,
        health: 'online',
        statusDotClass: 'online',
      },
      {
        id: 'p2',
        name: 'Local',
        modelCount: 0,
        isActive: true,
        health: 'online',
        statusDotClass: 'online',
      },
    ]);
  });

  it('filters models and builds an empty detail view when no provider is selected', () => {
    expect(getProviderModels(models, 'p1')).toHaveLength(2);
    expect(getProviderModels(models, 'p2')).toEqual([]);

    expect(getProviderDetailView({
      providers,
      models,
      selectedProviderId: null,
    })).toEqual({
      provider: null,
      models: [],
      health: 'offline',
    });
  });

  it('builds detail view for the selected provider only', () => {
    expect(getProviderDetailView({
      providers,
      models,
      selectedProviderId: 'p1',
    })).toMatchObject({
      provider: providers[0],
      models,
      health: 'online',
    });
  });
});
