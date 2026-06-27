import { state, parseContent, type Message } from './state';
import { t, getLang } from './i18n';
import { getEffectiveSystemPrompt } from './prompt';
import { showGlassAlert } from './glass-dialog';
import {
  type StreamCapture,
  updateLiveTokenUsage,
  resetLiveTokenUsage,
  loadTokenUsage,
  deriveTokenParts,
} from './chat-token';
import {
  getSelectedAttachments,
  clearSelectedAttachments,
} from './chat-attachment';
import {
  buildSearchAugmentedPrompt,
  cancelWebSearch,
  getSearchConfigSnapshot,
  getSearchProvider,
  type MessageSearchMetadata,
} from './web-search';
import {
  scrollToBottom,
  autoResizeTextarea,
} from './chat-render';
import { setupStreamListeners } from './chat-stream';
import {
  cancelGeneration,
  getProviderApiKey,
  recordGenerationRun,
  saveAssistantMessage,
  saveUserMessage,
  sendMessage,
  updateConversationModel,
} from './ipc/chat-ipc';
import { renameConversationFromFirstMessage } from './chat-conversation';
import {
  buildMessagesForApi,
  createStreamingAssistantMessage,
  markStreamingMessageCancelled,
  persistedAssistantStatus,
} from './chat-run-model';

export type WebSearchPhase = 'idle' | 'searching' | 'success' | 'error';

export interface ChatRunWorkflowCallbacks {
  renderChatArea: () => void;
  renderConversationListInDom: () => void;
  renderChatInputInDom: () => void;
  renderRightPanelInDom: () => void;
}

const noop = () => {};

function setChatInputValue(input: HTMLTextAreaElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  autoResizeTextarea(input);
}

export class ChatRunWorkflow {
  private sendSequence = 0;
  private activeSendId = 0;
  private readonly cancelledSendIds = new Set<number>();
  private sendPreparationInProgress = false;
  private webSearchPhase: WebSearchPhase = 'idle';
  private webSearchStatusText = '';
  private callbacks: ChatRunWorkflowCallbacks = {
    renderChatArea: noop,
    renderConversationListInDom: noop,
    renderChatInputInDom: noop,
    renderRightPanelInDom: noop,
  };

  setCallbacks(callbacks: ChatRunWorkflowCallbacks): void {
    this.callbacks = callbacks;
  }

  getWebSearchPhase(): WebSearchPhase {
    return this.webSearchPhase;
  }

  getWebSearchStatusText(): string {
    return this.webSearchStatusText;
  }

  isChatWebSearchEnabled(): boolean {
    if (typeof localStorage === 'undefined') return false;
    return getSearchConfigSnapshot().config.enabled && localStorage.getItem('tc-chat-web-search-enabled') === 'true';
  }

  async handleSendIntent(): Promise<void> {
    if (state.isStreaming) {
      await this.cancelCurrentRun();
      return;
    }
    await this.sendCurrentDraft();
  }

  async cancelCurrentRun(): Promise<void> {
    this.cancelledSendIds.add(this.activeSendId);
    markStreamingMessageCancelled(state.messages);
    await Promise.allSettled([cancelGeneration(), cancelWebSearch()]);
    state.isStreaming = false;
    this.setWebSearchPhase('idle');
    resetLiveTokenUsage();
    this.callbacks.renderChatArea();
    this.callbacks.renderChatInputInDom();
    this.callbacks.renderRightPanelInDom();
  }

  async sendCurrentDraft(): Promise<void> {
    let pendingAssistantMsg: Message | null = null;
    let ownsPreparation = false;
    try {
      if (this.sendPreparationInProgress) return;
      this.sendPreparationInProgress = true;
      ownsPreparation = true;

      const draft = this.prepareDraft();
      if (!draft) return;
      const { input, text, attachments, conversationId } = draft;

      const conv = state.conversations.find(c => c.id === conversationId);
      if (!conv) return;

      if (!conv.model_id && state.models.length > 0) {
        const firstModel = state.models[0];
        conv.model_id = firstModel.id;
        conv.provider_id = firstModel.provider_id;
        try {
          await updateConversationModel(conv.id, firstModel.provider_id, firstModel.id);
        } catch {}
        this.callbacks.renderChatArea();
      }

      let model = state.models.find(m => m.id === conv.model_id);
      if (!model && state.models.length > 0) {
        model = state.models[0];
        conv.model_id = model.id;
        conv.provider_id = model.provider_id;
      }
      if (!model) return;

      const provider = state.providers.find(p => p.id === conv.provider_id);
      if (!provider) return;

      setChatInputValue(input, '');
      clearSelectedAttachments();

      const sendId = ++this.sendSequence;
      this.activeSendId = sendId;
      const search = await this.runOptionalWebSearch(sendId, text, attachments);
      if (search.cancelled) return;

      let savedUserMessage: Message;
      try {
        savedUserMessage = await saveUserMessage({
          conversationId,
          content: text,
          attachmentsJson: attachments.length > 0 ? JSON.stringify(attachments) : null,
          searchMetadataJson: search.metadata ? JSON.stringify(search.metadata) : null,
        });
      } catch (e) {
        state.isStreaming = false;
        this.setWebSearchPhase('idle');
        this.callbacks.renderChatInputInDom();
        await showGlassAlert(t('chat.failedToSave') + String(e));
        return;
      }

      state.messages.push(savedUserMessage);
      await renameConversationFromFirstMessage(conversationId);

      const assistantMsg = createStreamingAssistantMessage({
        id: crypto.randomUUID(),
        conversationId,
        providerId: conv.provider_id,
        model,
        searchMetadataJson: search.metadata ? JSON.stringify(search.metadata) : null,
        createdAt: Math.floor(Date.now() / 1000),
      });
      state.messages.push(assistantMsg);
      pendingAssistantMsg = assistantMsg;
      state.isStreaming = true;

      this.callbacks.renderChatArea();
      this.callbacks.renderConversationListInDom();
      this.callbacks.renderChatInputInDom();
      scrollToBottom();

      const messagesForApi = buildMessagesForApi({
        messages: state.messages,
        assistantMessageId: assistantMsg.id,
        savedUserMessageId: savedUserMessage.id,
        augmentedUserText: search.augmentedUserText,
        globalPrompt: getEffectiveSystemPrompt(),
      });

      const capture: StreamCapture = {
        sendId,
        conversationId,
        messagesForApi,
        model,
        usage: null,
        metrics: null,
      };
      updateLiveTokenUsage(capture, '');
      this.callbacks.renderRightPanelInDom();

      await setupStreamListeners(assistantMsg.id, capture, this.cancelledSendIds, this.callbacks.renderChatInputInDom, this.callbacks.renderRightPanelInDom);

      let apiKey = '';
      if (conv.provider_id) {
        try {
          const key = await getProviderApiKey(conv.provider_id);
          apiKey = key ?? '';
        } catch (e) {
          console.error('Failed to get API key:', e);
        }
      }

      await sendMessage({
        baseUrl: provider.base_url,
        apiKey,
        model: model.model_name,
        messages: messagesForApi,
        temperature: model.temperature,
        maxTokens: model.max_output_tokens ?? undefined,
      });

      if (this.cancelledSendIds.has(sendId)) {
        assistantMsg.status = 'cancelled';
      }

      const assistantContent = parseContent(assistantMsg.content_json);
      let savedAssistant: Message | null = null;
      try {
        savedAssistant = await saveAssistantMessage({
          conversationId,
          content: assistantContent,
          reasoning: assistantMsg.reasoning_content,
          providerId: provider.id,
          providerName: provider.name,
          modelId: model.id,
          modelName: model.model_name,
          status: persistedAssistantStatus(assistantMsg.status),
          searchMetadataJson: search.metadata ? JSON.stringify(search.metadata) : null,
        });
        assistantMsg.id = savedAssistant.id;
        assistantMsg.status = savedAssistant.status;
        assistantMsg.created_at = savedAssistant.created_at;
        this.callbacks.renderChatArea();
      } catch (e) {
        console.error('Failed to save assistant message:', e);
      }

      const parts = deriveTokenParts(messagesForApi, assistantContent, capture.usage);
      try {
        await recordGenerationRun({
          conversationId,
          assistantMessageId: savedAssistant?.id ?? null,
          providerId: provider.id,
          modelId: model.id,
          status: persistedAssistantStatus(assistantMsg.status),
          uncachedInputTokens: parts.uncachedInput,
          cacheReadInputTokens: parts.cachedInput,
          cacheWriteInputTokens: parts.cacheWriteInput,
          outputTokens: parts.output,
          usageSource: parts.source,
          firstEventLatencyMs: capture.metrics?.first_event_ms ?? null,
          firstTokenLatencyMs: capture.metrics?.first_token_ms ?? null,
          durationMs: capture.metrics?.total_ms ?? null,
        });
      } catch (e) {
        console.error('Failed to record generation run:', e);
      }

      await loadTokenUsage(conversationId);

      if (savedAssistant) {
        assistantMsg.id = savedAssistant.id;
        assistantMsg.status = savedAssistant.status;
        assistantMsg.created_at = savedAssistant.created_at;
      }
      this.callbacks.renderChatArea();
      this.callbacks.renderConversationListInDom();
      this.callbacks.renderRightPanelInDom();
    } catch (e) {
      if (pendingAssistantMsg) {
        pendingAssistantMsg.status = 'failed';
      }
      state.isStreaming = false;
      this.setWebSearchPhase('idle');
      this.callbacks.renderChatArea();
      this.callbacks.renderChatInputInDom();
      await showGlassAlert(t('chat.sendError') + String(e));
    } finally {
      if (ownsPreparation) {
        this.sendPreparationInProgress = false;
      }
      this.cancelledSendIds.delete(this.activeSendId);
    }
  }

  private prepareDraft(): { input: HTMLTextAreaElement; text: string; attachments: ReturnType<typeof getSelectedAttachments>; conversationId: string } | null {
    const input = document.getElementById('chatInput') as HTMLTextAreaElement | null;
    if (!input) return null;
    const text = input.value.trim();
    const attachments = [...getSelectedAttachments()];
    if (!text && attachments.length === 0) return null;
    if (!state.currentConversationId) return null;
    return { input, text, attachments, conversationId: state.currentConversationId };
  }

  private async runOptionalWebSearch(sendId: number, text: string, attachments: ReturnType<typeof getSelectedAttachments>): Promise<{
    cancelled: boolean;
    metadata: MessageSearchMetadata | null;
    augmentedUserText: string;
  }> {
    let metadata: MessageSearchMetadata | null = null;
    let augmentedUserText = text;
    const shouldSearch = this.isChatWebSearchEnabled() && Boolean(text);
    if (!shouldSearch) return { cancelled: false, metadata, augmentedUserText };

    const searchConfig = getSearchConfigSnapshot().config;
    const searchProvider = getSearchProvider(searchConfig.providerId);
    state.isStreaming = true;
    this.setWebSearchPhase('searching', t('chat.searching'));
    this.callbacks.renderChatInputInDom();

    metadata = {
      enabled: true,
      query: text,
      results: [],
      searchedAt: new Date().toISOString(),
      providerId: searchConfig.providerId,
    };

    if (!searchProvider) {
      metadata.error = t('chat.noSearchProvider');
      this.setWebSearchPhase('error', t('chat.searchUnavailable'));
      return { cancelled: false, metadata, augmentedUserText };
    }

    try {
      const response = await searchProvider.search(text, {
        maxResults: searchConfig.defaultMaxResults,
        freshness: 'any',
        language: searchConfig.defaultLanguage === 'auto' ? getLang() : searchConfig.defaultLanguage,
        region: searchConfig.defaultRegion,
        safeSearch: searchConfig.safeSearch,
      });
      metadata.results = response.results;
      metadata.searchedAt = response.searchedAt;
      metadata.providerId = response.providerId;
      augmentedUserText = buildSearchAugmentedPrompt(text, response.results, { language: getLang() });
      this.setWebSearchPhase('success', `${t('chat.retrievedResults')} ${response.results.length}`);
    } catch (error) {
      const message = String(error);
      if (this.cancelledSendIds.has(sendId) || message.includes('SEARCH_CANCELLED')) {
        state.isStreaming = false;
        this.setWebSearchPhase('idle');
        clearSelectedAttachments();
        attachments.forEach(attachment => getSelectedAttachments().push(attachment));
        this.callbacks.renderChatInputInDom();
        const restoredInput = document.getElementById('chatInput') as HTMLTextAreaElement | null;
        if (restoredInput) {
          setChatInputValue(restoredInput, text);
        }
        this.cancelledSendIds.delete(sendId);
        return { cancelled: true, metadata, augmentedUserText };
      }
      metadata.error = message.length > 300 ? `${message.slice(0, 299)}...` : message;
      this.setWebSearchPhase('error', t('chat.searchFailed'));
      console.warn('Web Search failed; continuing without search:', metadata.error);
    }

    return { cancelled: false, metadata, augmentedUserText };
  }

  private setWebSearchPhase(phase: WebSearchPhase, text = ''): void {
    this.webSearchPhase = phase;
    this.webSearchStatusText = text;
  }
}

export const chatRunWorkflow = new ChatRunWorkflow();
