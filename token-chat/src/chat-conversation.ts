import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { state, parseContent, type Conversation, type Message } from './state';
import { t } from './i18n';
import { showGlassConfirm, showGlassPrompt } from './glass-dialog';
import { resetLiveTokenUsage, loadTokenUsage } from './chat-token';
import { parseAttachments } from './chat-attachment';
import { isSafeSourceUrl } from './web-search';
import {
  renderChatMessages,
  getMessageCopyText,
  copyText,
} from './chat-render';
import {
  bindChatInputEvents,
  updateConversationTitleLocal,
} from './chat-send';

// ── Callbacks set by chat.ts to avoid circular imports ──

let _renderChatArea: (bindEvents: () => void) => void = () => {};
let _renderConversationListInDom: (bindEvents: () => void) => void = () => {};
let _renderRightPanelInDom: () => void = () => {};

export function setConversationCallbacks(opts: {
  renderChatArea: (bindEvents: () => void) => void;
  renderConversationListInDom: (bindEvents: () => void) => void;
  renderRightPanelInDom: () => void;
}): void {
  _renderChatArea = opts.renderChatArea;
  _renderConversationListInDom = opts.renderConversationListInDom;
  _renderRightPanelInDom = opts.renderRightPanelInDom;
}

const isDev = !(window as any).__TAURI_INTERNALS__;

// ── Mock data ──

const devNow = Math.floor(Date.now() / 1000);
const mockConversations: Conversation[] = [
  { id: 'demo-1', title: '如何优化 TypeScript 项目', provider_id: 'p2', model_id: 'm3', pinned_at: devNow, archived_at: null, updated_at: devNow - 180 },
  { id: 'demo-2', title: 'API 设计最佳实践', provider_id: 'p1', model_id: 'm1', pinned_at: null, archived_at: null, updated_at: devNow - 86400 },
  { id: 'demo-3', title: '实现一个虚拟列表组件', provider_id: 'p1', model_id: 'm2', pinned_at: null, archived_at: null, updated_at: devNow - 172800 },
  { id: 'demo-4', title: 'Windows 客户端开发建议', provider_id: 'p1', model_id: 'm1', pinned_at: null, archived_at: null, updated_at: devNow - 259200 },
  { id: 'demo-5', title: '数据库索引优化指南', provider_id: 'p2', model_id: 'm3', pinned_at: null, archived_at: null, updated_at: devNow - 345600 },
];

const mockMessages: Message[] = [
  {
    id: 'demo-user-1', conversation_id: 'demo-1', role: 'user',
    content_json: JSON.stringify('如何优化大型 TypeScript 项目的构建速度？请给出可落地的方案，包括工具链、配置和代码组织方面的建议。'),
    reasoning_content: null, provider_name: null, model_name: null, status: 'completed', attachments_json: null, created_at: devNow - 170,
  },
  {
    id: 'demo-assistant-1', conversation_id: 'demo-1', role: 'assistant',
    content_json: JSON.stringify(`优化大型 TypeScript 项目的构建速度，可以从工具链、任务编排与代码组织三条线同时推进。

## 1. 工具链选择

- 使用更快的转译工具：开发阶段用 **esbuild**、**SWC** 或基于 esbuild 的 Vite。
- 将类型检查从转译流程中拆开，使用独立的 \`tsc --noEmit\` 任务并行执行。
- 对多包仓库使用 Turborepo 或 Nx，只构建真正发生变化的工作区。

## 2. 配置优化

- 开启 \`incremental\` 与 \`tsBuildInfoFile\`，复用上一次类型检查结果。
- 使用 \`skipLibCheck\` 减少第三方声明文件的重复检查。
- 收紧 \`include\` / \`exclude\`，避免测试产物与生成目录进入编译图。

## 3. 代码组织

按稳定边界拆分项目引用，让核心包、UI 包和工具包拥有独立缓存。先用构建分析器找出最慢的 10%，再决定是否增加新的工程复杂度。`),
    reasoning_content: null, provider_name: 'Anthropic', model_name: 'Claude Sonnet 4', status: 'completed', attachments_json: null, created_at: devNow - 120,
  },
];

// ── Conversation CRUD ──

export async function loadConversations(): Promise<void> {
  if (isDev) {
    state.conversations = [...mockConversations];
    return;
  }
  try {
    state.conversations = await invoke<Conversation[]>('list_conversations');
  } catch {
    state.conversations = [];
  }
}

export async function selectConversation(id: string): Promise<void> {
  state.currentConversationId = id;
  resetLiveTokenUsage();
  if (isDev) {
    state.messages = mockMessages.filter(message => message.conversation_id === id);
  } else {
    try {
      state.messages = await invoke<Message[]>('list_messages', { conversationId: id });
    } catch {
      state.messages = [];
    }
  }
  await loadTokenUsage(id);
  doRenderChatArea();
  doRenderConversationListInDom();
  doRenderRightPanelInDom();
}

export async function createConversation(): Promise<void> {
  if (isDev) {
    const now = Math.floor(Date.now() / 1000);
    const conv: Conversation = {
      id: crypto.randomUUID(), title: 'New Conversation',
      provider_id: state.providers[0]?.id ?? null,
      model_id: state.models.find(model => model.provider_id === state.providers[0]?.id)?.id ?? null,
      pinned_at: null, archived_at: null, updated_at: now,
    };
    state.conversations.unshift(conv);
    state.currentConversationId = conv.id;
    state.messages = [];
    doRenderChatArea();
    doRenderConversationListInDom();
    doRenderRightPanelInDom();
    return;
  }
  try {
    let providerId: string | undefined;
    let modelId: string | undefined;
    if (state.providers.length > 0) {
      providerId = state.providers[0].id;
      const pModels = state.models.filter(m => m.provider_id === providerId);
      if (pModels.length > 0) modelId = pModels[0].id;
    }
    const conv = await invoke<Conversation>('create_conversation', {
      input: { provider_id: providerId ?? null, model_id: modelId ?? null },
    });
    state.conversations.unshift(conv);
    await selectConversation(conv.id);
  } catch (e) {
    console.error('Failed to create conversation:', e);
  }
}

export async function deleteConversation(id: string): Promise<void> {
  if (!await showGlassConfirm(t('chat.confirmDeleteConv'), t('common.delete'), true)) return;
  if (isDev) {
    state.conversations = state.conversations.filter(c => c.id !== id);
    if (state.currentConversationId === id) {
      state.currentConversationId = state.conversations[0]?.id ?? null;
      state.messages = [];
    }
  } else {
    try {
      await invoke('delete_conversation', { id });
      state.conversations = state.conversations.filter(c => c.id !== id);
      if (state.currentConversationId === id) {
        state.currentConversationId = state.conversations[0]?.id ?? null;
        if (state.currentConversationId) {
          state.messages = await invoke<Message[]>('list_messages', { conversationId: state.currentConversationId });
          await loadTokenUsage(state.currentConversationId);
        } else {
          state.messages = [];
        }
      }
    } catch (e) {
      console.error('Failed to delete conversation:', e);
      return;
    }
  }
  doRenderChatArea();
  doRenderConversationListInDom();
  doRenderRightPanelInDom();
}

export async function renameCurrentConversation(): Promise<void> {
  if (!state.currentConversationId) return;
  const conv = state.conversations.find(c => c.id === state.currentConversationId);
  if (!conv) return;
  const title = await showGlassPrompt(t('chat.conversationTitle'), conv.title);
  if (title === null) return;
  await updateConversationTitleLocal(conv.id, title);
}

// ── Internal render helpers ──

function doRenderChatArea() { _renderChatArea(bindMessageEvents); }
function doRenderConversationListInDom() { _renderConversationListInDom(bindConversationListEvents); }
function doRenderRightPanelInDom() { _renderRightPanelInDom(); }

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

  document.getElementById('editTitleBtn')?.addEventListener('click', () => {
    renameCurrentConversation();
  });
  document.querySelector('.chat-center-title')?.addEventListener('dblclick', () => {
    renameCurrentConversation();
  });
}
