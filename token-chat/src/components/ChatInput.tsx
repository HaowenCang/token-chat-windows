/** @jsxImportSource preact */
import { render } from 'preact';
import { useState, useRef, useEffect, useCallback } from 'preact/hooks';
import { signal } from '@preact/signals';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { state } from '../state';
import { t } from '../i18n';
import {
  getSelectedAttachments,
  clearSelectedAttachments,
  addAttachmentFiles,
  pushSelectedAttachments,
  escHtml,
  formatFileSize,
  type MessageAttachment,
} from '../chat-attachment';
import { getSearchConfigSnapshot } from '../web-search';
import { isChatWebSearchEnabled, getWebSearchPhase, getWebSearchStatusText } from '../chat-send';
import { readFileBytes } from '../ipc/chat-ipc';
import { isTauriRuntime } from '../platform/runtime';

// ── Signals for reactive UI ──

export const inputDraft = signal('');
export const attachmentsSignal = signal<MessageAttachment[]>([]);
export const streamingSignal = signal(false);
export const searchEnabledSignal = signal(false);
export const searchPhaseSignal = signal('idle');
export const searchStatusSignal = signal('');

export function syncInputSignals(): void {
  attachmentsSignal.value = [...getSelectedAttachments()];
  streamingSignal.value = state.isStreaming;
  searchEnabledSignal.value = isChatWebSearchEnabled();
  searchPhaseSignal.value = getWebSearchPhase();
  searchStatusSignal.value = getWebSearchStatusText();
}

// ── ChatInput component ──

interface ChatInputProps {
  onSend: () => void;
}

function AttachmentDrafts({ onRemove }: { onRemove: (id: string) => void }) {
  if (attachmentsSignal.value.length === 0) return null;
  return (
    <div class="attachment-drafts">
      {attachmentsSignal.value.map(a => (
        <div class="attachment-chip" key={a.id}>
          <span class="attachment-chip-name">{a.name}</span>
          <span class="attachment-chip-meta">{a.kind} · {formatFileSize(a.size)}</span>
          <button class="attachment-remove" onClick={() => onRemove(a.id)} title="Remove attachment">&#10005;</button>
        </div>
      ))}
    </div>
  );
}

function ChatInputInner({ onSend }: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const streaming = streamingSignal.value;
  const searchFeatureEnabled = getSearchConfigSnapshot().config.enabled;
  const searchEnabled = searchEnabledSignal.value;
  const searchPhase = searchPhaseSignal.value;
  const searchStatusText = searchStatusSignal.value;

  // Auto-resize textarea
  const autoResize = useCallback(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
    }
  }, []);

  // Sync draft on mount
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.value = inputDraft.value;
      autoResize();
      textareaRef.current.focus();
    }
  }, []);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const sendKey = localStorage.getItem('tc-send-key') || 'enter';
    const isSend = sendKey === 'enter' ? (e.key === 'Enter' && !e.shiftKey) : (e.key === 'Enter' && e.shiftKey);
    if (isSend) {
      e.preventDefault();
      onSend();
    }
  }, [onSend]);

  const handleInput = useCallback(() => {
    autoResize();
    if (textareaRef.current) {
      inputDraft.value = textareaRef.current.value;
    }
  }, [autoResize]);

  const handlePaste = useCallback(async (e: ClipboardEvent) => {
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
      attachmentsSignal.value = [...getSelectedAttachments()];
    }
  }, []);

  const handleAttachClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(async () => {
    if (fileInputRef.current?.files) {
      await addAttachmentFiles(fileInputRef.current.files);
      attachmentsSignal.value = [...getSelectedAttachments()];
      fileInputRef.current.value = '';
    }
  }, []);

  const handleRemoveAttachment = useCallback((id: string) => {
    const remaining = getSelectedAttachments().filter(a => a.id !== id);
    clearSelectedAttachments();
    pushSelectedAttachments(remaining);
    attachmentsSignal.value = [...remaining];
  }, []);

  const handleSearchToggle = useCallback(() => {
    if (streaming) return;
    const next = !searchEnabled;
    localStorage.setItem('tc-chat-web-search-enabled', String(next));
    searchEnabledSignal.value = next;
    searchPhaseSignal.value = getWebSearchPhase();
    searchStatusSignal.value = getWebSearchStatusText();
  }, [streaming, searchEnabled]);

  const searchStatus = searchPhase !== 'idle' && searchStatusText
    ? <span class={`web-search-live-status is-${searchPhase}`} aria-live="polite">
        {searchPhase === 'searching' && <span class="spinner"></span>}
        {searchStatusText}
      </span>
    : null;

  // Drag & drop
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let unlisten: (() => void) | undefined;
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
              const binary = await readFileBytes(path);
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
              attachmentsSignal.value = [...getSelectedAttachments()];
            }
          } catch (e) {
            console.error('Failed to read dropped files:', e);
          }
        }
      } else if (event.payload.type === 'leave') {
        chatCenter.classList.remove('drag-over');
      }
    }).then(fn => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, []);

  return (
    <div class="chat-input-area">
      <AttachmentDrafts onRemove={handleRemoveAttachment} />
      <div class="chat-input-tools">
        <button
          class={`web-search-toggle ${searchEnabled ? 'is-on' : ''}`}
          type="button"
          role="switch"
          aria-checked={searchEnabled}
          disabled={!searchFeatureEnabled || streaming}
          title={searchFeatureEnabled ? t('chat.searchToggle') : t('chat.searchToggleDisabled')}
          onClick={handleSearchToggle}
        >
          <svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7">
            <circle cx="12" cy="12" r="8.5"/>
            <path d="M3.8 12h16.4M12 3.5c2.2 2.3 3.4 5.1 3.4 8.5S14.2 18.2 12 20.5M12 3.5C9.8 5.8 8.6 8.6 8.6 12s1.2 6.2 3.4 8.5"/>
          </svg>
          <span>{t('chat.webSearchBtn')}</span>
        </button>
        {searchStatus}
      </div>
      <div class="chat-input-wrap">
        <input type="file" ref={fileInputRef} multiple class="hidden" onChange={handleFileChange} />
        <button class="attach-btn" title={t('chat.attach')} aria-label={t('chat.attach')} onClick={handleAttachClick}>
          <svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
            <path d="m8.5 12.5 6.2-6.2a3.2 3.2 0 1 1 4.5 4.5l-8.1 8.1a5 5 0 0 1-7.1-7.1l8.3-8.3"/>
            <path d="m7.8 15.8 8.1-8.1"/>
          </svg>
        </button>
        <textarea
          id="chatInput"
          ref={textareaRef}
          class="chat-input"
          rows={1}
          placeholder={t('chat.typeMessage')}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          onPaste={handlePaste}
        />
        {streaming ? (
          <button class="send-btn" title={t('chat.stop')} aria-label={t('chat.stop')} style={{ background: 'var(--danger)' }} onClick={onSend}>
            <svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
              <rect x="7.5" y="7.5" width="9" height="9" rx="2"/>
            </svg>
          </button>
        ) : (
          <button class="send-btn" title={t('chat.send')} aria-label={t('chat.send')} onClick={onSend}>
            <svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="m6 12 6-6 6 6M12 7v11"/>
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

// ── Mount function ──

export function mountChatInput(container: HTMLElement, onSend: () => void): void {
  syncInputSignals();
  render(<ChatInputInner onSend={onSend} />, container);
}

export function updateChatInput(onSend: () => void): void {
  syncInputSignals();
  const mountEl = document.getElementById('chatInputMount');
  if (mountEl) {
    render(<ChatInputInner onSend={onSend} />, mountEl);
  }
}
