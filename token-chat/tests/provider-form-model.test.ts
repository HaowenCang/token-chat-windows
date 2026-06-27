import { describe, expect, it } from 'vitest';
import {
  discoveredModelDraft,
  modelDraftFromForm,
  modelFromDraft,
  modelStatePatchFromDraft,
  providerConnectionInputFromForm,
  providerDraftFromForm,
} from '../src/provider-form-model';

describe('provider form model', () => {
  it('builds provider drafts from trimmed required fields', () => {
    expect(providerDraftFromForm({
      name: '  OpenAI  ',
      baseUrl: '  https://api.openai.com/v1  ',
      apiKey: '  sk-test  ',
      extraHeadersJson: '  {"x-test":"1"}  ',
    })).toEqual({
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      extraHeadersJson: '{"x-test":"1"}',
    });

    expect(providerDraftFromForm({
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      extraHeadersJson: '   ',
    })).toMatchObject({
      apiKey: '',
      extraHeadersJson: null,
    });
  });

  it('rejects provider drafts and connection inputs without required values', () => {
    expect(providerDraftFromForm({
      name: '',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      extraHeadersJson: '',
    })).toBeNull();

    expect(providerConnectionInputFromForm({
      baseUrl: '   ',
      apiKey: 'sk-test',
    })).toBeNull();
  });

  it('normalizes model drafts and converts per-million prices to nanos', () => {
    const draft = modelDraftFromForm({
      providerId: ' p1 ',
      modelName: ' gpt-test ',
      displayName: ' GPT Test ',
      contextWindow: '128000',
      inputPrice: '2.5',
      cachePrice: '1.25',
      outputPrice: '10',
      currency: 'usd',
      systemPrompt: '  Be useful.  ',
      temperature: '1.3',
    });

    expect(draft).toEqual({
      providerId: 'p1',
      modelName: 'gpt-test',
      displayName: 'GPT Test',
      contextWindow: 128000,
      uncachedInputNanosPerMillion: 2_500_000_000,
      cacheReadNanosPerMillion: 1_250_000_000,
      outputNanosPerMillion: 10_000_000_000,
      currency: 'USD',
      systemPrompt: 'Be useful.',
      temperature: 1.3,
    });
  });

  it('rejects model drafts without identity fields and clamps numeric values', () => {
    expect(modelDraftFromForm({
      providerId: 'p1',
      modelName: '',
      displayName: 'GPT Test',
      contextWindow: '128000',
      inputPrice: '1',
      cachePrice: '1',
      outputPrice: '1',
      currency: 'USD',
    })).toBeNull();

    expect(modelDraftFromForm({
      providerId: 'p1',
      modelName: 'gpt-test',
      displayName: 'GPT Test',
      contextWindow: '-1',
      inputPrice: '-2',
      cachePrice: 'not-a-number',
      outputPrice: '3',
      currency: 'unknown',
      temperature: '9',
    })).toMatchObject({
      contextWindow: 0,
      uncachedInputNanosPerMillion: 0,
      cacheReadNanosPerMillion: 0,
      outputNanosPerMillion: 3_000_000_000,
      currency: 'CNY',
      systemPrompt: null,
      temperature: 2,
    });
  });

  it('projects model drafts into local state shape', () => {
    const draft = discoveredModelDraft('p1', 'gpt-new', 'usd');
    const model = modelFromDraft('m1', draft);

    expect(draft).toMatchObject({
      providerId: 'p1',
      modelName: 'gpt-new',
      displayName: 'gpt-new',
      contextWindow: 128000,
      currency: 'USD',
      temperature: 1,
    });
    expect(model).toMatchObject({
      id: 'm1',
      provider_id: 'p1',
      model_name: 'gpt-new',
      display_name: 'gpt-new',
      context_window: 128000,
      uncached_input_nanos_per_million: 0,
      cache_read_nanos_per_million: 0,
      output_nanos_per_million: 0,
      currency: 'USD',
      system_prompt: null,
      temperature: 1,
    });
    expect(modelStatePatchFromDraft(draft)).toMatchObject({
      model_name: 'gpt-new',
      display_name: 'gpt-new',
      context_window: 128000,
      currency: 'USD',
    });
  });
});
