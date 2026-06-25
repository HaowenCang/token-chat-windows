import { invoke } from '@tauri-apps/api/core';

export interface CurrencyCost {
  currency: string;
  cost_nanos: number;
}

export interface StatsSummary {
  total_cost_nanos: number;
  cost_by_currency?: CurrencyCost[];
  total_requests: number;
  cache_hit_rate: number;
  avg_latency_ms: number;
}

export interface ModelStats {
  model_name: string;
  provider_name: string;
  currency: string;
  request_count: number;
  cached_tokens: number;
  uncached_tokens: number;
  output_tokens: number;
  total_cost_nanos: number;
  avg_token_rate: number;
}

export interface DailyCost {
  date: string;
  model_key?: string;
  model_name?: string;
  provider_name?: string;
  currency?: string;
  cost_nanos: number;
  cached_tokens: number;
  input_tokens: number;
  output_tokens: number;
}

export interface ConversationStats {
  conversation_id: string;
  title: string;
  model: string;
  currency: string;
  requests: number;
  tokens: number;
  total_cost_nanos: number;
  updated_at: number;
}

export interface StatsRangeParams {
  start_ts: number | null;
  end_ts: number | null;
}

export interface StatsSnapshot {
  summary: StatsSummary;
  byModel: ModelStats[];
  dailyCosts: DailyCost[];
  byConversation: ConversationStats[];
}

export async function loadStatsSnapshot(range: StatsRangeParams | null): Promise<StatsSnapshot> {
  const summary = await invoke<StatsSummary>('get_stats_summary', { range });
  const byModel = await invoke<ModelStats[]>('get_stats_by_model', { range });
  const dailyCosts = await invoke<DailyCost[]>('get_stats_daily_costs', { range });
  const byConversation = await invoke<ConversationStats[]>('get_stats_by_conversation', { range });
  return { summary, byModel, dailyCosts, byConversation };
}
