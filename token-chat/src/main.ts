import './styles.css';
import './unified-shell.css';
import './glass-system.css';
import './liquid-glass.css';
import { injectGlassRefractionFilters } from './glass-caustics';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { state, type Page } from './state';
import { t, getLang } from './i18n';
import {
  loadConversations,
  renderConversationList,
  renderChatMessages,
  renderChatInput,
  renderRightPanelContent,
  renderRightPanelInDom,
  bindChatEvents,
  selectConversation,
} from './chat';
import { loadProviders, renderProviderPage, bindProviderEvents } from './provider';
import { loadStats, renderStatsPage, bindStatsEvents } from './stats';
import { renderSettingsPage, bindSettingsEvents } from './settings';
import { loadBuiltinPrompt } from './prompt';
import { applyThemePreferences } from './theme';
import { bindDataTooltips } from './tooltip';
import { applyFontSizePreferences } from './font-size';
import { formatCurrencyAmount, fetchExchangeRates } from './currency';
import { initCustomSelects } from './custom-select';
import { initCustomDatePickers } from './custom-date-picker';
import { clearDeclaredGlassPortals, mountDeclaredGlassPortals } from './liquid-glass';
import { loadSearchConfig } from './web-search';

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function iconSvg(name: 'menu' | 'edit' | 'panel' | 'close' | 'minimize' | 'maximize' | 'sparkles' | 'chat' | 'cube' | 'chart' | 'gear'): string {
  const paths = {
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    edit: '<path d="M13.5 6.5 17.5 10.5M4 20l4.2-.9L19 6.3a2 2 0 0 0-2.8-2.8L3.9 16.3 3 21z"/>',
    panel: '<rect x="3" y="4" width="18" height="16" rx="4"/><path d="M15 4v16"/>',
    close: '<path d="m7 7 10 10M17 7 7 17"/>',
    minimize: '<path d="M6 12h12"/>',
    maximize: '<rect x="5.5" y="5.5" width="13" height="13" rx="1.5"/>',
    sparkles: '<path d="M12 3.5c.7 3.3 2.2 4.8 5.5 5.5-3.3.7-4.8 2.2-5.5 5.5-.7-3.3-2.2-4.8-5.5-5.5 3.3-.7 4.8-2.2 5.5-5.5Z"/><path d="M18.5 14.5c.35 1.7 1.3 2.65 3 3-1.7.35-2.65 1.3-3 3-.35-1.7-1.3-2.65-3-3 1.7-.35 2.65-1.3 3-3Z"/>',
    chat: '<path d="M5 17.5 3.8 21l4.1-1.5a9 9 0 1 0-2.9-2Z"/><path d="M8 12h.01M12 12h.01M16 12h.01"/>',
    cube: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="m4.3 7.7 7.7 4.4 7.7-4.4M12 12.1V21"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.08A1.7 1.7 0 0 0 9 19.36a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.63 15 1.7 1.7 0 0 0 3.08 14H3v-4h.08A1.7 1.7 0 0 0 4.64 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.63 1.7 1.7 0 0 0 10 3.08V3h4v.08A1.7 1.7 0 0 0 15 4.64a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.37 9 1.7 1.7 0 0 0 20.92 10H21v4h-.08A1.7 1.7 0 0 0 19.4 15Z"/>',
  };
  return `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`;
}

function switchPage(page: Page) {
  state.page = page;
  render();
}

function togglePanel(panel: 'sidebar' | 'right') {
  if (panel === 'sidebar') {
    state.sidebarCollapsed = !state.sidebarCollapsed;
  } else {
    state.rightPanelCollapsed = !state.rightPanelCollapsed;
  }
  render();
}

function bindEvents() {
  document.querySelectorAll<HTMLElement>('[data-page]').forEach(el => {
    el.addEventListener('click', () => switchPage(el.dataset.page as Page));
  });
  document.querySelectorAll<HTMLElement>('[data-toggle]').forEach(el => {
    el.addEventListener('click', () => togglePanel(el.dataset.toggle as 'sidebar' | 'right'));
  });

  const modelSelect = document.getElementById('modelSelect') as HTMLSelectElement | null;
  if (modelSelect) {
    modelSelect.addEventListener('change', async () => {
      const modelId = modelSelect.value;
      if (!state.currentConversationId) return;
      const conv = state.conversations.find(c => c.id === state.currentConversationId);
      if (!conv) return;
      const model = state.models.find(m => m.id === modelId);
      if (model) {
        conv.model_id = modelId;
        conv.provider_id = model.provider_id;
        try {
          await invoke('update_conversation_model', {
            id: state.currentConversationId,
            providerId: model.provider_id,
            modelId: modelId,
          });
        } catch {}
        renderRightPanelInDom();
      }
    });
  }

  bindWindowChromeEvents();

  bindChatEvents();
  if (state.page === 'provider') bindProviderEvents();
  if (state.page === 'stats') bindStatsEvents(render);
  if (state.page === 'settings') bindSettingsEvents();
}

function bindWindowChromeEvents() {
  const isTauri = Boolean((window as any).__TAURI_INTERNALS__);
  const windowHandle = isTauri ? getCurrentWindow() : null;

  document.querySelectorAll<HTMLButtonElement>('[data-window-action]').forEach(button => {
    button.addEventListener('click', async () => {
      if (!windowHandle) return;
      const action = button.dataset.windowAction;
      if (action === 'minimize') await windowHandle.minimize();
      if (action === 'maximize') await windowHandle.toggleMaximize();
      if (action === 'close') await windowHandle.close();
    });
  });

  document.querySelector<HTMLElement>('.window-titlebar')?.addEventListener('dblclick', event => {
    if (!windowHandle || (event.target as Element).closest('.window-controls')) return;
    void windowHandle.toggleMaximize();
  });
}

function pageLabel(page: Page): string {
  const labels: Record<Page, string> = {
    chat: t('nav.chat'),
    provider: t('nav.providers'),
    stats: t('nav.stats'),
    settings: t('nav.settings'),
  };
  return labels[page];
}

function renderWindowTitlebar(): string {
  return `
    <header class="window-titlebar" data-tauri-drag-region>
      <div class="window-titlebar-title" data-tauri-drag-region>
        <span>Token Chat</span>
        <span class="window-titlebar-separator">/</span>
        <span class="window-titlebar-page">${pageLabel(state.page)}</span>
      </div>
      <div class="window-controls">
        <button class="window-control" data-window-action="minimize" aria-label="${t('window.minimize')}" title="${t('window.minimize')}">${iconSvg('minimize')}</button>
        <button class="window-control" data-window-action="maximize" aria-label="${t('window.maximize')}" title="${t('window.maximize')}">${iconSvg('maximize')}</button>
        <button class="window-control close" data-window-action="close" aria-label="${t('window.close')}" title="${t('window.close')}">${iconSvg('close')}</button>
      </div>
    </header>
  `;
}

function renderSidebar() {
  const collapsed = state.page === 'chat' && state.sidebarCollapsed;
  return `
    <aside class="chat-left glass-sidebar ${collapsed ? 'collapsed' : ''}" id="chatLeft">
      <div class="sidebar-brand-shell">
        <div class="sidebar-brand"><span class="brand-mark">${iconSvg('sparkles')}</span><span>${t('app.title')}</span></div>
      </div>
      <div class="sidebar-nav glass-nav" aria-label="Primary navigation">
        <button class="sidebar-nav-btn glass-nav-item ${state.page === 'chat' ? 'active' : ''}" data-page="chat" aria-label="${t('nav.chat')}" ${state.page === 'chat' ? 'aria-current="page"' : ''}>${iconSvg('chat')}<span>${t('nav.chat')}</span></button>
        <button class="sidebar-nav-btn glass-nav-item ${state.page === 'provider' ? 'active' : ''}" data-page="provider" aria-label="${t('nav.providers')}" ${state.page === 'provider' ? 'aria-current="page"' : ''}>${iconSvg('cube')}<span>${t('nav.providers')}</span></button>
        <button class="sidebar-nav-btn glass-nav-item ${state.page === 'stats' ? 'active' : ''}" data-page="stats" aria-label="${t('nav.stats')}" ${state.page === 'stats' ? 'aria-current="page"' : ''}>${iconSvg('chart')}<span>${t('nav.stats')}</span></button>
        <button class="sidebar-nav-btn glass-nav-item ${state.page === 'settings' ? 'active' : ''}" data-page="settings" aria-label="${t('nav.settings')}" ${state.page === 'settings' ? 'aria-current="page"' : ''}>${iconSvg('gear')}<span>${t('nav.settings')}</span></button>
      </div>
      <div class="chat-left-header">
        <h3>${t('chat.conversations')}</h3>
        <input class="chat-search glass-input glass-search-input" type="text" placeholder="${t('chat.search')}">
        <button class="chat-new-btn glass-button glass-button--primary">+ ${t('chat.new')}</button>
      </div>
      <div class="chat-list" id="chatList">
        ${renderConversationList()}
      </div>
    </aside>
  `;
}

function renderChatCenter() {
  const conv = state.conversations.find(c => c.id === state.currentConversationId);
  const model = conv ? state.models.find(m => m.id === conv.model_id) : null;
  return `
    <main class="chat-center">
      <div class="chat-center-header">
        <button class="toggle-btn" data-toggle="sidebar" title="${t('chat.toggleSidebar')}" aria-label="${t('chat.toggleSidebar')}">${iconSvg('menu')}</button>
        <span class="chat-center-title">${escHtml(conv?.title ?? t('chat.new'))}</span>
        ${conv ? `<button class="title-edit-btn" id="editTitleBtn" title="${t('chat.rename')}" aria-label="${t('chat.rename')}">${iconSvg('edit')}</button>` : ''}
        <select class="model-select" id="modelSelect">
          <option value="">${t('chat.noModel')}</option>
          ${state.providers.flatMap(p => {
            const pModels = state.models.filter(m => m.provider_id === p.id);
            return pModels.length > 0
              ? `<optgroup label="${escHtml(p.name)}">${pModels.map(m => `<option value="${m.id}" ${m.id === conv?.model_id ? 'selected' : ''}>${escHtml(m.display_name)}</option>`).join('')}</optgroup>`
              : '';
          }).join('')}
        </select>
        <div class="chat-center-tools">
          <button class="tool-btn" id="exportChatBtn">${t('chat.export')}</button>
          <button class="tool-btn" data-page="provider">${t('nav.settings')}</button>
        </div>
        <button class="toggle-btn" data-toggle="right" title="${t('chat.toggleMonitor')}" aria-label="${t('chat.toggleMonitor')}" style="margin-left:4px">${iconSvg('panel')}</button>
      </div>
      <div class="chat-messages" id="chatMessages">
        ${renderChatMessages()}
      </div>
      ${renderChatInput()}
    </main>
  `;
}

function renderRightPanel() {
  const collapsed = state.rightPanelCollapsed;
  return `
    <aside class="chat-right ${collapsed ? 'collapsed' : ''}" id="chatRight">
      <div class="chat-right-header">
        <h3>${t('chat.tokenMonitor')}</h3>
        <button class="toggle-btn" data-toggle="right" aria-label="${t('chat.closeMonitor')}" style="width:28px;height:28px">${iconSvg('close')}</button>
      </div>
      <div class="panel-body">
        ${renderRightPanelContent()}
      </div>
    </aside>
  `;
}

export async function render() {
  const app = document.getElementById('app')!;
  await loadBuiltinPrompt();
  if (state.page === 'chat') {
    await loadSearchConfig();
    if (state.conversations.length === 0) await loadConversations();
    if (state.providers.length === 0) await loadProviders();
    if (state.conversations.length > 0 && !state.currentConversationId) {
      await selectConversation(state.conversations[0].id);
    }
  }
  if (state.page === 'provider' && state.providers.length === 0) {
    await loadProviders();
  }
  if (state.page === 'stats') {
    await loadStats();
  }
  if (state.page === 'settings') {
    await loadSearchConfig();
  }
  const currentTheme = localStorage.getItem('tc-theme') || 'midnight';
  applyThemePreferences();
  applyFontSizePreferences();
  bindDataTooltips();
  clearDeclaredGlassPortals();
  app.innerHTML = `
    ${renderWindowTitlebar()}
    ${false ? `
    <nav class="topnav">
      <div class="topnav-brand"><span class="brand-mark">${iconSvg('sparkles')}</span><span>${t('app.title')}</span></div>
      <div class="topnav-tabs">
        <button class="topnav-tab" data-page="chat">${t('nav.chat')}</button>
        <button class="topnav-tab ${state.page === 'provider' ? 'active' : ''}" data-page="provider">${t('nav.providers')}</button>
        <button class="topnav-tab ${state.page === 'stats' ? 'active' : ''}" data-page="stats">${t('nav.stats')}</button>
        <button class="topnav-tab ${state.page === 'settings' ? 'active' : ''}" data-page="settings">${t('nav.settings')}</button>
      </div>
      <div class="topnav-right">
        <select class="topnav-select" id="langSelect">
          <option value="zh" ${getLang() === 'zh' ? 'selected' : ''}>中文</option>
          <option value="en" ${getLang() === 'en' ? 'selected' : ''}>English</option>
        </select>
        <select class="topnav-select" id="themeSelect">
          <option value="midnight" ${currentTheme === 'midnight' ? 'selected' : ''}>${t('theme.midnight')}</option>
          <option value="ocean" ${currentTheme === 'ocean' ? 'selected' : ''}>${t('theme.ocean')}</option>
          <option value="forest" ${currentTheme === 'forest' ? 'selected' : ''}>${t('theme.forest')}</option>
          <option value="sunset" ${currentTheme === 'sunset' ? 'selected' : ''}>${t('theme.sunset')}</option>
          <option value="rose" ${currentTheme === 'rose' ? 'selected' : ''}>${t('theme.rose')}</option>
          <option value="light" ${currentTheme === 'light' ? 'selected' : ''}>${t('theme.light')}</option>
        </select>
        <div class="topnav-stat">${t('chat.today')}: <span>${formatCurrencyAmount(0, 2)}</span></div>
        <div class="topnav-stat">${t('chat.tokens')}: <span>0</span></div>
      </div>
    </nav>` : ''}
    <div class="page-body ${state.page === 'chat' ? 'chat-page-body' : ''}" data-page-body="${state.page}">
      ${renderSidebar()}
      ${state.page === 'chat' ? renderChatCenter() + renderRightPanel() : ''}
      ${state.page === 'provider' ? renderProviderPage() : ''}
      ${state.page === 'stats' ? renderStatsPage() : ''}
      ${state.page === 'settings' ? renderSettingsPage() : ''}
    </div>
  `;
  mountDeclaredGlassPortals(app);
  bindEvents();
}

applyFontSizePreferences();
injectGlassRefractionFilters();
initCustomSelects();
initCustomDatePickers();
fetchExchangeRates();
render();
