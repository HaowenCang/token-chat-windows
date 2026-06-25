import { state, parseContent, type Conversation, type Message } from './state';
import { t } from './i18n';
import { renderMarkdown } from './chat-markdown';
import { relativeTime, renderRightPanelContent } from './chat-token';
import {
  escHtml,
  formatFileSize,
  parseAttachments,
  renderAttachmentDrafts,
  renderMessageAttachments,
} from './chat-attachment';
import {
  isSafeSourceUrl,
  parseSearchMetadata,
} from './web-search';

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

export function getMessageCopyText(msg: Message): string {
  const parts = [parseContent(msg.content_json)];
  const attachments = parseAttachments(msg.attachments_json);
  if (attachments.length > 0) {
    parts.push(`Attachments:\n${attachments.map(a => `- ${a.name} (${a.mime}, ${formatFileSize(a.size)})`).join('\n')}`);
  }
  return parts.filter(Boolean).join('\n\n');
}

export async function copyText(text: string): Promise<void> {
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

// ── Chat input HTML ──

export function renderChatInput(opts?: { isStreaming?: boolean; searchFeatureEnabled?: boolean; searchEnabled?: boolean; searchPhase?: string; searchStatusText?: string }): string {
  const streaming = opts?.isStreaming ?? false;
  const searchFeatureEnabled = opts?.searchFeatureEnabled ?? false;
  const searchEnabled = opts?.searchEnabled ?? false;
  const searchPhase = opts?.searchPhase ?? 'idle';
  const searchStatusText = opts?.searchStatusText ?? '';
  const searchStatus = searchPhase !== 'idle' && searchStatusText
    ? `<span class="web-search-live-status is-${searchPhase}" aria-live="polite">${searchPhase === 'searching' ? '<span class="spinner"></span>' : ''}${escHtml(searchStatusText)}</span>`
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

// ── Utilities ──

export function scrollToBottom(): void {
  const container = document.getElementById('chatMessages');
  if (container) {
    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
  }
}

export function autoResizeTextarea(textarea: HTMLTextAreaElement): void {
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
}
