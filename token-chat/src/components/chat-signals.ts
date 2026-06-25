/** @jsxImportSource preact */
import { signal, computed } from '@preact/signals';
import { state, type Message } from '../state';

// ── Signals synced from the mutable state singleton ──
// Call syncMessages() after any mutation to state.messages

export const messages = signal<Message[]>([]);
export const isStreaming = signal(false);
export const currentConversationId = signal<string | null>(null);

export function syncMessages(): void {
  messages.value = [...state.messages];
  isStreaming.value = state.isStreaming;
  currentConversationId.value = state.currentConversationId;
}
