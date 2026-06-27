import { describe, expect, it } from 'vitest';
import type { Message, Model } from '../src/state';
import {
  buildMessagesForApi,
  createStreamingAssistantMessage,
  markStreamingMessageCancelled,
  persistedAssistantStatus,
} from '../src/chat-run-model';

const model: Model = {
  id: 'm1',
  provider_id: 'p1',
  model_name: 'gpt-test',
  display_name: 'GPT Test',
  temperature: 0.7,
  context_window: 128000,
  uncached_input_nanos_per_million: 100,
  cache_read_nanos_per_million: 10,
  output_nanos_per_million: 200,
  currency: 'USD',
};

function message(overrides: Partial<Message>): Message {
  return {
    id: 'msg',
    conversation_id: 'conv',
    role: 'user',
    content_json: JSON.stringify('hello'),
    reasoning_content: null,
    provider_name: null,
    model_name: null,
    status: 'completed',
    attachments_json: null,
    created_at: 1,
    ...overrides,
  };
}

describe('chat run model', () => {
  it('maps transient assistant statuses to persisted run statuses', () => {
    expect(persistedAssistantStatus('streaming')).toBe('completed');
    expect(persistedAssistantStatus('completed')).toBe('completed');
    expect(persistedAssistantStatus('cancelled')).toBe('cancelled');
    expect(persistedAssistantStatus('failed')).toBe('failed');
  });

  it('marks the active streaming message as cancelled', () => {
    const messages = [
      message({ id: 'done', status: 'completed' }),
      message({ id: 'active', role: 'assistant', status: 'streaming' }),
    ];

    const cancelled = markStreamingMessageCancelled(messages);

    expect(cancelled?.id).toBe('active');
    expect(messages[1].status).toBe('cancelled');
  });

  it('creates a streaming assistant message with run metadata', () => {
    const assistant = createStreamingAssistantMessage({
      id: 'assistant-1',
      conversationId: 'conv-1',
      providerId: 'provider-1',
      model,
      searchMetadataJson: '{"enabled":true}',
      createdAt: 123,
    });

    expect(assistant).toMatchObject({
      id: 'assistant-1',
      conversation_id: 'conv-1',
      role: 'assistant',
      provider_name: 'provider-1',
      model_name: 'gpt-test',
      status: 'streaming',
      search_metadata_json: '{"enabled":true}',
      created_at: 123,
    });
  });

  it('builds API messages with global prompt and search-augmented draft', () => {
    const user = message({ id: 'user-1', content_json: JSON.stringify('plain user text') });
    const previousAssistant = message({
      id: 'assistant-old',
      role: 'assistant',
      content_json: JSON.stringify('previous answer'),
    });
    const streamingAssistant = message({
      id: 'assistant-new',
      role: 'assistant',
      status: 'streaming',
      content_json: '',
    });

    const apiMessages = buildMessagesForApi({
      messages: [user, previousAssistant, streamingAssistant],
      assistantMessageId: 'assistant-new',
      savedUserMessageId: 'user-1',
      augmentedUserText: 'augmented user text',
      globalPrompt: 'system prompt',
    });

    expect(apiMessages).toEqual([
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'augmented user text' },
      { role: 'assistant', content: 'previous answer' },
    ]);
  });
});
