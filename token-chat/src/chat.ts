// Entry point — DOM updates, event binding, orchestrates sub-modules
import { openUrl } from '@tauri-apps/plugin-opener';
import { state, type Message } from './state';
import { t } from './i18n';
import { isSafeSourceUrl, getSearchConfigSnapshot } from './web-search';
import { renderRightPanelContent } from './chat-token';
import {
  renderConversationList,
  renderChatMessages,
  renderChatInput,
  renderChatInput as renderChatInputHtml,
  getMessageCopyText,
  copyText,
  scrollToBottom,
  autoResizeTextarea,
} from './chat-render';
import {
  handleSend,
  bindChatInputEvents,
  getWebSearchPhase,
  getWebSearchStatusText,
  isChatWebSearchEnabled,
  setChatCallbacks,
} from './chat-send';
import {
  loadConversations,
  selectConversation,
  createConversation,
  renameCurrentConversation,
  deleteConversation,
  setConversationCallbacks,
  bindChatEvents as bindConversationAndMessageEvents,
} from './chat-conversation';

// ── DOM updaters ──

export function renderChatArea(bindEvents?: () => void): void {
  const messagesEl = document.getElementById('chatMessages');
  if (messagesEl) {
    messagesEl.innerHTML = renderChatMessages();
    if (bindEvents) bindEvents(); else bindMessageEvents();
    scrollToBottom();
  }
  const titleEl = document.querySelector('.chat-center-title');
  if (titleEl) {
    const conv = state.conversations.find(c => c.id === state.currentConversationId);
    titleEl.textContent = conv?.title ?? t('chat.new');
  }
  const modelEl = document.querySelector('.chat-center-model');
  if (modelEl) {
    const conv = state.conversations.find(c => c.id === state.currentConversationId);
    const model = conv ? state.models.find(m => m.id === conv.model_id) : null;
    modelEl.textContent = model?.display_name ?? model?.model_name ?? t('chat.noModel');
  }
}

export function renderConversationListInDom(bindEvents?: () => void): void {
  const listEl = document.getElementById('chatList');
  if (listEl) {
    listEl.innerHTML = renderConversationList();
    if (bindEvents) bindEvents(); else bindConversationListEvents();
  }
}

export function renderChatInputInDom(): void {
  const inputArea = document.querySelector('.chat-input-area');
  if (inputArea) {
    const parent = inputArea.parentElement;
    if (parent) {
      inputArea.outerHTML = renderChatInputHtml({
        isStreaming: state.isStreaming,
        searchFeatureEnabled: getSearchConfigSnapshot().config.enabled,
        searchEnabled: isChatWebSearchEnabled(),
        searchPhase: getWebSearchPhase(),
        searchStatusText: getWebSearchStatusText(),
      });
      bindChatInputEvents();
    }
  }
}

export function renderRightPanelInDom(): void {
  const panelBody = document.querySelector('.chat-right .panel-body');
  if (panelBody) {
    panelBody.innerHTML = renderRightPanelContent();
  }
}

// ── Event binding ──

function bindMessageEvents(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-open-source-url]').forEach(button => {
    button.addEventListener('click', async () => {
      const url = button.dataset.openSourceUrl ?? '';
      if (!isSafeSourceUrl(url)) return;
      try {
        await openUrl(url);
      } catch (error) {
        console.error('Failed to open source URL:', error);
      }
    });
  });

  document.querySelectorAll<HTMLButtonElement>('[data-copy-msg-id]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.copyMsgId;
      const msg = state.messages.find(m => m.id === id);
      if (!msg) return;
      await copyText(getMessageCopyText(msg));
      const oldText = btn.textContent ?? t('chat.copy');
      btn.textContent = t('chat.copied');
      btn.disabled = true;
      window.setTimeout(() => {
        btn.textContent = oldText;
        btn.disabled = false;
      }, 900);
    });
  });

  document.querySelectorAll<HTMLElement>('[data-toggle-thinking]').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.detail > 1) return;
      const sel = window.getSelection();
      if (sel && sel.toString().length > 0) return;
      const body = el.querySelector('.msg-thinking-body') as HTMLElement | null;
      if (body) {
        body.style.display = body.style.display === 'none' ? '' : 'none';
      }
    });
  });
}

function bindConversationListEvents(): void {
  document.querySelectorAll<HTMLElement>('[data-conv-id]').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.convId;
      if (id) selectConversation(id);
    });
  });
  document.querySelectorAll<HTMLElement>('[data-delete-conv]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = el.dataset.deleteConv;
      if (id) deleteConversation(id);
    });
  });
}

let selectionCopyFallbackBound = false;

function bindSelectionCopyFallback(): void {
  if (selectionCopyFallbackBound) return;
  selectionCopyFallbackBound = true;
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'c') return;
    const target = e.target as HTMLElement | null;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable) return;
    const selected = window.getSelection()?.toString() ?? '';
    if (selected.trim()) {
      void copyText(selected);
    }
  });
}

export function bindChatEvents(): void {
  bindConversationListEvents();
  bindChatInputEvents();
  bindMessageEvents();
  bindSelectionCopyFallback();

  document.querySelector('.chat-new-btn')?.addEventListener('click', () => createConversation());
  document.getElementById('editTitleBtn')?.addEventListener('click', () => renameCurrentConversation());
  document.querySelector('.chat-center-title')?.addEventListener('dblclick', () => renameCurrentConversation());
}

// ── Re-exports for main.ts ──

export {
  loadConversations,
  selectConversation,
  createConversation,
  renameCurrentConversation,
  deleteConversation,
};
export { renderConversationList, renderChatMessages, renderChatInput } from './chat-render';
export { renderRightPanelContent } from './chat-token';

// ── Wire up callbacks for sub-modules ──

setChatCallbacks({
  renderChatArea,
  renderConversationListInDom,
  renderChatInputInDom,
  renderRightPanelInDom,
});

setConversationCallbacks({
  renderChatArea: (bindEvents: () => void) => {
    renderChatArea();
  },
  renderConversationListInDom: (bindEvents: () => void) => {
    renderConversationListInDom();
  },
  renderRightPanelInDom,
});
