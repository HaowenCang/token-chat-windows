import { state, type Provider, type Model } from './state';
import { t } from './i18n';
import { currencyOptions, formatCurrencyAmount, getDisplayCurrency, normalizeCurrency } from './currency';
import { showGlassConfirm } from './glass-dialog';
import { clearDeclaredGlassPortals, mountDeclaredGlassPortals } from './liquid-glass';
import {
  discoveredModelDraft,
  modelDraftFromForm,
  modelFromDraft,
  modelStatePatchFromDraft,
  providerConnectionInputFromForm,
  providerDraftFromForm,
} from './provider-form-model';
import {
  getProviderDetailView,
  getProviderListItems,
  getProviderModels as getModelsForProvider,
} from './provider-catalog-view-model';
import {
  createModel as createModelInCatalog,
  createProvider as createProviderInCatalog,
  deleteModel as deleteModelFromCatalog,
  deleteProvider as deleteProviderFromCatalog,
  discoverModels as discoverProviderModels,
  getProviderApiKey,
  listModels as listModelsInCatalog,
  listProvidersWithModels,
  testProviderConnection,
  updateModel as updateModelInCatalog,
  updateProvider as updateProviderInCatalog,
} from './ipc/provider-catalog';
import { isWebRuntime } from './platform/runtime';

const isDev = isWebRuntime();

const mockProviders: Provider[] = [
  { id: 'p1', name: 'OpenAI', base_url: 'https://api.openai.com/v1', created_at: 1718000000, updated_at: 1718000000 },
  { id: 'p2', name: 'Anthropic', base_url: 'https://api.anthropic.com', created_at: 1718000000, updated_at: 1718000000 },
  { id: 'p3', name: 'Local Ollama', base_url: 'http://localhost:11434', created_at: 1718000000, updated_at: 1718000000 },
];

const mockModels: Model[] = [
  { id: 'm1', provider_id: 'p1', model_name: 'gpt-4o', display_name: 'GPT-4o', context_window: 128000, temperature: 1.0, uncached_input_nanos_per_million: 2500000000, cache_read_nanos_per_million: 1250000000, output_nanos_per_million: 10000000000, currency: 'USD' },
  { id: 'm2', provider_id: 'p1', model_name: 'gpt-4o-mini', display_name: 'GPT-4o Mini', context_window: 128000, temperature: 1.0, uncached_input_nanos_per_million: 150000000, cache_read_nanos_per_million: 75000000, output_nanos_per_million: 600000000, currency: 'USD' },
  { id: 'm3', provider_id: 'p2', model_name: 'claude-sonnet-4-20250514', display_name: 'Claude Sonnet 4', context_window: 200000, temperature: 1.0, uncached_input_nanos_per_million: 3000000000, cache_read_nanos_per_million: 300000000, output_nanos_per_million: 15000000000, currency: 'USD' },
  { id: 'm4', provider_id: 'p3', model_name: 'llama3', display_name: 'Llama 3', context_window: 8192, temperature: 1.0, uncached_input_nanos_per_million: 0, cache_read_nanos_per_million: 0, output_nanos_per_million: 0, currency: 'USD' },
];

let selectedProviderId: string | null = null;
let showAddProviderModal = false;
let showAddModelModal = false;
let showDiscoverModal = false;
let editingProviderId: string | null = null;
let editingModelId: string | null = null;
let testResult: { success: boolean; latency_ms: number; error?: string } | null = null;
let testLoading = false;
let discoverLoading = false;
let discoveredModels: { id: string; owned_by?: string; selected: boolean }[] = [];

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderCurrencyOptions(selectedCurrency: string): string {
  const selected = normalizeCurrency(selectedCurrency);
  return currencyOptions.map(option => `
    <option value="${option.value}" ${option.value === selected ? 'selected' : ''}>${escHtml(t(option.labelKey))} (${option.value})</option>
  `).join('');
}

function formatPrice(nanos: number, currency: string): string {
  const amount = nanos / 1e9;
  if (amount === 0) return t('provider.free');
  return formatCurrencyAmount(amount, 2, currency);
}

export async function loadProviders(): Promise<void> {
  if (isDev) {
    state.providers = [...mockProviders];
    state.models = [...mockModels];
    return;
  }
  try {
    const snapshot = await listProvidersWithModels();
    state.providers = snapshot.providers;
    state.models = snapshot.models;
  } catch {
    state.providers = [];
    state.models = [];
  }
}

async function loadModels(providerId: string): Promise<void> {
  if (isDev) {
    state.models = mockModels.filter(m => m.provider_id === providerId);
    return;
  }
  try {
    const models = await listModelsInCatalog(providerId);
    state.models = [
      ...state.models.filter(m => m.provider_id !== providerId),
      ...models,
    ];
  } catch {
    state.models = state.models.filter(m => m.provider_id !== providerId);
  }
}

function getCatalogModels(): Model[] {
  return isDev ? mockModels : state.models;
}

function getProviderModels(providerId: string): Model[] {
  return getModelsForProvider(getCatalogModels(), providerId);
}

export function renderProviderPage(): string {
  return `
    <div class="page-screen provider-page" style="flex:1;display:flex;flex-direction:column;overflow:hidden">
      <div class="page-header" style="padding:20px 28px 0;display:flex;align-items:center;gap:12px">
        <h2 style="font-size:var(--fs-page-title);font-weight:700">${t('provider.title')}</h2>
        <div style="margin-left:auto;display:flex;gap:8px">
          <button class="tool-btn glass-button glass-button--secondary" id="importConfigBtn">${t('provider.import')}</button>
          <button class="tool-btn glass-button glass-button--secondary" id="exportConfigBtn">${t('provider.export')}</button>
          <button class="test-btn glass-button glass-button--primary" id="addProviderBtn">+ ${t('provider.add')}</button>
        </div>
      </div>
      <div class="provider-shell glass-card" style="flex:1;display:flex;overflow:hidden;margin:16px 28px 28px">
        <div class="provider-list" style="border-right:1px solid var(--line)">
          <div class="provider-list-header">${t('provider.list')} (${state.providers.length})</div>
          <div class="provider-items" id="providerItems">
            ${renderProviderCards()}
          </div>
        </div>
        <div class="provider-detail" id="providerDetail">
          ${renderProviderDetail()}
        </div>
      </div>
      ${showAddProviderModal ? renderAddProviderModal() : ''}
      ${showAddModelModal ? renderAddModelModal() : ''}
      ${editingProviderId ? renderEditProviderModal() : ''}
      ${showDiscoverModal ? renderDiscoverModal() : ''}
      ${editingModelId ? renderEditModelModal() : ''}
    </div>
  `;
}

function renderProviderCards(): string {
  if (state.providers.length === 0) {
    return `<div class="placeholder-content" style="height:200px">${t('provider.noProviders')}</div>`;
  }
  return getProviderListItems({
    providers: state.providers,
    models: getCatalogModels(),
    selectedProviderId,
  }).map(item => {
    return `
      <div class="provider-item glass-card glass-list-item ${item.isActive ? 'active' : ''}" data-provider-id="${item.id}">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:2px">
          <div class="status-dot ${item.statusDotClass}"></div>
          <div class="provider-item-name">${escHtml(item.name)}</div>
        </div>
        <div class="provider-item-status">
          <span class="tag glass-chip">${item.modelCount} ${t('provider.models')}</span>
        </div>
      </div>
    `;
  }).join('');
}

function renderProviderDetail(): string {
  if (!selectedProviderId) {
    return `<div class="placeholder-content">${t('provider.selectProvider')}</div>`;
  }
  const { provider, models, health } = getProviderDetailView({
    providers: state.providers,
    models: getCatalogModels(),
    selectedProviderId,
  });
  if (!provider) return `<div class="placeholder-content">${t('provider.noProviders')}</div>`;

  const healthLabel = health === 'online' ? t('provider.online') : health === 'degraded' ? t('provider.degraded') : t('provider.offline');
  const healthColor = health === 'online' ? 'var(--success)' : health === 'degraded' ? 'var(--warning)' : 'var(--danger)';

  return `
    <div class="provider-detail-header">
      <h3>${escHtml(provider.name)}</h3>
      <p>${escHtml(provider.base_url)}</p>
    </div>
    <div class="health-section">
      <h4>${t('provider.health')}</h4>
      <div class="health-bar-wrap">
        <div class="health-bar-label">
          <span>${t('provider.test')}</span>
          <span style="color:${healthColor}">${healthLabel}</span>
        </div>
        <div class="health-bar">
          <div class="health-bar-fill" style="width:${health === 'online' ? '100' : health === 'degraded' ? '50' : '0'}%;background:${healthColor}"></div>
        </div>
      </div>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="test-btn glass-button glass-button--primary ${testLoading ? 'testing' : ''}" id="testConnBtn">
          <span class="spinner"></span>
          ${t('provider.test')}
        </button>
        <button class="modal-footer-btn glass-button glass-button--secondary" id="editProviderBtn">${t('provider.editProvider')}</button>
        <button class="modal-footer-btn glass-button glass-button--danger" id="deleteProviderBtn">${t('provider.deleteProvider')}</button>
      </div>
      <div class="test-result liquid-glass liquid-glass--notice ${testResult ? 'show' : ''} ${testResult?.success ? 'ok' : testResult ? 'fail' : ''}" id="testResult">
        ${testResult?.success
          ? `${t('provider.connectionSuccess')} (${testResult.latency_ms}ms)`
          : testResult
          ? `${t('provider.connectionFail')}: ${escHtml(testResult.error ?? t('provider.unknownError'))}`
          : ''
        }
      </div>
    </div>
      <div class="provider-models">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
          <h4 style="margin:0">${t('provider.models')} (${models.length})</h4>
          <button class="tool-btn glass-button glass-button--secondary" id="discoverModelsBtn">${t('provider.discover')}</button>
          <button class="tool-btn glass-button glass-button--secondary" id="addModelBtn">+ ${t('provider.addModel')}</button>
        </div>
      ${models.length === 0
        ? `<div class="placeholder-content" style="height:80px">${t('provider.noModels')}</div>`
        : `<table class="data-table">
            <thead><tr><th>${t('provider.thName')}</th><th>${t('provider.thApiName')}</th><th>${t('provider.thContext')}</th><th>${t('provider.thInput')}</th><th>${t('provider.thOutput')}</th><th></th></tr></thead>
            <tbody>
              ${models.map(m => `
                <tr>
                  <td><strong>${escHtml(m.display_name)}</strong></td>
                  <td style="color:var(--text-muted);font-family:var(--font-mono);font-size:var(--fs-secondary)">${escHtml(m.model_name)}</td>
                  <td>${(m.context_window / 1000).toFixed(0)}K</td>
                  <td>${formatPrice(m.uncached_input_nanos_per_million, m.currency)}</td>
                  <td>${formatPrice(m.output_nanos_per_million, m.currency)}</td>
                  <td><button class="tool-btn glass-button glass-button--secondary" data-edit-model="${m.id}" style="font-size:var(--fs-secondary)">Edit</button></td>
                </tr>
              `).join('')}
            </tbody>
          </table>`
      }
    </div>
  `;
}

function renderAddProviderModal(): string {
  return `
    <div class="modal-backdrop glass-modal-backdrop" data-glass-portal data-glass-portal-owner="provider">
      <div class="modal-overlay glass-modal provider-modal liquid-glass liquid-glass--modal" role="dialog" aria-modal="true" aria-label="Add Provider" style="width:min(480px,calc(100vw - 48px))">
        <div class="modal-header">
          <h2>${t('provider.add')}</h2>
          <button class="modal-close" id="closeAddProviderModal">&#10005;</button>
        </div>
        <div class="modal-body" style="flex-direction:column;gap:14px;padding:20px 24px">
          <div class="glass-form-field">
            <label>${t('provider.name')}</label>
            <input class="glass-input" type="text" id="providerName" placeholder="e.g. OpenAI" style="width:100%">
          </div>
          <div class="glass-form-field">
            <label>${t('provider.baseUrl')}</label>
            <input class="glass-input" type="text" id="providerBaseUrl" placeholder="https://api.openai.com/v1" style="width:100%">
          </div>
          <div class="glass-form-field">
            <label>${t('provider.apiKey')}</label>
            <input class="glass-input" type="password" id="providerApiKey" placeholder="sk-..." style="width:100%">
          </div>
          <div class="glass-form-field">
            <label>${t('provider.extraHeaders')}</label>
            <textarea class="glass-textarea" id="providerHeaders" placeholder='{"X-Custom": "value"}' style="width:100%;min-height:60px;font-family:var(--font-mono)"></textarea>
          </div>
          <div class="test-result liquid-glass liquid-glass--notice ${testResult ? 'show' : ''} ${testResult?.success ? 'ok' : testResult ? 'fail' : ''}" id="modalTestResult">
            ${testResult?.success
              ? `${t('provider.connectionSuccess')} (${testResult.latency_ms}ms)`
              : testResult
              ? `${t('provider.connectionFail')}: ${escHtml(testResult.error ?? t('provider.unknownError'))}`
              : ''
            }
          </div>
        </div>
        <div class="modal-footer">
          <button class="test-btn glass-button glass-button--secondary ${testLoading ? 'testing' : ''}" id="modalTestBtn">
            <span class="spinner"></span>
            ${t('provider.test')}
          </button>
          <div style="flex:1"></div>
          <button class="modal-footer-btn glass-button glass-button--secondary" id="cancelAddProvider">${t('common.cancel')}</button>
          <button class="test-btn glass-button glass-button--primary" id="saveProviderBtn">${t('common.save')}</button>
        </div>
      </div>
    </div>
  `;
}

function renderAddModelModal(): string {
  return `
    <div class="modal-backdrop glass-modal-backdrop" data-glass-portal data-glass-portal-owner="provider">
      <div class="modal-overlay glass-modal provider-modal liquid-glass liquid-glass--modal" role="dialog" aria-modal="true" aria-label="Add Model" style="width:min(520px,calc(100vw - 48px))">
        <div class="modal-header">
          <h2>${t('provider.addModel')}</h2>
          <button class="modal-close" id="closeAddModelModal">&#10005;</button>
        </div>
        <div class="modal-body" style="flex-direction:column;gap:14px;padding:20px 24px">
          <div class="glass-form-field">
            <label>${t('provider.apiIdentifier')}</label>
            <input class="glass-input" type="text" id="modelName" placeholder="gpt-4o" style="width:100%">
          </div>
          <div class="glass-form-field">
            <label>${t('provider.displayName')}</label>
            <input class="glass-input" type="text" id="modelDisplayName" placeholder="GPT-4o" style="width:100%">
          </div>
          <div class="glass-form-field">
            <label>${t('provider.contextWindow')}</label>
            <input class="glass-input" type="number" id="modelContextWindow" placeholder="128000" style="width:100%">
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div class="glass-form-field">
              <label>${t('provider.uncachedInput')}</label>
              <input class="glass-input" type="number" step="0.01" id="modelInputPrice" placeholder="2.50" style="width:100%">
            </div>
            <div class="glass-form-field">
              <label>${t('provider.cachePrice')}</label>
              <input class="glass-input" type="number" step="0.01" id="modelCachePrice" placeholder="1.25" style="width:100%">
            </div>
            <div class="glass-form-field">
              <label>${t('provider.outputPrice')}</label>
              <input class="glass-input" type="number" step="0.01" id="modelOutputPrice" placeholder="10.00" style="width:100%">
            </div>
            <div class="glass-form-field">
              <label>${t('provider.currency')}</label>
              <select class="glass-select" id="modelCurrency" style="width:100%">${renderCurrencyOptions(getDisplayCurrency())}</select>
            </div>
          </div>
          <div class="glass-form-field">
            <label>${t('provider.systemPrompt')} (${t('provider.optional')})</label>
            <textarea class="glass-textarea" id="modelSystemPrompt" placeholder="You are a helpful assistant." style="width:100%;min-height:60px"></textarea>
          </div>
          <div class="glass-form-field">
            <label>${t('provider.temperature')}: <span id="tempValue">0.7</span></label>
            <input class="glass-range" type="range" id="modelTemperature" min="0" max="2" step="0.1" value="0.7" style="width:100%;accent-color:var(--accent)">
          </div>
        </div>
        <div class="modal-footer">
          <div style="flex:1"></div>
          <button class="modal-footer-btn glass-button glass-button--secondary" id="cancelAddModel">${t('common.cancel')}</button>
          <button class="test-btn glass-button glass-button--primary" id="saveModelBtn">${t('common.save')}</button>
        </div>
      </div>
    </div>
  `;
}

function renderEditProviderModal(): string {
  const provider = state.providers.find(p => p.id === editingProviderId);
  if (!provider) return '';
  return `
    <div class="modal-backdrop glass-modal-backdrop" data-glass-portal data-glass-portal-owner="provider">
      <div class="modal-overlay glass-modal provider-modal liquid-glass liquid-glass--modal" role="dialog" aria-modal="true" aria-label="Edit Provider" style="width:min(480px,calc(100vw - 48px))">
        <div class="modal-header">
          <h2>${t('provider.editProvider')}</h2>
          <button class="modal-close" id="closeEditProviderModal">&#10005;</button>
        </div>
        <div class="modal-body" style="flex-direction:column;gap:14px;padding:20px 24px">
          <div class="glass-form-field">
            <label>${t('provider.name')}</label>
            <input class="glass-input" type="text" id="editProviderName" value="${escHtml(provider.name)}" style="width:100%">
          </div>
          <div class="glass-form-field">
            <label>${t('provider.baseUrl')}</label>
            <input class="glass-input" type="text" id="editProviderBaseUrl" value="${escHtml(provider.base_url)}" style="width:100%">
          </div>
          <div class="glass-form-field">
            <label>${t('provider.apiKey')}</label>
            <input class="glass-input" type="password" id="editProviderApiKey" placeholder="${t('provider.leaveEmpty')}" style="width:100%">
          </div>
          <div class="glass-form-field">
            <label>${t('provider.extraHeaders')}</label>
            <textarea class="glass-textarea" id="editProviderHeaders" placeholder='{"X-Custom": "value"}' style="width:100%;min-height:60px;font-family:var(--font-mono)">${provider.extra_headers_json ?? ''}</textarea>
          </div>
          <div class="test-result liquid-glass liquid-glass--notice ${testResult ? 'show' : ''} ${testResult?.success ? 'ok' : testResult ? 'fail' : ''}" id="editTestResult">
            ${testResult?.success
              ? `${t('provider.connectionSuccess')} (${testResult.latency_ms}ms)`
              : testResult
              ? `${t('provider.connectionFail')}: ${escHtml(testResult.error ?? t('provider.unknownError'))}`
              : ''
            }
          </div>
        </div>
        <div class="modal-footer">
          <button class="test-btn glass-button glass-button--secondary ${testLoading ? 'testing' : ''}" id="editTestBtn">
            <span class="spinner"></span>
            ${t('provider.test')}
          </button>
          <div style="flex:1"></div>
          <button class="modal-footer-btn glass-button glass-button--secondary" id="cancelEditProvider">${t('common.cancel')}</button>
          <button class="test-btn glass-button glass-button--primary" id="saveEditProviderBtn">${t('common.save')}</button>
        </div>
      </div>
    </div>
  `;
}

function renderDiscoverModal(): string {
  return `
    <div class="modal-backdrop glass-modal-backdrop" data-glass-portal data-glass-portal-owner="provider">
      <div class="modal-overlay glass-modal provider-modal liquid-glass liquid-glass--modal" role="dialog" aria-modal="true" aria-label="Discover Models" style="width:min(560px,calc(100vw - 48px))">
        <div class="modal-header">
          <h2>${t('provider.discover')}</h2>
          <button class="modal-close" id="closeDiscoverModal">&#10005;</button>
        </div>
        <div class="modal-body" style="flex-direction:column;gap:12px;padding:20px 24px">
          ${discoverLoading
            ? `<div style="text-align:center;padding:40px;color:var(--text-muted)"><div class="spinner" style="display:inline-block;width:24px;height:24px;margin-bottom:8px"></div><br>${t('provider.discovering')}</div>`
            : discoveredModels.length === 0
            ? `<div style="text-align:center;padding:40px;color:var(--text-muted)">${t('provider.noModelsFound')}</div>`
            : `<div style="margin-bottom:8px;color:var(--text-muted);font-size:var(--fs-secondary)">${discoveredModels.length} ${t('provider.modelsFound')}</div>
               <div style="max-height:400px;overflow-y:auto">
                 ${discoveredModels.map((m, i) => `
                   <label class="glass-check-row ${m.selected ? 'is-selected' : ''}">
                     <input class="glass-checkbox" type="checkbox" data-discover-idx="${i}" ${m.selected ? 'checked' : ''}>
                     <div style="flex:1">
                       <div style="font-family:var(--font-mono);font-size:var(--fs-code)">${escHtml(m.id)}</div>
                       ${m.owned_by ? `<div style="font-size:var(--fs-secondary);color:var(--text-faint)">by ${escHtml(m.owned_by)}</div>` : ''}
                     </div>
                   </label>
                 `).join('')}
               </div>`
          }
        </div>
        <div class="modal-footer">
          <div style="flex:1"></div>
          <button class="modal-footer-btn glass-button glass-button--secondary" id="cancelDiscover">${t('common.cancel')}</button>
          <button class="test-btn glass-button glass-button--primary" id="addDiscoveredBtn" ${discoverLoading || discoveredModels.filter(m => m.selected).length === 0 ? 'disabled' : ''}>${t('provider.addSelected')}</button>
        </div>
      </div>
    </div>
  `;
}

function renderEditModelModal(): string {
  const model = state.models.find(m => m.id === editingModelId);
  if (!model) return '';
  return `
    <div class="modal-backdrop glass-modal-backdrop" data-glass-portal data-glass-portal-owner="provider">
      <div class="modal-overlay glass-modal provider-modal liquid-glass liquid-glass--modal" role="dialog" aria-modal="true" aria-label="Edit Model" style="width:min(520px,calc(100vw - 48px))">
        <div class="modal-header">
          <h2>${t('provider.edit')} ${t('provider.models').replace(/s$/, '')}</h2>
          <button class="modal-close" id="closeEditModelModal">&#10005;</button>
        </div>
        <div class="modal-body" style="flex-direction:column;gap:14px;padding:20px 24px">
          <div class="glass-form-field">
            <label>${t('provider.apiIdentifier')}</label>
            <input class="glass-input" type="text" id="editModelName" value="${escHtml(model.model_name)}" style="width:100%">
          </div>
          <div class="glass-form-field">
            <label>${t('provider.displayName')}</label>
            <input class="glass-input" type="text" id="editModelDisplayName" value="${escHtml(model.display_name)}" style="width:100%">
          </div>
          <div class="glass-form-field">
            <label>${t('provider.contextWindow')}</label>
            <input class="glass-input" type="number" id="editModelContextWindow" value="${model.context_window}" style="width:100%">
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div class="glass-form-field">
              <label>${t('provider.uncachedInput')}</label>
              <input class="glass-input" type="number" step="0.01" id="editModelInputPrice" value="${(model.uncached_input_nanos_per_million / 1e9).toFixed(2)}" style="width:100%">
            </div>
            <div class="glass-form-field">
              <label>${t('provider.cachePrice')}</label>
              <input class="glass-input" type="number" step="0.01" id="editModelCachePrice" value="${(model.cache_read_nanos_per_million / 1e9).toFixed(2)}" style="width:100%">
            </div>
            <div class="glass-form-field">
              <label>${t('provider.outputPrice')}</label>
              <input class="glass-input" type="number" step="0.01" id="editModelOutputPrice" value="${(model.output_nanos_per_million / 1e9).toFixed(2)}" style="width:100%">
            </div>
            <div class="glass-form-field">
              <label>${t('provider.currency')}</label>
              <select class="glass-select" id="editModelCurrency" style="width:100%">${renderCurrencyOptions(model.currency)}</select>
            </div>
          </div>
          <div class="glass-form-field">
            <label>${t('provider.systemPrompt')} (${t('provider.optional')})</label>
            <textarea class="glass-textarea" id="editModelSystemPrompt" style="width:100%;min-height:60px">${model.system_prompt ?? ''}</textarea>
          </div>
          <div class="glass-form-field">
            <label>${t('provider.temperature')}: <span id="editTempValue">${model.temperature}</span></label>
            <input class="glass-range" type="range" id="editModelTemperature" min="0" max="2" step="0.1" value="${model.temperature}" style="width:100%;accent-color:var(--accent)">
          </div>
        </div>
        <div class="modal-footer">
          <button class="modal-footer-btn glass-button glass-button--danger" id="deleteModelBtn">${t('common.delete')}</button>
          <div style="flex:1"></div>
          <button class="modal-footer-btn glass-button glass-button--secondary" id="cancelEditModel">${t('common.cancel')}</button>
          <button class="test-btn glass-button glass-button--primary" id="saveEditModelBtn">${t('common.save')}</button>
        </div>
      </div>
    </div>
  `;
}

export function bindProviderEvents(): void {
  document.querySelectorAll<HTMLElement>('[data-provider-id]').forEach(el => {
    el.addEventListener('click', async () => {
      const id = el.dataset.providerId;
      if (id) {
        selectedProviderId = id;
        testResult = null;
        if (!isDev) await loadModels(id);
        else state.models = mockModels.filter(m => m.provider_id === id);
        refreshProviderView();
      }
    });
  });

  const addBtn = document.getElementById('addProviderBtn');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      showAddProviderModal = true;
      testResult = null;
      refreshProviderView();
    });
  }

  const closeAddModal = document.getElementById('closeAddProviderModal');
  if (closeAddModal) {
    closeAddModal.addEventListener('click', () => {
      showAddProviderModal = false;
      testResult = null;
      refreshProviderView();
    });
  }

  const cancelAdd = document.getElementById('cancelAddProvider');
  if (cancelAdd) {
    cancelAdd.addEventListener('click', () => {
      showAddProviderModal = false;
      testResult = null;
      refreshProviderView();
    });
  }

  const testConnBtn = document.getElementById('testConnBtn');
  if (testConnBtn) {
    testConnBtn.addEventListener('click', () => testConnection());
  }

  const modalTestBtn = document.getElementById('modalTestBtn');
  if (modalTestBtn) {
    modalTestBtn.addEventListener('click', () => testConnectionFromModal());
  }

  const saveProviderBtn = document.getElementById('saveProviderBtn');
  if (saveProviderBtn) {
    saveProviderBtn.addEventListener('click', () => saveProvider());
  }

  const deleteBtn = document.getElementById('deleteProviderBtn');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', () => deleteProvider());
  }

  const editBtn = document.getElementById('editProviderBtn');
  if (editBtn) {
    editBtn.addEventListener('click', () => {
      editingProviderId = selectedProviderId;
      testResult = null;
      refreshProviderView();
    });
  }

  const closeEditModal = document.getElementById('closeEditProviderModal');
  if (closeEditModal) {
    closeEditModal.addEventListener('click', () => {
      editingProviderId = null;
      testResult = null;
      refreshProviderView();
    });
  }

  const cancelEdit = document.getElementById('cancelEditProvider');
  if (cancelEdit) {
    cancelEdit.addEventListener('click', () => {
      editingProviderId = null;
      testResult = null;
      refreshProviderView();
    });
  }

  const editTestBtn = document.getElementById('editTestBtn');
  if (editTestBtn) {
    editTestBtn.addEventListener('click', () => testConnectionFromEditModal());
  }

  const saveEditBtn = document.getElementById('saveEditProviderBtn');
  if (saveEditBtn) {
    saveEditBtn.addEventListener('click', () => saveEditProvider());
  }

  const addModelBtn = document.getElementById('addModelBtn');
  if (addModelBtn) {
    addModelBtn.addEventListener('click', () => {
      showAddModelModal = true;
      refreshProviderView();
    });
  }

  const discoverBtn = document.getElementById('discoverModelsBtn');
  if (discoverBtn) {
    discoverBtn.addEventListener('click', () => startDiscoverModels());
  }

  const closeDiscoverModal = document.getElementById('closeDiscoverModal');
  if (closeDiscoverModal) {
    closeDiscoverModal.addEventListener('click', () => {
      showDiscoverModal = false;
      discoveredModels = [];
      refreshProviderView();
    });
  }

  const cancelDiscover = document.getElementById('cancelDiscover');
  if (cancelDiscover) {
    cancelDiscover.addEventListener('click', () => {
      showDiscoverModal = false;
      discoveredModels = [];
      refreshProviderView();
    });
  }

  const addDiscoveredBtn = document.getElementById('addDiscoveredBtn');
  if (addDiscoveredBtn) {
    addDiscoveredBtn.addEventListener('click', () => addDiscoveredModels());
  }

  document.querySelectorAll<HTMLInputElement>('[data-discover-idx]').forEach(el => {
    el.addEventListener('change', () => {
      const idx = parseInt(el.dataset.discoverIdx ?? '0', 10);
      if (discoveredModels[idx]) {
        discoveredModels[idx].selected = el.checked;
        refreshProviderView();
      }
    });
  });

  document.querySelectorAll<HTMLElement>('[data-edit-model]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = el.dataset.editModel;
      if (id) {
        editingModelId = id;
        refreshProviderView();
      }
    });
  });

  const closeEditModelModal = document.getElementById('closeEditModelModal');
  if (closeEditModelModal) {
    closeEditModelModal.addEventListener('click', () => {
      editingModelId = null;
      refreshProviderView();
    });
  }

  const cancelEditModel = document.getElementById('cancelEditModel');
  if (cancelEditModel) {
    cancelEditModel.addEventListener('click', () => {
      editingModelId = null;
      refreshProviderView();
    });
  }

  const saveEditModelBtn = document.getElementById('saveEditModelBtn');
  if (saveEditModelBtn) {
    saveEditModelBtn.addEventListener('click', () => saveEditModel());
  }

  const deleteModelBtn = document.getElementById('deleteModelBtn');
  if (deleteModelBtn) {
    deleteModelBtn.addEventListener('click', () => deleteEditingModel());
  }

  const editTempSlider = document.getElementById('editModelTemperature') as HTMLInputElement | null;
  if (editTempSlider) {
    editTempSlider.addEventListener('input', () => {
      const label = document.getElementById('editTempValue');
      if (label) label.textContent = editTempSlider.value;
    });
  }

  const closeModelModal = document.getElementById('closeAddModelModal');
  if (closeModelModal) {
    closeModelModal.addEventListener('click', () => {
      showAddModelModal = false;
      refreshProviderView();
    });
  }

  const cancelModel = document.getElementById('cancelAddModel');
  if (cancelModel) {
    cancelModel.addEventListener('click', () => {
      showAddModelModal = false;
      refreshProviderView();
    });
  }

  const saveModelBtn = document.getElementById('saveModelBtn');
  if (saveModelBtn) {
    saveModelBtn.addEventListener('click', () => saveModel());
  }

  const tempSlider = document.getElementById('modelTemperature') as HTMLInputElement | null;
  if (tempSlider) {
    tempSlider.addEventListener('input', () => {
      const label = document.getElementById('tempValue');
      if (label) label.textContent = tempSlider.value;
    });
  }

  document.querySelectorAll<HTMLElement>('.glass-modal-backdrop').forEach(backdrop => {
    backdrop.addEventListener('pointerdown', event => {
      if (event.target === backdrop) closeTopProviderModal();
    });
  });

  document.removeEventListener('keydown', handleModalEscape);
  document.addEventListener('keydown', handleModalEscape);
}

function handleModalEscape(e: KeyboardEvent): void {
  if (e.key === 'Escape') closeTopProviderModal();
}

function closeTopProviderModal(): void {
  if (editingModelId) {
    editingModelId = null;
  } else if (showDiscoverModal) {
    showDiscoverModal = false;
    discoveredModels = [];
  } else if (showAddModelModal) {
    showAddModelModal = false;
  } else if (editingProviderId) {
    editingProviderId = null;
    testResult = null;
  } else if (showAddProviderModal) {
    showAddProviderModal = false;
    testResult = null;
  } else {
    return;
  }
  refreshProviderView();
}

async function testConnection(): Promise<void> {
  if (!selectedProviderId) return;
  const provider = state.providers.find(p => p.id === selectedProviderId);
  if (!provider) return;

  testLoading = true;
  testResult = null;
  refreshProviderView();

  if (isDev) {
    await new Promise(r => setTimeout(r, 800));
    testResult = { success: true, latency_ms: 245 };
  } else {
    try {
      const apiKey = await getProviderApiKey(selectedProviderId);
      testResult = await testProviderConnection({
        baseUrl: provider.base_url,
        apiKey: apiKey ?? '',
      });
    } catch (e) {
      testResult = { success: false, latency_ms: 0, error: String(e) };
    }
  }

  testLoading = false;
  refreshProviderView();
}

async function testConnectionFromModal(): Promise<void> {
  const baseUrlInput = document.getElementById('providerBaseUrl') as HTMLInputElement | null;
  const apiKeyInput = document.getElementById('providerApiKey') as HTMLInputElement | null;
  const connection = providerConnectionInputFromForm({
    baseUrl: baseUrlInput?.value ?? '',
    apiKey: apiKeyInput?.value ?? '',
  });

  if (!connection) return;

  testLoading = true;
  testResult = null;
  refreshProviderView();

  if (isDev) {
    await new Promise(r => setTimeout(r, 800));
    testResult = { success: true, latency_ms: 180 };
  } else {
    try {
      testResult = await testProviderConnection({
        baseUrl: connection.baseUrl,
        apiKey: connection.apiKey,
      });
    } catch (e) {
      testResult = { success: false, latency_ms: 0, error: String(e) };
    }
  }

  testLoading = false;
  refreshProviderView();
}

async function saveProvider(): Promise<void> {
  const nameInput = document.getElementById('providerName') as HTMLInputElement | null;
  const baseUrlInput = document.getElementById('providerBaseUrl') as HTMLInputElement | null;
  const apiKeyInput = document.getElementById('providerApiKey') as HTMLInputElement | null;
  const headersInput = document.getElementById('providerHeaders') as HTMLTextAreaElement | null;

  const draft = providerDraftFromForm({
    name: nameInput?.value ?? '',
    baseUrl: baseUrlInput?.value ?? '',
    apiKey: apiKeyInput?.value ?? '',
    extraHeadersJson: headersInput?.value ?? '',
  });

  if (!draft) return;

  if (isDev) {
    const newProvider: Provider = {
      id: crypto.randomUUID(),
      name: draft.name,
      base_url: draft.baseUrl,
      extra_headers_json: draft.extraHeadersJson,
      created_at: Math.floor(Date.now() / 1000),
      updated_at: Math.floor(Date.now() / 1000),
    };
    state.providers.push(newProvider);
  } else {
    try {
      const provider = await createProviderInCatalog(draft);
      state.providers.push(provider);
    } catch (e) {
      console.error('Failed to create provider:', e);
      return;
    }
  }

  showAddProviderModal = false;
  testResult = null;
  refreshProviderView();
}

async function deleteProvider(): Promise<void> {
  if (!selectedProviderId) return;
  if (!await showGlassConfirm(t('provider.confirmDelete'), t('provider.deleteProvider'), true)) return;

  if (isDev) {
    state.providers = state.providers.filter(p => p.id !== selectedProviderId);
    selectedProviderId = null;
  } else {
    try {
      await deleteProviderFromCatalog(selectedProviderId);
      state.providers = state.providers.filter(p => p.id !== selectedProviderId);
      selectedProviderId = null;
    } catch (e) {
      console.error('Failed to delete provider:', e);
      return;
    }
  }

  testResult = null;
  refreshProviderView();
}

async function testConnectionFromEditModal(): Promise<void> {
  const baseUrlInput = document.getElementById('editProviderBaseUrl') as HTMLInputElement | null;
  const apiKeyInput = document.getElementById('editProviderApiKey') as HTMLInputElement | null;
  const connection = providerConnectionInputFromForm({
    baseUrl: baseUrlInput?.value ?? '',
    apiKey: apiKeyInput?.value ?? '',
  });

  if (!connection) return;

  if (!connection.apiKey && editingProviderId) {
    try {
      const stored = await getProviderApiKey(editingProviderId);
      connection.apiKey = stored ?? '';
    } catch {}
  }

  testLoading = true;
  testResult = null;
  refreshProviderView();

  if (isDev) {
    await new Promise(r => setTimeout(r, 800));
    testResult = { success: true, latency_ms: 180 };
  } else {
    try {
      testResult = await testProviderConnection({
        baseUrl: connection.baseUrl,
        apiKey: connection.apiKey,
      });
    } catch (e) {
      testResult = { success: false, latency_ms: 0, error: String(e) };
    }
  }

  testLoading = false;
  refreshProviderView();
}

async function saveEditProvider(): Promise<void> {
  if (!editingProviderId) return;

  const nameInput = document.getElementById('editProviderName') as HTMLInputElement | null;
  const baseUrlInput = document.getElementById('editProviderBaseUrl') as HTMLInputElement | null;
  const apiKeyInput = document.getElementById('editProviderApiKey') as HTMLInputElement | null;
  const headersInput = document.getElementById('editProviderHeaders') as HTMLTextAreaElement | null;

  const draft = providerDraftFromForm({
    name: nameInput?.value ?? '',
    baseUrl: baseUrlInput?.value ?? '',
    apiKey: apiKeyInput?.value ?? '',
    extraHeadersJson: headersInput?.value ?? '',
  });

  if (!draft) return;

  if (!draft.apiKey && editingProviderId) {
    try {
      const stored = await getProviderApiKey(editingProviderId);
      draft.apiKey = stored ?? '';
    } catch {}
  }

  if (isDev) {
    const idx = state.providers.findIndex(p => p.id === editingProviderId);
    if (idx >= 0) {
      state.providers[idx] = {
        ...state.providers[idx],
        name: draft.name,
        base_url: draft.baseUrl,
        extra_headers_json: draft.extraHeadersJson,
        updated_at: Math.floor(Date.now() / 1000),
      };
    }
  } else {
    try {
      const provider = await updateProviderInCatalog(editingProviderId, draft);
      const idx = state.providers.findIndex(p => p.id === editingProviderId);
      if (idx >= 0) {
        state.providers[idx] = provider;
      }
    } catch (e) {
      console.error('Failed to update provider:', e);
      return;
    }
  }

  editingProviderId = null;
  testResult = null;
  refreshProviderView();
}

async function startDiscoverModels(): Promise<void> {
  if (!selectedProviderId) return;
  const provider = state.providers.find(p => p.id === selectedProviderId);
  if (!provider) return;

  showDiscoverModal = true;
  discoverLoading = true;
  discoveredModels = [];
  refreshProviderView();

  if (isDev) {
    await new Promise(r => setTimeout(r, 1000));
    discoveredModels = [
      { id: 'gpt-4o', owned_by: 'openai', selected: true },
      { id: 'gpt-4o-mini', owned_by: 'openai', selected: true },
      { id: 'gpt-4-turbo', owned_by: 'openai', selected: false },
      { id: 'gpt-3.5-turbo', owned_by: 'openai', selected: false },
      { id: 'dall-e-3', owned_by: 'openai', selected: false },
    ];
  } else {
    try {
      const apiKey = await getProviderApiKey(selectedProviderId);
      const models = await discoverProviderModels({
        baseUrl: provider.base_url,
        apiKey: apiKey ?? '',
      });
      const existingModelNames = new Set(getProviderModels(provider.id).map(m => m.model_name));
      discoveredModels = models.map(m => ({
        id: m.id,
        owned_by: m.owned_by,
        selected: !existingModelNames.has(m.id),
      }));
    } catch (e) {
      console.error('Failed to discover models:', e);
      discoveredModels = [];
    }
  }

  discoverLoading = false;
  refreshProviderView();
}

async function addDiscoveredModels(): Promise<void> {
  if (!selectedProviderId) return;
  const selected = discoveredModels.filter(m => m.selected);
  if (selected.length === 0) return;

  for (const m of selected) {
    const draft = discoveredModelDraft(selectedProviderId, m.id, getDisplayCurrency());
    if (isDev) {
      mockModels.push(modelFromDraft(crypto.randomUUID(), draft));
    } else {
      try {
        await createModelInCatalog(draft);
      } catch (e) {
        console.error(`Failed to add model ${m.id}:`, e);
      }
    }
  }

  if (isDev) {
    state.models = mockModels.filter(m => m.provider_id === selectedProviderId);
  } else {
    await loadModels(selectedProviderId);
  }

  showDiscoverModal = false;
  discoveredModels = [];
  refreshProviderView();
}

async function saveEditModel(): Promise<void> {
  if (!editingModelId) return;
  const model = state.models.find(m => m.id === editingModelId);
  if (!model) return;

  const nameInput = document.getElementById('editModelName') as HTMLInputElement | null;
  const displayNameInput = document.getElementById('editModelDisplayName') as HTMLInputElement | null;
  const ctxInput = document.getElementById('editModelContextWindow') as HTMLInputElement | null;
  const inputPriceInput = document.getElementById('editModelInputPrice') as HTMLInputElement | null;
  const cachePriceInput = document.getElementById('editModelCachePrice') as HTMLInputElement | null;
  const outputPriceInput = document.getElementById('editModelOutputPrice') as HTMLInputElement | null;
  const currencyInput = document.getElementById('editModelCurrency') as HTMLSelectElement | null;
  const systemPromptInput = document.getElementById('editModelSystemPrompt') as HTMLTextAreaElement | null;
  const tempInput = document.getElementById('editModelTemperature') as HTMLInputElement | null;

  const draft = modelDraftFromForm({
    providerId: model.provider_id,
    modelName: nameInput?.value ?? '',
    displayName: displayNameInput?.value ?? '',
    contextWindow: ctxInput?.value ?? '',
    inputPrice: inputPriceInput?.value ?? '',
    cachePrice: cachePriceInput?.value ?? '',
    outputPrice: outputPriceInput?.value ?? '',
    currency: currencyInput?.value || getDisplayCurrency(),
    systemPrompt: systemPromptInput?.value ?? '',
    temperature: tempInput?.value ?? '',
  });
  if (!draft) return;
  const patch = modelStatePatchFromDraft(draft);

  if (isDev) {
    const idx = state.models.findIndex(m => m.id === editingModelId);
    if (idx >= 0) {
      state.models[idx] = { ...state.models[idx], ...patch };
    }
  } else {
    try {
      await updateModelInCatalog(editingModelId, draft);
      const idx = state.models.findIndex(m => m.id === editingModelId);
      if (idx >= 0) {
        state.models[idx] = { ...state.models[idx], ...patch };
      }
    } catch (e) {
      console.error('Failed to update model:', e);
      return;
    }
  }

  editingModelId = null;
  refreshProviderView();
}

async function deleteEditingModel(): Promise<void> {
  if (!editingModelId) return;
  if (!await showGlassConfirm(t('provider.confirmDeleteModel'), t('common.delete'), true)) return;

  if (isDev) {
    state.models = state.models.filter(m => m.id !== editingModelId);
  } else {
    try {
      await deleteModelFromCatalog(editingModelId);
      state.models = state.models.filter(m => m.id !== editingModelId);
    } catch (e) {
      console.error('Failed to delete model:', e);
      return;
    }
  }

  editingModelId = null;
  refreshProviderView();
}

async function saveModel(): Promise<void> {
  if (!selectedProviderId) return;

  const nameInput = document.getElementById('modelName') as HTMLInputElement | null;
  const displayNameInput = document.getElementById('modelDisplayName') as HTMLInputElement | null;
  const ctxInput = document.getElementById('modelContextWindow') as HTMLInputElement | null;
  const inputPriceInput = document.getElementById('modelInputPrice') as HTMLInputElement | null;
  const cachePriceInput = document.getElementById('modelCachePrice') as HTMLInputElement | null;
  const outputPriceInput = document.getElementById('modelOutputPrice') as HTMLInputElement | null;
  const currencyInput = document.getElementById('modelCurrency') as HTMLSelectElement | null;
  const systemPromptInput = document.getElementById('modelSystemPrompt') as HTMLTextAreaElement | null;
  const tempInput = document.getElementById('modelTemperature') as HTMLInputElement | null;

  const draft = modelDraftFromForm({
    providerId: selectedProviderId,
    modelName: nameInput?.value ?? '',
    displayName: displayNameInput?.value ?? '',
    contextWindow: ctxInput?.value ?? '',
    inputPrice: inputPriceInput?.value ?? '',
    cachePrice: cachePriceInput?.value ?? '',
    outputPrice: outputPriceInput?.value ?? '',
    currency: currencyInput?.value || getDisplayCurrency(),
    systemPrompt: systemPromptInput?.value ?? '',
    temperature: tempInput?.value ?? '',
  });
  if (!draft) return;

  if (isDev) {
    mockModels.push(modelFromDraft(crypto.randomUUID(), draft));
    state.models = mockModels.filter(m => m.provider_id === selectedProviderId);
  } else {
    try {
      const model = await createModelInCatalog(draft);
      state.models.push(model);
    } catch (e) {
      console.error('Failed to create model:', e);
      return;
    }
  }

  showAddModelModal = false;
  refreshProviderView();
}

function refreshProviderView(): void {
  const pageBody = document.querySelector('.page-body');
  if (!pageBody) return;

  const existing = pageBody.querySelector('.provider-page');
  if (!existing) return;

  clearDeclaredGlassPortals('provider');
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = renderProviderPage();
  const newContent = tempDiv.firstElementChild;
  if (newContent) {
    existing.replaceWith(newContent);
    mountDeclaredGlassPortals(newContent, 'provider');
    bindProviderEvents();
  }
}
