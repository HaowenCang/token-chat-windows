import type { Model } from './state';
import { normalizeCurrency } from './currency';
import type { ModelDraft, ProviderDraft } from './ipc/provider-catalog';

export interface ProviderFormValues {
  name: string;
  baseUrl: string;
  apiKey: string;
  extraHeadersJson: string;
}

export interface ProviderConnectionFormValues {
  baseUrl: string;
  apiKey: string;
}

export interface ModelFormValues {
  providerId: string;
  modelName: string;
  displayName: string;
  contextWindow: string;
  inputPrice: string;
  cachePrice: string;
  outputPrice: string;
  currency: string;
  systemPrompt?: string;
  temperature?: string;
}

export interface ModelStatePatch {
  model_name: string;
  display_name: string;
  context_window: number;
  uncached_input_nanos_per_million: number;
  cache_read_nanos_per_million: number;
  output_nanos_per_million: number;
  currency: string;
  system_prompt: string | null;
  temperature: number;
}

function trim(value: string | null | undefined): string {
  return value?.trim() ?? '';
}

function parsePositiveInt(value: string): number {
  return Math.max(0, Number.parseInt(value, 10) || 0);
}

function priceToNanos(value: string): number {
  return Math.max(0, Math.round((Number.parseFloat(value) || 0) * 1e9));
}

function parseTemperature(value: string | null | undefined, fallback = 1): number {
  const parsed = Number.parseFloat(value ?? '');
  return Number.isFinite(parsed) ? Math.max(0, Math.min(2, parsed)) : fallback;
}

export function providerDraftFromForm(values: ProviderFormValues): ProviderDraft | null {
  const name = trim(values.name);
  const baseUrl = trim(values.baseUrl);
  if (!name || !baseUrl) return null;
  return {
    name,
    baseUrl,
    apiKey: trim(values.apiKey),
    extraHeadersJson: trim(values.extraHeadersJson) || null,
  };
}

export function providerConnectionInputFromForm(values: ProviderConnectionFormValues): { baseUrl: string; apiKey: string } | null {
  const baseUrl = trim(values.baseUrl);
  if (!baseUrl) return null;
  return {
    baseUrl,
    apiKey: trim(values.apiKey),
  };
}

export function modelDraftFromForm(values: ModelFormValues): ModelDraft | null {
  const providerId = trim(values.providerId);
  const modelName = trim(values.modelName);
  const displayName = trim(values.displayName);
  if (!providerId || !modelName || !displayName) return null;

  return {
    providerId,
    modelName,
    displayName,
    contextWindow: parsePositiveInt(values.contextWindow),
    uncachedInputNanosPerMillion: priceToNanos(values.inputPrice),
    cacheReadNanosPerMillion: priceToNanos(values.cachePrice),
    outputNanosPerMillion: priceToNanos(values.outputPrice),
    currency: normalizeCurrency(values.currency),
    systemPrompt: trim(values.systemPrompt) || null,
    temperature: parseTemperature(values.temperature, 1),
  };
}

export function modelStatePatchFromDraft(draft: ModelDraft): ModelStatePatch {
  return {
    model_name: draft.modelName,
    display_name: draft.displayName,
    context_window: draft.contextWindow ?? 0,
    uncached_input_nanos_per_million: draft.uncachedInputNanosPerMillion ?? 0,
    cache_read_nanos_per_million: draft.cacheReadNanosPerMillion ?? 0,
    output_nanos_per_million: draft.outputNanosPerMillion ?? 0,
    currency: normalizeCurrency(draft.currency),
    system_prompt: draft.systemPrompt ?? null,
    temperature: draft.temperature ?? 1,
  };
}

export function modelFromDraft(id: string, draft: ModelDraft): Model {
  return {
    id,
    provider_id: draft.providerId,
    max_output_tokens: draft.maxOutputTokens ?? undefined,
    ...modelStatePatchFromDraft(draft),
  };
}

export function discoveredModelDraft(providerId: string, modelName: string, currency: string): ModelDraft {
  return {
    providerId,
    modelName,
    displayName: modelName,
    contextWindow: 128000,
    uncachedInputNanosPerMillion: 0,
    cacheReadNanosPerMillion: 0,
    outputNanosPerMillion: 0,
    currency: normalizeCurrency(currency),
    temperature: 1,
  };
}
