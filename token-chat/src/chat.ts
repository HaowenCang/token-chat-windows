import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { openUrl } from '@tauri-apps/plugin-opener';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { state, parseContent, type Conversation, type Message } from './state';
import { t, getLang } from './i18n';
import { getEffectiveSystemPrompt } from './prompt';
import { showGlassAlert, showGlassConfirm, showGlassPrompt } from './glass-dialog';
import { renderMarkdown } from './chat-markdown';
import {
  type StreamChunk,
  type StreamCapture,
  type ApiMessage,
  type ApiMessageContent,
  loadTokenUsage,
  updateLiveTokenUsage,
  resetLiveTokenUsage,
  relativeTime,
  deriveTokenParts,
  estimateTokenCount,
  stringifyApiContent,
  renderRightPanelContent,
} from './chat-token';
export { renderRightPanelContent };
import {
  buildSearchAugmentedPrompt,
  cancelWebSearch,
  getSearchConfigSnapshot,
  getSearchProvider,
  isSafeSourceUrl,
  parseSearchMetadata,
  type MessageSearchMetadata,
} from './web-search';

declare global {
  interface Window {
    __handleSend: () => void;
  }
}

let streamUnlisten: UnlistenFn | null = null;
let metricsUnlisten: UnlistenFn | null = null;
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

// ── Attachment types & state ──

export interface MessageAttachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  kind: 'text' | 'image' | 'binary';
  content?: string;
  data_url?: string;
  truncated?: boolean;
}

let selectedAttachments: MessageAttachment[] = [];
let selectionCopyFallbackBound = false;
let sendSequence = 0;
let activeSendId = 0;
const cancelledSendIds = new Set<number>();
let sendPreparationInProgress = false;
let webSearchPhase: 'idle' | 'searching' | 'success' | 'error' = 'idle';
let webSearchStatusText = '';

const MAX_TEXT_ATTACHMENT_BYTES = 180_000;
const MAX_IMAGE_ATTACHMENT_BYTES = 4_000_000;

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function isChatWebSearchEnabled(): boolean {
  return getSearchConfigSnapshot().config.enabled && localStorage.getItem('tc-chat-web-search-enabled') === 'true';
}

function setWebSearchPhase(phase: typeof webSearchPhase, text = ''): void {
  webSearchPhase = phase;
  webSearchStatusText = text;
}

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function parseAttachments(json: string | null | undefined): MessageAttachment[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isTextLike(file: File): boolean {
  if (file.type.startsWith('text/')) return true;
  return /\.(csv|json|log|md|txt|xml|yaml|yml|ts|tsx|js|jsx|css|html|rs|py|java|go|sql)$/i.test(file.name);
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

async function fileToAttachment(file: File): Promise<MessageAttachment> {
  const base: MessageAttachment = {
    id: crypto.randomUUID(),
    name: file.name,
    mime: file.type || 'application/octet-stream',
    size: file.size,
    kind: 'binary',
  };

  if (file.type.startsWith('image/')) {
    if (file.size <= MAX_IMAGE_ATTACHMENT_BYTES) {
      return { ...base, kind: 'image', data_url: await readFileAsDataUrl(file) };
    }
    return { ...base, kind: 'image', truncated: true };
  }

  if (isTextLike(file)) {
    const truncated = file.size > MAX_TEXT_ATTACHMENT_BYTES;
    const slice = truncated ? file.slice(0, MAX_TEXT_ATTACHMENT_BYTES) : file;
    return {
      ...base,
      kind: 'text',
      content: await slice.text(),
      truncated,
    };
  }

  return base;
}

async function addAttachmentFiles(files: FileList | null): Promise<void> {
  if (!files || files.length === 0) return;
  const additions = await Promise.all(Array.from(files).map(fileToAttachment));
  selectedAttachments = [...selectedAttachments, ...additions];
}

function renderAttachmentDrafts(): string {
  if (selectedAttachments.length === 0) return '';
  return `
    <div class="attachment-drafts">
      ${selectedAttachments.map(a => `
        <div class="attachment-chip">
          <span class="attachment-chip-name">${escHtml(a.name)}</span>
          <span class="attachment-chip-meta">${escHtml(a.kind)} · ${formatFileSize(a.size)}</span>
          <button class="attachment-remove" data-remove-attachment="${a.id}" title="Remove attachment">&#10005;</button>
        </div>
      `).join('')}
    </div>
  `;
}

function renderMessageAttachments(attachments: MessageAttachment[]): string {
  if (attachments.length === 0) return '';
  return `
    <div class="msg-attachments">
      ${attachments.map(a => `
        <div class="msg-attachment">
          ${a.kind === 'image' && a.data_url ? `<img src="${escHtml(a.data_url)}" alt="${escHtml(a.name)}">` : ''}
          <div class="msg-attachment-name">${escHtml(a.name)}</div>
          <div class="msg-attachment-meta">${escHtml(a.mime)} · ${formatFileSize(a.size)}${a.truncated ? ' · truncated' : ''}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function buildTextWithAttachments(text: string, attachments: MessageAttachment[]): string {
  const parts: string[] = [];
  if (text.trim()) parts.push(text.trim());

  const attachmentTexts = attachments.map(a => {
    if (a.kind === 'text' && a.content) {
      return [
        `File: ${a.name}`,
        `Type: ${a.mime || 'text/plain'}`,
        a.truncated ? 'Note: content was truncated.' : '',
        'Content:',
        a.content,
      ].filter(Boolean).join('\n');
    }
    return `File: ${a.name}\nType: ${a.mime}\nSize: ${formatFileSize(a.size)}${a.truncated ? '\nNote: file was too large to embed.' : ''}`;
  });

  if (attachmentTexts.length > 0) {
    parts.push(`Attachments:\n\n${attachmentTexts.join('\n\n---\n\n')}`);
  }
  return parts.join('\n\n');
}

function buildApiContent(text: string, attachments: MessageAttachment[]): ApiMessageContent {
  const imageAttachments = attachments.filter(a => a.kind === 'image' && a.data_url);
  const textPart = buildTextWithAttachments(text, attachments);
  if (imageAttachments.length === 0) return textPart;

  return [
    { type: 'text', text: textPart || 'Please review the attached file(s).' },
    ...imageAttachments.map(a => ({ type: 'image_url' as const, image_url: { url: a.data_url! } })),
  ];
}

function titleFromContent(text: string, attachments: MessageAttachment[]): string {
  const source = text.trim() || attachments[0]?.name || t('chat.new');
  const cleaned = source
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#*_`>\[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > 28 ? `${cleaned.slice(0, 28)}...` : cleaned;
}

function isDefaultConversationTitle(title: string): boolean {
  const normalized = title.trim().toLowerCase();
  return normalized === '' || normalized === 'new conversation' || title.trim() === '新对话';
}

// ── Conversation list ──

export function renderConversationList(): string {
  const convs = state.conversations;
  if (convs.length === 0) {
    return `<div class="placeholder-content" style="height:100%">${t('chat.noConversations')}</div>`;
  }
  return convs.map(c => {
    const isActive = c.id === state.currentConversationId;
    const model = state.models.find(m => m.id === c.model_id);
    const modelName = model?.display_name ?? model?.model_name ?? '';
    return `
      <div class="chat-item ${isActive ? 'active' : ''}" data-conv-id="${c.id}">
        <div class="chat-item-content">
          <div class="chat-item-title">${escHtml(c.title)}</div>
          <div class="chat-item-meta">
            ${modelName ? `<span class="chat-item-model">${escHtml(modelName)}</span>` : ''}
            <span>${relativeTime(c.updated_at)}</span>
          </div>
        </div>
        <button class="chat-item-delete" data-delete-conv="${c.id}" title="${t('common.delete')}">&#10005;</button>
      </div>
    `;
  }).join('');
}

// ── Message rendering ──

export function renderChatMessages(): string {
  if (!state.currentConversationId) {
    return `
      <div class="chat-welcome">
        <div class="welcome-orb" aria-hidden="true"><span></span></div>
        <h1>${t('chat.selectOrCreate')}</h1>
        <p>${t('chat.noConversations')}</p>
      </div>
    `;
  }
  if (state.messages.length === 0) {
    return `
      <div class="chat-welcome compact">
        <div class="welcome-orb" aria-hidden="true"><span></span></div>
        <h1>${t('chat.sendToBegin')}</h1>
      </div>
    `;
  }
  return state.messages.map(m => renderMessage(m)).join('');
}

function renderMessage(msg: Message): string {
  const role = msg.role;
  const content = parseContent(msg.content_json);
  const attachments = parseAttachments(msg.attachments_json);
  const isUser = role === 'user';

  let bubbleInner = '';
  if (msg.reasoning_content) {
    bubbleInner += `
      <div class="msg-thinking" data-toggle-thinking>
        <div class="msg-thinking-label">Thinking</div>
        <div class="msg-thinking-body">${renderMarkdown(msg.reasoning_content)}</div>
      </div>`;
  }
  bubbleInner += `<div class="msg-content">${renderMarkdown(content)}</div>`;
  bubbleInner += renderMessageAttachments(attachments);
  bubbleInner += renderMessageSearchMetadata(msg, isUser);

  let statusHtml = '';
  if (msg.status === 'streaming') {
    statusHtml = '<span class="msg-metric"><span class="spinner" style="display:inline-block"></span></span>';
  } else if (msg.status === 'cancelled') {
    statusHtml = `<span style="color:var(--warning);font-size:var(--fs-secondary)">${t('chat.cancelled')}</span>`;
  } else if (msg.status === 'failed') {
    statusHtml = `<span style="color:var(--danger);font-size:var(--fs-secondary)">${t('chat.failed')}</span>`;
  }

  return `
    <div class="msg ${role}" data-msg-id="${msg.id}">
      <div class="msg-bubble">${bubbleInner}</div>
      <div class="msg-meta">
        ${!isUser && msg.model_name ? `<span class="msg-metric">${escHtml(msg.model_name)}</span>` : ''}
        ${statusHtml}
        <button class="msg-copy-btn" data-copy-msg-id="${escHtml(msg.id)}" title="Copy message">Copy</button>
      </div>
    </div>
  `;
}

function renderMessageSearchMetadata(msg: Message, isUser: boolean): string {
  const metadata = parseSearchMetadata(msg.search_metadata_json);
  if (!metadata) return '';
  if (metadata.error) {
    if (!isUser) return '';
    const brief = metadata.error.length > 140 ? `${metadata.error.slice(0, 139)}…` : metadata.error;
    return `<div class="message-search-state is-error" title="${escHtml(brief)}"><span aria-hidden="true">!</span> ${t('chat.searchFailed')}</div>`;
  }
  if (metadata.results.length === 0) {
    return isUser ? `<div class="message-search-state is-empty">${t('chat.noResults')}</div>` : '';
  }
  if (isUser) {
    return `<div class="message-search-state is-success"><span class="search-pulse-dot"></span>${t('chat.retrievedResults')} ${metadata.results.length}</div>`;
  }
  const sources = metadata.results
    .filter(result => isSafeSourceUrl(result.url))
    .map((result, index) => `
      <li class="message-source-item">
        <span class="message-source-index">${index + 1}</span>
        <div class="message-source-copy">
          <button class="message-source-title" type="button" data-open-source-url="${escHtml(result.url)}">${escHtml(result.title)}</button>
          <div class="message-source-meta">
            <span>${escHtml(result.source || sourceHost(result.url))}</span>
            <span class="message-source-url">${escHtml(result.url)}</span>
            ${result.publishedAt ? `<span>${escHtml(result.publishedAt)}</span>` : ''}
          </div>
        </div>
        <button class="message-source-open" type="button" data-open-source-url="${escHtml(result.url)}" aria-label="用系统浏览器打开来源">↗</button>
      </li>`)
    .join('');
  if (!sources) return '';
  return `
    <details class="message-sources">
      <summary><span>来源</span><span class="glass-chip">${metadata.results.length}</span></summary>
      <ol>${sources}</ol>
    </details>`;
}

function sourceHost(value: string): string {
  try {
    return new URL(value).hostname;
  } catch {
    return t('chat.webSource');
  }
}

function getMessageCopyText(msg: Message): string {
  const parts = [parseContent(msg.content_json)];
  const attachments = parseAttachments(msg.attachments_json);
  if (attachments.length > 0) {
    parts.push(`Attachments:\n${attachments.map(a => `- ${a.name} (${a.mime}, ${formatFileSize(a.size)})`).join('\n')}`);
  }
  return parts.filter(Boolean).join('\n\n');
}

async function copyText(text: string): Promise<void> {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {}

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

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

// ── Chat input ──

export function renderChatInput(): string {
  const streaming = state.isStreaming;
  const searchFeatureEnabled = getSearchConfigSnapshot().config.enabled;
  const searchEnabled = isChatWebSearchEnabled();
  const searchStatus = webSearchPhase !== 'idle' && webSearchStatusText
    ? `<span class="web-search-live-status is-${webSearchPhase}" aria-live="polite">${webSearchPhase === 'searching' ? '<span class="spinner"></span>' : ''}${escHtml(webSearchStatusText)}</span>`
    : '';
  return `
    <div class="chat-input-area">
      ${renderAttachmentDrafts()}
      <div class="chat-input-tools">
        <button class="web-search-toggle ${searchEnabled ? 'is-on' : ''}" id="webSearchToggle" type="button" role="switch" aria-checked="${searchEnabled}" ${!searchFeatureEnabled || streaming ? 'disabled' : ''} title="${searchFeatureEnabled ? t('chat.searchToggle') : t('chat.searchToggleDisabled')}">
          <svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="8.5"/><path d="M3.8 12h16.4M12 3.5c2.2 2.3 3.4 5.1 3.4 8.5S14.2 18.2 12 20.5M12 3.5C9.8 5.8 8.6 8.6 8.6 12s1.2 6.2 3.4 8.5"/></svg>
          <span>${t('chat.webSearchBtn')}</span>
        </button>
        ${searchStatus}
      </div>
      <div class="chat-input-wrap">
        <input type="file" id="attachmentInput" multiple class="hidden">
        <button class="attach-btn" id="attachBtn" title="${t('chat.attach')}" aria-label="${t('chat.attach')}">
          <svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m8.5 12.5 6.2-6.2a3.2 3.2 0 1 1 4.5 4.5l-8.1 8.1a5 5 0 0 1-7.1-7.1l8.3-8.3"/><path d="m7.8 15.8 8.1-8.1"/></svg>
        </button>
        <textarea class="chat-input" rows="1" placeholder="${t('chat.typeMessage')}" id="chatInput"></textarea>
        ${streaming
          ? `<button class="send-btn" id="sendBtn" title="${t('chat.stop')}" aria-label="${t('chat.stop')}" style="background:var(--danger)"><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><rect x="7.5" y="7.5" width="9" height="9" rx="2"/></svg></button>`
          : `<button class="send-btn" id="sendBtn" title="${t('chat.send')}" aria-label="${t('chat.send')}"><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m6 12 6-6 6 6M12 7v11"/></svg></button>`
        }
      </div>
    </div>
  `;
}

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
  renderChatArea();
  renderConversationListInDom();
  renderRightPanelInDom();
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
    renderChatArea();
    renderConversationListInDom();
    renderRightPanelInDom();
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

async function deleteConversation(id: string): Promise<void> {
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
  renderChatArea();
  renderConversationListInDom();
  renderRightPanelInDom();
}

async function updateConversationTitleLocal(conversationId: string, title: string): Promise<void> {
  const trimmed = title.trim();
  if (!trimmed) return;
  const conv = state.conversations.find(c => c.id === conversationId);
  if (!conv || conv.title === trimmed) return;
  conv.title = trimmed;
  conv.updated_at = Math.floor(Date.now() / 1000);
  if (!isDev) {
    try {
      await invoke('update_conversation_title', { id: conversationId, title: trimmed });
    } catch (e) {
      console.error('Failed to update conversation title:', e);
    }
  }
  renderChatArea();
  renderConversationListInDom();
}

async function maybeAutoGenerateConversationTitle(conversationId: string): Promise<void> {
  const conv = state.conversations.find(c => c.id === conversationId);
  if (!conv || !isDefaultConversationTitle(conv.title)) return;
  const firstUser = state.messages.find(m => m.conversation_id === conversationId && m.role === 'user');
  if (!firstUser) return;
  const title = titleFromContent(parseContent(firstUser.content_json), parseAttachments(firstUser.attachments_json));
  await updateConversationTitleLocal(conversationId, title);
}

export async function renameCurrentConversation(): Promise<void> {
  if (!state.currentConversationId) return;
  const conv = state.conversations.find(c => c.id === state.currentConversationId);
  if (!conv) return;
  const title = await showGlassPrompt(t('chat.conversationTitle'), conv.title);
  if (title === null) return;
  await updateConversationTitleLocal(conv.id, title);
}

// ── Send & streaming ──

export async function handleSend(): Promise<void> {
  let pendingAssistantMsg: Message | null = null;
  let ownsPreparation = false;
  try {
    if (state.isStreaming) {
      cancelledSendIds.add(activeSendId);
      const streamingMessage = state.messages.find(message => message.status === 'streaming');
      if (streamingMessage) streamingMessage.status = 'cancelled';
      await Promise.allSettled([invoke('cancel_generation'), cancelWebSearch()]);
      state.isStreaming = false;
      setWebSearchPhase('idle');
      resetLiveTokenUsage();
      renderChatArea();
      renderChatInputInDom();
      renderRightPanelInDom();
      return;
    }
    if (sendPreparationInProgress) return;
    sendPreparationInProgress = true;
    ownsPreparation = true;

    const input = document.getElementById('chatInput') as HTMLTextAreaElement | null;
    if (!input) return;
    const text = input.value.trim();
    const attachments = [...selectedAttachments];
    if (!text && attachments.length === 0) return;
    if (!state.currentConversationId) return;
    const conversationId = state.currentConversationId;

    const conv = state.conversations.find(c => c.id === conversationId);
    if (!conv) return;

    if (!conv.model_id && state.models.length > 0) {
      const firstModel = state.models[0];
      conv.model_id = firstModel.id;
      conv.provider_id = firstModel.provider_id;
      try {
        await invoke('update_conversation_model', {
          id: conv.id,
          providerId: firstModel.provider_id,
          modelId: firstModel.id,
        });
      } catch {}
      renderChatArea();
    }

    let model = state.models.find(m => m.id === conv.model_id);
    if (!model && state.models.length > 0) {
      model = state.models[0];
      conv.model_id = model.id;
      conv.provider_id = model.provider_id;
    }
    if (!model) return;

    const provider = state.providers.find(p => p.id === conv.provider_id);
    if (!provider) return;

    input.value = '';
    selectedAttachments = [];
    autoResizeTextarea(input);

    const sendId = ++sendSequence;
    activeSendId = sendId;
    let searchMetadata: MessageSearchMetadata | null = null;
    let augmentedUserText = text;
    const shouldSearch = isChatWebSearchEnabled() && Boolean(text);

    if (shouldSearch) {
      const searchConfig = getSearchConfigSnapshot().config;
      const searchProvider = getSearchProvider(searchConfig.providerId);
      state.isStreaming = true;
      setWebSearchPhase('searching', t('chat.searching'));
      renderChatInputInDom();

      searchMetadata = {
        enabled: true,
        query: text,
        results: [],
        searchedAt: new Date().toISOString(),
        providerId: searchConfig.providerId,
      };

      if (!searchProvider) {
        searchMetadata.error = t('chat.noSearchProvider');
        setWebSearchPhase('error', t('chat.searchUnavailable'));
      } else {
        try {
          const response = await searchProvider.search(text, {
            maxResults: searchConfig.defaultMaxResults,
            freshness: 'any',
            language: searchConfig.defaultLanguage === 'auto' ? getLang() : searchConfig.defaultLanguage,
            region: searchConfig.defaultRegion,
            safeSearch: searchConfig.safeSearch,
          });
          searchMetadata.results = response.results;
          searchMetadata.searchedAt = response.searchedAt;
          searchMetadata.providerId = response.providerId;
          augmentedUserText = buildSearchAugmentedPrompt(text, response.results, { language: getLang() });
          setWebSearchPhase('success', `${t('chat.retrievedResults')} ${response.results.length}`);
        } catch (error) {
          const message = String(error);
          if (cancelledSendIds.has(sendId) || message.includes('SEARCH_CANCELLED')) {
            state.isStreaming = false;
            setWebSearchPhase('idle');
            selectedAttachments = attachments;
            renderChatInputInDom();
            const restoredInput = document.getElementById('chatInput') as HTMLTextAreaElement | null;
            if (restoredInput) {
              restoredInput.value = text;
              autoResizeTextarea(restoredInput);
            }
            cancelledSendIds.delete(sendId);
            return;
          }
          searchMetadata.error = message.length > 300 ? `${message.slice(0, 299)}…` : message;
          setWebSearchPhase('error', t('chat.searchFailed'));
          console.warn('Web Search failed; continuing without search:', searchMetadata.error);
        }
      }
    }

    let savedUserMessage: Message;
    try {
      savedUserMessage = await invoke<Message>('save_user_message', {
        conversationId,
        content: text,
        attachmentsJson: attachments.length > 0 ? JSON.stringify(attachments) : null,
        searchMetadataJson: searchMetadata ? JSON.stringify(searchMetadata) : null,
      });
    } catch (e) {
      state.isStreaming = false;
      setWebSearchPhase('idle');
      renderChatInputInDom();
      await showGlassAlert(t('chat.failedToSave') + String(e));
      return;
    }

    state.messages.push(savedUserMessage);
    await maybeAutoGenerateConversationTitle(conversationId);

    const assistantMsg: Message = {
      id: crypto.randomUUID(),
      conversation_id: conversationId,
      role: 'assistant',
      content_json: '',
      reasoning_content: null,
      provider_name: conv.provider_id ?? null,
      model_name: model.model_name,
      status: 'streaming',
      attachments_json: null,
      search_metadata_json: searchMetadata ? JSON.stringify(searchMetadata) : null,
      created_at: Math.floor(Date.now() / 1000),
    };
    state.messages.push(assistantMsg);
    pendingAssistantMsg = assistantMsg;
    state.isStreaming = true;

    renderChatArea();
    renderConversationListInDom();
    renderChatInputInDom();
    scrollToBottom();

    const messagesForApi: ApiMessage[] = [];
    const globalPrompt = getEffectiveSystemPrompt();
    if (globalPrompt) {
      messagesForApi.push({ role: 'system', content: globalPrompt });
    }
    state.messages
      .filter(m => m.id !== assistantMsg.id)
      .forEach(m => {
        const messageText = m.id === savedUserMessage.id ? augmentedUserText : parseContent(m.content_json);
        messagesForApi.push({
          role: m.role,
          content: buildApiContent(messageText, parseAttachments(m.attachments_json)),
        });
      });

    const capture: StreamCapture = {
      sendId,
      conversationId,
      messagesForApi,
      model,
      usage: null,
      metrics: null,
    };
    updateLiveTokenUsage(capture, '');
    renderRightPanelInDom();

    await setupStreamListeners(assistantMsg.id, capture);

    let apiKey = '';
    if (conv.provider_id) {
      try {
        const key = await invoke<string | null>('get_provider_api_key', { id: conv.provider_id });
        apiKey = key ?? '';
      } catch (e) {
        console.error('Failed to get API key:', e);
      }
    }

    await invoke('send_message', {
      baseUrl: provider.base_url,
      apiKey,
      model: model.model_name,
      messages: messagesForApi,
      temperature: model.temperature,
      maxTokens: model.max_output_tokens ?? undefined,
    });
    cleanupStreamListeners();

    if (cancelledSendIds.has(sendId)) {
      assistantMsg.status = 'cancelled';
    }

    const assistantContent = parseContent(assistantMsg.content_json);
    let savedAssistant: Message | null = null;
    try {
      savedAssistant = await invoke<Message>('save_assistant_message', {
        conversationId,
        content: assistantContent,
        reasoning: assistantMsg.reasoning_content,
        providerId: provider.id,
        providerName: provider.name,
        modelId: model.id,
        modelName: model.model_name,
        status: assistantMsg.status === 'failed' ? 'failed' : assistantMsg.status === 'cancelled' ? 'cancelled' : 'completed',
        searchMetadataJson: searchMetadata ? JSON.stringify(searchMetadata) : null,
      });
      assistantMsg.id = savedAssistant.id;
      assistantMsg.status = savedAssistant.status;
      assistantMsg.created_at = savedAssistant.created_at;
      renderChatArea();
    } catch (e) {
      console.error('Failed to save assistant message:', e);
    }

    const parts = deriveTokenParts(messagesForApi, assistantContent, capture.usage);
    try {
      await invoke('record_generation_run', {
        input: {
          conversation_id: conversationId,
          assistant_message_id: savedAssistant?.id ?? null,
          provider_id: provider.id,
          model_id: model.id,
          status: assistantMsg.status === 'failed' ? 'failed' : assistantMsg.status === 'cancelled' ? 'cancelled' : 'completed',
          uncached_input_tokens: parts.uncachedInput,
          cache_read_input_tokens: parts.cachedInput,
          cache_write_input_tokens: parts.cacheWriteInput,
          output_tokens: parts.output,
          usage_source: parts.source,
          first_event_latency_ms: capture.metrics?.first_event_ms ?? null,
          first_token_latency_ms: capture.metrics?.first_token_ms ?? null,
          duration_ms: capture.metrics?.total_ms ?? null,
        },
      });
      resetLiveTokenUsage();
      await loadTokenUsage(conversationId);
      renderRightPanelInDom();
    } catch (e) {
      console.error('Failed to record token usage:', e);
    }
    cancelledSendIds.delete(sendId);
    setWebSearchPhase('idle');
    renderChatInputInDom();
  } catch (e) {
    state.isStreaming = false;
    if (pendingAssistantMsg) {
      pendingAssistantMsg.status = 'failed';
    }
    resetLiveTokenUsage();
    cleanupStreamListeners();
    renderChatArea();
    renderChatInputInDom();
    renderRightPanelInDom();
    await showGlassAlert(t('chat.sendFailed') + String(e));
  } finally {
    if (ownsPreparation) sendPreparationInProgress = false;
  }
}

window.__handleSend = () => { handleSend(); };

async function setupStreamListeners(assistantMsgId: string, capture: StreamCapture): Promise<void> {
  cleanupStreamListeners();

  const assistantMsg = state.messages.find(m => m.id === assistantMsgId);
  if (!assistantMsg) return;

  streamUnlisten = await listen<StreamChunk>('chat-stream', (event) => {
    const chunk = event.payload;
    if (chunk.reasoning) {
      assistantMsg.reasoning_content = chunk.reasoning;
    }
    if (chunk.content) {
      assistantMsg.content_json = JSON.stringify(chunk.content);
    }
    if (chunk.usage) {
      capture.usage = chunk.usage;
    }
    updateLiveTokenUsage(capture, parseContent(assistantMsg.content_json));
    renderRightPanelInDom();
    if (chunk.done) {
      assistantMsg.status = cancelledSendIds.has(capture.sendId) ? 'cancelled' : 'completed';
      state.isStreaming = false;
      renderChatInputInDom();
    }
    updateStreamingMessage(assistantMsg);
  });

  metricsUnlisten = await listen<StreamChunk>('chat-metrics', (event) => {
    capture.metrics = (event as any).payload;
  });
}

function cleanupStreamListeners(): void {
  if (streamUnlisten) { streamUnlisten(); streamUnlisten = null; }
  if (metricsUnlisten) { metricsUnlisten(); metricsUnlisten = null; }
}

function updateStreamingMessage(msg: Message): void {
  const el = document.querySelector(`[data-msg-id="${msg.id}"]`);
  if (!el) return;

  const contentEl = el.querySelector('.msg-content');
  if (contentEl) {
    contentEl.innerHTML = renderMarkdown(parseContent(msg.content_json));
  }

  const thinkingEl = el.querySelector('.msg-thinking-body') as HTMLElement | null;
  if (msg.reasoning_content && thinkingEl) {
    thinkingEl.innerHTML = renderMarkdown(msg.reasoning_content);
  } else if (msg.reasoning_content && !thinkingEl) {
    const bubble = el.querySelector('.msg-bubble');
    if (bubble) {
      const thinkingDiv = document.createElement('div');
      thinkingDiv.className = 'msg-thinking';
      thinkingDiv.innerHTML = `
        <div class="msg-thinking-label">Thinking</div>
        <div class="msg-thinking-body">${renderMarkdown(msg.reasoning_content)}</div>
      `;
      bubble.insertBefore(thinkingDiv, bubble.firstChild);
    }
  }

  const metaEl = el.querySelector('.msg-meta');
  if (metaEl && !state.isStreaming) {
    const spinner = metaEl.querySelector('.spinner');
    if (spinner) spinner.remove();
    if (msg.status === 'cancelled') {
      metaEl.innerHTML += '<span style="color:var(--warning);font-size:var(--fs-secondary)">Cancelled</span>';
    }
  }

  scrollToBottom();
}

function scrollToBottom(): void {
  const container = document.getElementById('chatMessages');
  if (container) {
    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
  }
}

function autoResizeTextarea(textarea: HTMLTextAreaElement): void {
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
}

// ── DOM updaters ──

export function renderChatArea(): void {
  const messagesEl = document.getElementById('chatMessages');
  if (messagesEl) {
    messagesEl.innerHTML = renderChatMessages();
    bindMessageEvents();
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

export function renderConversationListInDom(): void {
  const listEl = document.getElementById('chatList');
  if (listEl) {
    listEl.innerHTML = renderConversationList();
    bindConversationListEvents();
  }
}

export function renderChatInputInDom(): void {
  const inputArea = document.querySelector('.chat-input-area');
  if (inputArea) {
    const parent = inputArea.parentElement;
    if (parent) {
      inputArea.outerHTML = renderChatInput();
      bindChatInputEvents();
    }
  }
}

function rerenderChatInputPreservingDraft(): void {
  const currentInput = document.getElementById('chatInput') as HTMLTextAreaElement | null;
  const draft = currentInput?.value ?? '';
  renderChatInputInDom();
  const nextInput = document.getElementById('chatInput') as HTMLTextAreaElement | null;
  if (nextInput) {
    nextInput.value = draft;
    autoResizeTextarea(nextInput);
    nextInput.focus();
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

export function bindConversationListEvents(): void {
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

export function bindChatInputEvents(): void {
  const input = document.getElementById('chatInput') as HTMLTextAreaElement | null;
  if (input) {
    input.addEventListener('keydown', (e) => {
      const sendKey = localStorage.getItem('tc-send-key') || 'enter';
      const isSend = sendKey === 'enter' ? (e.key === 'Enter' && !e.shiftKey) : (e.key === 'Enter' && e.shiftKey);
      const isNewline = sendKey === 'enter' ? (e.key === 'Enter' && e.shiftKey) : (e.key === 'Enter' && !e.shiftKey);
      if (isSend) {
        e.preventDefault();
        handleSend();
      } else if (isNewline) {
        // Allow default newline behavior
      }
    });
    input.addEventListener('input', () => autoResizeTextarea(input));
    input.addEventListener('paste', async (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const imageFiles: File[] = [];
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }
      if (imageFiles.length > 0) {
        e.preventDefault();
        const dt = new DataTransfer();
        imageFiles.forEach(f => dt.items.add(f));
        await addAttachmentFiles(dt.files);
        rerenderChatInputPreservingDraft();
      }
    });
    input.focus();
  }

  const isTauri = !!(window as any).__TAURI_INTERNALS__;
  if (isTauri) {
    getCurrentWindow().onDragDropEvent(async (event) => {
      const chatCenter = document.querySelector('.chat-center');
      if (!chatCenter) return;
      if (event.payload.type === 'over') {
        chatCenter.classList.add('drag-over');
      } else if (event.payload.type === 'drop') {
        chatCenter.classList.remove('drag-over');
        const paths = event.payload.paths;
        if (paths.length > 0) {
          try {
            const files: File[] = [];
            for (const path of paths) {
              const binary: number[] = await invoke('read_file_bytes', { path });
              const name = path.split(/[/\\]/).pop() ?? 'file';
              const ext = name.split('.').pop()?.toLowerCase() ?? '';
              const mimeMap: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' };
              const mime = mimeMap[ext] ?? 'application/octet-stream';
              const blob = new Blob([new Uint8Array(binary)], { type: mime });
              files.push(new File([blob], name, { type: mime }));
            }
            if (files.length > 0) {
              const dt = new DataTransfer();
              files.forEach(f => dt.items.add(f));
              await addAttachmentFiles(dt.files);
              rerenderChatInputPreservingDraft();
            }
          } catch (e) {
            console.error('Failed to read dropped files:', e);
          }
        }
      } else if (event.payload.type === 'leave') {
        chatCenter.classList.remove('drag-over');
      }
    });
  }

  const sendBtn = document.getElementById('sendBtn');
  if (sendBtn) {
    sendBtn.addEventListener('click', () => handleSend());
  }

  const webSearchToggle = document.getElementById('webSearchToggle') as HTMLButtonElement | null;
  webSearchToggle?.addEventListener('click', () => {
    if (webSearchToggle.disabled || state.isStreaming) return;
    const next = webSearchToggle.getAttribute('aria-checked') !== 'true';
    localStorage.setItem('tc-chat-web-search-enabled', String(next));
    rerenderChatInputPreservingDraft();
  });

  const attachBtn = document.getElementById('attachBtn');
  const attachmentInput = document.getElementById('attachmentInput') as HTMLInputElement | null;
  if (attachBtn && attachmentInput) {
    attachBtn.addEventListener('click', () => attachmentInput.click());
    attachmentInput.addEventListener('change', async () => {
      await addAttachmentFiles(attachmentInput.files);
      attachmentInput.value = '';
      rerenderChatInputPreservingDraft();
    });
  }

  document.querySelectorAll<HTMLElement>('[data-remove-attachment]').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.removeAttachment;
      selectedAttachments = selectedAttachments.filter(a => a.id !== id);
      rerenderChatInputPreservingDraft();
    });
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
