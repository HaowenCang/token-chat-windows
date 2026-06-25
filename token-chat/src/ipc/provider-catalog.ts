import { invoke } from '@tauri-apps/api/core';
import type { Model, Provider } from '../state';

export interface ProviderCatalogSnapshot {
  providers: Provider[];
  models: Model[];
}

export interface ProviderDraft {
  name: string;
  baseUrl: string;
  apiKey?: string | null;
  extraHeadersJson?: string | null;
}

export interface ModelDraft {
  providerId: string;
  modelName: string;
  displayName: string;
  systemPrompt?: string | null;
  temperature?: number | null;
  maxOutputTokens?: number | null;
  contextWindow?: number | null;
  uncachedInputNanosPerMillion?: number | null;
  cacheReadNanosPerMillion?: number | null;
  cacheWriteNanosPerMillion?: number | null;
  outputNanosPerMillion?: number | null;
  currency?: string | null;
}

export interface ProviderConnectionResult {
  success: boolean;
  latency_ms: number;
  error?: string;
}

export interface DiscoveredModel {
  id: string;
  owned_by?: string;
}

function providerInput(draft: ProviderDraft) {
  return {
    name: draft.name,
    base_url: draft.baseUrl,
    api_key: draft.apiKey ?? undefined,
    extra_headers_json: draft.extraHeadersJson || null,
  };
}

function modelInput(draft: ModelDraft) {
  return {
    provider_id: draft.providerId,
    model_name: draft.modelName,
    display_name: draft.displayName,
    system_prompt: draft.systemPrompt ?? null,
    temperature: draft.temperature ?? undefined,
    max_output_tokens: draft.maxOutputTokens ?? undefined,
    context_window: draft.contextWindow ?? undefined,
    uncached_input_nanos_per_million: draft.uncachedInputNanosPerMillion ?? undefined,
    cache_read_nanos_per_million: draft.cacheReadNanosPerMillion ?? undefined,
    cache_write_nanos_per_million: draft.cacheWriteNanosPerMillion ?? undefined,
    output_nanos_per_million: draft.outputNanosPerMillion ?? undefined,
    currency: draft.currency ?? undefined,
  };
}

export async function listProvidersWithModels(): Promise<ProviderCatalogSnapshot> {
  const providers = await invoke<Provider[]>('list_providers');
  const models: Model[] = [];
  for (const provider of providers) {
    try {
      models.push(...await listModels(provider.id));
    } catch {}
  }
  return { providers, models };
}

export function listModels(providerId: string): Promise<Model[]> {
  return invoke<Model[]>('list_models', { providerId });
}

export function createProvider(draft: ProviderDraft): Promise<Provider> {
  return invoke<Provider>('create_provider', { input: providerInput(draft) });
}

export function updateProvider(id: string, draft: ProviderDraft): Promise<Provider> {
  return invoke<Provider>('update_provider', { id, input: providerInput(draft) });
}

export function deleteProvider(id: string): Promise<void> {
  return invoke('delete_provider', { id });
}

export function getProviderApiKey(id: string): Promise<string | null> {
  return invoke<string | null>('get_provider_api_key', { id });
}

export function testProviderConnection(input: {
  baseUrl: string;
  apiKey: string;
}): Promise<ProviderConnectionResult> {
  return invoke<ProviderConnectionResult>('test_provider', {
    baseUrl: input.baseUrl,
    apiKey: input.apiKey,
  });
}

export function discoverModels(input: {
  baseUrl: string;
  apiKey: string;
}): Promise<DiscoveredModel[]> {
  return invoke<DiscoveredModel[]>('discover_models', {
    baseUrl: input.baseUrl,
    apiKey: input.apiKey,
  });
}

export function createModel(draft: ModelDraft): Promise<Model> {
  return invoke<Model>('create_model', { input: modelInput(draft) });
}

export function updateModel(id: string, draft: ModelDraft): Promise<Model> {
  return invoke<Model>('update_model', { id, input: modelInput(draft) });
}

export function deleteModel(id: string): Promise<void> {
  return invoke('delete_model', { id });
}
