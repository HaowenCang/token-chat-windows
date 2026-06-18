import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { state, type Conversation, type Message, type Model } from './state';
import { t } from './i18n';

declare global {
  interface Window {
    __handleSend: () => void;
  }
}

let streamUnlisten: UnlistenFn | null = null;
let metricsUnlisten: UnlistenFn | null = null;
const isDev = !(window as any).__TAURI_INTERNALS__;

interface StreamChunk {
  content: string;
  reasoning: string;
  done: boolean;
  usage?: StreamUsage;
}

interface StreamUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  cached_tokens?: number;
  total_tokens?: number;
}

interface StreamMetrics {
  first_event_ms: number;
  first_token_ms: number;
  total_ms: number;
  tokens_generated: number;
}

interface ApiMessage {
  role: string;
  content: string;
}

interface TokenParts {
  uncachedInput: number;
  cachedInput: number;
  cacheWriteInput: number;
  output: number;
  source: 'provider_reported' | 'estimated';
}

interface TokenUsageRun {
  input_tokens: number;
  output_tokens: number;
  cost_nanos: number;
  created_at: number;
}

interface ConversationTokenUsage {
  conversation_id: string;
  uncached_input_tokens: number;
  cached_input_tokens: number;
  cache_write_input_tokens: number;
  output_tokens: number;
  cost_nanos: number;
  request_count: number;
  currency: string;
  recent_runs: TokenUsageRun[];
}

interface LiveTokenUsage {
  conversationId: string;
  parts: TokenParts;
  costNanos: number;
  currency: string;
  run: TokenUsageRun;
}

interface StreamCapture {
  conversationId: string;
  messagesForApi: ApiMessage[];
  model: Model;
  usage: StreamUsage | null;
  metrics: StreamMetrics | null;
}

let currentTokenUsage: ConversationTokenUsage | null = null;
let liveTokenUsage: LiveTokenUsage | null = null;

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function clampTokenNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function estimateTokenCount(text: string): number {
  if (!text.trim()) return 0;
  const cjkCount = (text.match(/[\u3400-\u9fff\uf900-\ufaff]/g) ?? []).length;
  const nonCjkText = text.replace(/[\u3400-\u9fff\uf900-\ufaff]/g, '');
  return Math.max(1, cjkCount + Math.ceil(nonCjkText.length / 4));
}

function estimatePromptTokens(messages: ApiMessage[]): number {
  return messages.reduce((sum, msg) => sum + estimateTokenCount(msg.content) + 4, 2);
}

function deriveTokenParts(messagesForApi: ApiMessage[], assistantContent: string, usage: StreamUsage | null): TokenParts {
  const estimatedPrompt = estimatePromptTokens(messagesForApi);
  const estimatedOutput = estimateTokenCount(assistantContent);
  const reportedCompletion = clampTokenNumber(usage?.completion_tokens);
  const reportedTotal = clampTokenNumber(usage?.total_tokens);
  let prompt = clampTokenNumber(usage?.prompt_tokens);
  let output = reportedCompletion;

  if (prompt === 0 && reportedTotal > 0 && output > 0) {
    prompt = Math.max(0, reportedTotal - output);
  }
  if (output === 0 && reportedTotal > 0 && prompt > 0) {
    output = Math.max(0, reportedTotal - prompt);
  }
  if (prompt === 0) prompt = estimatedPrompt;
  if (output === 0) output = estimatedOutput;

  const cachedInput = Math.min(clampTokenNumber(usage?.cached_tokens), prompt);
  return {
    uncachedInput: Math.max(0, prompt - cachedInput),
    cachedInput,
    cacheWriteInput: 0,
    output,
    source: usage ? 'provider_reported' : 'estimated',
  };
}

function calculateCostNanos(parts: TokenParts, model: Model): number {
  const total =
    parts.uncachedInput * model.uncached_input_nanos_per_million +
    parts.cachedInput * model.cache_read_nanos_per_million +
    parts.output * model.output_nanos_per_million;
  return Math.max(0, Math.round(total / 1_000_000));
}

function formatCostNanos(nanos: number, currency = 'USD'): string {
  const amount = nanos / 1_000_000_000;
  const prefix = currency.toUpperCase() === 'USD' ? '$' : `${currency.toUpperCase()} `;
  return `${prefix}${amount.toFixed(4)}`;
}

function buildEstimatedUsageFromMessages(convId: string, model: Model | null): ConversationTokenUsage {
  const inputTokens = state.messages
    .filter(m => m.role === 'user' || m.role === 'system')
    .reduce((sum, m) => sum + estimateTokenCount(parseContent(m.content_json)), 0);
  const outputTokens = state.messages
    .filter(m => m.role === 'assistant')
    .reduce((sum, m) => sum + estimateTokenCount(parseContent(m.content_json)), 0);
  const parts: TokenParts = {
    uncachedInput: inputTokens,
    cachedInput: 0,
    cacheWriteInput: 0,
    output: outputTokens,
    source: 'estimated',
  };
  const costNanos = model ? calculateCostNanos(parts, model) : 0;
  const assistantMessages = state.messages.filter(m => m.role === 'assistant');

  return {
    conversation_id: convId,
    uncached_input_tokens: inputTokens,
    cached_input_tokens: 0,
    cache_write_input_tokens: 0,
    output_tokens: outputTokens,
    cost_nanos: costNanos,
    request_count: assistantMessages.length,
    currency: model?.currency ?? 'USD',
    recent_runs: assistantMessages.slice(-10).map(m => ({
      input_tokens: 0,
      output_tokens: estimateTokenCount(parseContent(m.content_json)),
      cost_nanos: 0,
      created_at: m.created_at,
    })),
  };
}

function getPanelUsage(convId: string, model: Model | null): ConversationTokenUsage {
  const persisted = currentTokenUsage?.conversation_id === convId ? currentTokenUsage : null;
  const shouldEstimate = !persisted || (persisted.request_count === 0 && state.messages.length > 0);
  const base = shouldEstimate
    ? buildEstimatedUsageFromMessages(convId, model)
    : persisted;

  if (!base) {
    return {
      conversation_id: convId,
      uncached_input_tokens: 0,
      cached_input_tokens: 0,
      cache_write_input_tokens: 0,
      output_tokens: 0,
      cost_nanos: 0,
      request_count: 0,
      currency: model?.currency ?? 'USD',
      recent_runs: [],
    };
  }

  if (liveTokenUsage?.conversationId !== convId) return base;

  return {
    ...base,
    uncached_input_tokens: base.uncached_input_tokens + liveTokenUsage.parts.uncachedInput,
    cached_input_tokens: base.cached_input_tokens + liveTokenUsage.parts.cachedInput,
    cache_write_input_tokens: base.cache_write_input_tokens + liveTokenUsage.parts.cacheWriteInput,
    output_tokens: base.output_tokens + liveTokenUsage.parts.output,
    cost_nanos: base.cost_nanos + liveTokenUsage.costNanos,
    request_count: base.request_count + 1,
    currency: liveTokenUsage.currency || base.currency,
    recent_runs: [...base.recent_runs, liveTokenUsage.run].slice(-10),
  };
}

function renderMiniChart(runs: TokenUsageRun[]): string {
  if (runs.length === 0) {
    return `<svg viewBox="0 0 260 60" style="width:100%;height:60px">
      <line x1="0" y1="58" x2="260" y2="58" stroke="var(--line)" stroke-width="1"/>
      <text x="130" y="34" text-anchor="middle" fill="var(--text-faint)" font-size="11">No data yet</text>
    </svg>`;
  }

  const maxTokens = Math.max(...runs.map(r => r.input_tokens + r.output_tokens), 1);
  const barWidth = 16;
  const gap = 8;
  const startX = Math.max(0, 260 - runs.length * (barWidth + gap));
  const bars = runs.map((run, idx) => {
    const total = run.input_tokens + run.output_tokens;
    const totalHeight = Math.max(2, (total / maxTokens) * 48);
    const outputHeight = total > 0 ? (run.output_tokens / total) * totalHeight : 0;
    const inputHeight = totalHeight - outputHeight;
    const x = startX + idx * (barWidth + gap);
    const inputY = 58 - totalHeight;
    const outputY = 58 - outputHeight;
    return `<g>
      <rect x="${x}" y="${inputY}" width="${barWidth}" height="${inputHeight}" rx="2" fill="var(--stack-input)" opacity="0.75"/>
      <rect x="${x}" y="${outputY}" width="${barWidth}" height="${outputHeight}" rx="2" fill="var(--stack-output)" opacity="0.85"/>
    </g>`;
  }).join('');

  return `<svg viewBox="0 0 260 60" style="width:100%;height:60px">
    <line x1="0" y1="58" x2="260" y2="58" stroke="var(--line)" stroke-width="1"/>
    ${bars}
  </svg>`;
}

export async function loadTokenUsage(conversationId: string): Promise<void> {
  if (isDev) {
    currentTokenUsage = null;
    return;
  }
  try {
    currentTokenUsage = await invoke<ConversationTokenUsage>('get_conversation_token_usage', { conversationId });
  } catch {
    currentTokenUsage = null;
  }
}

function updateLiveTokenUsage(capture: StreamCapture, assistantContent: string): void {
  const parts = deriveTokenParts(capture.messagesForApi, assistantContent, capture.usage);
  const costNanos = calculateCostNanos(parts, capture.model);
  liveTokenUsage = {
    conversationId: capture.conversationId,
    parts,
    costNanos,
    currency: capture.model.currency,
    run: {
      input_tokens: parts.uncachedInput + parts.cachedInput + parts.cacheWriteInput,
      output_tokens: parts.output,
      cost_nanos: costNanos,
      created_at: Math.floor(Date.now() / 1000),
    },
  };
}

function relativeTime(ts: number): string {
  const now = Date.now();
  const diff = now - ts * 1000;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function renderMarkdown(text: string): string {
  let html = escHtml(text);
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const label = lang ? `<span class="msg-code-lang">${escHtml(lang)}</span>` : '';
    return `<div class="msg-code-block">${label}<button class="msg-code-copy" onclick="navigator.clipboard.writeText(this.parentElement.querySelector('code').textContent)">Copy</button><pre><code>${code}</code></pre></div>`;
  });
  html = html.replace(/`([^`]+)`/g, '<code style="background:var(--surface-raised);padding:1px 4px;border-radius:3px;font-family:var(--font-mono);font-size:12px">$1</code>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/\n/g, '<br>');
  return html;
}

export function renderConversationList(): string {
  const convs = state.conversations;
  if (convs.length === 0) {
    return `<div class="placeholder-content" style="height:100%">${t('chat.noConversations')}</div>`;
  }
  return convs.map(c => {
    const isActive = c.id === state.currentConversationId;
    const model = state.models.find(m => m.id === c.model_id);
    const modelName = model?.display_name ?? model?.model_name ?? '';
    return `
      <div class="chat-item ${isActive ? 'active' : ''}" data-conv-id="${c.id}">
        <div class="chat-item-title">${escHtml(c.title)}</div>
        <div class="chat-item-meta">
          ${modelName ? `<span class="chat-item-model">${escHtml(modelName)}</span>` : ''}
          <span>${relativeTime(c.updated_at)}</span>
        </div>
      </div>
    `;
  }).join('');
}

export function renderChatMessages(): string {
  if (!state.currentConversationId) {
    return `<div class="placeholder-content">${t('chat.selectOrCreate')}</div>`;
  }
  if (state.messages.length === 0) {
    return `<div class="placeholder-content">${t('chat.sendToBegin')}</div>`;
  }
  return state.messages.map(m => renderMessage(m)).join('');
}

function renderMessage(msg: Message): string {
  const role = msg.role;
  const content = parseContent(msg.content_json);
  const isUser = role === 'user';

  let bubbleInner = '';
  if (msg.reasoning_content) {
    bubbleInner += `
      <div class="msg-thinking" data-toggle-thinking>
        <div class="msg-thinking-label">Thinking</div>
        <div class="msg-thinking-body">${renderMarkdown(msg.reasoning_content)}</div>
      </div>`;
  }
  bubbleInner += `<div class="msg-content">${renderMarkdown(content)}</div>`;

  let statusHtml = '';
  if (msg.status === 'streaming') {
    statusHtml = '<span class="msg-metric"><span class="spinner" style="display:inline-block"></span></span>';
  } else if (msg.status === 'cancelled') {
    statusHtml = `<span style="color:var(--warning);font-size:11px">${t('chat.cancelled')}</span>`;
  } else if (msg.status === 'failed') {
    statusHtml = `<span style="color:var(--danger);font-size:11px">${t('chat.failed')}</span>`;
  }

  return `
    <div class="msg ${role}" data-msg-id="${msg.id}">
      <div class="msg-bubble">${bubbleInner}</div>
      <div class="msg-meta">
        ${!isUser && msg.model_name ? `<span class="msg-metric">${escHtml(msg.model_name)}</span>` : ''}
        ${statusHtml}
      </div>
    </div>
  `;
}

function parseContent(contentJson: string): string {
  try {
    const parsed = JSON.parse(contentJson);
    if (typeof parsed === 'string') return parsed;
    if (parsed.text) return parsed.text;
    return contentJson;
  } catch {
    return contentJson;
  }
}

export function renderChatInput(): string {
  const streaming = state.isStreaming;
  return `
    <div class="chat-input-area">
      <div class="chat-input-wrap">
        <button class="attach-btn" title="Attach">&#128206;</button>
        <textarea class="chat-input" rows="1" placeholder="${t('chat.typeMessage')}" id="chatInput"></textarea>
        ${streaming
          ? `<button class="send-btn" id="sendBtn" title="${t('chat.stop')}" style="background:var(--danger)" onclick="window.__handleSend()">&#9632;</button>`
          : `<button class="send-btn" id="sendBtn" title="${t('chat.send')}" onclick="window.__handleSend()">&#9654;</button>`
        }
      </div>
    </div>
  `;
}

export function renderRightPanelContent(): string {
  const convId = state.currentConversationId;
  if (!convId) {
    return renderEmptyRightPanel();
  }

  const conv = state.conversations.find(c => c.id === convId);
  const model = conv ? state.models.find(m => m.id === conv.model_id) : null;
  const usage = getPanelUsage(convId, model ?? null);
  const totalInput = usage.uncached_input_tokens + usage.cached_input_tokens + usage.cache_write_input_tokens;
  const totalOutput = usage.output_tokens;
  const costLabel = formatCostNanos(usage.cost_nanos, usage.currency);

  return `
    <div class="metric-row">
      <div class="metric-card">
        <div class="metric-card-label">${t('chat.input')}</div>
        <div class="metric-card-value" style="color:var(--stack-input)">${totalInput.toLocaleString()}</div>
        <div class="metric-card-sub">${t('chat.tokens')}</div>
      </div>
      <div class="metric-card">
        <div class="metric-card-label">${t('chat.output')}</div>
        <div class="metric-card-value" style="color:var(--stack-output)">${totalOutput.toLocaleString()}</div>
        <div class="metric-card-sub">${t('chat.tokens')}</div>
      </div>
    </div>
    <div class="metric-card">
      <div class="metric-card-label">${t('chat.sessionCost')}</div>
      <div class="metric-card-value">${costLabel}</div>
      <div class="metric-card-sub">${usage.request_count} ${t('chat.messages')}</div>
    </div>
    <div class="mini-chart">
      <div class="mini-chart-title">Token Usage (last 10 msgs)</div>
      ${renderMiniChart(usage.recent_runs)}
    </div>
    ${model ? `
    <div class="model-info-card">
      <div class="model-info-name">${escHtml(model.display_name || model.model_name)}</div>
      <div class="model-info-provider">${escHtml(model.provider_id)}</div>
      <div class="model-info-stats">
        <div><div class="model-info-stat-label">${t('chat.inputPerM')}</div><div class="model-info-stat-value">$${(model.uncached_input_nanos_per_million / 1e9).toFixed(2)}</div></div>
        <div><div class="model-info-stat-label">${t('chat.outputPerM')}</div><div class="model-info-stat-value">$${(model.output_nanos_per_million / 1e9).toFixed(2)}</div></div>
        <div><div class="model-info-stat-label">${t('chat.maxCtx')}</div><div class="model-info-stat-value">${(model.context_window / 1000).toFixed(0)}K</div></div>
        <div><div class="model-info-stat-label">${t('chat.latency')}</div><div class="model-info-stat-value">-</div></div>
      </div>
    </div>` : `
    <div class="model-info-card">
      <div class="model-info-name">${t('chat.noModel')}</div>
      <div class="model-info-provider">-</div>
    </div>`}
  `;
}

function renderEmptyRightPanel(): string {
  return `
    <div class="metric-row">
      <div class="metric-card">
        <div class="metric-card-label">${t('chat.input')}</div>
        <div class="metric-card-value" style="color:var(--stack-input)">0</div>
        <div class="metric-card-sub">${t('chat.tokens')}</div>
      </div>
      <div class="metric-card">
        <div class="metric-card-label">${t('chat.output')}</div>
        <div class="metric-card-value" style="color:var(--stack-output)">0</div>
        <div class="metric-card-sub">${t('chat.tokens')}</div>
      </div>
    </div>
    <div class="metric-card">
      <div class="metric-card-label">${t('chat.sessionCost')}</div>
      <div class="metric-card-value">$0.00</div>
      <div class="metric-card-sub">0 ${t('chat.messages')}</div>
    </div>
    <div class="model-info-card">
      <div class="model-info-name">${t('chat.noModel')}</div>
      <div class="model-info-provider">-</div>
    </div>
  `;
}

export async function loadConversations(): Promise<void> {
  try {
    state.conversations = await invoke<Conversation[]>('list_conversations');
  } catch {
    state.conversations = [];
  }
}

export async function selectConversation(id: string): Promise<void> {
  state.currentConversationId = id;
  liveTokenUsage = null;
  try {
    state.messages = await invoke<Message[]>('list_messages', { conversationId: id });
  } catch {
    state.messages = [];
  }
  await loadTokenUsage(id);
  renderChatArea();
  renderConversationListInDom();
  renderRightPanelInDom();
}

export async function createConversation(): Promise<void> {
  try {
    let providerId: string | undefined;
    let modelId: string | undefined;
    if (state.providers.length > 0) {
      providerId = state.providers[0].id;
      const pModels = state.models.filter(m => m.provider_id === providerId);
      if (pModels.length > 0) modelId = pModels[0].id;
    }
    const conv = await invoke<Conversation>('create_conversation', {
      input: { provider_id: providerId ?? null, model_id: modelId ?? null },
    });
    state.conversations.unshift(conv);
    await selectConversation(conv.id);
  } catch (e) {
    console.error('Failed to create conversation:', e);
  }
}

export async function handleSend(): Promise<void> {
  let pendingAssistantMsg: Message | null = null;
  try {
    if (state.isStreaming) {
      try { await invoke('cancel_generation'); } catch {}
      state.isStreaming = false;
      liveTokenUsage = null;
      renderChatInputInDom();
      renderRightPanelInDom();
      return;
    }

    const input = document.getElementById('chatInput') as HTMLTextAreaElement | null;
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    if (!state.currentConversationId) return;
    const conversationId = state.currentConversationId;

    const conv = state.conversations.find(c => c.id === conversationId);
    if (!conv) return;

    // Auto-select model if not set
    if (!conv.model_id && state.models.length > 0) {
      const firstModel = state.models[0];
      conv.model_id = firstModel.id;
      conv.provider_id = firstModel.provider_id;
      try {
        await invoke('update_conversation_model', {
          id: conv.id,
          providerId: firstModel.provider_id,
          modelId: firstModel.id,
        });
      } catch {}
      renderChatArea();
    }

    let model = state.models.find(m => m.id === conv.model_id);
    // Fallback: try first model if still not found
    if (!model && state.models.length > 0) {
      model = state.models[0];
      conv.model_id = model.id;
      conv.provider_id = model.provider_id;
    }
    if (!model) return;

    const provider = state.providers.find(p => p.id === conv.provider_id);
    if (!provider) return;

    input.value = '';
    autoResizeTextarea(input);

    try {
      await invoke('save_user_message', {
        conversationId,
        content: text,
      });
    } catch (e) {
      alert('Failed to save message: ' + String(e));
      return;
    }

    const userMsg: Message = {
      id: crypto.randomUUID(),
      conversation_id: conversationId,
      role: 'user',
      content_json: JSON.stringify(text),
      reasoning_content: null,
      provider_name: null,
      model_name: null,
      status: 'sent',
      created_at: Math.floor(Date.now() / 1000),
    };
    state.messages.push(userMsg);

    const assistantMsg: Message = {
      id: crypto.randomUUID(),
      conversation_id: conversationId,
      role: 'assistant',
      content_json: '',
      reasoning_content: null,
      provider_name: conv.provider_id ?? null,
      model_name: model.model_name,
      status: 'streaming',
      created_at: Math.floor(Date.now() / 1000),
    };
    state.messages.push(assistantMsg);
    pendingAssistantMsg = assistantMsg;
    state.isStreaming = true;

    renderChatArea();
    renderChatInputInDom();
    scrollToBottom();

    const messagesForApi: ApiMessage[] = [];
    const globalPrompt = localStorage.getItem('tc-global-prompt') || '';
    if (globalPrompt) {
      messagesForApi.push({ role: 'system', content: globalPrompt });
    }
    state.messages
      .filter(m => m.id !== assistantMsg.id)
      .forEach(m => {
        messagesForApi.push({ role: m.role, content: parseContent(m.content_json) });
      });

    const capture: StreamCapture = {
      conversationId,
      messagesForApi,
      model,
      usage: null,
      metrics: null,
    };
    updateLiveTokenUsage(capture, '');
    renderRightPanelInDom();

    await setupStreamListeners(assistantMsg.id, capture);

    let apiKey = '';
    if (conv.provider_id) {
      try {
        const key = await invoke<string | null>('get_provider_api_key', { id: conv.provider_id });
        apiKey = key ?? '';
      } catch (e) {
        console.error('Failed to get API key:', e);
      }
    }

    await invoke('send_message', {
      baseUrl: provider.base_url,
      apiKey,
      model: model.model_name,
      messages: messagesForApi,
      temperature: 0.7,
      maxTokens: 4096,
    });
    cleanupStreamListeners();

    const assistantContent = parseContent(assistantMsg.content_json);
    let savedAssistant: Message | null = null;
    try {
      savedAssistant = await invoke<Message>('save_assistant_message', {
        conversationId,
        content: assistantContent,
        reasoning: assistantMsg.reasoning_content,
        providerId: provider.id,
        providerName: provider.name,
        modelId: model.id,
        modelName: model.model_name,
        status: assistantMsg.status === 'failed' ? 'failed' : 'completed',
      });
      assistantMsg.id = savedAssistant.id;
      assistantMsg.status = savedAssistant.status;
      assistantMsg.created_at = savedAssistant.created_at;
    } catch (e) {
      console.error('Failed to save assistant message:', e);
    }

    const parts = deriveTokenParts(messagesForApi, assistantContent, capture.usage);
    try {
      await invoke('record_generation_run', {
        input: {
          conversation_id: conversationId,
          assistant_message_id: savedAssistant?.id ?? null,
          provider_id: provider.id,
          model_id: model.id,
          status: assistantMsg.status === 'failed' ? 'failed' : 'completed',
          uncached_input_tokens: parts.uncachedInput,
          cache_read_input_tokens: parts.cachedInput,
          cache_write_input_tokens: parts.cacheWriteInput,
          output_tokens: parts.output,
          usage_source: parts.source,
          first_event_latency_ms: capture.metrics?.first_event_ms ?? null,
          first_token_latency_ms: capture.metrics?.first_token_ms ?? null,
          duration_ms: capture.metrics?.total_ms ?? null,
        },
      });
      liveTokenUsage = null;
      await loadTokenUsage(conversationId);
      renderRightPanelInDom();
    } catch (e) {
      console.error('Failed to record token usage:', e);
    }
  } catch (e) {
    state.isStreaming = false;
    if (pendingAssistantMsg) {
      pendingAssistantMsg.status = 'failed';
    }
    liveTokenUsage = null;
    cleanupStreamListeners();
    renderChatArea();
    renderChatInputInDom();
    renderRightPanelInDom();
    alert('Send failed: ' + String(e));
  }
}

window.__handleSend = () => { handleSend(); };

async function setupStreamListeners(assistantMsgId: string, capture: StreamCapture): Promise<void> {
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
      assistantMsg.status = 'completed';
      state.isStreaming = false;
      renderChatInputInDom();
    }
    updateStreamingMessage(assistantMsg);
  });

  metricsUnlisten = await listen<StreamMetrics>('chat-metrics', (event) => {
    capture.metrics = event.payload;
  });
}

function cleanupStreamListeners(): void {
  if (streamUnlisten) { streamUnlisten(); streamUnlisten = null; }
  if (metricsUnlisten) { metricsUnlisten(); metricsUnlisten = null; }
}

function updateStreamingMessage(msg: Message): void {
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
      metaEl.innerHTML += '<span style="color:var(--warning);font-size:11px">Cancelled</span>';
    }
  }

  scrollToBottom();
}

function scrollToBottom(): void {
  const container = document.getElementById('chatMessages');
  if (container) {
    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
  }
}

export function autoResizeTextarea(textarea: HTMLTextAreaElement): void {
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
}

export function renderChatArea(): void {
  const messagesEl = document.getElementById('chatMessages');
  if (messagesEl) {
    messagesEl.innerHTML = renderChatMessages();
    scrollToBottom();
  }
  const titleEl = document.querySelector('.chat-center-title');
  if (titleEl) {
    const conv = state.conversations.find(c => c.id === state.currentConversationId);
    titleEl.textContent = conv?.title ?? 'New Conversation';
  }
  const modelEl = document.querySelector('.chat-center-model');
  if (modelEl) {
    const conv = state.conversations.find(c => c.id === state.currentConversationId);
    const model = conv ? state.models.find(m => m.id === conv.model_id) : null;
    modelEl.textContent = model?.display_name ?? model?.model_name ?? 'No model selected';
  }
}

export function renderConversationListInDom(): void {
  const listEl = document.getElementById('chatList');
  if (listEl) {
    listEl.innerHTML = renderConversationList();
    bindConversationListEvents();
  }
}

export function renderChatInputInDom(): void {
  const inputArea = document.querySelector('.chat-input-area');
  if (inputArea) {
    const parent = inputArea.parentElement;
    if (parent) {
      inputArea.outerHTML = renderChatInput();
      bindChatInputEvents();
    }
  }
}

export function renderRightPanelInDom(): void {
  const panelBody = document.querySelector('.chat-right .panel-body');
  if (panelBody) {
    panelBody.innerHTML = renderRightPanelContent();
  }
}

export function bindConversationListEvents(): void {
  document.querySelectorAll<HTMLElement>('[data-conv-id]').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.convId;
      if (id) selectConversation(id);
    });
  });

  const newBtn = document.querySelector('.chat-new-btn');
  if (newBtn) {
    newBtn.addEventListener('click', () => createConversation());
  }
}

export function bindChatInputEvents(): void {
  const input = document.getElementById('chatInput') as HTMLTextAreaElement | null;
  if (input) {
    input.addEventListener('keydown', (e) => {
      const sendKey = localStorage.getItem('tc-send-key') || 'enter';
      const isSend = sendKey === 'enter' ? (e.key === 'Enter' && !e.shiftKey) : (e.key === 'Enter' && e.shiftKey);
      const isNewline = sendKey === 'enter' ? (e.key === 'Enter' && e.shiftKey) : (e.key === 'Enter' && !e.shiftKey);
      if (isSend) {
        e.preventDefault();
        handleSend();
      } else if (isNewline) {
        // Allow default newline behavior
      }
    });
    input.addEventListener('input', () => autoResizeTextarea(input));
    input.focus();
  }
  const sendBtn = document.getElementById('sendBtn');
  if (sendBtn) {
    sendBtn.addEventListener('click', () => handleSend());
  }
}

export function bindChatEvents(): void {
  bindConversationListEvents();
  bindChatInputEvents();

  document.querySelectorAll<HTMLElement>('[data-toggle-thinking]').forEach(el => {
    el.addEventListener('click', () => {
      const body = el.querySelector('.msg-thinking-body') as HTMLElement | null;
      if (body) {
        body.style.display = body.style.display === 'none' ? '' : 'none';
      }
    });
  });
}
