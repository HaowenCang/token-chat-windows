import type {
  ConversationStats,
  DailyCost,
  ModelStats,
  StatsRangeParams,
  StatsSummary,
} from './ipc/stats-snapshot';
import type { CurrencyCode } from './currency';

export interface StatsData {
  summary: StatsSummary;
  daily_costs: DailyCost[];
  token_breakdown: { cached: number; input: number; output: number };
  by_model: ModelStats[];
  by_conversation: ConversationStats[];
}

export type TimeRange = 'all' | 'today' | 'month' | 'custom';
export type SortDir = 'asc' | 'desc';

export interface StatsRangeState {
  timeRange: TimeRange;
  customStartDate: string;
  customEndDate: string;
  now?: Date;
}

export interface StatsCurrencyInput {
  summary: StatsSummary;
  dailyCosts: DailyCost[];
  byModel: ModelStats[];
  byConversation: ConversationStats[];
}

export interface StatsCurrencyNormalizer {
  displayCurrency: CurrencyCode;
  convertCurrencyNanos: (nanos: number, sourceCurrency: string, baseCurrency: CurrencyCode) => number;
  defaultCurrency?: string;
}

export interface SortState {
  key: string;
  dir: SortDir;
}

export function emptyStats(): StatsData {
  return {
    summary: {
      total_cost_nanos: 0,
      cost_by_currency: [],
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

export function toStartOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

export function toEndOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

export function dateInputToDate(value: string, endOfDay: boolean): Date | null {
  if (!value) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day);
  return endOfDay ? toEndOfDay(date) : toStartOfDay(date);
}

export function getStatsRangeParams(state: StatsRangeState): StatsRangeParams | null {
  const now = state.now ?? new Date();
  if (state.timeRange === 'all') return null;
  if (state.timeRange === 'today') {
    return {
      start_ts: Math.floor(toStartOfDay(now).getTime() / 1000),
      end_ts: Math.floor(toEndOfDay(now).getTime() / 1000),
    };
  }
  if (state.timeRange === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    return {
      start_ts: Math.floor(start.getTime() / 1000),
      end_ts: Math.floor(toEndOfDay(now).getTime() / 1000),
    };
  }

  const start = dateInputToDate(state.customStartDate, false);
  const end = dateInputToDate(state.customEndDate, true);
  return {
    start_ts: start ? Math.floor(start.getTime() / 1000) : null,
    end_ts: end ? Math.floor(end.getTime() / 1000) : null,
  };
}

export function normalizeStatsCurrency(
  input: StatsCurrencyInput,
  normalizer: StatsCurrencyNormalizer,
): StatsData {
  const displayCurrency = normalizer.displayCurrency;
  const defaultCurrency = normalizer.defaultCurrency ?? 'CNY';
  const convert = (nanos: number, currency: string | null | undefined) =>
    normalizer.convertCurrencyNanos(nanos, currency ?? defaultCurrency, displayCurrency);

  const convertedDaily = input.dailyCosts.map(day => ({
    ...day,
    currency: displayCurrency,
    cost_nanos: convert(day.cost_nanos, day.currency),
  }));

  const modelMap = new Map<string, ModelStats>();
  for (const row of input.byModel) {
    const key = `${row.provider_name}\u0000${row.model_name}`;
    const current = modelMap.get(key);
    const convertedCost = convert(row.total_cost_nanos, row.currency);
    if (current) {
      current.request_count += row.request_count;
      current.cached_tokens += row.cached_tokens;
      current.uncached_tokens += row.uncached_tokens;
      current.output_tokens += row.output_tokens;
      current.total_cost_nanos += convertedCost;
    } else {
      modelMap.set(key, { ...row, currency: displayCurrency, total_cost_nanos: convertedCost });
    }
  }
  const convertedModels = [...modelMap.values()];

  const conversationMap = new Map<string, ConversationStats>();
  for (const row of input.byConversation) {
    const current = conversationMap.get(row.conversation_id);
    const convertedCost = convert(row.total_cost_nanos, row.currency);
    if (current) {
      current.requests += row.requests;
      current.tokens += row.tokens;
      current.total_cost_nanos += convertedCost;
      current.updated_at = Math.max(current.updated_at, row.updated_at);
    } else {
      conversationMap.set(row.conversation_id, { ...row, currency: displayCurrency, total_cost_nanos: convertedCost });
    }
  }

  const costRows = input.summary.cost_by_currency?.length
    ? input.summary.cost_by_currency
    : input.byModel.map(row => ({ currency: row.currency ?? defaultCurrency, cost_nanos: row.total_cost_nanos }));
  const totalCost = costRows.reduce((sum, item) => sum + convert(item.cost_nanos, item.currency), 0);

  return {
    summary: {
      ...input.summary,
      total_cost_nanos: totalCost,
      cost_by_currency: [{ currency: displayCurrency, cost_nanos: totalCost }],
    },
    daily_costs: convertedDaily,
    token_breakdown: {
      cached: convertedModels.reduce((sum, row) => sum + row.cached_tokens, 0),
      input: convertedModels.reduce((sum, row) => sum + row.uncached_tokens, 0),
      output: convertedModels.reduce((sum, row) => sum + row.output_tokens, 0),
    },
    by_model: convertedModels,
    by_conversation: [...conversationMap.values()],
  };
}

export function getModelStatsTotalTokens(row: ModelStats): number {
  return row.cached_tokens + row.uncached_tokens + row.output_tokens;
}

export function getModelStatsSortValue(row: ModelStats, key: string): number | string {
  if (key === 'total_tokens') return getModelStatsTotalTokens(row);
  const value = row[key as keyof ModelStats];
  return typeof value === 'number' || typeof value === 'string' ? value : '';
}

export function getConversationStatsSortValue(row: ConversationStats, key: string): number | string {
  const value = row[key as keyof ConversationStats];
  return typeof value === 'number' || typeof value === 'string' ? value : '';
}

export function sortTable<T>(
  data: T[],
  key: string,
  dir: SortDir,
  getValue: (row: T, key: string) => number | string = (row, sortKey) => {
    const value = (row as Record<string, unknown>)[sortKey];
    return typeof value === 'number' || typeof value === 'string' ? value : '';
  },
): T[] {
  return [...data].sort((a, b) => {
    const av = getValue(a, key);
    const bv = getValue(b, key);
    if (typeof av === 'number' && typeof bv === 'number') {
      return dir === 'asc' ? av - bv : bv - av;
    }
    return dir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
  });
}

export function toggleSortState(current: SortState, nextKey: string, defaultDir: SortDir = 'desc'): SortState {
  if (current.key === nextKey) {
    return { key: nextKey, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  }
  return { key: nextKey, dir: defaultDir };
}
