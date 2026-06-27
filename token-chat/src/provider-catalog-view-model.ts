import type { Model, Provider } from './state';

export type ProviderHealth = 'online' | 'degraded' | 'offline';

export interface ProviderListItem {
  id: string;
  name: string;
  modelCount: number;
  isActive: boolean;
  health: ProviderHealth;
  statusDotClass: string;
}

export interface ProviderDetailView {
  provider: Provider | null;
  models: Model[];
  health: ProviderHealth;
}

export function getProviderModels(models: Model[], providerId: string): Model[] {
  return models.filter(model => model.provider_id === providerId);
}

export function getProviderHealth(_provider: Provider): ProviderHealth {
  return 'online';
}

export function getProviderListItems(input: {
  providers: Provider[];
  models: Model[];
  selectedProviderId: string | null;
}): ProviderListItem[] {
  return input.providers.map(provider => {
    const health = getProviderHealth(provider);
    return {
      id: provider.id,
      name: provider.name,
      modelCount: getProviderModels(input.models, provider.id).length,
      isActive: provider.id === input.selectedProviderId,
      health,
      statusDotClass: health === 'online' ? 'online' : health === 'degraded' ? 'degraded' : '',
    };
  });
}

export function getProviderDetailView(input: {
  providers: Provider[];
  models: Model[];
  selectedProviderId: string | null;
}): ProviderDetailView {
  const provider = input.selectedProviderId
    ? input.providers.find(item => item.id === input.selectedProviderId) ?? null
    : null;
  return {
    provider,
    models: provider ? getProviderModels(input.models, provider.id) : [],
    health: provider ? getProviderHealth(provider) : 'offline',
  };
}
