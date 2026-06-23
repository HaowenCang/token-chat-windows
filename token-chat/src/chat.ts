import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { openUrl } from '@tauri-apps/plugin-opener';
import { state, type Conversation, type Message, type Model } from './state';
import { getLang, t } from './i18n';
import { getEffectiveSystemPrompt } from './prompt';
import { tooltipAttrs } from './tooltip';
import { convertCurrencyNanos, formatCurrencyAmount, formatCurrencyNanos, getDisplayCurrency } from './currency';
import { showGlassAlert, showGlassPrompt } from './glass-dialog';
import {
  buildSearchAugmentedPrompt,
  cancelWebSearch,
  getSearchConfigSnapshot,
  getSearchProvider,
  isSafeSourceUrl,
  parseSearchMetadata,
  type MessageSearchMetadata,
} from './web-search';

declare global {
  interface Window {
    __handleSend: () => void;
  }
}

let streamUnlisten: UnlistenFn | null = null;
let metricsUnlisten: UnlistenFn | null = null;
const isDev = !(window as any).__TAURI_INTERNALS__;

const devNow = Math.floor(Date.now() / 1000);
const mockConversations: Conversation[] = [
  { id: 'demo-1', title: '如何优化 TypeScript 项目', provider_id: 'p2', model_id: 'm3', pinned_at: devNow, archived_at: null, updated_at: devNow - 180 },
  { id: 'demo-2', title: 'API 设计最佳实践', provider_id: 'p1', model_id: 'm1', pinned_at: null, archived_at: null, updated_at: devNow - 86400 },
  { id: 'demo-3', title: '实现一个虚拟列表组件', provider_id: 'p1', model_id: 'm2', pinned_at: null, archived_at: null, updated_at: devNow - 172800 },
  { id: 'demo-4', title: 'Windows 客户端开发建议', provider_id: 'p1', model_id: 'm1', pinned_at: null, archived_at: null, updated_at: devNow - 259200 },
  { id: 'demo-5', title: '数据库索引优化指南', provider_id: 'p2', model_id: 'm3', pinned_at: null, archived_at: null, updated_at: devNow - 345600 },
];

const mockMessages: Message[] = [
  {
    id: 'demo-user-1', conversation_id: 'demo-1', role: 'user',
    content_json: JSON.stringify('如何优化大型 TypeScript 项目的构建速度？请给出可落地的方案，包括工具链、配置和代码组织方面的建议。'),
    reasoning_content: null, provider_name: null, model_name: null, status: 'completed', attachments_json: null, created_at: devNow - 170,
  },
  {
    id: 'demo-assistant-1', conversation_id: 'demo-1', role: 'assistant',
    content_json: JSON.stringify(`优化大型 TypeScript 项目的构建速度，可以从工具链、任务编排与代码组织三条线同时推进。

## 1. 工具链选择

- 使用更快的转译工具：开发阶段用 **esbuild**、**SWC** 或基于 esbuild 的 Vite。
- 将类型检查从转译流程中拆开，使用独立的 \`tsc --noEmit\` 任务并行执行。
- 对多包仓库使用 Turborepo 或 Nx，只构建真正发生变化的工作区。

## 2. 配置优化

- 开启 \`incremental\` 与 \`tsBuildInfoFile\`，复用上一次类型检查结果。
- 使用 \`skipLibCheck\` 减少第三方声明文件的重复检查。
- 收紧 \`include\` / \`exclude\`，避免测试产物与生成目录进入编译图。

## 3. 代码组织

按稳定边界拆分项目引用，让核心包、UI 包和工具包拥有独立缓存。先用构建分析器找出最慢的 10%，再决定是否增加新的工程复杂度。`),
    reasoning_content: null, provider_name: 'Anthropic', model_name: 'Claude Sonnet 4', status: 'completed', attachments_json: null, created_at: devNow - 120,
  },
];

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

type ApiMessageContent =
  | string
  | Array<
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string } }
    >;

interface ApiMessage {
  role: string;
  content: ApiMessageContent;
}

interface MessageAttachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  kind: 'text' | 'image' | 'binary';
  content?: string;
  data_url?: string;
  truncated?: boolean;
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

interface TokenUsageRun {
  input_tokens: number;
  output_tokens: number;
  cost_nanos: number;
  currency?: string;
  first_event_latency_ms?: number | null;
  first_token_latency_ms?: number | null;
  created_at: number;
}

interface ConversationTokenUsage {
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

interface StreamCapture {
  sendId: number;
  conversationId: string;
  messagesForApi: ApiMessage[];
  model: Model;
  usage: StreamUsage | null;
  metrics: StreamMetrics | null;
}

let currentTokenUsage: ConversationTokenUsage | null = null;
let liveTokenUsage: LiveTokenUsage | null = null;
let selectedAttachments: MessageAttachment[] = [];
let selectionCopyFallbackBound = false;
let sendSequence = 0;
let activeSendId = 0;
const cancelledSendIds = new Set<number>();
let sendPreparationInProgress = false;
let webSearchPhase: 'idle' | 'searching' | 'success' | 'error' = 'idle';
let webSearchStatusText = '';

const MAX_TEXT_ATTACHMENT_BYTES = 180_000;
const MAX_IMAGE_ATTACHMENT_BYTES = 4_000_000;

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function isChatWebSearchEnabled(): boolean {
  return getSearchConfigSnapshot().config.enabled && localStorage.getItem('tc-chat-web-search-enabled') === 'true';
}

function setWebSearchPhase(phase: typeof webSearchPhase, text = ''): void {
  webSearchPhase = phase;
  webSearchStatusText = text;
}

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function parseAttachments(json: string | null | undefined): MessageAttachment[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isTextLike(file: File): boolean {
  if (file.type.startsWith('text/')) return true;
  return /\.(csv|json|log|md|txt|xml|yaml|yml|ts|tsx|js|jsx|css|html|rs|py|java|go|sql)$/i.test(file.name);
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

async function fileToAttachment(file: File): Promise<MessageAttachment> {
  const base: MessageAttachment = {
    id: crypto.randomUUID(),
    name: file.name,
    mime: file.type || 'application/octet-stream',
    size: file.size,
    kind: 'binary',
  };

  if (file.type.startsWith('image/')) {
    if (file.size <= MAX_IMAGE_ATTACHMENT_BYTES) {
      return { ...base, kind: 'image', data_url: await readFileAsDataUrl(file) };
    }
    return { ...base, kind: 'image', truncated: true };
  }

  if (isTextLike(file)) {
    const truncated = file.size > MAX_TEXT_ATTACHMENT_BYTES;
    const slice = truncated ? file.slice(0, MAX_TEXT_ATTACHMENT_BYTES) : file;
    return {
      ...base,
      kind: 'text',
      content: await slice.text(),
      truncated,
    };
  }

  return base;
}

async function addAttachmentFiles(files: FileList | null): Promise<void> {
  if (!files || files.length === 0) return;
  const additions = await Promise.all(Array.from(files).map(fileToAttachment));
  selectedAttachments = [...selectedAttachments, ...additions];
}

function renderAttachmentDrafts(): string {
  if (selectedAttachments.length === 0) return '';
  return `
    <div class="attachment-drafts">
      ${selectedAttachments.map(a => `
        <div class="attachment-chip">
          <span class="attachment-chip-name">${escHtml(a.name)}</span>
          <span class="attachment-chip-meta">${escHtml(a.kind)} · ${formatFileSize(a.size)}</span>
          <button class="attachment-remove" data-remove-attachment="${a.id}" title="Remove attachment">&#10005;</button>
        </div>
      `).join('')}
    </div>
  `;
}

function renderMessageAttachments(attachments: MessageAttachment[]): string {
  if (attachments.length === 0) return '';
  return `
    <div class="msg-attachments">
      ${attachments.map(a => `
        <div class="msg-attachment">
          ${a.kind === 'image' && a.data_url ? `<img src="${escHtml(a.data_url)}" alt="${escHtml(a.name)}">` : ''}
          <div class="msg-attachment-name">${escHtml(a.name)}</div>
          <div class="msg-attachment-meta">${escHtml(a.mime)} · ${formatFileSize(a.size)}${a.truncated ? ' · truncated' : ''}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function stringifyApiContent(content: ApiMessageContent): string {
  if (typeof content === 'string') return content;
  return content.map(part => {
    if (part.type === 'text') return part.text;
    return '[Image attachment]';
  }).join('\n');
}

function buildTextWithAttachments(text: string, attachments: MessageAttachment[]): string {
  const parts: string[] = [];
  if (text.trim()) parts.push(text.trim());

  const attachmentTexts = attachments.map(a => {
    if (a.kind === 'text' && a.content) {
      return [
        `File: ${a.name}`,
        `Type: ${a.mime || 'text/plain'}`,
        a.truncated ? 'Note: content was truncated.' : '',
        'Content:',
        a.content,
      ].filter(Boolean).join('\n');
    }
    return `File: ${a.name}\nType: ${a.mime}\nSize: ${formatFileSize(a.size)}${a.truncated ? '\nNote: file was too large to embed.' : ''}`;
  });

  if (attachmentTexts.length > 0) {
    parts.push(`Attachments:\n\n${attachmentTexts.join('\n\n---\n\n')}`);
  }
  return parts.join('\n\n');
}

function buildApiContent(text: string, attachments: MessageAttachment[]): ApiMessageContent {
  const imageAttachments = attachments.filter(a => a.kind === 'image' && a.data_url);
  const textPart = buildTextWithAttachments(text, attachments);
  if (imageAttachments.length === 0) return textPart;

  return [
    { type: 'text', text: textPart || 'Please review the attached file(s).' },
    ...imageAttachments.map(a => ({ type: 'image_url' as const, image_url: { url: a.data_url! } })),
  ];
}

function titleFromContent(text: string, attachments: MessageAttachment[]): string {
  const source = text.trim() || attachments[0]?.name || 'New Conversation';
  const cleaned = source
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#*_`>\[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > 28 ? `${cleaned.slice(0, 28)}...` : cleaned;
}

function isDefaultConversationTitle(title: string): boolean {
  const normalized = title.trim().toLowerCase();
  return normalized === '' || normalized === 'new conversation' || title.trim() === '新对话';
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
  return messages.reduce((sum, msg) => sum + estimateTokenCount(stringifyApiContent(msg.content)) + 4, 2);
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

function getTokenChartText() {
  if (getLang() === 'zh') {
    return {
      title: 'Token \u7528\u91cf\uff08\u6700\u8fd1 10 \u6761\u6d88\u606f\uff09',
      noData: '\u6682\u65e0\u6570\u636e',
      input: '\u8f93\u5165',
      output: '\u8f93\u51fa',
      total: '\u603b\u8ba1',
      cost: '\u8d39\u7528',
      tokens: 'Token',
    };
  }
  return {
    title: 'Token Usage (last 10 msgs)',
    noData: 'No data yet',
    input: 'Input',
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
    const inputHeight = totalHeight - outputHeight;
    const x = startX + idx * (barWidth + gap);
    const inputY = 58 - totalHeight;
    const outputY = 58 - outputHeight;
    return `<g class="mini-chart-run" ${tooltipAttrs(formatShortDateTime(run.created_at), [
      { label: text.input, value: `${run.input_tokens.toLocaleString()} ${text.tokens}`, color: 'var(--chart-input)' },
      { label: text.output, value: `${run.output_tokens.toLocaleString()} ${text.tokens}`, color: 'var(--chart-output)' },
      { label: text.total, value: `${total.toLocaleString()} ${text.tokens}`, color: 'var(--chart-line)' },
      { label: text.cost, value: formatConvertedCostNanos(run.cost_nanos, run.currency ?? getDisplayCurrency()) },
    ])}>
      <rect x="${x}" y="${inputY}" width="${barWidth}" height="${inputHeight}" rx="2" fill="var(--chart-input)" opacity="0.75"/>
      <rect x="${x}" y="${outputY}" width="${barWidth}" height="${outputHeight}" rx="2" fill="var(--chart-output)" opacity="0.85"/>
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
      currency: capture.model.currency,
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

function formatShortDateTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function placeholderToken(index: number): string {
  return `\uE000${index}\uE001`;
}

function restorePlaceholders(html: string, placeholders: string[]): string {
  return html.replace(/\uE000(\d+)\uE001/g, (_, idx) => placeholders[Number(idx)] ?? '');
}

function renderLatex(math: string, block: boolean): string {
  let html = escHtml(math.trim());
  html = html.replace(/\\mathbf\{([^{}]+)\}/g, '<span class="math-vector">$1</span>');
  html = html.replace(/\\mathrm\{([^{}]+)\}/g, '<span class="math-roman">$1</span>');

  for (let i = 0; i < 4; i += 1) {
    html = html.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '<span class="math-frac"><span>$1</span><span>$2</span></span>');
  }

  const commands: Record<string, string> = {
    '\\varepsilon': 'ε',
    '\\epsilon': 'ε',
    '\\partial': '∂',
    '\\nabla': '∇',
    '\\cdot': '·',
    '\\times': '×',
    '\\rho': 'ρ',
    '\\mu': 'μ',
    '\\pi': 'π',
    '\\alpha': 'α',
    '\\beta': 'β',
    '\\gamma': 'γ',
    '\\Delta': 'Δ',
    '\\delta': 'δ',
    '\\leq': '≤',
    '\\geq': '≥',
    '\\neq': '≠',
    '\\infty': '∞',
    '\\left': '',
    '\\right': '',
  };
  for (const [cmd, value] of Object.entries(commands).sort((a, b) => b[0].length - a[0].length)) {
    html = html.split(cmd).join(value);
  }
  html = html.replace(/\\([a-zA-Z]+)/g, '$1');
  html = html.replace(/_\{([^{}]+)\}/g, '<sub>$1</sub>');
  html = html.replace(/_([A-Za-z0-9]+)/g, '<sub>$1</sub>');
  html = html.replace(/\^\{([^{}]+)\}/g, '<sup>$1</sup>');
  html = html.replace(/\^([A-Za-z0-9+\-=]+)/g, '<sup>$1</sup>');

  const cls = block ? 'math-block' : 'math-inline';
  const tag = block ? 'div' : 'span';
  return `<${tag} class="${cls}" title="${escHtml(math.trim())}">${html}</${tag}>`;
}

function renderInlineMarkdown(text: string): string {
  const placeholders: string[] = [];
  let working = text.replace(/`([^`]+)`/g, (_, code) => {
    const token = placeholderToken(placeholders.length);
    placeholders.push(`<code class="md-inline-code">${escHtml(code)}</code>`);
    return token;
  });
  working = working.replace(/\$([^$\n]+)\$/g, (_, math) => {
    const token = placeholderToken(placeholders.length);
    placeholders.push(renderLatex(math, false));
    return token;
  });

  let html = escHtml(working);
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  return restorePlaceholders(html, placeholders);
}

export function renderMarkdown(text: string): string {
  const blockPlaceholders: string[] = [];
  let source = text.replace(/\r\n/g, '\n');
  source = source.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const label = lang ? `<span class="msg-code-lang">${escHtml(lang)}</span>` : '';
    const token = placeholderToken(blockPlaceholders.length);
    blockPlaceholders.push(`<div class="msg-code-block"><div class="msg-code-toolbar">${label}<button class="msg-code-copy" onclick="navigator.clipboard.writeText(this.closest('.msg-code-block').querySelector('code').textContent)">Copy</button></div><pre><code>${escHtml(code)}</code></pre></div>`);
    return `\n${token}\n`;
  });
  source = source.replace(/\$\$([\s\S]*?)\$\$/g, (_, math) => {
    const token = placeholderToken(blockPlaceholders.length);
    blockPlaceholders.push(renderLatex(math, true));
    return `\n${token}\n`;
  });

  const parts: string[] = [];
  let paragraph: string[] = [];
  let listType: 'ul' | 'ol' | null = null;

  const closeList = () => {
    if (listType) {
      parts.push(`</${listType}>`);
      listType = null;
    }
  };
  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    closeList();
    parts.push(`<p>${paragraph.map(renderInlineMarkdown).join('<br>')}</p>`);
    paragraph = [];
  };
  const openList = (type: 'ul' | 'ol', start = 1) => {
    flushParagraph();
    if (listType === type) return;
    closeList();
    listType = type;
    parts.push(type === 'ol'
      ? `<ol class="md-list" start="${start}">`
      : '<ul class="md-list">');
  };

  for (const line of source.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      closeList();
      continue;
    }
    if (/^\uE000\d+\uE001$/.test(trimmed)) {
      flushParagraph();
      closeList();
      parts.push(trimmed);
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      closeList();
      const level = Math.min(6, heading[1].length);
      parts.push(`<h${level} class="md-heading md-h${level}">${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    const unordered = /^[-*+]\s+(.+)$/.exec(trimmed);
    if (unordered) {
      openList('ul');
      parts.push(`<li>${renderInlineMarkdown(unordered[1])}</li>`);
      continue;
    }

    const ordered = /^(\d+)\.\s+(.+)$/.exec(trimmed);
    if (ordered) {
      const ordinal = Math.max(1, Number.parseInt(ordered[1], 10) || 1);
      openList('ol', ordinal);
      parts.push(`<li value="${ordinal}">${renderInlineMarkdown(ordered[2])}</li>`);
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  closeList();
  return `<div class="markdown-body">${restorePlaceholders(parts.join(''), blockPlaceholders)}</div>`;
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
    return `
      <div class="chat-welcome">
        <div class="welcome-orb" aria-hidden="true"><span></span></div>
        <h1>${t('chat.selectOrCreate')}</h1>
        <p>${t('chat.noConversations')}</p>
      </div>
    `;
  }
  if (state.messages.length === 0) {
    return `
      <div class="chat-welcome compact">
        <div class="welcome-orb" aria-hidden="true"><span></span></div>
        <h1>${t('chat.sendToBegin')}</h1>
      </div>
    `;
  }
  return state.messages.map(m => renderMessage(m)).join('');
}

function renderMessage(msg: Message): string {
  const role = msg.role;
  const content = parseContent(msg.content_json);
  const attachments = parseAttachments(msg.attachments_json);
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
  bubbleInner += renderMessageAttachments(attachments);
  bubbleInner += renderMessageSearchMetadata(msg, isUser);

  let statusHtml = '';
  if (msg.status === 'streaming') {
    statusHtml = '<span class="msg-metric"><span class="spinner" style="display:inline-block"></span></span>';
  } else if (msg.status === 'cancelled') {
    statusHtml = `<span style="color:var(--warning);font-size:var(--fs-secondary)">${t('chat.cancelled')}</span>`;
  } else if (msg.status === 'failed') {
    statusHtml = `<span style="color:var(--danger);font-size:var(--fs-secondary)">${t('chat.failed')}</span>`;
  }

  return `
    <div class="msg ${role}" data-msg-id="${msg.id}">
      <div class="msg-bubble">${bubbleInner}</div>
      <div class="msg-meta">
        ${!isUser && msg.model_name ? `<span class="msg-metric">${escHtml(msg.model_name)}</span>` : ''}
        ${statusHtml}
        <button class="msg-copy-btn" data-copy-msg-id="${escHtml(msg.id)}" title="Copy message">Copy</button>
      </div>
    </div>
  `;
}

function renderMessageSearchMetadata(msg: Message, isUser: boolean): string {
  const metadata = parseSearchMetadata(msg.search_metadata_json);
  if (!metadata) return '';
  if (metadata.error) {
    if (!isUser) return '';
    const brief = metadata.error.length > 140 ? `${metadata.error.slice(0, 139)}…` : metadata.error;
    return `<div class="message-search-state is-error" title="${escHtml(brief)}"><span aria-hidden="true">!</span> 搜索失败，已降级为普通对话</div>`;
  }
  if (metadata.results.length === 0) {
    return isUser ? '<div class="message-search-state is-empty">未检索到可用网络结果</div>' : '';
  }
  if (isUser) {
    return `<div class="message-search-state is-success"><span class="search-pulse-dot"></span>已检索 ${metadata.results.length} 条结果</div>`;
  }
  const sources = metadata.results
    .filter(result => isSafeSourceUrl(result.url))
    .map((result, index) => `
      <li class="message-source-item">
        <span class="message-source-index">${index + 1}</span>
        <div class="message-source-copy">
          <button class="message-source-title" type="button" data-open-source-url="${escHtml(result.url)}">${escHtml(result.title)}</button>
          <div class="message-source-meta">
            <span>${escHtml(result.source || sourceHost(result.url))}</span>
            <span class="message-source-url">${escHtml(result.url)}</span>
            ${result.publishedAt ? `<span>${escHtml(result.publishedAt)}</span>` : ''}
          </div>
        </div>
        <button class="message-source-open" type="button" data-open-source-url="${escHtml(result.url)}" aria-label="用系统浏览器打开来源">↗</button>
      </li>`)
    .join('');
  if (!sources) return '';
  return `
    <details class="message-sources">
      <summary><span>来源</span><span class="glass-chip">${metadata.results.length}</span></summary>
      <ol>${sources}</ol>
    </details>`;
}

function sourceHost(value: string): string {
  try {
    return new URL(value).hostname;
  } catch {
    return '网页来源';
  }
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

function getMessageCopyText(msg: Message): string {
  const parts = [parseContent(msg.content_json)];
  const attachments = parseAttachments(msg.attachments_json);
  if (attachments.length > 0) {
    parts.push(`Attachments:\n${attachments.map(a => `- ${a.name} (${a.mime}, ${formatFileSize(a.size)})`).join('\n')}`);
  }
  return parts.filter(Boolean).join('\n\n');
}

async function copyText(text: string): Promise<void> {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {}

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

function bindSelectionCopyFallback(): void {
  if (selectionCopyFallbackBound) return;
  selectionCopyFallbackBound = true;
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'c') return;
    const target = e.target as HTMLElement | null;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable) return;
    const selected = window.getSelection()?.toString() ?? '';
    if (selected.trim()) {
      void copyText(selected);
    }
  });
}

export function renderChatInput(): string {
  const streaming = state.isStreaming;
  const searchFeatureEnabled = getSearchConfigSnapshot().config.enabled;
  const searchEnabled = isChatWebSearchEnabled();
  const searchStatus = webSearchPhase !== 'idle' && webSearchStatusText
    ? `<span class="web-search-live-status is-${webSearchPhase}" aria-live="polite">${webSearchPhase === 'searching' ? '<span class="spinner"></span>' : ''}${escHtml(webSearchStatusText)}</span>`
    : '';
  return `
    <div class="chat-input-area">
      ${renderAttachmentDrafts()}
      <div class="chat-input-tools">
        <button class="web-search-toggle ${searchEnabled ? 'is-on' : ''}" id="webSearchToggle" type="button" role="switch" aria-checked="${searchEnabled}" ${!searchFeatureEnabled || streaming ? 'disabled' : ''} title="${searchFeatureEnabled ? '发送前检索网络资料' : '请先在设置中配置并启用网络搜索'}">
          <svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="8.5"/><path d="M3.8 12h16.4M12 3.5c2.2 2.3 3.4 5.1 3.4 8.5S14.2 18.2 12 20.5M12 3.5C9.8 5.8 8.6 8.6 8.6 12s1.2 6.2 3.4 8.5"/></svg>
          <span>联网搜索</span>
        </button>
        ${searchStatus}
      </div>
      <div class="chat-input-wrap">
        <input type="file" id="attachmentInput" multiple class="hidden">
        <button class="attach-btn" id="attachBtn" title="${t('chat.attach')}" aria-label="${t('chat.attach')}">
          <svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m8.5 12.5 6.2-6.2a3.2 3.2 0 1 1 4.5 4.5l-8.1 8.1a5 5 0 0 1-7.1-7.1l8.3-8.3"/><path d="m7.8 15.8 8.1-8.1"/></svg>
        </button>
        <textarea class="chat-input" rows="1" placeholder="${t('chat.typeMessage')}" id="chatInput"></textarea>
        ${streaming
          ? `<button class="send-btn" id="sendBtn" title="${t('chat.stop')}" aria-label="${t('chat.stop')}" style="background:var(--danger)"><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><rect x="7.5" y="7.5" width="9" height="9" rx="2"/></svg></button>`
          : `<button class="send-btn" id="sendBtn" title="${t('chat.send')}" aria-label="${t('chat.send')}"><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m6 12 6-6 6 6M12 7v11"/></svg></button>`
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
    <div class="metric-card">
      <div class="metric-card-label">${t('chat.sessionCost')}</div>
      <div class="metric-card-value">${costLabel}</div>
      <div class="metric-card-sub">${usage.request_count} ${t('chat.messages')}</div>
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
        <div><div class="model-info-stat-label">${t('chat.inputPerM')}</div><div class="model-info-stat-value">${formatCurrencyAmount(model.uncached_input_nanos_per_million / 1e9, 2, model.currency)}</div></div>
        <div><div class="model-info-stat-label">${t('chat.outputPerM')}</div><div class="model-info-stat-value">${formatCurrencyAmount(model.output_nanos_per_million / 1e9, 2, model.currency)}</div></div>
        <div><div class="model-info-stat-label">${t('chat.maxCtx')}</div><div class="model-info-stat-value">${(model.context_window / 1000).toFixed(0)}K</div></div>
        <div><div class="model-info-stat-label">${t('chat.latency')}</div><div class="model-info-stat-value">${(() => {
          const latencyRuns = usage.recent_runs.filter(r => r.first_token_latency_ms != null && r.first_token_latency_ms > 0);
          if (latencyRuns.length === 0) return '-';
          const avg = Math.round(latencyRuns.reduce((s, r) => s + (r.first_token_latency_ms ?? 0), 0) / latencyRuns.length);
          return `${avg}ms`;
        })()}</div></div>
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
      <div class="metric-card-value">${formatCurrencyAmount(0, 2)}</div>
      <div class="metric-card-sub">0 ${t('chat.messages')}</div>
    </div>
    <div class="model-info-card">
      <div class="model-info-name">${t('chat.noModel')}</div>
      <div class="model-info-provider">-</div>
    </div>
  `;
}

export async function loadConversations(): Promise<void> {
  if (isDev) {
    state.conversations = [...mockConversations];
    return;
  }
  try {
    state.conversations = await invoke<Conversation[]>('list_conversations');
  } catch {
    state.conversations = [];
  }
}

export async function selectConversation(id: string): Promise<void> {
  state.currentConversationId = id;
  liveTokenUsage = null;
  if (isDev) {
    state.messages = mockMessages.filter(message => message.conversation_id === id);
  } else {
    try {
      state.messages = await invoke<Message[]>('list_messages', { conversationId: id });
    } catch {
      state.messages = [];
    }
  }
  await loadTokenUsage(id);
  renderChatArea();
  renderConversationListInDom();
  renderRightPanelInDom();
}

export async function createConversation(): Promise<void> {
  if (isDev) {
    const now = Math.floor(Date.now() / 1000);
    const conv: Conversation = {
      id: crypto.randomUUID(), title: 'New Conversation',
      provider_id: state.providers[0]?.id ?? null,
      model_id: state.models.find(model => model.provider_id === state.providers[0]?.id)?.id ?? null,
      pinned_at: null, archived_at: null, updated_at: now,
    };
    state.conversations.unshift(conv);
    state.currentConversationId = conv.id;
    state.messages = [];
    renderChatArea();
    renderConversationListInDom();
    renderRightPanelInDom();
    return;
  }
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

async function updateConversationTitleLocal(conversationId: string, title: string): Promise<void> {
  const trimmed = title.trim();
  if (!trimmed) return;
  const conv = state.conversations.find(c => c.id === conversationId);
  if (!conv || conv.title === trimmed) return;
  conv.title = trimmed;
  conv.updated_at = Math.floor(Date.now() / 1000);
  if (!isDev) {
    try {
      await invoke('update_conversation_title', { id: conversationId, title: trimmed });
    } catch (e) {
      console.error('Failed to update conversation title:', e);
    }
  }
  renderChatArea();
  renderConversationListInDom();
}

async function maybeAutoGenerateConversationTitle(conversationId: string): Promise<void> {
  const conv = state.conversations.find(c => c.id === conversationId);
  if (!conv || !isDefaultConversationTitle(conv.title)) return;
  const firstUser = state.messages.find(m => m.conversation_id === conversationId && m.role === 'user');
  if (!firstUser) return;
  const title = titleFromContent(parseContent(firstUser.content_json), parseAttachments(firstUser.attachments_json));
  await updateConversationTitleLocal(conversationId, title);
}

export async function renameCurrentConversation(): Promise<void> {
  if (!state.currentConversationId) return;
  const conv = state.conversations.find(c => c.id === state.currentConversationId);
  if (!conv) return;
  const title = await showGlassPrompt('Conversation title', conv.title);
  if (title === null) return;
  await updateConversationTitleLocal(conv.id, title);
}

export async function handleSend(): Promise<void> {
  let pendingAssistantMsg: Message | null = null;
  let ownsPreparation = false;
  try {
    if (state.isStreaming) {
      cancelledSendIds.add(activeSendId);
      const streamingMessage = state.messages.find(message => message.status === 'streaming');
      if (streamingMessage) streamingMessage.status = 'cancelled';
      await Promise.allSettled([invoke('cancel_generation'), cancelWebSearch()]);
      state.isStreaming = false;
      setWebSearchPhase('idle');
      liveTokenUsage = null;
      renderChatArea();
      renderChatInputInDom();
      renderRightPanelInDom();
      return;
    }
    if (sendPreparationInProgress) return;
    sendPreparationInProgress = true;
    ownsPreparation = true;

    const input = document.getElementById('chatInput') as HTMLTextAreaElement | null;
    if (!input) return;
    const text = input.value.trim();
    const attachments = [...selectedAttachments];
    if (!text && attachments.length === 0) return;
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
    selectedAttachments = [];
    autoResizeTextarea(input);

    const sendId = ++sendSequence;
    activeSendId = sendId;
    let searchMetadata: MessageSearchMetadata | null = null;
    let augmentedUserText = text;
    const shouldSearch = isChatWebSearchEnabled() && Boolean(text);

    if (shouldSearch) {
      const searchConfig = getSearchConfigSnapshot().config;
      const searchProvider = getSearchProvider(searchConfig.providerId);
      state.isStreaming = true;
      setWebSearchPhase('searching', '正在搜索网络…');
      renderChatInputInDom();

      searchMetadata = {
        enabled: true,
        query: text,
        results: [],
        searchedAt: new Date().toISOString(),
        providerId: searchConfig.providerId,
      };

      if (!searchProvider) {
        searchMetadata.error = '未配置可用的 Search Provider';
        setWebSearchPhase('error', '搜索 Provider 不可用，已使用普通对话继续');
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
          setWebSearchPhase('success', `已检索 ${response.results.length} 条结果`);
        } catch (error) {
          const message = String(error);
          if (cancelledSendIds.has(sendId) || message.includes('SEARCH_CANCELLED')) {
            state.isStreaming = false;
            setWebSearchPhase('idle');
            selectedAttachments = attachments;
            renderChatInputInDom();
            const restoredInput = document.getElementById('chatInput') as HTMLTextAreaElement | null;
            if (restoredInput) {
              restoredInput.value = text;
              autoResizeTextarea(restoredInput);
            }
            cancelledSendIds.delete(sendId);
            return;
          }
          searchMetadata.error = message.length > 300 ? `${message.slice(0, 299)}…` : message;
          setWebSearchPhase('error', '搜索失败，已使用普通对话继续');
          console.warn('Web Search failed; continuing without search:', searchMetadata.error);
        }
      }
    }

    let savedUserMessage: Message;
    try {
      savedUserMessage = await invoke<Message>('save_user_message', {
        conversationId,
        content: text,
        attachmentsJson: attachments.length > 0 ? JSON.stringify(attachments) : null,
        searchMetadataJson: searchMetadata ? JSON.stringify(searchMetadata) : null,
      });
    } catch (e) {
      state.isStreaming = false;
      setWebSearchPhase('idle');
      renderChatInputInDom();
      await showGlassAlert('Failed to save message: ' + String(e));
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

    renderChatArea();
    renderConversationListInDom();
    renderChatInputInDom();
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

    if (cancelledSendIds.has(sendId)) {
      assistantMsg.status = 'cancelled';
    }

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
        status: assistantMsg.status === 'failed' ? 'failed' : assistantMsg.status === 'cancelled' ? 'cancelled' : 'completed',
        searchMetadataJson: searchMetadata ? JSON.stringify(searchMetadata) : null,
      });
      assistantMsg.id = savedAssistant.id;
      assistantMsg.status = savedAssistant.status;
      assistantMsg.created_at = savedAssistant.created_at;
      renderChatArea();
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
          status: assistantMsg.status === 'failed' ? 'failed' : assistantMsg.status === 'cancelled' ? 'cancelled' : 'completed',
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
    cancelledSendIds.delete(sendId);
    setWebSearchPhase('idle');
    renderChatInputInDom();
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
    await showGlassAlert('Send failed: ' + String(e));
  } finally {
    if (ownsPreparation) sendPreparationInProgress = false;
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
      assistantMsg.status = cancelledSendIds.has(capture.sendId) ? 'cancelled' : 'completed';
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
      metaEl.innerHTML += '<span style="color:var(--warning);font-size:var(--fs-secondary)">Cancelled</span>';
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
    bindMessageEvents();
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

function rerenderChatInputPreservingDraft(): void {
  const currentInput = document.getElementById('chatInput') as HTMLTextAreaElement | null;
  const draft = currentInput?.value ?? '';
  renderChatInputInDom();
  const nextInput = document.getElementById('chatInput') as HTMLTextAreaElement | null;
  if (nextInput) {
    nextInput.value = draft;
    autoResizeTextarea(nextInput);
    nextInput.focus();
  }
}

export function renderRightPanelInDom(): void {
  const panelBody = document.querySelector('.chat-right .panel-body');
  if (panelBody) {
    panelBody.innerHTML = renderRightPanelContent();
  }
}

function bindMessageEvents(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-open-source-url]').forEach(button => {
    button.addEventListener('click', async () => {
      const url = button.dataset.openSourceUrl ?? '';
      if (!isSafeSourceUrl(url)) return;
      try {
        await openUrl(url);
      } catch (error) {
        console.error('Failed to open source URL:', error);
      }
    });
  });

  document.querySelectorAll<HTMLButtonElement>('[data-copy-msg-id]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.copyMsgId;
      const msg = state.messages.find(m => m.id === id);
      if (!msg) return;
      await copyText(getMessageCopyText(msg));
      const oldText = btn.textContent ?? 'Copy';
      btn.textContent = 'Copied';
      btn.disabled = true;
      window.setTimeout(() => {
        btn.textContent = oldText;
        btn.disabled = false;
      }, 900);
    });
  });

  document.querySelectorAll<HTMLElement>('[data-toggle-thinking]').forEach(el => {
    el.addEventListener('click', () => {
      const body = el.querySelector('.msg-thinking-body') as HTMLElement | null;
      if (body) {
        body.style.display = body.style.display === 'none' ? '' : 'none';
      }
    });
  });
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

  const webSearchToggle = document.getElementById('webSearchToggle') as HTMLButtonElement | null;
  webSearchToggle?.addEventListener('click', () => {
    if (webSearchToggle.disabled || state.isStreaming) return;
    const next = webSearchToggle.getAttribute('aria-checked') !== 'true';
    localStorage.setItem('tc-chat-web-search-enabled', String(next));
    rerenderChatInputPreservingDraft();
  });

  const attachBtn = document.getElementById('attachBtn');
  const attachmentInput = document.getElementById('attachmentInput') as HTMLInputElement | null;
  if (attachBtn && attachmentInput) {
    attachBtn.addEventListener('click', () => attachmentInput.click());
    attachmentInput.addEventListener('change', async () => {
      await addAttachmentFiles(attachmentInput.files);
      attachmentInput.value = '';
      rerenderChatInputPreservingDraft();
    });
  }

  document.querySelectorAll<HTMLElement>('[data-remove-attachment]').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.removeAttachment;
      selectedAttachments = selectedAttachments.filter(a => a.id !== id);
      rerenderChatInputPreservingDraft();
    });
  });
}

export function bindChatEvents(): void {
  bindConversationListEvents();
  bindChatInputEvents();
  bindMessageEvents();
  bindSelectionCopyFallback();

  document.getElementById('editTitleBtn')?.addEventListener('click', () => {
    renameCurrentConversation();
  });
  document.querySelector('.chat-center-title')?.addEventListener('dblclick', () => {
    renameCurrentConversation();
  });
}
