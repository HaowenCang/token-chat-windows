import { invoke } from '@tauri-apps/api/core';
import { getLang, t } from './i18n';
import { tooltipAttrs } from './tooltip';

const isDev = !(window as any).__TAURI_INTERNALS__;

interface StatsSummary {
  total_cost_nanos: number;
  total_requests: number;
  cache_hit_rate: number;
  avg_latency_ms: number;
}

interface ModelStats {
  model_name: string;
  provider_name: string;
  request_count: number;
  cached_tokens: number;
  uncached_tokens: number;
  output_tokens: number;
  total_cost_nanos: number;
}

interface DailyCost {
  date: string;
  model_key?: string;
  model_name?: string;
  provider_name?: string;
  cost_nanos: number;
  cached_tokens: number;
  input_tokens: number;
  output_tokens: number;
}

interface ConversationStats {
  conversation_id: string;
  title: string;
  model: string;
  requests: number;
  tokens: number;
  total_cost_nanos: number;
  updated_at: number;
}

interface StatsData {
  summary: StatsSummary;
  daily_costs: DailyCost[];
  token_breakdown: { cached: number; input: number; output: number };
  by_model: ModelStats[];
  by_conversation: ConversationStats[];
}

interface StatsRangeParams {
  start_ts: number | null;
  end_ts: number | null;
}

type TimeRange = 'all' | 'today' | 'month' | 'custom';
type SortDir = 'asc' | 'desc';
type TrendScope = 'all' | 'model';
type TrendSeries = 'total' | 'cached' | 'input' | 'output';

interface TrendModelOption {
  key: string;
  modelName: string;
  providerName: string;
}

let statsData: StatsData | null = null;
let timeRange: TimeRange = 'all';
let customStartDate = '';
let customEndDate = '';
let modelSortKey = 'total_cost_nanos';
let modelSortDir: SortDir = 'desc';
let convSortKey = 'total_cost_nanos';
let convSortDir: SortDir = 'desc';
let trendScope: TrendScope = 'all';
let selectedTrendModelKey = '';
let trendEnteringSeries: TrendSeries | null = null;
const trendSeriesVisibility: Record<TrendSeries, boolean> = {
  total: true,
  cached: true,
  input: true,
  output: true,
};
let rerender: (() => void) | null = null;

const mockStats: StatsData = {
  summary: {
    total_cost_nanos: 12450000000,
    total_requests: 156,
    cache_hit_rate: 0.68,
    avg_latency_ms: 1200,
  },
  daily_costs: [
    { date: '2026-06-13', model_key: 'm1', model_name: 'GPT-4.1', provider_name: 'OpenAI', cost_nanos: 1200000000, cached_tokens: 4200, input_tokens: 3200, output_tokens: 1800 },
    { date: '2026-06-14', model_key: 'm2', model_name: 'DeepSeek Chat', provider_name: 'DeepSeek', cost_nanos: 2300000000, cached_tokens: 6800, input_tokens: 4700, output_tokens: 2600 },
    { date: '2026-06-15', model_key: 'm1', model_name: 'GPT-4.1', provider_name: 'OpenAI', cost_nanos: 1800000000, cached_tokens: 5200, input_tokens: 3900, output_tokens: 2100 },
    { date: '2026-06-16', model_key: 'm2', model_name: 'DeepSeek Chat', provider_name: 'DeepSeek', cost_nanos: 3100000000, cached_tokens: 7600, input_tokens: 6200, output_tokens: 3100 },
    { date: '2026-06-17', model_key: 'm1', model_name: 'GPT-4.1', provider_name: 'OpenAI', cost_nanos: 2000000000, cached_tokens: 6100, input_tokens: 4300, output_tokens: 2400 },
    { date: '2026-06-18', model_key: 'm2', model_name: 'DeepSeek Chat', provider_name: 'DeepSeek', cost_nanos: 1500000000, cached_tokens: 4800, input_tokens: 3500, output_tokens: 1700 },
    { date: '2026-06-19', model_key: 'm1', model_name: 'GPT-4.1', provider_name: 'OpenAI', cost_nanos: 2500000000, cached_tokens: 7900, input_tokens: 5200, output_tokens: 2900 },
  ],
  token_breakdown: { cached: 45000, input: 28000, output: 15000 },
  by_model: [
    { model_name: 'gpt-4.1', provider_name: 'OpenAI', request_count: 45, cached_tokens: 12000, uncached_tokens: 8000, output_tokens: 5000, total_cost_nanos: 5200000000 },
    { model_name: 'deepseek-chat', provider_name: 'DeepSeek', request_count: 60, cached_tokens: 20000, uncached_tokens: 12000, output_tokens: 6000, total_cost_nanos: 3800000000 },
    { model_name: 'claude-sonnet-4', provider_name: 'Claude Gateway', request_count: 30, cached_tokens: 8000, uncached_tokens: 5000, output_tokens: 2500, total_cost_nanos: 2100000000 },
  ],
  by_conversation: [
    { conversation_id: 'c1', title: 'Python optimization', model: 'gpt-4.1', requests: 12, tokens: 8500, total_cost_nanos: 2100000000, updated_at: 1781770000 },
    { conversation_id: 'c2', title: 'React component design', model: 'deepseek-chat', requests: 8, tokens: 5200, total_cost_nanos: 1200000000, updated_at: 1781770000 },
    { conversation_id: 'c3', title: 'API architecture', model: 'claude-sonnet-4', requests: 15, tokens: 12000, total_cost_nanos: 3500000000, updated_at: 1781770000 },
  ],
};

function formatCost(nanos: number): string {
  return `$${(nanos / 1_000_000_000).toFixed(4)}`;
}

function formatCostAmount(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatPct(value: number, total: number): string {
  return total > 0 ? `${((value / total) * 100).toFixed(1)}%` : '0.0%';
}

function getChartText() {
  if (getLang() === 'zh') {
    return {
      noData: '\u6682\u65e0\u6570\u636e',
      tokens: 'Token',
      cost: '\u8d39\u7528',
      total: '\u603b\u8ba1',
      tokenTotal: 'Token \u603b\u6d88\u8017',
      singleModel: '\u5355\u6a21\u578b Token \u6d88\u8017',
      cached: '\u8f93\u5165\uff08\u547d\u4e2d\u7f13\u5b58\uff09Token',
      uncached: '\u8f93\u5165\uff08\u672a\u547d\u4e2d\u7f13\u5b58\uff09Token',
      output: '\u8f93\u51fa Token',
      selectModel: '\u9009\u62e9\u6a21\u578b',
      unknownModel: '\u672a\u77e5\u6a21\u578b',
    };
  }
  return {
    noData: 'No data',
    tokens: 'Tokens',
    cost: 'Cost',
    total: 'Total',
    tokenTotal: 'Token total',
    singleModel: 'Single-model token usage',
    cached: 'Input (cached) Token',
    uncached: 'Input (uncached) Token',
    output: 'Output Token',
    selectModel: 'Select model',
    unknownModel: 'Unknown model',
  };
}

function totalDailyTokens(day: DailyCost): number {
  return day.cached_tokens + day.input_tokens + day.output_tokens;
}

function sumDailyTokens(days: DailyCost[]): number {
  return days.reduce((sum, day) => sum + totalDailyTokens(day), 0);
}

function formatAxisTokens(value: number): string {
  if (value <= 0) return '0';
  if (value >= 1000) return `${Math.round(value / 1000).toLocaleString().replace(/,/g, '')}k`;
  return String(Math.round(value));
}

function parseDateKey(value: string): Date | null {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function formatDateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function addDays(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function mergeDailyCosts(days: DailyCost[]): DailyCost[] {
  const map = new Map<string, DailyCost>();
  for (const day of days) {
    const current = map.get(day.date) ?? {
      date: day.date,
      cost_nanos: 0,
      cached_tokens: 0,
      input_tokens: 0,
      output_tokens: 0,
    };
    current.cost_nanos += day.cost_nanos;
    current.cached_tokens += day.cached_tokens;
    current.input_tokens += day.input_tokens;
    current.output_tokens += day.output_tokens;
    map.set(day.date, current);
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function getTrendModelOptions(days: DailyCost[]): TrendModelOption[] {
  const options = new Map<string, TrendModelOption>();
  for (const day of days) {
    if (!day.model_key) continue;
    options.set(day.model_key, {
      key: day.model_key,
      modelName: day.model_name || getChartText().unknownModel,
      providerName: day.provider_name || '',
    });
  }
  return [...options.values()].sort((a, b) =>
    `${a.providerName} ${a.modelName}`.localeCompare(`${b.providerName} ${b.modelName}`),
  );
}

function getTrendRows(days: DailyCost[], options: TrendModelOption[]): DailyCost[] {
  if (trendScope === 'all') return days;
  if (!options.some(option => option.key === selectedTrendModelKey)) {
    selectedTrendModelKey = options[0]?.key ?? '';
  }
  return selectedTrendModelKey
    ? days.filter(day => day.model_key === selectedTrendModelKey)
    : [];
}

function normalizeTrendDays(days: DailyCost[]): DailyCost[] {
  const sorted = mergeDailyCosts(days);
  if (sorted.length === 0) return [];

  let start = parseDateKey(sorted[0].date);
  let end = parseDateKey(sorted[sorted.length - 1].date);
  const now = new Date();

  if (timeRange === 'today') {
    start = toStartOfDay(now);
    end = toStartOfDay(now);
  } else if (timeRange === 'month') {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    end = toStartOfDay(now);
  } else if (timeRange === 'custom') {
    start = dateInputToDate(customStartDate, false) ?? start;
    end = dateInputToDate(customEndDate, false) ?? end;
  }

  if (!start || !end) return sorted;
  const span = Math.round((toStartOfDay(end).getTime() - toStartOfDay(start).getTime()) / 86_400_000);
  if (span < 0 || span > 60) return sorted;

  const map = new Map(sorted.map(day => [day.date, day]));
  return Array.from({ length: span + 1 }, (_, idx) => {
    const date = formatDateKey(addDays(start!, idx));
    return map.get(date) ?? {
      date,
      cost_nanos: 0,
      cached_tokens: 0,
      input_tokens: 0,
      output_tokens: 0,
    };
  });
}

function niceStep(value: number): number {
  if (value <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const normalized = value / magnitude;
  const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return factor * magnitude;
}

function niceTokenMax(value: number): number {
  return Math.max(6, niceStep(value / 6) * 6);
}

function smoothPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;

  let path = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let idx = 0; idx < points.length - 1; idx += 1) {
    const p0 = points[idx - 1] ?? points[idx];
    const p1 = points[idx];
    const p2 = points[idx + 1];
    const p3 = points[idx + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    path += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return path;
}

export async function loadStats(): Promise<void> {
  if (isDev) {
    statsData = { ...mockStats };
    return;
  }
  try {
    const range = getStatsRangeParams();
    const summary = await invoke<StatsSummary>('get_stats_summary', { range });
    const byModel = await invoke<ModelStats[]>('get_stats_by_model', { range });
    const dailyCosts = await invoke<DailyCost[]>('get_stats_daily_costs', { range });
    const byConversation = await invoke<ConversationStats[]>('get_stats_by_conversation', { range });
    statsData = {
      summary,
      daily_costs: dailyCosts,
      token_breakdown: {
        cached: byModel.reduce((s, m) => s + m.cached_tokens, 0),
        input: byModel.reduce((s, m) => s + m.uncached_tokens, 0),
        output: byModel.reduce((s, m) => s + m.output_tokens, 0),
      },
      by_model: byModel,
      by_conversation: byConversation,
    };
  } catch {
    statsData = emptyStats();
  }
}

function emptyStats(): StatsData {
  return {
    summary: {
      total_cost_nanos: 0,
      total_requests: 0,
      cache_hit_rate: 0,
      avg_latency_ms: 0,
    },
    daily_costs: [],
    token_breakdown: { cached: 0, input: 0, output: 0 },
    by_model: [],
    by_conversation: [],
  };
}

function toStartOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function toEndOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

function dateInputToDate(value: string, endOfDay: boolean): Date | null {
  if (!value) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day);
  return endOfDay ? toEndOfDay(date) : toStartOfDay(date);
}

function getStatsRangeParams(): StatsRangeParams | null {
  const now = new Date();
  if (timeRange === 'all') return null;
  if (timeRange === 'today') {
    return {
      start_ts: Math.floor(toStartOfDay(now).getTime() / 1000),
      end_ts: Math.floor(toEndOfDay(now).getTime() / 1000),
    };
  }
  if (timeRange === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    return {
      start_ts: Math.floor(start.getTime() / 1000),
      end_ts: Math.floor(toEndOfDay(now).getTime() / 1000),
    };
  }

  const start = dateInputToDate(customStartDate, false);
  const end = dateInputToDate(customEndDate, true);
  return {
    start_ts: start ? Math.floor(start.getTime() / 1000) : null,
    end_ts: end ? Math.floor(end.getTime() / 1000) : null,
  };
}

function sortTable<T extends Record<string, any>>(data: T[], key: string, dir: SortDir): T[] {
  return [...data].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (typeof av === 'number' && typeof bv === 'number') {
      return dir === 'asc' ? av - bv : bv - av;
    }
    return dir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
  });
}

function renderSparkline(dailyCosts: DailyCost[]): string {
  const text = getChartText();
  const W = 520, H = 180, PAD = 40;
  if (dailyCosts.length === 0) {
    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:180px">
      <line x1="${PAD}" y1="${H - PAD}" x2="${W - PAD}" y2="${H - PAD}" stroke="var(--line)" stroke-width="1"/>
      <text x="${W / 2}" y="${H / 2}" text-anchor="middle" fill="var(--text-faint)" class="chart-text">${text.noData}</text>
    </svg>`;
  }
  const data = dailyCosts.map(d => d.cost_nanos / 1_000_000_000);
  const maxVal = Math.max(...data, 1);
  const xStep = (W - PAD * 2) / Math.max(data.length - 1, 1);

  const points = data.map((v, i) => {
    const x = PAD + i * xStep;
    const y = H - PAD - (v / maxVal) * (H - PAD * 2);
    return { x, y };
  });

  const polylinePoints = points.map(p => `${p.x},${p.y}`).join(' ');
  const areaPoints = `${PAD},${H - PAD} ${polylinePoints} ${PAD + (data.length - 1) * xStep},${H - PAD}`;

  const gridLines = [0.25, 0.5, 0.75].map(pct => {
    const y = H - PAD - pct * (H - PAD * 2);
    return `<line x1="${PAD}" y1="${y}" x2="${W - PAD}" y2="${y}" stroke="var(--line)" stroke-dasharray="4,4" stroke-width="0.5"/>
            <text x="${PAD - 6}" y="${y + 4}" text-anchor="end" fill="var(--text-faint)" class="chart-text-small">${formatCostAmount(maxVal * pct)}</text>`;
  }).join('');

  const xLabels = dailyCosts.map((d, i) => {
    const x = PAD + i * xStep;
    return `<text x="${x}" y="${H - PAD + 16}" text-anchor="middle" fill="var(--text-faint)" class="chart-text-small">${escHtml(d.date)}</text>`;
  }).join('');

  const circles = points.map((p, i) =>
    `<circle cx="${p.x}" cy="${p.y}" r="4" fill="var(--accent)" opacity="0.7" ${tooltipAttrs(dailyCosts[i].date, [
      { label: text.cost, value: formatCost(dailyCosts[i].cost_nanos), color: 'var(--accent)' },
      { label: text.tokens, value: `${totalDailyTokens(dailyCosts[i]).toLocaleString()} ${text.tokens}`, color: 'var(--chart-line)' },
    ])}>
      <animate attributeName="opacity" values="0.7;1;0.7" dur="2s" repeatCount="indefinite"/>
    </circle>`
  ).join('');

  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:180px">
    <defs>
      <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.3"/>
        <stop offset="100%" stop-color="var(--accent)" stop-opacity="0.02"/>
      </linearGradient>
    </defs>
    ${gridLines}
    <polygon points="${areaPoints}" fill="url(#sparkGrad)"/>
    <polyline points="${polylinePoints}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    ${circles}
    ${xLabels}
    <text x="${PAD}" y="${PAD - 10}" fill="var(--text-muted)" class="chart-text">费用趋势</text>
  </svg>`;
}

function renderTokenTrend(dailyCosts: DailyCost[]): string {
  const days = normalizeTrendDays(dailyCosts);
  const text = getChartText();
  const W = 1120, H = 300;
  const LEFT = 58, RIGHT = 28, TOP = 24, BOTTOM = 42;
  const chartW = W - LEFT - RIGHT;
  const chartH = H - TOP - BOTTOM;
  const baseY = H - BOTTOM;

  if (days.length === 0) {
    return `<svg viewBox="0 0 ${W} ${H}" class="token-trend-chart">
      <text x="${W / 2}" y="${H / 2}" text-anchor="middle" fill="var(--chart-axis)" class="chart-text-large">${text.noData}</text>
    </svg>`;
  }

  const totals = days.map(totalDailyTokens);
  const visibleBarTotals = days.map(day =>
    (trendSeriesVisibility.cached ? day.cached_tokens : 0) +
    (trendSeriesVisibility.input ? day.input_tokens : 0) +
    (trendSeriesVisibility.output ? day.output_tokens : 0),
  );
  const maxToken = niceTokenMax(Math.max(
    trendSeriesVisibility.total ? Math.max(...totals, 0) : 0,
    Math.max(...visibleBarTotals, 0),
    1,
  ));
  const xStep = days.length > 1 ? chartW / (days.length - 1) : chartW;
  const slot = days.length > 1 ? xStep : chartW;
  const barWidth = Math.min(16, Math.max(5, slot * 0.28));
  const yFor = (value: number) => baseY - (value / maxToken) * chartH;
  const xFor = (idx: number) => days.length > 1 ? LEFT + idx * xStep : LEFT + chartW / 2;
  const points = totals.map((total, idx) => ({ x: xFor(idx), y: yFor(total) }));
  const linePath = smoothPath(points);
  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];
  const areaPath = `${linePath} L ${lastPoint.x.toFixed(2)} ${baseY.toFixed(2)} L ${firstPoint.x.toFixed(2)} ${baseY.toFixed(2)} Z`;
  const labelEvery = Math.max(1, Math.ceil(days.length / 16));

  const rowsFor = (d: DailyCost, total: number) => {
    const rows: { label: string; value: string; color: string }[] = [];
    if (trendSeriesVisibility.total) {
      rows.push({ label: text.tokenTotal, value: `${total.toLocaleString()} ${text.tokens}`, color: 'var(--chart-line)' });
    }
    if (trendSeriesVisibility.cached) {
      rows.push({ label: text.cached, value: `${d.cached_tokens.toLocaleString()} ${text.tokens}`, color: 'var(--chart-cache)' });
    }
    if (trendSeriesVisibility.input) {
      rows.push({ label: text.uncached, value: `${d.input_tokens.toLocaleString()} ${text.tokens}`, color: 'var(--chart-input)' });
    }
    if (trendSeriesVisibility.output) {
      rows.push({ label: text.output, value: `${d.output_tokens.toLocaleString()} ${text.tokens}`, color: 'var(--chart-output)' });
    }
    return rows;
  };

  const grid = Array.from({ length: 7 }, (_, idx) => {
    const value = (maxToken / 6) * idx;
    const y = yFor(value);
    return `<g>
      <line x1="${LEFT}" y1="${y}" x2="${W - RIGHT}" y2="${y}" stroke="var(--chart-grid)" stroke-dasharray="4 4" stroke-width="1"/>
      <text x="${LEFT - 8}" y="${y + 4}" text-anchor="end" fill="var(--chart-axis)" class="chart-text">${formatAxisTokens(value)}</text>
    </g>`;
  }).reverse().join('');

  const bars = days.map((d, idx) => {
    const total = totals[idx];
    const cachedHeight = trendSeriesVisibility.cached && d.cached_tokens > 0
      ? Math.max(2, (d.cached_tokens / maxToken) * chartH)
      : 0;
    const inputHeight = trendSeriesVisibility.input && d.input_tokens > 0
      ? Math.max(2, (d.input_tokens / maxToken) * chartH)
      : 0;
    const outputHeight = trendSeriesVisibility.output && d.output_tokens > 0
      ? Math.max(2, (d.output_tokens / maxToken) * chartH)
      : 0;
    const x = xFor(idx) - barWidth / 2;
    const cachedY = baseY - cachedHeight;
    const inputY = cachedY - inputHeight;
    const outputY = inputY - outputHeight;
    const label = idx % labelEvery === 0 || idx === days.length - 1
      ? `<text x="${xFor(idx)}" y="${H - 14}" text-anchor="middle" fill="var(--chart-axis)" class="chart-text">${escHtml(d.date)}</text>`
      : '';
    return `<g class="token-trend-bar" ${tooltipAttrs(d.date, rowsFor(d, total))}>
      ${trendSeriesVisibility.cached ? `<rect class="trend-series trend-series-cached ${trendEnteringSeries === 'cached' ? 'series-entering' : ''}" x="${x}" y="${cachedY}" width="${barWidth}" height="${cachedHeight}" rx="2" fill="var(--chart-cache)"/>` : ''}
      ${trendSeriesVisibility.input ? `<rect class="trend-series trend-series-input ${trendEnteringSeries === 'input' ? 'series-entering' : ''}" x="${x}" y="${inputY}" width="${barWidth}" height="${inputHeight}" rx="2" fill="var(--chart-input)"/>` : ''}
      ${trendSeriesVisibility.output ? `<rect class="trend-series trend-series-output ${trendEnteringSeries === 'output' ? 'series-entering' : ''}" x="${x}" y="${outputY}" width="${barWidth}" height="${outputHeight}" rx="2" fill="var(--chart-output)"/>` : ''}
      ${label}
    </g>`;
  }).join('');

  const hits = points.map((point, idx) => {
    const day = days[idx];
    return `<circle class="token-trend-hit" cx="${point.x}" cy="${point.y}" r="12" ${tooltipAttrs(day.date, rowsFor(day, totals[idx]))}/>`;
  }).join('');

  return `<svg viewBox="0 0 ${W} ${H}" class="token-trend-chart">
    <defs>
      <linearGradient id="tokenTrendArea" x1="0" y1="${TOP}" x2="0" y2="${baseY}" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="var(--chart-line)" stop-opacity="0.20"/>
        <stop offset="100%" stop-color="var(--chart-line)" stop-opacity="0.02"/>
      </linearGradient>
    </defs>
    ${grid}
    ${trendSeriesVisibility.total ? `<path class="trend-series trend-series-total ${trendEnteringSeries === 'total' ? 'series-entering' : ''}" d="${areaPath}" fill="url(#tokenTrendArea)"/>` : ''}
    ${bars}
    ${trendSeriesVisibility.total ? `<path class="trend-series trend-series-total ${trendEnteringSeries === 'total' ? 'series-entering' : ''}" d="${linePath}" fill="none" stroke="var(--chart-line)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
    ${trendSeriesVisibility.total ? hits : ''}
  </svg>`;
}

function renderTrendLegendButton(series: TrendSeries, label: string): string {
  const active = trendSeriesVisibility[series];
  const colorVariable = series === 'cached' ? 'cache' : series;
  const swatch = series === 'total'
    ? '<span class="token-trend-line-swatch"><i></i></span>'
    : `<span class="token-trend-color-swatch" style="background:var(--chart-${colorVariable})"></span>`;
  return `
    <button
      type="button"
      class="token-trend-legend-btn ${active ? 'active' : 'inactive'}"
      data-trend-series="${series}"
      aria-pressed="${active}"
    >${swatch}<span>${label}</span></button>
  `;
}

function renderTokenTrendPanel(dailyCosts: DailyCost[]): string {
  const text = getChartText();
  const options = getTrendModelOptions(dailyCosts);
  const selectedRows = getTrendRows(dailyCosts, options);
  const trendDays = mergeDailyCosts(selectedRows);
  const selectedModel = options.find(option => option.key === selectedTrendModelKey);
  const title = trendScope === 'model' ? text.singleModel : text.tokenTotal;
  const total = sumDailyTokens(trendDays);

  return `
    <div class="chart-panel token-trend-panel">
      <div class="token-trend-head">
        <div class="token-trend-heading">
          <span class="token-trend-title">${title}</span>
          <span class="token-trend-total">| ${total.toLocaleString()} ${text.tokens}</span>
        </div>
        <div class="token-trend-controls">
          <div class="token-trend-tabs">
            <button type="button" class="${trendScope === 'all' ? 'active' : ''}" data-trend-scope="all">${text.tokenTotal}</button>
            <button type="button" class="${trendScope === 'model' ? 'active' : ''}" data-trend-scope="model">${text.singleModel}</button>
          </div>
          ${trendScope === 'model' ? `
            <select class="token-trend-model-select" id="tokenTrendModel" aria-label="${text.selectModel}">
              ${options.length === 0 ? `<option value="">${text.noData}</option>` : options.map(option => `
                <option value="${escHtml(option.key)}" ${option.key === selectedTrendModelKey ? 'selected' : ''}>
                  ${escHtml(option.modelName)}${option.providerName ? ` - ${escHtml(option.providerName)}` : ''}
                </option>
              `).join('')}
            </select>
          ` : ''}
        </div>
      </div>
      <div class="token-trend-legend" aria-label="${escHtml(title)}">
        ${renderTrendLegendButton('total', text.tokenTotal)}
        ${renderTrendLegendButton('cached', text.cached)}
        ${renderTrendLegendButton('input', text.uncached)}
        ${renderTrendLegendButton('output', text.output)}
      </div>
      <div class="token-trend-canvas" data-model="${escHtml(selectedModel?.modelName ?? '')}">
        ${renderTokenTrend(trendDays)}
      </div>
    </div>
  `;
}

function renderDonut(breakdown: { cached: number; input: number; output: number }): string {
  const total = breakdown.cached + breakdown.input + breakdown.output;
  if (total === 0) {
    return `<div class="donut" ${tooltipAttrs('Token breakdown', [
      { label: 'Total', value: '0 tokens' },
    ])} style="background:conic-gradient(var(--line) 0deg 360deg)">
      <div class="donut-center"><div class="donut-center-value">0</div><div class="donut-center-label">TOTAL</div></div>
    </div>`;
  }

  const cachedPct = (breakdown.cached / total) * 360;
  const inputPct = (breakdown.input / total) * 360;
  const outputPct = (breakdown.output / total) * 360;

  const gradient = `conic-gradient(
    var(--chart-cache) 0deg ${cachedPct}deg,
    var(--chart-input) ${cachedPct}deg ${cachedPct + inputPct}deg,
    var(--chart-output) ${cachedPct + inputPct}deg 360deg
  )`;

  const rows = [
    { label: 'Total', value: `${total.toLocaleString()} tokens`, color: 'var(--chart-line)' },
    { label: 'Cached', value: `${breakdown.cached.toLocaleString()} (${formatPct(breakdown.cached, total)})`, color: 'var(--chart-cache)' },
    { label: 'Input', value: `${breakdown.input.toLocaleString()} (${formatPct(breakdown.input, total)})`, color: 'var(--chart-input)' },
    { label: 'Output', value: `${breakdown.output.toLocaleString()} (${formatPct(breakdown.output, total)})`, color: 'var(--chart-output)' },
  ];

  return `<div class="donut" ${tooltipAttrs('Token breakdown', rows)} style="background:${gradient}">
    <div class="donut-center">
      <div class="donut-center-value">${(total / 1000).toFixed(1)}k</div>
      <div class="donut-center-label">TOTAL</div>
    </div>
  </div>
  <div class="donut-legend">
    <div class="donut-legend-item" ${tooltipAttrs('Cached input', [rows[1]])}><div class="donut-legend-dot" style="background:var(--chart-cache)"></div><span>Cached - ${breakdown.cached.toLocaleString()} (${formatPct(breakdown.cached, total)})</span></div>
    <div class="donut-legend-item" ${tooltipAttrs('Input', [rows[2]])}><div class="donut-legend-dot" style="background:var(--chart-input)"></div><span>Input - ${breakdown.input.toLocaleString()} (${formatPct(breakdown.input, total)})</span></div>
    <div class="donut-legend-item" ${tooltipAttrs('Output', [rows[3]])}><div class="donut-legend-dot" style="background:var(--chart-output)"></div><span>Output - ${breakdown.output.toLocaleString()} (${formatPct(breakdown.output, total)})</span></div>
  </div>`;
}

function sortIndicator(key: string, activeKey: string, dir: SortDir): string {
  if (key !== activeKey) return '';
  return dir === 'asc' ? ' ▲' : ' ▼';
}

function renderModelTable(models: ModelStats[]): string {
  const sorted = sortTable(models, modelSortKey, modelSortDir);
  const cols: { key: string; label: string }[] = [
    { key: 'model_name', label: '模型名' },
    { key: 'provider_name', label: 'Provider' },
    { key: 'request_count', label: '请求数' },
    { key: 'cached_tokens', label: '缓存输入' },
    { key: 'uncached_tokens', label: '非缓存输入' },
    { key: 'output_tokens', label: '输出' },
    { key: 'total_tokens', label: '总Token' },
    { key: 'total_cost_nanos', label: '费用' },
  ];

  const headers = cols.map(c =>
    `<th data-sort-model="${c.key}" style="cursor:pointer;user-select:none">${escHtml(c.label)}${sortIndicator(c.key, modelSortKey, modelSortDir)}</th>`
  ).join('');

  const rows = sorted.map(m => {
    const totalTokens = m.cached_tokens + m.uncached_tokens + m.output_tokens;
    return `<tr>
      <td>${escHtml(m.model_name)}</td>
      <td>${escHtml(m.provider_name)}</td>
      <td>${m.request_count}</td>
      <td>${m.cached_tokens.toLocaleString()}</td>
      <td>${m.uncached_tokens.toLocaleString()}</td>
      <td>${m.output_tokens.toLocaleString()}</td>
      <td>${totalTokens.toLocaleString()}</td>
      <td>${formatCost(m.total_cost_nanos)}</td>
    </tr>`;
  }).join('');

  return `<table class="data-table"><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
}

function renderConvTable(convs: ConversationStats[]): string {
  const sorted = sortTable(convs, convSortKey, convSortDir);
  const cols: { key: string; label: string }[] = [
    { key: 'title', label: '对话标题' },
    { key: 'model', label: '模型' },
    { key: 'requests', label: '请求数' },
    { key: 'tokens', label: '总Token' },
    { key: 'total_cost_nanos', label: '费用' },
  ];

  const headers = cols.map(c =>
    `<th data-sort-conv="${c.key}" style="cursor:pointer;user-select:none">${escHtml(c.label)}${sortIndicator(c.key, convSortKey, convSortDir)}</th>`
  ).join('');

  const rows = sorted.map(c => `<tr>
    <td>${escHtml(c.title)}</td>
    <td>${escHtml(c.model)}</td>
    <td>${c.requests}</td>
    <td>${c.tokens.toLocaleString()}</td>
    <td>${formatCost(c.total_cost_nanos)}</td>
  </tr>`).join('');

  return `<table class="data-table"><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
}

export function renderStatsPage(): string {
  if (!statsData) {
    return `<div style="flex:1;overflow-y:auto;padding:28px;color:var(--text-faint)">Loading...</div>`;
  }

  const { summary, daily_costs, token_breakdown, by_model, by_conversation } = statsData;
  const aggregateDailyCosts = mergeDailyCosts(daily_costs);
  return `
    <div style="flex:1;overflow-y:auto">
      <div class="stats-top">
        <h2>${t('stats.title')}</h2>
        <div class="time-filters">
          <button class="time-filter ${timeRange === 'all' ? 'active' : ''}" data-range="all">${t('stats.all')}</button>
          <button class="time-filter ${timeRange === 'today' ? 'active' : ''}" data-range="today">${t('stats.today')}</button>
          <button class="time-filter ${timeRange === 'month' ? 'active' : ''}" data-range="month">${t('stats.month')}</button>
          <button class="time-filter ${timeRange === 'custom' ? 'active' : ''}" data-range="custom">Custom</button>
          <input class="date-filter" id="statsStartDate" type="date" value="${escHtml(customStartDate)}">
          <input class="date-filter" id="statsEndDate" type="date" value="${escHtml(customEndDate)}">
        </div>
      </div>
      <div class="stats-kpi">
        <div class="kpi-card">
          <div class="kpi-card-label">${t('stats.totalCost')}</div>
          <div class="kpi-card-value">${formatCost(summary.total_cost_nanos)}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-card-label">${t('stats.totalRequests')}</div>
          <div class="kpi-card-value">${summary.total_requests}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-card-label">${t('stats.cacheHitRate')}</div>
          <div class="kpi-card-value">${(summary.cache_hit_rate * 100).toFixed(1)}%</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-card-label">${t('stats.avgLatency')}</div>
          <div class="kpi-card-value">${Math.round(summary.avg_latency_ms)}ms</div>
        </div>
      </div>
      <div class="stats-charts">
        <div class="chart-panel">
          <h3>${t('stats.costTrend')}</h3>
          ${renderSparkline(aggregateDailyCosts)}
        </div>
        <div class="chart-panel">
          <h3>${t('stats.tokenBreakdown')}</h3>
          <div class="donut-wrap">
            ${renderDonut(token_breakdown)}
          </div>
        </div>
        ${renderTokenTrendPanel(daily_costs)}
      </div>
      <div class="stats-tables">
        <div class="table-panel">
          <h3>${t('stats.byModel')}</h3>
          ${renderModelTable(by_model)}
        </div>
        <div class="table-panel">
          <h3>${t('stats.byConversation')}</h3>
          ${renderConvTable(by_conversation)}
        </div>
      </div>
      <div class="export-bar">
        <button class="export-btn" id="exportJson">${t('stats.export')} JSON</button>
        <button class="export-btn" id="exportCsv">${t('stats.export')} CSV</button>
      </div>
    </div>
  `;
}

function refreshTokenTrendPanel(): void {
  if (!statsData) return;
  const panel = document.querySelector('.token-trend-panel');
  if (!panel) return;
  panel.outerHTML = renderTokenTrendPanel(statsData.daily_costs);
  bindTokenTrendEvents();
}

function bindTokenTrendEvents(): void {
  document.querySelectorAll<HTMLElement>('[data-trend-scope]').forEach(button => {
    button.addEventListener('click', () => {
      const nextScope = button.dataset.trendScope as TrendScope;
      if (nextScope === trendScope) return;
      trendScope = nextScope;
      refreshTokenTrendPanel();
    });
  });

  const modelSelect = document.getElementById('tokenTrendModel') as HTMLSelectElement | null;
  if (modelSelect) {
    modelSelect.addEventListener('change', () => {
      selectedTrendModelKey = modelSelect.value;
      refreshTokenTrendPanel();
    });
  }

  document.querySelectorAll<HTMLButtonElement>('[data-trend-series]').forEach(button => {
    button.addEventListener('click', () => {
      const series = button.dataset.trendSeries as TrendSeries;
      if (!(series in trendSeriesVisibility)) return;

      if (trendSeriesVisibility[series]) {
        const nodes = document.querySelectorAll<SVGElement>(`.trend-series-${series}`);
        button.classList.remove('active');
        button.classList.add('inactive');
        button.setAttribute('aria-pressed', 'false');
        nodes.forEach(node => node.classList.add('series-leaving'));
        window.setTimeout(() => {
          trendSeriesVisibility[series] = false;
          refreshTokenTrendPanel();
        }, nodes.length > 0 ? 180 : 0);
        return;
      }

      trendSeriesVisibility[series] = true;
      trendEnteringSeries = series;
      refreshTokenTrendPanel();
      window.setTimeout(() => {
        trendEnteringSeries = null;
      }, 240);
    });
  });
}

export function bindStatsEvents(renderFn: () => void): void {
  rerender = renderFn;
  bindTokenTrendEvents();

  document.querySelectorAll<HTMLElement>('[data-range]').forEach(el => {
    el.addEventListener('click', () => {
      timeRange = el.dataset.range as TimeRange;
      rerender?.();
    });
  });

  const startInput = document.getElementById('statsStartDate') as HTMLInputElement | null;
  const endInput = document.getElementById('statsEndDate') as HTMLInputElement | null;
  if (startInput) {
    startInput.addEventListener('change', () => {
      customStartDate = startInput.value;
      timeRange = 'custom';
      rerender?.();
    });
  }
  if (endInput) {
    endInput.addEventListener('change', () => {
      customEndDate = endInput.value;
      timeRange = 'custom';
      rerender?.();
    });
  }

  document.querySelectorAll<HTMLElement>('[data-sort-model]').forEach(el => {
    el.addEventListener('click', () => {
      const key = el.dataset.sortModel!;
      if (modelSortKey === key) {
        modelSortDir = modelSortDir === 'asc' ? 'desc' : 'asc';
      } else {
        modelSortKey = key;
        modelSortDir = 'desc';
      }
      rerender?.();
    });
  });

  document.querySelectorAll<HTMLElement>('[data-sort-conv]').forEach(el => {
    el.addEventListener('click', () => {
      const key = el.dataset.sortConv!;
      if (convSortKey === key) {
        convSortDir = convSortDir === 'asc' ? 'desc' : 'asc';
      } else {
        convSortKey = key;
        convSortDir = 'desc';
      }
      rerender?.();
    });
  });

  document.getElementById('exportJson')?.addEventListener('click', () => {
    if (!statsData) return;
    const blob = new Blob([JSON.stringify(statsData, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'token-stats.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  document.getElementById('exportCsv')?.addEventListener('click', () => {
    if (!statsData) return;
    const rows = ['Model,Provider,Requests,Cached Input,Uncached Input,Output,Total Tokens,Cost'];
    for (const m of statsData.by_model) {
      const total = m.cached_tokens + m.uncached_tokens + m.output_tokens;
      rows.push([m.model_name, m.provider_name, m.request_count, m.cached_tokens, m.uncached_tokens, m.output_tokens, total, (m.total_cost_nanos / 1e9).toFixed(2)].join(','));
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'token-stats.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  });
}
