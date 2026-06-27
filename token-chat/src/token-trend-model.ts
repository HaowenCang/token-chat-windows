import type { DailyCost } from './ipc/stats-snapshot';
import {
  dateInputToDate,
  toStartOfDay,
  type TimeRange,
} from './stats-view-model';

export type TrendScope = 'all' | 'model';
export type TrendSeries = 'total' | 'cached' | 'input' | 'output';
export type TrendSeriesVisibility = Record<TrendSeries, boolean>;

export interface TrendModelOption {
  key: string;
  modelName: string;
  providerName: string;
}

export interface TrendSelectionState {
  scope: TrendScope;
  selectedModelKey: string;
}

export interface ResolvedTrendSelection {
  options: TrendModelOption[];
  selectedModelKey: string;
  selectedModel: TrendModelOption | undefined;
  selectedRows: DailyCost[];
}

export interface TrendWindowState {
  timeRange: TimeRange;
  customStartDate: string;
  customEndDate: string;
  now?: Date;
  maxFillDays?: number;
}

export const defaultTrendSeriesVisibility: TrendSeriesVisibility = {
  total: true,
  cached: true,
  input: true,
  output: true,
};

export function totalDailyTokens(day: DailyCost): number {
  return day.cached_tokens + day.input_tokens + day.output_tokens;
}

export function sumDailyTokens(days: DailyCost[]): number {
  return days.reduce((sum, day) => sum + totalDailyTokens(day), 0);
}

export function visibleDailyTokens(day: DailyCost, visibility: TrendSeriesVisibility): number {
  return (
    (visibility.cached ? day.cached_tokens : 0) +
    (visibility.input ? day.input_tokens : 0) +
    (visibility.output ? day.output_tokens : 0)
  );
}

export function parseDateKey(value: string): Date | null {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

export function formatDateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function addDays(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

export function mergeDailyCosts(days: DailyCost[]): DailyCost[] {
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

export function getTrendModelOptions(days: DailyCost[], unknownModelLabel: string): TrendModelOption[] {
  const options = new Map<string, TrendModelOption>();
  for (const day of days) {
    if (!day.model_key) continue;
    options.set(day.model_key, {
      key: day.model_key,
      modelName: day.model_name || unknownModelLabel,
      providerName: day.provider_name || '',
    });
  }
  return [...options.values()].sort((a, b) =>
    `${a.providerName} ${a.modelName}`.localeCompare(`${b.providerName} ${b.modelName}`),
  );
}

export function resolveTrendSelection(
  days: DailyCost[],
  state: TrendSelectionState,
  unknownModelLabel: string,
): ResolvedTrendSelection {
  const options = getTrendModelOptions(days, unknownModelLabel);
  if (state.scope === 'all') {
    return {
      options,
      selectedModelKey: state.selectedModelKey,
      selectedModel: options.find(option => option.key === state.selectedModelKey),
      selectedRows: days,
    };
  }

  const selectedModelKey = options.some(option => option.key === state.selectedModelKey)
    ? state.selectedModelKey
    : options[0]?.key ?? '';
  return {
    options,
    selectedModelKey,
    selectedModel: options.find(option => option.key === selectedModelKey),
    selectedRows: selectedModelKey ? days.filter(day => day.model_key === selectedModelKey) : [],
  };
}

export function normalizeTrendDays(days: DailyCost[], state: TrendWindowState): DailyCost[] {
  const sorted = mergeDailyCosts(days);
  if (sorted.length === 0) return [];

  let start = parseDateKey(sorted[0].date);
  let end = parseDateKey(sorted[sorted.length - 1].date);
  const now = state.now ?? new Date();

  if (state.timeRange === 'today') {
    start = toStartOfDay(now);
    end = toStartOfDay(now);
  } else if (state.timeRange === 'month') {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    end = toStartOfDay(now);
  } else if (state.timeRange === 'custom') {
    start = dateInputToDate(state.customStartDate, false) ?? start;
    end = dateInputToDate(state.customEndDate, false) ?? end;
  }

  if (!start || !end) return sorted;
  const span = Math.round((toStartOfDay(end).getTime() - toStartOfDay(start).getTime()) / 86_400_000);
  if (span < 0 || span > (state.maxFillDays ?? 60)) return sorted;

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
