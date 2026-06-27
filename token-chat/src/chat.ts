// Entry point — DOM updates, event binding, orchestrates sub-modules
import { state } from './state';
import { t } from './i18n';
import { copyText } from './chat-render';
import {
  handleSend,
  setChatCallbacks,
} from './chat-send';
import {
  loadConversations,
  selectConversation,
  createConversation,
  renameCurrentConversation,
  deleteConversation,
  setCurrentConversationModel,
  setConversationCallbacks,
} from './chat-conversation';

import { mountMessageList } from './components/MessageList';
import { mountChatInput } from './components/ChatInput';
import { mountConversationList } from './components/ConversationList';
import { mountRightPanel } from './components/RightPanel';

// ── DOM updaters ──

function renderChatArea(): void {
  const messagesEl = document.getElementById('chatMessages');
  if (messagesEl) {
    mountMessageList(messagesEl);
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

function renderConversationListInDom(): void {
  const listEl = document.getElementById('chatList');
  if (listEl) {
    mountConversationList(listEl, selectConversation, deleteConversation);
  }
}

function renderChatInputInDom(): void {
  const mountEl = document.getElementById('chatInputMount');
  if (mountEl) {
    mountChatInput(mountEl, handleSend);
  }
}

function renderRightPanelInDom(): void {
  const panelBody = document.querySelector('.chat-right .panel-body');
  if (panelBody) {
    mountRightPanel(panelBody as HTMLElement);
  }
}

// ── Event binding ──

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
  bindSelectionCopyFallback();

  document.querySelector('.chat-new-btn')?.addEventListener('click', () => createConversation());
  document.getElementById('editTitleBtn')?.addEventListener('click', () => renameCurrentConversation());
  document.querySelector('.chat-center-title')?.addEventListener('dblclick', () => renameCurrentConversation());
}

export function mountChatSurfaceInDom(): void {
  renderConversationListInDom();
  renderChatArea();
  renderChatInputInDom();
  renderRightPanelInDom();
}

// ── Re-exports for main.ts ──

export {
  loadConversations,
  selectConversation,
  setCurrentConversationModel,
};

// ── Wire up callbacks for sub-modules ──

setChatCallbacks({
  renderChatArea,
  renderConversationListInDom,
  renderChatInputInDom,
  renderRightPanelInDom,
});

setConversationCallbacks({
  renderChatArea,
  renderConversationListInDom,
  renderRightPanelInDom,
});
