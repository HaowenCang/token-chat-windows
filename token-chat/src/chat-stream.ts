import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { state, parseContent, type Message } from './state';
import { type StreamChunk, type StreamCapture, updateLiveTokenUsage } from './chat-token';
import { renderMarkdown } from './chat-markdown';

let streamUnlisten: UnlistenFn | null = null;
let metricsUnlisten: UnlistenFn | null = null;

export async function setupStreamListeners(
  assistantMsgId: string,
  capture: StreamCapture,
  cancelledSendIds: Set<number>,
  onDone: () => void,
  renderRightPanelInDom: () => void,
): Promise<void> {
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
      onDone();
    }
    updateStreamingMessage(assistantMsg);
  });

  metricsUnlisten = await listen<StreamChunk>('chat-metrics', (event) => {
    capture.metrics = (event as any).payload;
  });
}

export function cleanupStreamListeners(): void {
  if (streamUnlisten) { streamUnlisten(); streamUnlisten = null; }
  if (metricsUnlisten) { metricsUnlisten(); metricsUnlisten = null; }
}

export function updateStreamingMessage(msg: Message): void {
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

export function scrollToBottom(): void {
  const container = document.getElementById('chatMessages');
  if (container) {
    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
  }
}
