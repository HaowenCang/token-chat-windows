/** @jsxImportSource preact */
import { signal } from '@preact/signals';
import { state, parseContent, type Message } from '../state';
import { renderMarkdown } from '../rendering/markdown-renderer';

// ── Signals synced from the mutable state singleton ──

export const messages = signal<Message[]>([]);
export const currentConversationId = signal<string | null>(null);

// ── Markdown cache: content_json → rendered HTML ──
const markdownCache = new Map<string, string>();
const REASONING_CACHE = new Map<string, string>();

export function getCachedMarkdown(contentJson: string): string {
  let html = markdownCache.get(contentJson);
  if (html === undefined) {
    html = renderMarkdown(parseContent(contentJson));
    markdownCache.set(contentJson, html);
  }
  return html;
}

export function getCachedReasoningMarkdown(reasoning: string): string {
  let html = REASONING_CACHE.get(reasoning);
  if (html === undefined) {
    html = renderMarkdown(reasoning);
    REASONING_CACHE.set(reasoning, html);
  }
  return html;
}

// ── Sync with dirty check to avoid unnecessary re-renders ──

let lastSyncKey = '';

export function syncMessages(): void {
  // Build a fingerprint: conversation ID + message count + last message content
  const msgs = state.messages;
  const lastMsg = msgs[msgs.length - 1];
  const syncKey = `${state.currentConversationId}:${msgs.length}:${lastMsg?.id}:${lastMsg?.status}:${lastMsg?.content_json?.length ?? 0}`;

  if (syncKey !== lastSyncKey) {
    lastSyncKey = syncKey;
    messages.value = [...msgs];
  }
  currentConversationId.value = state.currentConversationId;
}
