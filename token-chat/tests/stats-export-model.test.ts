import { describe, expect, it } from 'vitest';
import type { StatsData } from '../src/stats-view-model';
import { buildStatsCsv, buildStatsJson } from '../src/stats-export-model';

const statsData: StatsData = {
  summary: {
    total_cost_nanos: 100,
    cost_by_currency: [{ currency: 'USD', cost_nanos: 100 }],
    total_requests: 1,
    cache_hit_rate: 0,
    avg_latency_ms: 0,
  },
  daily_costs: [],
  token_breakdown: { cached: 1, input: 2, output: 3 },
  by_model: [
    {
      model_name: 'gpt, "quoted"',
      provider_name: 'OpenAI',
      currency: 'USD',
      request_count: 2,
      cached_tokens: 10,
      uncached_tokens: 20,
      output_tokens: 30,
      total_cost_nanos: 1_500_000_000,
      avg_token_rate: 0,
    },
  ],
  by_conversation: [],
};

describe('stats export model', () => {
  it('builds pretty JSON from stats data', () => {
    expect(buildStatsJson(statsData)).toContain('"total_cost_nanos": 100');
  });

  it('builds escaped CSV rows with derived token totals', () => {
    expect(buildStatsCsv(statsData, 'USD')).toBe([
      'Model,Provider,Requests,Cached Input,Uncached Input,Output,Total Tokens,Cost (USD)',
      '"gpt, ""quoted""",OpenAI,2,10,20,30,60,1.50',
    ].join('\n'));
  });
});
