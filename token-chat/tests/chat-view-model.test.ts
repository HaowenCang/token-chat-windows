import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getConversationListItems, getMessageSearchView } from '../src/chat-view-model';
import { state, type Conversation, type Message, type Model } from '../src/state';

function conversation(overrides: Partial<Conversation>): Conversation {
  return {
    id: 'conversation-1',
    title: 'Architecture review',
    provider_id: 'provider-1',
    model_id: 'model-1',
    pinned_at: null,
    archived_at: null,
    updated_at: 0,
    ...overrides,
  };
}

function model(overrides: Partial<Model>): Model {
  return {
    id: 'model-1',
    provider_id: 'provider-1',
    model_name: 'gpt-test',
    display_name: 'GPT Test',
    temperature: 1,
    context_window: 128000,
    uncached_input_nanos_per_million: 0,
    cache_read_nanos_per_million: 0,
    output_nanos_per_million: 0,
    currency: 'USD',
    ...overrides,
  };
}

function message(searchMetadata: unknown): Message {
  return {
    id: 'message-1',
    conversation_id: 'conversation-1',
    role: 'assistant',
    content_json: JSON.stringify('answer'),
    reasoning_content: null,
    provider_name: null,
    model_name: null,
    status: 'completed',
    attachments_json: null,
    search_metadata_json: typeof searchMetadata === 'string'
      ? searchMetadata
      : JSON.stringify(searchMetadata),
    created_at: 0,
  };
}

describe('chat view model', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-27T12:00:00.000Z'));
    state.conversations = [];
    state.models = [];
    state.currentConversationId = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('projects conversation identity, model labels, activity, and relative time', () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    state.models = [model({})];
    state.conversations = [
      conversation({ id: 'active', updated_at: nowSeconds - 90 }),
      conversation({ id: 'unmatched', model_id: 'missing', updated_at: nowSeconds - 7200 }),
    ];
    state.currentConversationId = 'active';

    expect(getConversationListItems()).toEqual([
      {
        id: 'active',
        title: 'Architecture review',
        modelName: 'GPT Test',
        relativeUpdatedAt: '1m ago',
        isActive: true,
      },
      {
        id: 'unmatched',
        title: 'Architecture review',
        modelName: '',
        relativeUpdatedAt: '2h ago',
        isActive: false,
      },
    ]);
  });

  it('projects safe search sources and derives a missing source from its host', () => {
    const view = getMessageSearchView(message({
      enabled: true,
      query: 'architecture',
      results: [
        {
          title: 'Architecture guide',
          url: 'https://docs.example.com/guide',
          snippet: 'Evidence',
          retrievedAt: '2026-06-27T00:00:00.000Z',
        },
        {
          title: 'Unsafe source',
          url: 'javascript:alert(1)',
          snippet: 'Ignore',
          retrievedAt: '',
        },
      ],
      searchedAt: '2026-06-27T00:00:00.000Z',
      providerId: 'http-json',
      error: 'partial',
    }));

    expect(view).toEqual({
      error: 'partial',
      resultCount: 1,
      sources: [{
        index: 1,
        title: 'Architecture guide',
        url: 'https://docs.example.com/guide',
        source: 'docs.example.com',
        publishedAt: null,
      }],
    });
  });

  it('returns null for malformed or disabled search metadata', () => {
    expect(getMessageSearchView(message('{broken'))).toBeNull();
    expect(getMessageSearchView(message({ enabled: false, query: 'x', results: [] }))).toBeNull();
  });
});
