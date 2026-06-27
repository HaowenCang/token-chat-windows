import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '../src/state';

const workflowMocks = vi.hoisted(() => ({
  cancelGeneration: vi.fn(async () => {}),
  cancelWebSearch: vi.fn(async () => {}),
  resetLiveTokenUsage: vi.fn(),
  getSearchConfigSnapshot: vi.fn(() => ({
    config: { enabled: true },
    hasApiKey: false,
  })),
}));

vi.mock('../src/ipc/chat-ipc', () => ({
  cancelGeneration: workflowMocks.cancelGeneration,
  getProviderApiKey: vi.fn(),
  recordGenerationRun: vi.fn(),
  saveAssistantMessage: vi.fn(),
  saveUserMessage: vi.fn(),
  sendMessage: vi.fn(),
  updateConversationModel: vi.fn(),
}));

vi.mock('../src/web-search', () => ({
  buildSearchAugmentedPrompt: vi.fn((text: string) => text),
  cancelWebSearch: workflowMocks.cancelWebSearch,
  getSearchConfigSnapshot: workflowMocks.getSearchConfigSnapshot,
  getSearchProvider: vi.fn(() => null),
}));

vi.mock('../src/chat-token', () => ({
  deriveTokenParts: vi.fn(() => ({
    uncachedInput: 0,
    cachedInput: 0,
    cacheWriteInput: 0,
    output: 0,
    source: 'estimated',
  })),
  loadTokenUsage: vi.fn(),
  resetLiveTokenUsage: workflowMocks.resetLiveTokenUsage,
  updateLiveTokenUsage: vi.fn(),
}));

vi.mock('../src/chat-attachment', () => ({
  clearSelectedAttachments: vi.fn(),
  getSelectedAttachments: vi.fn(() => []),
}));

vi.mock('../src/chat-render', () => ({
  autoResizeTextarea: vi.fn(),
  scrollToBottom: vi.fn(),
}));

vi.mock('../src/chat-stream', () => ({
  setupStreamListeners: vi.fn(() => ({
    sendId: 0,
    conversationId: '',
    messagesForApi: [],
    model: null,
    usage: null,
    metrics: null,
  })),
}));

vi.mock('../src/chat-conversation', () => ({
  renameConversationFromFirstMessage: vi.fn(),
}));

vi.mock('../src/prompt', () => ({
  getEffectiveSystemPrompt: vi.fn(() => ''),
}));

vi.mock('../src/glass-dialog', () => ({
  showGlassAlert: vi.fn(),
}));

import { ChatRunWorkflow } from '../src/chat-run-workflow';
import { state } from '../src/state';

function streamingMessage(): Message {
  return {
    id: 'assistant-streaming',
    conversation_id: 'conversation-1',
    role: 'assistant',
    content_json: '',
    reasoning_content: null,
    provider_name: 'provider-1',
    model_name: 'model-1',
    status: 'streaming',
    attachments_json: null,
    search_metadata_json: null,
    created_at: 0,
  };
}

describe('chat run workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.messages = [];
    state.isStreaming = false;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('routes a send intent to cancellation while a run is streaming', async () => {
    const workflow = new ChatRunWorkflow();
    const callbacks = {
      renderChatArea: vi.fn(),
      renderConversationListInDom: vi.fn(),
      renderChatInputInDom: vi.fn(),
      renderRightPanelInDom: vi.fn(),
    };
    workflow.setCallbacks(callbacks);
    state.messages = [streamingMessage()];
    state.isStreaming = true;

    await workflow.handleSendIntent();

    expect(workflowMocks.cancelGeneration).toHaveBeenCalledOnce();
    expect(workflowMocks.cancelWebSearch).toHaveBeenCalledOnce();
    expect(workflowMocks.resetLiveTokenUsage).toHaveBeenCalledOnce();
    expect(state.messages[0].status).toBe('cancelled');
    expect(state.isStreaming).toBe(false);
    expect(workflow.getWebSearchPhase()).toBe('idle');
    expect(workflow.getWebSearchStatusText()).toBe('');
    expect(callbacks.renderChatArea).toHaveBeenCalledOnce();
    expect(callbacks.renderChatInputInDom).toHaveBeenCalledOnce();
    expect(callbacks.renderRightPanelInDom).toHaveBeenCalledOnce();
    expect(callbacks.renderConversationListInDom).not.toHaveBeenCalled();
  });

  it('restores local state even when an external cancellation adapter fails', async () => {
    workflowMocks.cancelGeneration.mockRejectedValueOnce(new Error('backend unavailable'));
    const workflow = new ChatRunWorkflow();
    state.messages = [streamingMessage()];
    state.isStreaming = true;

    await expect(workflow.cancelCurrentRun()).resolves.toBeUndefined();

    expect(state.messages[0].status).toBe('cancelled');
    expect(state.isStreaming).toBe(false);
    expect(workflow.getWebSearchPhase()).toBe('idle');
  });

  it('enables chat search only when provider configuration and local preference agree', () => {
    const getItem = vi.fn(() => 'true');
    vi.stubGlobal('localStorage', { getItem });
    const workflow = new ChatRunWorkflow();

    expect(workflow.isChatWebSearchEnabled()).toBe(true);
    expect(getItem).toHaveBeenCalledWith('tc-chat-web-search-enabled');

    workflowMocks.getSearchConfigSnapshot.mockReturnValueOnce({
      config: { enabled: false },
      hasApiKey: false,
    });
    expect(workflow.isChatWebSearchEnabled()).toBe(false);

    vi.stubGlobal('localStorage', { getItem: () => 'false' });
    expect(workflow.isChatWebSearchEnabled()).toBe(false);
  });
});
