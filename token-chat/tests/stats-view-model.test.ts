import { describe, expect, it } from 'vitest';
import type { ConversationStats, DailyCost, ModelStats, StatsSummary } from '../src/ipc/stats-snapshot';
import {
  getModelStatsTotalTokens,
  getStatsRangeParams,
  normalizeStatsCurrency,
  sortTable,
  toggleSortState,
} from '../src/stats-view-model';

const summary: StatsSummary = {
  total_cost_nanos: 0,
  cost_by_currency: [
    { currency: 'CNY', cost_nanos: 100 },
    { currency: 'USD', cost_nanos: 200 },
  ],
  total_requests: 3,
  cache_hit_rate: 0.5,
  avg_latency_ms: 100,
};

const dailyCosts: DailyCost[] = [
  { date: '2026-06-25', currency: 'USD', cost_nanos: 10, cached_tokens: 1, input_tokens: 2, output_tokens: 3 },
];

const byModel: ModelStats[] = [
  {
    model_name: 'gpt',
    provider_name: 'OpenAI',
    currency: 'CNY',
    request_count: 1,
    cached_tokens: 10,
    uncached_tokens: 20,
    output_tokens: 30,
    total_cost_nanos: 100,
    avg_token_rate: 10,
  },
  {
    model_name: 'gpt',
    provider_name: 'OpenAI',
    currency: 'USD',
    request_count: 2,
    cached_tokens: 1,
    uncached_tokens: 2,
    output_tokens: 3,
    total_cost_nanos: 200,
    avg_token_rate: 20,
  },
];

const byConversation: ConversationStats[] = [
  {
    conversation_id: 'c1',
    title: 'One',
    model: 'gpt',
    currency: 'CNY',
    requests: 1,
    tokens: 10,
    total_cost_nanos: 100,
    updated_at: 1,
  },
  {
    conversation_id: 'c1',
    title: 'One',
    model: 'gpt',
    currency: 'USD',
    requests: 2,
    tokens: 20,
    total_cost_nanos: 200,
    updated_at: 3,
  },
];

describe('stats view model', () => {
  it('normalizes mixed-currency stats into the display currency and merges duplicate rows', () => {
    const stats = normalizeStatsCurrency({
      summary,
      dailyCosts,
      byModel,
      byConversation,
    }, {
      displayCurrency: 'CNY',
      convertCurrencyNanos: (nanos, source) => source === 'USD' ? nanos * 7 : nanos,
    });

    expect(stats.summary).toMatchObject({
      total_cost_nanos: 1500,
      cost_by_currency: [{ currency: 'CNY', cost_nanos: 1500 }],
    });
    expect(stats.daily_costs[0]).toMatchObject({ currency: 'CNY', cost_nanos: 70 });
    expect(stats.by_model).toHaveLength(1);
    expect(stats.by_model[0]).toMatchObject({
      request_count: 3,
      cached_tokens: 11,
      uncached_tokens: 22,
      output_tokens: 33,
      total_cost_nanos: 1500,
      currency: 'CNY',
    });
    expect(stats.token_breakdown).toEqual({ cached: 11, input: 22, output: 33 });
    expect(stats.by_conversation[0]).toMatchObject({
      requests: 3,
      tokens: 30,
      total_cost_nanos: 1500,
      updated_at: 3,
    });
  });

  it('builds stable range params from date filter state', () => {
    const now = new Date(2026, 5, 26, 12, 0, 0, 0);

    expect(getStatsRangeParams({ timeRange: 'all', customStartDate: '', customEndDate: '', now })).toBeNull();
    expect(getStatsRangeParams({ timeRange: 'today', customStartDate: '', customEndDate: '', now })).toEqual({
      start_ts: Math.floor(new Date(2026, 5, 26, 0, 0, 0, 0).getTime() / 1000),
      end_ts: Math.floor(new Date(2026, 5, 26, 23, 59, 59, 999).getTime() / 1000),
    });
    expect(getStatsRangeParams({ timeRange: 'month', customStartDate: '', customEndDate: '', now })).toEqual({
      start_ts: Math.floor(new Date(2026, 5, 1, 0, 0, 0, 0).getTime() / 1000),
      end_ts: Math.floor(new Date(2026, 5, 26, 23, 59, 59, 999).getTime() / 1000),
    });
    expect(getStatsRangeParams({ timeRange: 'custom', customStartDate: '2026-06-01', customEndDate: '2026-06-10', now })).toEqual({
      start_ts: Math.floor(new Date(2026, 5, 1, 0, 0, 0, 0).getTime() / 1000),
      end_ts: Math.floor(new Date(2026, 5, 10, 23, 59, 59, 999).getTime() / 1000),
    });
  });

  it('sorts derived total-token columns and toggles sort state', () => {
    const rows = [
      { name: 'small', cached_tokens: 1, uncached_tokens: 2, output_tokens: 3 },
      { name: 'large', cached_tokens: 10, uncached_tokens: 20, output_tokens: 30 },
    ] as ModelStats[];

    expect(getModelStatsTotalTokens(rows[0])).toBe(6);
    expect(sortTable(rows, 'total_tokens', 'desc', row => getModelStatsTotalTokens(row)).map(row => row.name)).toEqual(['large', 'small']);
    expect(toggleSortState({ key: 'total_tokens', dir: 'desc' }, 'total_tokens')).toEqual({ key: 'total_tokens', dir: 'asc' });
    expect(toggleSortState({ key: 'total_tokens', dir: 'asc' }, 'request_count')).toEqual({ key: 'request_count', dir: 'desc' });
  });
});
