import { parseContent, type Message, type Model } from './state';
import { buildApiContent, parseAttachments } from './chat-attachment';
import type { ApiMessage } from './chat-token';

export type PersistedAssistantStatus = 'completed' | 'cancelled' | 'failed';

export interface StreamingAssistantMessageInput {
  id: string;
  conversationId: string;
  providerId: string | null;
  model: Model;
  searchMetadataJson: string | null;
  createdAt: number;
}

export interface MessagesForApiInput {
  messages: Message[];
  assistantMessageId: string;
  savedUserMessageId: string;
  augmentedUserText: string;
  globalPrompt: string;
}

export function persistedAssistantStatus(status: string): PersistedAssistantStatus {
  if (status === 'failed') return 'failed';
  if (status === 'cancelled') return 'cancelled';
  return 'completed';
}

export function markStreamingMessageCancelled(messages: Message[]): Message | null {
  const streamingMessage = messages.find(message => message.status === 'streaming');
  if (!streamingMessage) return null;
  streamingMessage.status = 'cancelled';
  return streamingMessage;
}

export function createStreamingAssistantMessage(input: StreamingAssistantMessageInput): Message {
  return {
    id: input.id,
    conversation_id: input.conversationId,
    role: 'assistant',
    content_json: '',
    reasoning_content: null,
    provider_name: input.providerId,
    model_name: input.model.model_name,
    status: 'streaming',
    attachments_json: null,
    search_metadata_json: input.searchMetadataJson,
    created_at: input.createdAt,
  };
}

export function buildMessagesForApi(input: MessagesForApiInput): ApiMessage[] {
  const messagesForApi: ApiMessage[] = [];
  if (input.globalPrompt) {
    messagesForApi.push({ role: 'system', content: input.globalPrompt });
  }
  input.messages
    .filter(message => message.id !== input.assistantMessageId)
    .forEach(message => {
      const messageText = message.id === input.savedUserMessageId
        ? input.augmentedUserText
        : parseContent(message.content_json);
      messagesForApi.push({
        role: message.role,
        content: buildApiContent(messageText, parseAttachments(message.attachments_json)),
      });
    });
  return messagesForApi;
}
