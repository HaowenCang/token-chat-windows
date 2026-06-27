import type { StatsData } from './stats-view-model';
import { getModelStatsTotalTokens } from './stats-view-model';

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildStatsJson(statsData: StatsData): string {
  return JSON.stringify(statsData, null, 2);
}

export function buildStatsCsv(statsData: StatsData, displayCurrency: string): string {
  const rows: Array<Array<string | number>> = [
    ['Model', 'Provider', 'Requests', 'Cached Input', 'Uncached Input', 'Output', 'Total Tokens', `Cost (${displayCurrency})`],
  ];
  for (const model of statsData.by_model) {
    rows.push([
      model.model_name,
      model.provider_name,
      model.request_count,
      model.cached_tokens,
      model.uncached_tokens,
      model.output_tokens,
      getModelStatsTotalTokens(model),
      (model.total_cost_nanos / 1e9).toFixed(2),
    ]);
  }
  return rows.map(row => row.map(csvCell).join(',')).join('\n');
}
