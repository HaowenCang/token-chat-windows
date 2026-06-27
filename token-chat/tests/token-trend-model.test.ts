import { describe, expect, it } from 'vitest';
import type { DailyCost } from '../src/ipc/stats-snapshot';
import {
  mergeDailyCosts,
  normalizeTrendDays,
  resolveTrendSelection,
  sumDailyTokens,
  visibleDailyTokens,
} from '../src/token-trend-model';

const days: DailyCost[] = [
  { date: '2026-06-01', model_key: 'm2', model_name: 'Beta', provider_name: 'B', cost_nanos: 1, cached_tokens: 1, input_tokens: 2, output_tokens: 3 },
  { date: '2026-06-01', model_key: 'm1', model_name: 'Alpha', provider_name: 'A', cost_nanos: 2, cached_tokens: 4, input_tokens: 5, output_tokens: 6 },
  { date: '2026-06-03', model_key: 'm1', model_name: 'Alpha', provider_name: 'A', cost_nanos: 3, cached_tokens: 7, input_tokens: 8, output_tokens: 9 },
];

describe('token trend model', () => {
  it('merges daily costs and computes token totals', () => {
    const merged = mergeDailyCosts(days);

    expect(merged).toEqual([
      { date: '2026-06-01', cost_nanos: 3, cached_tokens: 5, input_tokens: 7, output_tokens: 9 },
      { date: '2026-06-03', cost_nanos: 3, cached_tokens: 7, input_tokens: 8, output_tokens: 9 },
    ]);
    expect(sumDailyTokens(merged)).toBe(45);
    expect(visibleDailyTokens(merged[0], { total: true, cached: false, input: true, output: true })).toBe(16);
  });

  it('resolves single-model selection and falls back to the first available option', () => {
    const resolved = resolveTrendSelection(days, { scope: 'model', selectedModelKey: 'missing' }, 'Unknown');

    expect(resolved.selectedModelKey).toBe('m1');
    expect(resolved.selectedModel).toMatchObject({ key: 'm1', modelName: 'Alpha', providerName: 'A' });
    expect(resolved.selectedRows.map(row => row.model_key)).toEqual(['m1', 'm1']);

    expect(resolveTrendSelection(days, { scope: 'all', selectedModelKey: 'm2' }, 'Unknown')).toMatchObject({
      selectedModelKey: 'm2',
      selectedRows: days,
    });
  });

  it('fills missing days inside a bounded trend window', () => {
    expect(normalizeTrendDays(days, {
      timeRange: 'custom',
      customStartDate: '2026-06-01',
      customEndDate: '2026-06-03',
    })).toEqual([
      { date: '2026-06-01', cost_nanos: 3, cached_tokens: 5, input_tokens: 7, output_tokens: 9 },
      { date: '2026-06-02', cost_nanos: 0, cached_tokens: 0, input_tokens: 0, output_tokens: 0 },
      { date: '2026-06-03', cost_nanos: 3, cached_tokens: 7, input_tokens: 8, output_tokens: 9 },
    ]);

    expect(normalizeTrendDays(days, {
      timeRange: 'custom',
      customStartDate: '2026-01-01',
      customEndDate: '2026-06-03',
    })).toEqual(mergeDailyCosts(days));
  });
});
