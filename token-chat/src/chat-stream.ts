import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { state, parseContent } from './state';
import { type StreamChunk, type StreamCapture, updateLiveTokenUsage } from './chat-token';
import { patchStreamingMessage } from './components/MessageList';

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
    patchStreamingMessage(assistantMsg);
  });

  metricsUnlisten = await listen<StreamChunk>('chat-metrics', (event) => {
    capture.metrics = (event as any).payload;
  });
}

function cleanupStreamListeners(): void {
  if (streamUnlisten) { streamUnlisten(); streamUnlisten = null; }
  if (metricsUnlisten) { metricsUnlisten(); metricsUnlisten = null; }
}
