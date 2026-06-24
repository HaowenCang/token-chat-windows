import { state } from './state';
import { t, getLang, setLang } from './i18n';
import { getBuiltinPromptSnapshot } from './prompt';
import { applyThemePreferences, getCustomAccentColor, resetCustomAccentColor, setCustomAccentColor } from './theme';
import {
  getTooltipDelay,
  getTooltipGlassLevel,
  getTooltipStyle,
  setTooltipDelay,
  setTooltipGlassLevel,
  setTooltipStyle,
  tooltipAttrs,
  tooltipGlassLevels,
  tooltipStyles,
} from './tooltip';
import { bindFontSizeSettings, renderFontSizeSettings } from './font-size-settings';
import {
  currencyOptions,
  type CurrencyCode,
  getDisplayCurrency,
  getExchangeRate,
  setDisplayCurrency,
  setExchangeRate,
} from './currency';
import {
  getSearchConfigSnapshot,
  saveSearchConfig,
  testSearchConnection,
  type SearchProviderConfig,
} from './web-search';

let clearSearchApiKeyRequested = false;

export function renderSettingsPage(): string {
  const sendKey = localStorage.getItem('tc-send-key') || 'enter';
  const currentTheme = localStorage.getItem('tc-theme') || 'midnight';
  const storedGlobalPrompt = localStorage.getItem('tc-global-prompt');
  const globalPrompt = storedGlobalPrompt !== null ? storedGlobalPrompt : getBuiltinPromptSnapshot();
  const customAccent = getCustomAccentColor();
  const tooltipStyle = getTooltipStyle();
  const tooltipGlassLevel = getTooltipGlassLevel();
  const tooltipDelay = getTooltipDelay();
  const displayCurrency = getDisplayCurrency();

  return `
    <div class="page-screen settings-page">
      <div class="settings-scroll">
        <div class="settings-content">
          <div class="page-header">
            <h2>${t('settings.title')}</h2>
          </div>
        <div class="settings-section glass-card">
          <h3 class="settings-section-title">${t('settings.language')}</h3>
          <div class="settings-row">
            <label>${t('settings.language')}</label>
            <select class="chat-search glass-select" id="settingsLang" style="width:200px">
              <option value="zh" ${getLang() === 'zh' ? 'selected' : ''}>中文</option>
              <option value="en" ${getLang() === 'en' ? 'selected' : ''}>English</option>
            </select>
          </div>
        </div>

        <div class="settings-section glass-card">
          <h3 class="settings-section-title">${t('settings.theme')}</h3>
          <div class="settings-row">
            <label>${t('settings.theme')}</label>
            <select class="chat-search glass-select" id="settingsTheme" style="width:200px">
              <option value="midnight" ${currentTheme === 'midnight' ? 'selected' : ''}>${t('theme.midnight')}</option>
              <option value="ocean" ${currentTheme === 'ocean' ? 'selected' : ''}>${t('theme.ocean')}</option>
              <option value="forest" ${currentTheme === 'forest' ? 'selected' : ''}>${t('theme.forest')}</option>
              <option value="sunset" ${currentTheme === 'sunset' ? 'selected' : ''}>${t('theme.sunset')}</option>
              <option value="rose" ${currentTheme === 'rose' ? 'selected' : ''}>${t('theme.rose')}</option>
              <option value="light" ${currentTheme === 'light' ? 'selected' : ''}>${t('theme.light')}</option>
            </select>
          </div>
          <div class="settings-row">
            <label>${t('settings.accentColor')}</label>
            <div class="theme-color-control">
              <input type="color" id="settingsAccentColor" value="${escHtml(customAccent)}">
              <input class="chat-search glass-input" id="settingsAccentText" value="${escHtml(customAccent)}" style="width:120px">
              <button class="tool-btn glass-button glass-button--secondary" id="resetAccentColor">${t('settings.reset')}</button>
            </div>
          </div>
        </div>

        <div class="settings-section glass-card">
          <h3 class="settings-section-title">${t('settings.costCurrency')}</h3>
          <div class="settings-row">
            <label>${t('settings.displayCurrency')}</label>
            <select class="chat-search glass-select" id="settingsDisplayCurrency" style="width:240px">
              ${currencyOptions.map(option => `<option value="${option.value}" ${displayCurrency === option.value ? 'selected' : ''}>${escHtml(t(option.labelKey))} (${option.value})</option>`).join('')}
            </select>
          </div>
          <div class="settings-row settings-rate-setting">
            <label>${t('settings.exchangeRates')}</label>
            <div class="settings-rate-list" id="settingsExchangeRates">
              ${renderExchangeRateFields(displayCurrency)}
            </div>
          </div>
          <div class="settings-hint">${t('settings.exchangeRateHint')}</div>
        </div>

        <div class="settings-section glass-card settings-tooltip-section">
          <h3 class="settings-section-title">${t('settings.dataDetailBubbles')}</h3>
          <div class="settings-tooltip-form" role="group" aria-label="${t('settings.dataDetailBubbles')}">
            <div class="settings-row settings-form-row">
              <label for="settingsTooltipStyle">${t('settings.bubbleStyle')}</label>
              <div class="settings-form-control">
                <select class="chat-search glass-select" id="settingsTooltipStyle" style="width:100%">
                  ${tooltipStyles.map(style => `<option value="${style.value}" ${tooltipStyle === style.value ? 'selected' : ''}>${escHtml(t(style.labelKey))}</option>`).join('')}
                </select>
              </div>
              <div class="settings-form-action">
                <button class="tool-btn glass-button glass-button--secondary tooltip-preview-trigger" ${tooltipAttrs(t('settings.tooltipPreview'), [
                  { label: t('settings.tooltipTotal'), value: '42,000 tokens', color: 'var(--chart-line)' },
                  { label: t('settings.tooltipInput'), value: '28,000 tokens', color: 'var(--chart-input)' },
                  { label: t('settings.tooltipOutput'), value: '14,000 tokens', color: 'var(--chart-output)' },
                ], { trigger: 'click' })}>${t('settings.tooltipPreview')}</button>
              </div>
            </div>
            <div class="settings-row settings-form-row ${tooltipStyle === 'glass' ? '' : 'hidden'}" id="settingsTooltipGlassRow">
              <label for="settingsTooltipGlassLevel">${t('settings.tooltipGlassLevel')}</label>
              <div class="settings-form-control">
                <select class="chat-search glass-select" id="settingsTooltipGlassLevel" style="width:100%">
                  ${tooltipGlassLevels.map(level => `<option value="${level.value}" ${tooltipGlassLevel === level.value ? 'selected' : ''}>${escHtml(t(level.labelKey))}</option>`).join('')}
                </select>
              </div>
              <div class="settings-form-action" aria-hidden="true"></div>
            </div>
            <div class="settings-row settings-form-row settings-form-row--with-help">
              <label for="settingsTooltipDelay">${t('settings.popupDelay')}</label>
              <div class="settings-form-control">
                <div class="glass-input-suffix">
                  <input class="chat-search glass-input" id="settingsTooltipDelay" type="number" min="0" max="2000" step="25" value="${tooltipDelay}">
                  <span class="glass-input-suffix__label">ms</span>
                </div>
                <p class="settings-form-help">${t('settings.tooltipDelayHint')}</p>
              </div>
              <div class="settings-form-action" aria-hidden="true"></div>
            </div>
          </div>
        </div>

        ${renderWebSearchSettings()}

        ${renderFontSizeSettings()}

        <div class="settings-section glass-card">
          <h3 class="settings-section-title">${t('settings.sendKey')}</h3>
          <div class="settings-row">
            <label>${t('settings.sendKey')}</label>
            <select class="chat-search glass-select" id="settingsSendKey" style="width:280px">
              <option value="enter" ${sendKey === 'enter' ? 'selected' : ''}>${t('settings.enterToSend')}</option>
              <option value="shift-enter" ${sendKey === 'shift-enter' ? 'selected' : ''}>${t('settings.shiftEnterToSend')}</option>
            </select>
          </div>
          <div class="settings-hint">${t('settings.sendKeyHint')}</div>
        </div>

        <div class="settings-section glass-card">
          <h3 class="settings-section-title">${t('settings.globalPrompt')}</h3>
          <div class="settings-row settings-row--stacked">
            <label>${t('settings.globalPromptDesc')}</label>
            <textarea class="chat-search glass-textarea" id="settingsGlobalPrompt" style="width:100%;min-height:120px;resize:vertical;font-family:var(--font-mono);font-size:var(--fs-code)">${escHtml(globalPrompt)}</textarea>
            <div class="settings-hint">${t('settings.searchHint')}</div>
          </div>
        </div>

        <div class="settings-section glass-card">
          <h3 class="settings-section-title">${t('settings.customPrompts')}</h3>
          <div class="settings-row settings-row--stacked">
            <div style="display:flex;gap:8px;margin-bottom:12px">
              <button class="test-btn glass-button glass-button--primary" id="addPromptBtn">+ ${t('settings.addPrompt')}</button>
            </div>
            <div id="promptList">
              ${renderPromptList()}
            </div>
          </div>
        </div>
        </div>
      </div>
    </div>
  `;
}

function renderPromptList(): string {
  const prompts = JSON.parse(localStorage.getItem('tc-custom-prompts') || '[]');
  if (prompts.length === 0) {
    return `<div style="color:var(--text-faint);font-size:var(--fs-secondary)">${t('settings.noPrompts')}</div>`;
  }
  return prompts.map((p: { name: string; prompt: string; scope: string }, i: number) => `
    <div class="prompt-item glass-card glass-list-item" style="display:flex;align-items:center;gap:12px;padding:10px 12px;margin-bottom:6px">
      <div style="flex:1">
        <div style="font-weight:500">${escHtml(p.name)}</div>
        <div style="font-size:var(--fs-secondary);color:var(--text-faint)">${p.scope}: ${escHtml(p.prompt.slice(0, 60))}${p.prompt.length > 60 ? '...' : ''}</div>
      </div>
      <button class="tool-btn glass-button glass-button--secondary" data-edit-prompt="${i}" style="font-size:var(--fs-secondary)">${t('common.edit')}</button>
      <button class="tool-btn glass-button glass-button--danger" data-delete-prompt="${i}" style="font-size:var(--fs-secondary)">${t('common.delete')}</button>
    </div>
  `).join('');
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderSwitch(id: string, checked: boolean, label: string): string {
  return `
    <button class="glass-switch ${checked ? 'is-on' : ''}" id="${id}" type="button" role="switch" aria-checked="${checked}" aria-label="${escHtml(label)}">
      <span class="glass-switch-track"><span class="glass-switch-thumb"></span></span>
      <span class="glass-switch-label">${escHtml(checked ? t('common.enabled') : t('common.disabled'))}</span>
    </button>`;
}

function renderWebSearchSettings(): string {
  const { config, hasApiKey } = getSearchConfigSnapshot();
  return `
    <div class="settings-section glass-card web-search-settings">
      <div class="settings-section-heading">
        <div>
          <h3 class="settings-section-title">${t('settings.webSearch')}</h3>
          <p class="settings-section-copy">通过可配置的 HTTP JSON Search Provider 检索资料，并在桌面端后端代理请求。</p>
        </div>
        <span class="glass-chip">${t('settings.webSearch')}</span>
      </div>
      <div class="settings-row">
        <label>启用网络搜索</label>
        ${renderSwitch('searchFeatureEnabled', config.enabled, '启用网络搜索')}
      </div>
      <div class="settings-row">
        <label for="searchProviderId">默认 Provider</label>
        <select class="chat-search glass-select" id="searchProviderId" style="width:260px">
          <option value="http-json" ${config.providerId === 'http-json' ? 'selected' : ''}>HTTP JSON Search</option>
        </select>
      </div>
      <div class="settings-row">
        <label for="searchBaseUrl">${t('settings.searchBaseUrl')}</label>
        <input class="chat-search glass-input web-search-wide-input" id="searchBaseUrl" type="url" spellcheck="false" placeholder="https://search.example.com/api/search" value="${escHtml(config.baseUrl)}">
      </div>
      <div class="settings-row">
        <label>${t('settings.searchApiKey')}</label>
        <div class="secret-input-row">
          <input class="chat-search glass-input" id="searchApiKey" type="password" autocomplete="new-password" spellcheck="false" placeholder="${hasApiKey ? t('provider.leaveEmpty') : t('provider.optional')}">
          <button class="tool-btn glass-button glass-button--secondary" id="toggleSearchApiKey" type="button" aria-label="${t('settings.showKey')}">${t('settings.showKey')}</button>
          ${hasApiKey ? `<button class="tool-btn glass-button glass-button--danger" id="clearSearchApiKey" type="button">${t('settings.clearKey')}</button>` : ''}
        </div>
      </div>
      <div class="settings-row">
        <label for="searchMaxResults">默认结果数量</label>
        <select class="chat-search glass-select" id="searchMaxResults" style="width:180px">
          ${[3, 5, 8, 10].map(count => `<option value="${count}" ${config.defaultMaxResults === count ? 'selected' : ''}>${count} 条</option>`).join('')}
        </select>
      </div>
      <div class="settings-row">
        <label for="searchLanguage">默认语言</label>
        <select class="chat-search glass-select" id="searchLanguage" style="width:220px">
          <option value="auto" ${config.defaultLanguage === 'auto' ? 'selected' : ''}>跟随应用语言</option>
          <option value="zh" ${config.defaultLanguage === 'zh' ? 'selected' : ''}>中文</option>
          <option value="en" ${config.defaultLanguage === 'en' ? 'selected' : ''}>English</option>
        </select>
      </div>
      <div class="settings-row">
        <label for="searchRegion">默认地区</label>
        <input class="chat-search glass-input" id="searchRegion" type="text" placeholder="例如 CN、US；可留空" value="${escHtml(config.defaultRegion)}">
      </div>
      <div class="settings-row">
        <label>${t('settings.safeSearch')}</label>
        ${renderSwitch('searchSafeSearch', config.safeSearch, t('settings.safeSearch'))}
      </div>
      <div class="settings-row">
        <label for="searchTimeout">搜索超时</label>
        <div class="glass-input-suffix web-search-timeout">
          <input class="chat-search glass-input" id="searchTimeout" type="number" min="1000" max="120000" step="500" value="${config.timeoutMs}">
          <span class="glass-input-suffix__label">ms</span>
        </div>
      </div>
      <details class="web-search-advanced">
        <summary>高级 HTTP 适配器设置</summary>
        <p class="settings-form-help">可配置鉴权、查询参数与响应 JSON 字段映射，便于接入 Bing、Brave、Tavily、SerpAPI、SearXNG 或自建服务。</p>
        <div class="web-search-advanced-grid">
          ${renderSearchTextField('searchApiKeyHeader', t('settings.apiKeyHeader'), config.apiKeyHeader, 'Authorization')}
          ${renderSearchTextField('searchApiKeyPrefix', t('settings.apiKeyPrefix'), config.apiKeyPrefix, 'Bearer ')}
          ${renderSearchTextField('searchApiKeyQueryParam', t('settings.apiKeyQueryParam'), config.apiKeyQueryParam, '')}
          ${renderSearchTextField('searchQueryParam', t('settings.queryParam'), config.queryParam, 'q')}
          ${renderSearchTextField('searchCountParam', t('settings.countParam'), config.resultCountParam, 'count')}
          ${renderSearchTextField('searchLanguageParam', t('settings.languageParam'), config.languageParam, 'language')}
          ${renderSearchTextField('searchRegionParam', t('settings.regionParam'), config.regionParam, 'region')}
          ${renderSearchTextField('searchSafeParam', t('settings.safeParam'), config.safeSearchParam, 'safeSearch')}
          ${renderSearchTextField('searchFreshnessParam', t('settings.freshnessParam'), config.freshnessParam, 'freshness')}
          ${renderSearchTextField('searchResultsPath', t('settings.resultsPath'), config.resultsPath, 'results / web.results')}
          ${renderSearchTextField('searchTitleField', t('settings.titleField'), config.titleField, 'title')}
          ${renderSearchTextField('searchUrlField', t('settings.urlField'), config.urlField, 'url')}
          ${renderSearchTextField('searchSnippetField', t('settings.snippetField'), config.snippetField, 'snippet')}
          ${renderSearchTextField('searchSourceField', t('settings.sourceField'), config.sourceField, 'source')}
          ${renderSearchTextField('searchPublishedField', t('settings.publishedField'), config.publishedAtField, 'publishedAt')}
        </div>
        <div class="glass-form-field web-search-headers-field">
          <label for="searchExtraHeaders">额外请求头（JSON，不要在此填写 API Key）</label>
          <textarea class="chat-search glass-textarea" id="searchExtraHeaders" rows="3" spellcheck="false">${escHtml(config.extraHeadersJson)}</textarea>
        </div>
      </details>
      <div class="web-search-actions">
        <button class="test-btn glass-button glass-button--primary" id="saveSearchSettings" type="button">${t('settings.saveSearch')}</button>
        <button class="tool-btn glass-button glass-button--secondary" id="testSearchConnection" type="button">${t('settings.testSearch')}</button>
        <span class="settings-form-help">测试会使用 “OpenAI” 作为示例查询，不显示或记录完整 API Key。</span>
      </div>
      <div class="test-result liquid-glass liquid-glass--notice" id="searchTestResult" aria-live="polite"></div>
    </div>`;
}

function renderSearchTextField(id: string, label: string, value: string, placeholder: string): string {
  return `
    <div class="glass-form-field">
      <label for="${id}">${escHtml(label)}</label>
      <input class="chat-search glass-input" id="${id}" type="text" spellcheck="false" placeholder="${escHtml(placeholder)}" value="${escHtml(value)}">
    </div>`;
}

function renderExchangeRateFields(baseCurrency: CurrencyCode): string {
  return currencyOptions
    .filter(option => option.value !== baseCurrency)
    .map(option => `
      <label class="settings-rate-row">
        <span class="settings-rate-source">1 ${option.value} <span class="settings-rate-equals">=</span></span>
        <input
          class="chat-search glass-input settings-rate-input"
          type="number"
          min="0.000001"
          step="0.0001"
          value="${getExchangeRate(option.value, baseCurrency)}"
          data-exchange-source="${option.value}"
        >
        <span class="settings-rate-base">${baseCurrency}</span>
      </label>
    `).join('');
}

function bindExchangeRateInputs(): void {
  document.querySelectorAll<HTMLInputElement>('[data-exchange-source]').forEach(input => {
    const applyRate = () => {
      input.value = String(setExchangeRate(input.dataset.exchangeSource ?? '', input.value));
    };
    input.addEventListener('change', applyRate);
    input.addEventListener('blur', applyRate);
  });
}

function getInputValue(id: string): string {
  return (document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null)?.value.trim() ?? '';
}

function getSwitchValue(id: string): boolean {
  return document.getElementById(id)?.getAttribute('aria-checked') === 'true';
}

function bindGlassSwitch(id: string): void {
  const button = document.getElementById(id) as HTMLButtonElement | null;
  if (!button) return;
  button.addEventListener('click', () => {
    const checked = button.getAttribute('aria-checked') !== 'true';
    button.setAttribute('aria-checked', String(checked));
    button.classList.toggle('is-on', checked);
    const label = button.querySelector<HTMLElement>('.glass-switch-label');
    if (label) label.textContent = checked ? '已开启' : '已关闭';
  });
}

function readSearchConfigForm(): SearchProviderConfig {
  const previous = getSearchConfigSnapshot().config;
  return {
    enabled: getSwitchValue('searchFeatureEnabled'),
    providerId: getInputValue('searchProviderId') || 'http-json',
    baseUrl: getInputValue('searchBaseUrl'),
    apiKeyHeader: getInputValue('searchApiKeyHeader'),
    apiKeyPrefix: (document.getElementById('searchApiKeyPrefix') as HTMLInputElement | null)?.value ?? '',
    apiKeyQueryParam: getInputValue('searchApiKeyQueryParam'),
    queryParam: getInputValue('searchQueryParam') || 'q',
    resultCountParam: getInputValue('searchCountParam'),
    languageParam: getInputValue('searchLanguageParam'),
    regionParam: getInputValue('searchRegionParam'),
    safeSearchParam: getInputValue('searchSafeParam'),
    freshnessParam: getInputValue('searchFreshnessParam'),
    resultsPath: getInputValue('searchResultsPath'),
    titleField: getInputValue('searchTitleField') || 'title',
    urlField: getInputValue('searchUrlField') || 'url',
    snippetField: getInputValue('searchSnippetField') || 'snippet',
    sourceField: getInputValue('searchSourceField'),
    publishedAtField: getInputValue('searchPublishedField'),
    extraHeadersJson: getInputValue('searchExtraHeaders') || '{}',
    defaultMaxResults: Number(getInputValue('searchMaxResults')) || previous.defaultMaxResults,
    defaultLanguage: getInputValue('searchLanguage') || 'auto',
    defaultRegion: getInputValue('searchRegion'),
    safeSearch: getSwitchValue('searchSafeSearch'),
    timeoutMs: Number(getInputValue('searchTimeout')) || previous.timeoutMs,
  };
}

function setSearchResultNotice(kind: 'idle' | 'loading' | 'ok' | 'fail', html: string): void {
  const result = document.getElementById('searchTestResult');
  if (!result) return;
  result.classList.toggle('show', kind !== 'idle');
  result.classList.toggle('ok', kind === 'ok');
  result.classList.toggle('fail', kind === 'fail');
  result.innerHTML = html;
}

async function persistSearchSettings(): Promise<void> {
  const apiKeyInput = document.getElementById('searchApiKey') as HTMLInputElement | null;
  const view = await saveSearchConfig(
    readSearchConfigForm(),
    apiKeyInput?.value,
    clearSearchApiKeyRequested,
  );
  clearSearchApiKeyRequested = false;
  if (apiKeyInput) {
    apiKeyInput.value = '';
    apiKeyInput.placeholder = view.hasApiKey ? '已保存；留空则保留' : '可选';
  }
}

function bindWebSearchSettings(): void {
  bindGlassSwitch('searchFeatureEnabled');
  bindGlassSwitch('searchSafeSearch');

  const apiKeyInput = document.getElementById('searchApiKey') as HTMLInputElement | null;
  const revealButton = document.getElementById('toggleSearchApiKey') as HTMLButtonElement | null;
  revealButton?.addEventListener('click', () => {
    if (!apiKeyInput) return;
    const showing = apiKeyInput.type === 'text';
    apiKeyInput.type = showing ? 'password' : 'text';
    revealButton.textContent = showing ? '显示' : '隐藏';
    revealButton.setAttribute('aria-label', showing ? '显示 API Key' : '隐藏 API Key');
  });

  document.getElementById('clearSearchApiKey')?.addEventListener('click', event => {
    clearSearchApiKeyRequested = true;
    if (apiKeyInput) {
      apiKeyInput.value = '';
      apiKeyInput.placeholder = '保存后清除';
    }
    const button = event.currentTarget as HTMLButtonElement;
    button.textContent = '待保存清除';
    button.disabled = true;
  });

  const saveButton = document.getElementById('saveSearchSettings') as HTMLButtonElement | null;
  saveButton?.addEventListener('click', async () => {
    saveButton.disabled = true;
    setSearchResultNotice('loading', t('settings.saving'));
    try {
      await persistSearchSettings();
      setSearchResultNotice('ok', t('settings.saved'));
    } catch (error) {
      setSearchResultNotice('fail', `${t('settings.saveFail')}${escHtml(String(error))}`);
    } finally {
      saveButton.disabled = false;
    }
  });

  const testButton = document.getElementById('testSearchConnection') as HTMLButtonElement | null;
  testButton?.addEventListener('click', async () => {
    testButton.disabled = true;
    setSearchResultNotice('loading', `<span class="spinner"></span> ${t('settings.testing')}`);
    try {
      await persistSearchSettings();
      const result = await testSearchConnection();
      if (result.success) {
        const examples = result.results.slice(0, 3)
          .map(item => `<li><strong>${escHtml(item.title)}</strong><span>${escHtml(item.source || '')}</span></li>`)
          .join('');
        setSearchResultNotice('ok', `${t('settings.testSuccess')} · ${result.latencyMs} ms · ${result.resultCount} ${t('provider.models').toLowerCase()}${examples ? `<ul class="search-test-examples">${examples}</ul>` : ''}`);
      } else {
        setSearchResultNotice('fail', `${t('settings.testFail')}${escHtml(result.error || t('provider.unknownError'))}`);
      }
    } catch (error) {
      setSearchResultNotice('fail', `${t('settings.testFail')}${escHtml(String(error))}`);
    } finally {
      testButton.disabled = false;
    }
  });
}

export function bindSettingsEvents(): void {
  bindFontSizeSettings();
  bindWebSearchSettings();

  const langSelect = document.getElementById('settingsLang') as HTMLSelectElement | null;
  if (langSelect) {
    langSelect.addEventListener('change', () => {
      setLang(langSelect.value as 'zh' | 'en');
      const app = document.getElementById('app');
      if (app) {
        const event = new CustomEvent('settings-changed');
        app.dispatchEvent(event);
      }
    });
  }

  const themeSelect = document.getElementById('settingsTheme') as HTMLSelectElement | null;
  if (themeSelect) {
    themeSelect.addEventListener('change', () => {
      const theme = themeSelect.value;
      localStorage.setItem('tc-theme', theme);
      applyThemePreferences();
    });
  }

  const accentColorInput = document.getElementById('settingsAccentColor') as HTMLInputElement | null;
  const accentTextInput = document.getElementById('settingsAccentText') as HTMLInputElement | null;
  const applyAccent = (value: string) => {
    setCustomAccentColor(value);
    const normalized = getCustomAccentColor();
    if (accentColorInput) accentColorInput.value = normalized;
    if (accentTextInput) accentTextInput.value = normalized;
  };
  if (accentColorInput) {
    accentColorInput.addEventListener('input', () => applyAccent(accentColorInput.value));
  }
  if (accentTextInput) {
    accentTextInput.addEventListener('change', () => applyAccent(accentTextInput.value));
  }
  document.getElementById('resetAccentColor')?.addEventListener('click', () => {
    resetCustomAccentColor();
    const normalized = getCustomAccentColor();
    if (accentColorInput) accentColorInput.value = normalized;
    if (accentTextInput) accentTextInput.value = normalized;
  });

  const displayCurrencySelect = document.getElementById('settingsDisplayCurrency') as HTMLSelectElement | null;
  bindExchangeRateInputs();
  if (displayCurrencySelect) {
    displayCurrencySelect.addEventListener('change', () => {
      setDisplayCurrency(displayCurrencySelect.value);
      const rateList = document.getElementById('settingsExchangeRates');
      if (rateList) {
        rateList.innerHTML = renderExchangeRateFields(getDisplayCurrency());
        bindExchangeRateInputs();
      }
    });
  }

  const tooltipStyleSelect = document.getElementById('settingsTooltipStyle') as HTMLSelectElement | null;
  const tooltipGlassRow = document.getElementById('settingsTooltipGlassRow');
  if (tooltipStyleSelect) {
    const syncGlassRow = () => {
      tooltipGlassRow?.classList.toggle('hidden', tooltipStyleSelect.value !== 'glass');
    };
    tooltipStyleSelect.addEventListener('change', () => {
      setTooltipStyle(tooltipStyleSelect.value);
      syncGlassRow();
    });
    syncGlassRow();
  }

  const tooltipGlassSelect = document.getElementById('settingsTooltipGlassLevel') as HTMLSelectElement | null;
  if (tooltipGlassSelect) {
    tooltipGlassSelect.addEventListener('change', () => {
      setTooltipGlassLevel(tooltipGlassSelect.value);
    });
  }

  const tooltipDelayInput = document.getElementById('settingsTooltipDelay') as HTMLInputElement | null;
  if (tooltipDelayInput) {
    const applyDelay = () => {
      setTooltipDelay(tooltipDelayInput.value);
      tooltipDelayInput.value = String(getTooltipDelay());
    };
    tooltipDelayInput.addEventListener('change', applyDelay);
    tooltipDelayInput.addEventListener('blur', applyDelay);
  }

  const sendKeySelect = document.getElementById('settingsSendKey') as HTMLSelectElement | null;
  if (sendKeySelect) {
    sendKeySelect.addEventListener('change', () => {
      localStorage.setItem('tc-send-key', sendKeySelect.value);
    });
  }

  const globalPrompt = document.getElementById('settingsGlobalPrompt') as HTMLTextAreaElement | null;
  if (globalPrompt) {
    globalPrompt.addEventListener('change', () => {
      localStorage.setItem('tc-global-prompt', globalPrompt.value);
    });
  }

  const addPromptBtn = document.getElementById('addPromptBtn');
  if (addPromptBtn) {
    addPromptBtn.addEventListener('click', () => {
      const prompts = JSON.parse(localStorage.getItem('tc-custom-prompts') || '[]');
      prompts.push({ name: t('settings.newPrompt'), prompt: '', scope: 'global' });
      localStorage.setItem('tc-custom-prompts', JSON.stringify(prompts));
      const promptList = document.getElementById('promptList');
      if (promptList) promptList.innerHTML = renderPromptList();
    });
  }

  document.querySelectorAll<HTMLElement>('[data-delete-prompt]').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.dataset.deletePrompt ?? '0', 10);
      const prompts = JSON.parse(localStorage.getItem('tc-custom-prompts') || '[]');
      prompts.splice(idx, 1);
      localStorage.setItem('tc-custom-prompts', JSON.stringify(prompts));
      const promptList = document.getElementById('promptList');
      if (promptList) promptList.innerHTML = renderPromptList();
      bindSettingsEvents();
    });
  });

  document.querySelectorAll<HTMLElement>('[data-edit-prompt]').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.dataset.editPrompt ?? '0', 10);
      const prompts = JSON.parse(localStorage.getItem('tc-custom-prompts') || '[]');
      const prompt = prompts[idx];
      if (!prompt) return;
      const promptList = document.getElementById('promptList');
      if (!promptList) return;
      promptList.innerHTML = `
        <div class="glass-card glass-form-card" style="padding:16px">
          <div style="display:flex;flex-direction:column;gap:12px">
            <div>
              <label style="display:block;font-size:var(--fs-secondary);color:var(--text-muted);margin-bottom:4px">${t('common.name')}</label>
              <input class="chat-search glass-input" type="text" id="editPromptName" value="${escHtml(prompt.name)}" style="width:100%">
            </div>
            <div>
              <label style="display:block;font-size:var(--fs-secondary);color:var(--text-muted);margin-bottom:4px">Scope</label>
              <select class="chat-search glass-select" id="editPromptScope" style="width:100%">
                <option value="global" ${prompt.scope === 'global' ? 'selected' : ''}>Global</option>
                <option value="conversation" ${prompt.scope === 'conversation' ? 'selected' : ''}>Per Conversation</option>
                <option value="model" ${prompt.scope === 'model' ? 'selected' : ''}>Per Model</option>
              </select>
            </div>
            <div>
              <label style="display:block;font-size:var(--fs-secondary);color:var(--text-muted);margin-bottom:4px">${t('common.systemPrompt')}</label>
              <textarea class="chat-search glass-textarea" id="editPromptContent" style="width:100%;min-height:100px;resize:vertical;font-family:var(--font-mono);font-size:var(--fs-code)">${escHtml(prompt.prompt)}</textarea>
            </div>
            <div style="display:flex;gap:8px;justify-content:flex-end">
              <button class="modal-footer-btn glass-button glass-button--secondary" id="cancelEditPrompt">${t('common.cancel')}</button>
              <button class="test-btn glass-button glass-button--primary" id="saveEditPrompt">${t('common.save')}</button>
            </div>
          </div>
        </div>
      `;
      const cancelBtn = document.getElementById('cancelEditPrompt');
      if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
          promptList.innerHTML = renderPromptList();
          bindSettingsEvents();
        });
      }
      const saveBtn = document.getElementById('saveEditPrompt');
      if (saveBtn) {
        saveBtn.addEventListener('click', () => {
          const nameInput = document.getElementById('editPromptName') as HTMLInputElement | null;
          const scopeInput = document.getElementById('editPromptScope') as HTMLSelectElement | null;
          const contentInput = document.getElementById('editPromptContent') as HTMLTextAreaElement | null;
          prompts[idx] = {
            name: nameInput?.value || 'Untitled',
            scope: scopeInput?.value || 'global',
            prompt: contentInput?.value || '',
          };
          localStorage.setItem('tc-custom-prompts', JSON.stringify(prompts));
          promptList.innerHTML = renderPromptList();
          bindSettingsEvents();
        });
      }
    });
  });
}
