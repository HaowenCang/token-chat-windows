import { state, parseContent, type Message } from './state';
import { t, getLang } from './i18n';
import { getEffectiveSystemPrompt } from './prompt';
import { showGlassAlert } from './glass-dialog';
import {
  type StreamCapture,
  type ApiMessage,
  updateLiveTokenUsage,
  resetLiveTokenUsage,
  loadTokenUsage,
  deriveTokenParts,
} from './chat-token';
import {
  getSelectedAttachments,
  clearSelectedAttachments,
  parseAttachments,
  buildApiContent,
  titleFromContent,
  isDefaultConversationTitle,
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
  updateConversationTitle,
} from './ipc/chat-ipc';
import { isWebRuntime } from './platform/runtime';

// ── Send state ──

let sendSequence = 0;
let activeSendId = 0;
const cancelledSendIds = new Set<number>();
let sendPreparationInProgress = false;
let webSearchPhase: 'idle' | 'searching' | 'success' | 'error' = 'idle';
let webSearchStatusText = '';

export function getWebSearchPhase(): typeof webSearchPhase { return webSearchPhase; }
export function getWebSearchStatusText(): string { return webSearchStatusText; }
export function isChatWebSearchEnabled(): boolean {
  return getSearchConfigSnapshot().config.enabled && localStorage.getItem('tc-chat-web-search-enabled') === 'true';
}

function setWebSearchPhase(phase: typeof webSearchPhase, text = ''): void {
  webSearchPhase = phase;
  webSearchStatusText = text;
}

// ── Callbacks set by chat.ts to avoid circular imports ──

let _renderChatArea: () => void = () => {};
let _renderConversationListInDom: () => void = () => {};
let _renderChatInputInDom: () => void = () => {};
let _renderRightPanelInDom: () => void = () => {};

export function setChatCallbacks(opts: {
  renderChatArea: () => void;
  renderConversationListInDom: () => void;
  renderChatInputInDom: () => void;
  renderRightPanelInDom: () => void;
}): void {
  _renderChatArea = opts.renderChatArea;
  _renderConversationListInDom = opts.renderConversationListInDom;
  _renderChatInputInDom = opts.renderChatInputInDom;
  _renderRightPanelInDom = opts.renderRightPanelInDom;
}

function doRenderChatArea() { _renderChatArea(); }
function doRenderConversationListInDom() { _renderConversationListInDom(); }
function doRenderChatInputInDom() { _renderChatInputInDom(); }
function doRenderRightPanelInDom() { _renderRightPanelInDom(); }

function setChatInputValue(input: HTMLTextAreaElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  autoResizeTextarea(input);
}

// ── Auto-generate title ──

async function maybeAutoGenerateConversationTitle(conversationId: string): Promise<void> {
  const conv = state.conversations.find(c => c.id === conversationId);
  if (!conv || !isDefaultConversationTitle(conv.title)) return;
  const firstUser = state.messages.find(m => m.conversation_id === conversationId && m.role === 'user');
  if (!firstUser) return;
  const title = titleFromContent(parseContent(firstUser.content_json), parseAttachments(firstUser.attachments_json));
  await updateConversationTitleLocal(conversationId, title);
}

// ── Main send handler ──

export async function handleSend(): Promise<void> {
  let pendingAssistantMsg: Message | null = null;
  let ownsPreparation = false;
  try {
    if (state.isStreaming) {
      cancelledSendIds.add(activeSendId);
      const streamingMessage = state.messages.find(message => message.status === 'streaming');
      if (streamingMessage) streamingMessage.status = 'cancelled';
      await Promise.allSettled([cancelGeneration(), cancelWebSearch()]);
      state.isStreaming = false;
      setWebSearchPhase('idle');
      resetLiveTokenUsage();
      doRenderChatArea();
      doRenderChatInputInDom();
      doRenderRightPanelInDom();
      return;
    }
    if (sendPreparationInProgress) return;
    sendPreparationInProgress = true;
    ownsPreparation = true;

    const input = document.getElementById('chatInput') as HTMLTextAreaElement | null;
    if (!input) return;
    const text = input.value.trim();
    const attachments = [...getSelectedAttachments()];
    if (!text && attachments.length === 0) return;
    if (!state.currentConversationId) return;
    const conversationId = state.currentConversationId;

    const conv = state.conversations.find(c => c.id === conversationId);
    if (!conv) return;

    if (!conv.model_id && state.models.length > 0) {
      const firstModel = state.models[0];
      conv.model_id = firstModel.id;
      conv.provider_id = firstModel.provider_id;
      try {
        await updateConversationModel(conv.id, firstModel.provider_id, firstModel.id);
      } catch {}
      doRenderChatArea();
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

    const sendId = ++sendSequence;
    activeSendId = sendId;
    let searchMetadata: MessageSearchMetadata | null = null;
    let augmentedUserText = text;
    const shouldSearch = isChatWebSearchEnabled() && Boolean(text);

    if (shouldSearch) {
      const searchConfig = getSearchConfigSnapshot().config;
      const searchProvider = getSearchProvider(searchConfig.providerId);
      state.isStreaming = true;
      setWebSearchPhase('searching', t('chat.searching'));
      doRenderChatInputInDom();

      searchMetadata = {
        enabled: true,
        query: text,
        results: [],
        searchedAt: new Date().toISOString(),
        providerId: searchConfig.providerId,
      };

      if (!searchProvider) {
        searchMetadata.error = t('chat.noSearchProvider');
        setWebSearchPhase('error', t('chat.searchUnavailable'));
      } else {
        try {
          const response = await searchProvider.search(text, {
            maxResults: searchConfig.defaultMaxResults,
            freshness: 'any',
            language: searchConfig.defaultLanguage === 'auto' ? getLang() : searchConfig.defaultLanguage,
            region: searchConfig.defaultRegion,
            safeSearch: searchConfig.safeSearch,
          });
          searchMetadata.results = response.results;
          searchMetadata.searchedAt = response.searchedAt;
          searchMetadata.providerId = response.providerId;
          augmentedUserText = buildSearchAugmentedPrompt(text, response.results, { language: getLang() });
          setWebSearchPhase('success', `${t('chat.retrievedResults')} ${response.results.length}`);
        } catch (error) {
          const message = String(error);
          if (cancelledSendIds.has(sendId) || message.includes('SEARCH_CANCELLED')) {
            state.isStreaming = false;
            setWebSearchPhase('idle');
            clearSelectedAttachments();
            attachments.forEach(a => getSelectedAttachments().push(a));
            doRenderChatInputInDom();
            const restoredInput = document.getElementById('chatInput') as HTMLTextAreaElement | null;
            if (restoredInput) {
              setChatInputValue(restoredInput, text);
            }
            cancelledSendIds.delete(sendId);
            return;
          }
          searchMetadata.error = message.length > 300 ? `${message.slice(0, 299)}…` : message;
          setWebSearchPhase('error', t('chat.searchFailed'));
          console.warn('Web Search failed; continuing without search:', searchMetadata.error);
        }
      }
    }

    let savedUserMessage: Message;
    try {
      savedUserMessage = await saveUserMessage({
        conversationId,
        content: text,
        attachmentsJson: attachments.length > 0 ? JSON.stringify(attachments) : null,
        searchMetadataJson: searchMetadata ? JSON.stringify(searchMetadata) : null,
      });
    } catch (e) {
      state.isStreaming = false;
      setWebSearchPhase('idle');
      doRenderChatInputInDom();
      await showGlassAlert(t('chat.failedToSave') + String(e));
      return;
    }

    state.messages.push(savedUserMessage);
    await maybeAutoGenerateConversationTitle(conversationId);

    const assistantMsg: Message = {
      id: crypto.randomUUID(),
      conversation_id: conversationId,
      role: 'assistant',
      content_json: '',
      reasoning_content: null,
      provider_name: conv.provider_id ?? null,
      model_name: model.model_name,
      status: 'streaming',
      attachments_json: null,
      search_metadata_json: searchMetadata ? JSON.stringify(searchMetadata) : null,
      created_at: Math.floor(Date.now() / 1000),
    };
    state.messages.push(assistantMsg);
    pendingAssistantMsg = assistantMsg;
    state.isStreaming = true;

    doRenderChatArea();
    doRenderConversationListInDom();
    doRenderChatInputInDom();
    scrollToBottom();

    const messagesForApi: ApiMessage[] = [];
    const globalPrompt = getEffectiveSystemPrompt();
    if (globalPrompt) {
      messagesForApi.push({ role: 'system', content: globalPrompt });
    }
    state.messages
      .filter(m => m.id !== assistantMsg.id)
      .forEach(m => {
        const messageText = m.id === savedUserMessage.id ? augmentedUserText : parseContent(m.content_json);
        messagesForApi.push({
          role: m.role,
          content: buildApiContent(messageText, parseAttachments(m.attachments_json)),
        });
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
    doRenderRightPanelInDom();

    await setupStreamListeners(assistantMsg.id, capture, cancelledSendIds, doRenderChatInputInDom, doRenderRightPanelInDom);

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

    if (cancelledSendIds.has(sendId)) {
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
        status: assistantMsg.status === 'failed' ? 'failed' : assistantMsg.status === 'cancelled' ? 'cancelled' : 'completed',
        searchMetadataJson: searchMetadata ? JSON.stringify(searchMetadata) : null,
      });
      assistantMsg.id = savedAssistant.id;
      assistantMsg.status = savedAssistant.status;
      assistantMsg.created_at = savedAssistant.created_at;
      doRenderChatArea();
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
        status: assistantMsg.status === 'failed' ? 'failed' : assistantMsg.status === 'cancelled' ? 'cancelled' : 'completed',
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
    doRenderChatArea();
    doRenderConversationListInDom();
    doRenderRightPanelInDom();
  } catch (e) {
    if (pendingAssistantMsg) {
      pendingAssistantMsg.status = 'failed';
    }
    state.isStreaming = false;
    setWebSearchPhase('idle');
    doRenderChatArea();
    doRenderChatInputInDom();
    await showGlassAlert(t('chat.sendError') + String(e));
  } finally {
    if (ownsPreparation) {
      sendPreparationInProgress = false;
    }
    cancelledSendIds.delete(activeSendId);
  }
}

// ── Update conversation title (called from chat-conversation.ts) ──

export async function updateConversationTitleLocal(conversationId: string, title: string): Promise<void> {
  const trimmed = title.trim();
  if (!trimmed) return;
  const conv = state.conversations.find(c => c.id === conversationId);
  if (!conv || conv.title === trimmed) return;
  conv.title = trimmed;
  conv.updated_at = Math.floor(Date.now() / 1000);
  const isDev = isWebRuntime();
  if (!isDev) {
    try {
      await updateConversationTitle(conversationId, trimmed);
    } catch (e) {
      console.error('Failed to update conversation title:', e);
    }
  }
  doRenderChatArea();
  doRenderConversationListInDom();
}

declare global {
  interface Window {
    __handleSend: () => void;
  }
}

window.__handleSend = () => { handleSend(); };
