import { state, parseContent, type Model } from './state';
import { getLang, t } from './i18n';
import { tooltipAttrs } from './tooltip';
import { convertCurrencyNanos, formatCurrencyAmount, formatCurrencyNanos, getDisplayCurrency } from './currency';
import { renderMarkdown } from './chat-markdown';
import { loadConversationTokenUsage } from './ipc/chat-ipc';
import { isWebRuntime } from './platform/runtime';

// ── Interfaces ──

export interface StreamChunk {
  content: string;
  reasoning: string;
  done: boolean;
  usage?: StreamUsage;
}

export interface StreamUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  cached_tokens?: number;
  total_tokens?: number;
}

export interface StreamMetrics {
  first_event_ms: number;
  first_token_ms: number;
  total_ms: number;
  tokens_generated: number;
}

export type ApiMessageContent =
  | string
  | Array<
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string } }
    >;

export interface ApiMessage {
  role: string;
  content: ApiMessageContent;
}

interface TokenParts {
  uncachedInput: number;
  cachedInput: number;
  cacheWriteInput: number;
  output: number;
  source: 'provider_reported' | 'estimated';
}

interface CurrencyCost {
  currency: string;
  cost_nanos: number;
}

export interface TokenUsageRun {
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  cost_nanos: number;
  currency?: string;
  first_event_latency_ms?: number | null;
  first_token_latency_ms?: number | null;
  duration_ms?: number | null;
  created_at: number;
}

export interface ConversationTokenUsage {
  conversation_id: string;
  uncached_input_tokens: number;
  cached_input_tokens: number;
  cache_write_input_tokens: number;
  output_tokens: number;
  cost_nanos: number;
  cost_by_currency?: CurrencyCost[];
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

export interface StreamCapture {
  sendId: number;
  conversationId: string;
  messagesForApi: ApiMessage[];
  model: Model;
  usage: StreamUsage | null;
  metrics: StreamMetrics | null;
}

// ── State ──

export let currentTokenUsage: ConversationTokenUsage | null = null;
export let liveTokenUsage: LiveTokenUsage | null = null;

export function resetLiveTokenUsage(): void {
  liveTokenUsage = null;
}

export function setCurrentTokenUsage(v: ConversationTokenUsage | null): void {
  currentTokenUsage = v;
}

// ── Helpers ──

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function clampTokenNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

export function estimateTokenCount(text: string): number {
  if (!text.trim()) return 0;
  const cjkCount = (text.match(/[㐀-鿿豈-﫿]/g) ?? []).length;
  const nonCjkText = text.replace(/[㐀-鿿豈-﫿]/g, '');
  return Math.max(1, cjkCount + Math.ceil(nonCjkText.length / 4));
}

export function stringifyApiContent(content: ApiMessageContent): string {
  if (typeof content === 'string') return content;
  return content.map(part => {
    if (part.type === 'text') return part.text;
    return '[Image attachment]';
  }).join('\n');
}

function estimatePromptTokens(messages: ApiMessage[]): number {
  return messages.reduce((sum, msg) => sum + estimateTokenCount(stringifyApiContent(msg.content)) + 4, 2);
}

export function deriveTokenParts(messagesForApi: ApiMessage[], assistantContent: string, usage: StreamUsage | null): TokenParts {
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

export function calculateCostNanos(parts: TokenParts, model: Model): number {
  const total =
    parts.uncachedInput * model.uncached_input_nanos_per_million +
    parts.cachedInput * model.cache_read_nanos_per_million +
    parts.output * model.output_nanos_per_million;
  return Math.max(0, Math.round(total / 1_000_000));
}

function formatConvertedCostNanos(nanos: number, sourceCurrency: string): string {
  return formatCurrencyNanos(convertCurrencyNanos(nanos, sourceCurrency), 4);
}

function formatConversationCost(usage: ConversationTokenUsage): string {
  const costs = usage.cost_by_currency?.length
    ? usage.cost_by_currency
    : [{ currency: usage.currency, cost_nanos: usage.cost_nanos }];
  const convertedNanos = costs.reduce(
    (sum, item) => sum + convertCurrencyNanos(item.cost_nanos, item.currency),
    0,
  );
  return formatCurrencyNanos(convertedNanos, 4);
}

function formatShortDateTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function relativeTime(ts: number): string {
  const now = Date.now();
  const diff = now - ts * 1000;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

// ── Token usage ──

function getTokenChartText() {
  if (getLang() === 'zh') {
    return {
      title: 'Token 用量（最近 10 条消息）',
      noData: '暂无数据',
      input: '输入',
      cached: '缓存输入',
      output: '输出',
      total: '总计',
      cost: '费用',
      tokens: 'Token',
    };
  }
  return {
    title: 'Token Usage (last 10 msgs)',
    noData: 'No data yet',
    input: 'Input',
    cached: 'Cached Input',
    output: 'Output',
    total: 'Total',
    cost: 'Cost',
    tokens: 'tokens',
  };
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
    cost_by_currency: [{ currency: model?.currency ?? getDisplayCurrency(), cost_nanos: costNanos }],
    request_count: assistantMessages.length,
    currency: model?.currency ?? getDisplayCurrency(),
    recent_runs: assistantMessages.slice(-10).map(m => ({
      input_tokens: 0,
      cached_input_tokens: 0,
      output_tokens: estimateTokenCount(parseContent(m.content_json)),
      cost_nanos: 0,
      currency: model?.currency ?? getDisplayCurrency(),
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
      cost_by_currency: [],
      request_count: 0,
      currency: model?.currency ?? getDisplayCurrency(),
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
    cost_by_currency: [
      ...(base.cost_by_currency ?? [{ currency: base.currency, cost_nanos: base.cost_nanos }]),
      { currency: liveTokenUsage.currency, cost_nanos: liveTokenUsage.costNanos },
    ],
    request_count: base.request_count + 1,
    currency: liveTokenUsage.currency || base.currency,
    recent_runs: [...base.recent_runs, liveTokenUsage.run].slice(-10),
  };
}

export async function loadTokenUsage(conversationId: string): Promise<void> {
  const isDev = isWebRuntime();
  if (isDev) {
    currentTokenUsage = null;
    return;
  }
  try {
    currentTokenUsage = await loadConversationTokenUsage(conversationId);
  } catch {
    currentTokenUsage = null;
  }
}

export function updateLiveTokenUsage(capture: StreamCapture, assistantContent: string): void {
  const parts = deriveTokenParts(capture.messagesForApi, assistantContent, capture.usage);
  const costNanos = calculateCostNanos(parts, capture.model);
  liveTokenUsage = {
    conversationId: capture.conversationId,
    parts,
    costNanos,
    currency: capture.model.currency,
    run: {
      input_tokens: parts.uncachedInput + parts.cachedInput + parts.cacheWriteInput,
      cached_input_tokens: parts.cachedInput,
      output_tokens: parts.output,
      cost_nanos: costNanos,
      currency: capture.model.currency,
      created_at: Math.floor(Date.now() / 1000),
    },
  };
}

// ── Mini chart ──

function renderMiniChart(runs: TokenUsageRun[]): string {
  const text = getTokenChartText();
  if (runs.length === 0) {
    return `<svg viewBox="0 0 260 60" style="width:100%;height:60px">
      <line x1="0" y1="58" x2="260" y2="58" stroke="var(--line)" stroke-width="1"/>
      <text x="130" y="34" text-anchor="middle" fill="var(--text-faint)" class="chart-text">${text.noData}</text>
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
    const cachedHeight = total > 0 ? (run.cached_input_tokens / total) * totalHeight : 0;
    const uncachedHeight = totalHeight - outputHeight - cachedHeight;
    const x = startX + idx * (barWidth + gap);
    const cachedY = 58 - totalHeight;
    const uncachedY = cachedY + cachedHeight;
    const outputY = 58 - outputHeight;
    const uncachedInput = run.input_tokens - run.cached_input_tokens;
    return `<g class="mini-chart-run" ${tooltipAttrs(formatShortDateTime(run.created_at), [
      { label: text.input, value: `${run.input_tokens.toLocaleString()} ${text.tokens}`, color: 'var(--chart-input)' },
      { label: text.cached, value: `${run.cached_input_tokens.toLocaleString()} ${text.tokens}`, color: 'var(--stack-cache)' },
      { label: text.output, value: `${run.output_tokens.toLocaleString()} ${text.tokens}`, color: 'var(--chart-output)' },
      { label: text.total, value: `${total.toLocaleString()} ${text.tokens}`, color: 'var(--chart-line)' },
      { label: text.cost, value: formatConvertedCostNanos(run.cost_nanos, run.currency ?? getDisplayCurrency()) },
    ])}>
      <rect x="${x}" y="${cachedY}" width="${barWidth}" height="${Math.max(0, cachedHeight)}" rx="2" fill="var(--stack-cache)" opacity="0.75"/>
      <rect x="${x}" y="${uncachedY}" width="${barWidth}" height="${Math.max(0, uncachedHeight)}" rx="2" fill="var(--chart-input)" opacity="0.75"/>
      <rect x="${x}" y="${outputY}" width="${barWidth}" height="${outputHeight}" rx="2" fill="var(--chart-output)" opacity="0.85"/>
    </g>`;
  }).join('');

  return `<svg viewBox="0 0 260 60" style="width:100%;height:60px">
    <line x1="0" y1="58" x2="260" y2="58" stroke="var(--line)" stroke-width="1"/>
    ${bars}
  </svg>`;
}

// ── Right panel ──

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
      <div class="metric-card-value">${formatCurrencyAmount(0, 2)}</div>
      <div class="metric-card-sub">0 ${t('chat.messages')}</div>
    </div>
    <div class="model-info-card">
      <div class="model-info-name">${t('chat.noModel')}</div>
      <div class="model-info-provider">-</div>
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
  const costLabel = formatConversationCost(usage);
  const tokenChartText = getTokenChartText();

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
    <div class="metric-row">
      <div class="metric-card">
        <div class="metric-card-label">${t('chat.cacheHitRate')}</div>
        <div class="metric-card-value">${(() => {
          const totalCacheable = usage.cached_input_tokens + usage.uncached_input_tokens;
          if (totalCacheable === 0) return '-';
          return `${Math.round(usage.cached_input_tokens / totalCacheable * 100)}%`;
        })()}</div>
        <div class="metric-card-sub">${usage.cached_input_tokens.toLocaleString()} / ${totalInput.toLocaleString()}</div>
      </div>
      <div class="metric-card">
        <div class="metric-card-label">${t('chat.sessionCost')}</div>
        <div class="metric-card-value">${costLabel}</div>
        <div class="metric-card-sub">${usage.request_count} ${t('chat.messages')}</div>
      </div>
    </div>
    <div class="mini-chart">
      <div class="mini-chart-title">${tokenChartText.title}</div>
      ${renderMiniChart(usage.recent_runs)}
    </div>
    ${model ? `
    <div class="model-info-card">
      <div class="model-info-name">${escHtml(model.display_name || model.model_name)}</div>
      <div class="model-info-provider">${escHtml(model.provider_id)}</div>
      <div class="model-info-stats">
        <div><div class="model-info-stat-label">${t('chat.cacheReadPerM')}</div><div class="model-info-stat-value">${formatCurrencyAmount(model.cache_read_nanos_per_million / 1e9, 2, model.currency)}</div></div>
        <div><div class="model-info-stat-label">${t('chat.inputPerM')}</div><div class="model-info-stat-value">${formatCurrencyAmount(model.uncached_input_nanos_per_million / 1e9, 2, model.currency)}</div></div>
        <div><div class="model-info-stat-label">${t('chat.outputPerM')}</div><div class="model-info-stat-value">${formatCurrencyAmount(model.output_nanos_per_million / 1e9, 2, model.currency)}</div></div>
        <div><div class="model-info-stat-label">${t('chat.maxCtx')}</div><div class="model-info-stat-value">${(model.context_window / 1000).toFixed(0)}K</div></div>
        <div><div class="model-info-stat-label">${t('chat.latency')}</div><div class="model-info-stat-value">${(() => {
          const latencyRuns = usage.recent_runs.filter(r => r.first_token_latency_ms != null && r.first_token_latency_ms > 0);
          if (latencyRuns.length === 0) return '-';
          const avg = Math.round(latencyRuns.reduce((s, r) => s + (r.first_token_latency_ms ?? 0), 0) / latencyRuns.length);
          return `${avg}ms`;
        })()}</div></div>
        <div><div class="model-info-stat-label">${t('chat.tokenRate')}</div><div class="model-info-stat-value">${(() => {
          const rateRuns = usage.recent_runs.filter(r => r.duration_ms != null && r.duration_ms > 0 && r.output_tokens > 0 && r.first_token_latency_ms != null && (r.duration_ms - (r.first_token_latency_ms ?? 0)) > 0);
          if (rateRuns.length === 0) return '-';
          const totalOutput = rateRuns.reduce((s, r) => s + r.output_tokens, 0);
          const totalGenTime = rateRuns.reduce((s, r) => s + (r.duration_ms ?? 0) - (r.first_token_latency_ms ?? 0), 0);
          if (totalGenTime <= 0) return '-';
          const rate = Math.round(totalOutput / totalGenTime * 1000);
          return `${rate} t/s`;
        })()}</div></div>
      </div>
    </div>` : `
    <div class="model-info-card">
      <div class="model-info-name">${t('chat.noModel')}</div>
      <div class="model-info-provider">-</div>
    </div>`}
  `;
}
