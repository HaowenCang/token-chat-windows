import { invoke } from '@tauri-apps/api/core';
import type { Conversation, Message } from '../state';
import type { ApiMessage, ConversationTokenUsage } from '../chat-token';

export function listConversations(): Promise<Conversation[]> {
  return invoke<Conversation[]>('list_conversations');
}

export function createConversation(input: {
  title?: string;
  providerId?: string | null;
  modelId?: string | null;
}): Promise<Conversation> {
  return invoke<Conversation>('create_conversation', {
    input: {
      title: input.title,
      provider_id: input.providerId ?? null,
      model_id: input.modelId ?? null,
    },
  });
}

export function deleteConversation(id: string): Promise<void> {
  return invoke('delete_conversation', { id });
}

export function updateConversationTitle(id: string, title: string): Promise<void> {
  return invoke('update_conversation_title', { id, title });
}

export function updateConversationModel(id: string, providerId: string, modelId: string): Promise<void> {
  return invoke('update_conversation_model', { id, providerId, modelId });
}

export function listMessages(conversationId: string): Promise<Message[]> {
  return invoke<Message[]>('list_messages', { conversationId });
}

export function saveUserMessage(input: {
  conversationId: string;
  content: string;
  attachmentsJson: string | null;
  searchMetadataJson: string | null;
}): Promise<Message> {
  return invoke<Message>('save_user_message', input);
}

export function saveAssistantMessage(input: {
  conversationId: string;
  content: string;
  reasoning: string | null;
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
  status: string;
  searchMetadataJson: string | null;
}): Promise<Message> {
  return invoke<Message>('save_assistant_message', input);
}

export function getProviderApiKey(id: string): Promise<string | null> {
  return invoke<string | null>('get_provider_api_key', { id });
}

export function cancelGeneration(): Promise<void> {
  return invoke('cancel_generation');
}

export function sendMessage(input: {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: ApiMessage[];
  temperature?: number | null;
  maxTokens?: number | null;
}): Promise<void> {
  return invoke('send_message', {
    baseUrl: input.baseUrl,
    apiKey: input.apiKey,
    model: input.model,
    messages: input.messages,
    temperature: input.temperature ?? undefined,
    maxTokens: input.maxTokens ?? undefined,
  });
}

export function recordGenerationRun(input: {
  conversationId: string;
  assistantMessageId: string | null;
  providerId: string | null;
  modelId: string | null;
  status: string;
  uncachedInputTokens: number;
  cacheReadInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
  usageSource: 'provider_reported' | 'estimated';
  firstEventLatencyMs: number | null;
  firstTokenLatencyMs: number | null;
  durationMs: number | null;
}): Promise<void> {
  return invoke('record_generation_run', {
    input: {
      conversation_id: input.conversationId,
      assistant_message_id: input.assistantMessageId,
      provider_id: input.providerId,
      model_id: input.modelId,
      status: input.status,
      uncached_input_tokens: input.uncachedInputTokens,
      cache_read_input_tokens: input.cacheReadInputTokens,
      cache_write_input_tokens: input.cacheWriteInputTokens,
      output_tokens: input.outputTokens,
      usage_source: input.usageSource,
      first_event_latency_ms: input.firstEventLatencyMs,
      first_token_latency_ms: input.firstTokenLatencyMs,
      duration_ms: input.durationMs,
    },
  });
}

export function loadConversationTokenUsage(conversationId: string): Promise<ConversationTokenUsage> {
  return invoke<ConversationTokenUsage>('get_conversation_token_usage', { conversationId });
}

export function readFileBytes(path: string): Promise<number[]> {
  return invoke<number[]>('read_file_bytes', { path });
}
