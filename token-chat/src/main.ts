import './styles.css';
import { invoke } from '@tauri-apps/api/core';
import { state, type Page } from './state';
import { t, getLang, setLang } from './i18n';
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

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

  const themeSelect = document.getElementById('themeSelect') as HTMLSelectElement | null;
  if (themeSelect) {
    themeSelect.addEventListener('change', () => {
      const theme = themeSelect.value;
      localStorage.setItem('tc-theme', theme);
      applyThemePreferences();
    });
  }

  const langSelect = document.getElementById('langSelect') as HTMLSelectElement | null;
  if (langSelect) {
    langSelect.addEventListener('change', () => {
      setLang(langSelect.value as 'zh' | 'en');
      render();
    });
  }

  bindChatEvents();
  if (state.page === 'provider') bindProviderEvents();
  if (state.page === 'stats') bindStatsEvents(render);
  if (state.page === 'settings') bindSettingsEvents();
}

function renderSidebar() {
  const collapsed = state.sidebarCollapsed;
  return `
    <aside class="chat-left ${collapsed ? 'collapsed' : ''}" id="chatLeft">
      <div class="chat-left-header">
        <h3>${t('chat.conversations')}</h3>
        <input class="chat-search" type="text" placeholder="${t('chat.search')}">
        <button class="chat-new-btn">+ ${t('chat.new')}</button>
      </div>
      <div class="chat-list" id="chatList">
        ${renderConversationList()}
      </div>
      <div class="sidebar-nav">
        <button class="sidebar-nav-btn ${state.page === 'chat' ? 'active' : ''}" data-page="chat">${t('nav.chat')}</button>
        <button class="sidebar-nav-btn ${state.page === 'provider' ? 'active' : ''}" data-page="provider">${t('nav.providers')}</button>
        <button class="sidebar-nav-btn ${state.page === 'stats' ? 'active' : ''}" data-page="stats">${t('nav.stats')}</button>
        <button class="sidebar-nav-btn ${state.page === 'settings' ? 'active' : ''}" data-page="settings">${t('nav.settings')}</button>
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
        <button class="toggle-btn" data-toggle="sidebar" title="Toggle conversations">&#9776;</button>
        <span class="chat-center-title">${escHtml(conv?.title ?? 'New Conversation')}</span>
        ${conv ? `<button class="title-edit-btn" id="editTitleBtn" title="Rename conversation">&#9998;</button>` : ''}
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
          <button class="tool-btn" id="exportChatBtn">Export</button>
          <button class="tool-btn" data-page="provider">Settings</button>
        </div>
        <button class="toggle-btn" data-toggle="right" title="Toggle token monitor" style="margin-left:4px">&#9638;</button>
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
        <button class="toggle-btn" data-toggle="right" style="width:24px;height:24px;font-size:12px">&#10005;</button>
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
  const currentTheme = localStorage.getItem('tc-theme') || 'midnight';
  applyThemePreferences();
  applyFontSizePreferences();
  bindDataTooltips();
  app.innerHTML = `
    <nav class="topnav">
      <div class="topnav-brand">${t('app.title')}</div>
      <div class="topnav-tabs">
        <button class="topnav-tab ${state.page === 'chat' ? 'active' : ''}" data-page="chat">${t('nav.chat')}</button>
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
        <div class="topnav-stat">Today: <span>$0.00</span></div>
        <div class="topnav-stat">Tokens: <span>0</span></div>
      </div>
    </nav>
    <div class="page-body">
      ${state.page === 'chat' ? renderSidebar() + renderChatCenter() + renderRightPanel() : ''}
      ${state.page === 'provider' ? renderProviderPage() : ''}
      ${state.page === 'stats' ? renderStatsPage() : ''}
      ${state.page === 'settings' ? renderSettingsPage() : ''}
    </div>
  `;
  bindEvents();
}

applyFontSizePreferences();
render();
