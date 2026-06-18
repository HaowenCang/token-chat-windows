import { invoke } from '@tauri-apps/api/core';
import { t } from './i18n';

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
  cost: number;
}

interface ConversationStats {
  title: string;
  model: string;
  requests: number;
  tokens: number;
  cost: number;
}

interface StatsData {
  summary: StatsSummary;
  daily_costs: DailyCost[];
  token_breakdown: { cached: number; input: number; output: number };
  by_model: ModelStats[];
  by_conversation: ConversationStats[];
}

type TimeRange = 'all' | 'today' | 'month';
type SortDir = 'asc' | 'desc';

let statsData: StatsData | null = null;
let timeRange: TimeRange = 'all';
let modelSortKey = 'cost';
let modelSortDir: SortDir = 'desc';
let convSortKey = 'cost';
let convSortDir: SortDir = 'desc';
let rerender: (() => void) | null = null;

const mockStats: StatsData = {
  summary: {
    total_cost_nanos: 12450000000,
    total_requests: 156,
    cache_hit_rate: 0.68,
    avg_latency_ms: 1200,
  },
  daily_costs: [
    { date: 'Mon', cost: 1.2 },
    { date: 'Tue', cost: 2.3 },
    { date: 'Wed', cost: 1.8 },
    { date: 'Thu', cost: 3.1 },
    { date: 'Fri', cost: 2.0 },
    { date: 'Sat', cost: 1.5 },
    { date: 'Sun', cost: 2.5 },
  ],
  token_breakdown: { cached: 45000, input: 28000, output: 15000 },
  by_model: [
    { model_name: 'gpt-4.1', provider_name: 'OpenAI', request_count: 45, cached_tokens: 12000, uncached_tokens: 8000, output_tokens: 5000, total_cost_nanos: 5200000000 },
    { model_name: 'deepseek-chat', provider_name: 'DeepSeek', request_count: 60, cached_tokens: 20000, uncached_tokens: 12000, output_tokens: 6000, total_cost_nanos: 3800000000 },
    { model_name: 'claude-sonnet-4', provider_name: 'Claude Gateway', request_count: 30, cached_tokens: 8000, uncached_tokens: 5000, output_tokens: 2500, total_cost_nanos: 2100000000 },
  ],
  by_conversation: [
    { title: 'Python 优化问题', model: 'gpt-4.1', requests: 12, tokens: 8500, cost: 2.1 },
    { title: 'React 组件设计', model: 'deepseek-chat', requests: 8, tokens: 5200, cost: 1.2 },
    { title: 'API 架构讨论', model: 'claude-sonnet-4', requests: 15, tokens: 12000, cost: 3.5 },
  ],
};

function formatCost(nanos: number): string {
  return `¥${(nanos / 1_000_000_000).toFixed(2)}`;
}

function formatCostFromYuan(yuan: number): string {
  return `¥${yuan.toFixed(2)}`;
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function loadStats(): Promise<void> {
  if (isDev) {
    statsData = { ...mockStats };
    return;
  }
  try {
    const summary = await invoke<StatsSummary>('get_stats_summary');
    const byModel = await invoke<ModelStats[]>('get_stats_by_model');
    statsData = {
      summary,
      daily_costs: mockStats.daily_costs,
      token_breakdown: {
        cached: byModel.reduce((s, m) => s + m.cached_tokens, 0),
        input: byModel.reduce((s, m) => s + m.uncached_tokens, 0),
        output: byModel.reduce((s, m) => s + m.output_tokens, 0),
      },
      by_model: byModel,
      by_conversation: mockStats.by_conversation,
    };
  } catch {
    statsData = { ...mockStats };
  }
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
  const W = 520, H = 180, PAD = 40;
  const data = dailyCosts.map(d => d.cost);
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
            <text x="${PAD - 6}" y="${y + 4}" text-anchor="end" fill="var(--text-faint)" font-size="10">${formatCostFromYuan(maxVal * pct)}</text>`;
  }).join('');

  const xLabels = dailyCosts.map((d, i) => {
    const x = PAD + i * xStep;
    return `<text x="${x}" y="${H - PAD + 16}" text-anchor="middle" fill="var(--text-faint)" font-size="10">${escHtml(d.date)}</text>`;
  }).join('');

  const circles = points.map(p =>
    `<circle cx="${p.x}" cy="${p.y}" r="4" fill="var(--accent)" opacity="0.7">
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
    <text x="${PAD}" y="${PAD - 10}" fill="var(--text-muted)" font-size="11">费用趋势</text>
  </svg>`;
}

function renderDonut(breakdown: { cached: number; input: number; output: number }): string {
  const total = breakdown.cached + breakdown.input + breakdown.output;
  if (total === 0) {
    return `<div class="donut" style="background:conic-gradient(var(--line) 0deg 360deg)">
      <div class="donut-center"><div class="donut-center-value">0</div><div class="donut-center-label">TOTAL</div></div>
    </div>`;
  }

  const cachedPct = (breakdown.cached / total) * 360;
  const inputPct = (breakdown.input / total) * 360;
  const outputPct = (breakdown.output / total) * 360;

  const gradient = `conic-gradient(
    var(--stack-cache) 0deg ${cachedPct}deg,
    var(--stack-input) ${cachedPct}deg ${cachedPct + inputPct}deg,
    var(--stack-output) ${cachedPct + inputPct}deg 360deg
  )`;

  return `<div class="donut" style="background:${gradient}">
    <div class="donut-center">
      <div class="donut-center-value">${(total / 1000).toFixed(1)}k</div>
      <div class="donut-center-label">TOTAL</div>
    </div>
  </div>
  <div class="donut-legend">
    <div class="donut-legend-item"><div class="donut-legend-dot" style="background:var(--stack-cache)"></div><span>Cached — ${breakdown.cached.toLocaleString()}</span></div>
    <div class="donut-legend-item"><div class="donut-legend-dot" style="background:var(--stack-input)"></div><span>Input — ${breakdown.input.toLocaleString()}</span></div>
    <div class="donut-legend-item"><div class="donut-legend-dot" style="background:var(--stack-output)"></div><span>Output — ${breakdown.output.toLocaleString()}</span></div>
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
    { key: 'cost', label: '费用' },
  ];

  const headers = cols.map(c =>
    `<th data-sort-conv="${c.key}" style="cursor:pointer;user-select:none">${escHtml(c.label)}${sortIndicator(c.key, convSortKey, convSortDir)}</th>`
  ).join('');

  const rows = sorted.map(c => `<tr>
    <td>${escHtml(c.title)}</td>
    <td>${escHtml(c.model)}</td>
    <td>${c.requests}</td>
    <td>${c.tokens.toLocaleString()}</td>
    <td>${formatCostFromYuan(c.cost)}</td>
  </tr>`).join('');

  return `<table class="data-table"><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
}

export function renderStatsPage(): string {
  if (!statsData) {
    return `<div style="flex:1;overflow-y:auto;padding:28px;color:var(--text-faint)">Loading...</div>`;
  }

  const { summary, daily_costs, token_breakdown, by_model, by_conversation } = statsData;
  const totalCostYuan = summary.total_cost_nanos / 1_000_000_000;

  return `
    <div style="flex:1;overflow-y:auto">
      <div class="stats-top">
        <h2>${t('stats.title')}</h2>
        <div class="time-filters">
          <button class="time-filter ${timeRange === 'all' ? 'active' : ''}" data-range="all">${t('stats.all')}</button>
          <button class="time-filter ${timeRange === 'today' ? 'active' : ''}" data-range="today">${t('stats.today')}</button>
          <button class="time-filter ${timeRange === 'month' ? 'active' : ''}" data-range="month">${t('stats.month')}</button>
        </div>
      </div>
      <div class="stats-kpi">
        <div class="kpi-card">
          <div class="kpi-card-label">${t('stats.totalCost')}</div>
          <div class="kpi-card-value">${formatCostFromYuan(totalCostYuan)}</div>
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
          ${renderSparkline(daily_costs)}
        </div>
        <div class="chart-panel">
          <h3>${t('stats.tokenBreakdown')}</h3>
          <div class="donut-wrap">
            ${renderDonut(token_breakdown)}
          </div>
        </div>
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

export function bindStatsEvents(renderFn: () => void): void {
  rerender = renderFn;

  document.querySelectorAll<HTMLElement>('[data-range]').forEach(el => {
    el.addEventListener('click', () => {
      timeRange = el.dataset.range as TimeRange;
      rerender?.();
    });
  });

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
