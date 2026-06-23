export interface Provider {
  id: string;
  name: string;
  base_url: string;
  extra_headers_json?: string | null;
  created_at: number;
  updated_at: number;
}

export interface Model {
  id: string;
  provider_id: string;
  model_name: string;
  display_name: string;
  system_prompt?: string | null;
  temperature: number;
  context_window: number;
  uncached_input_nanos_per_million: number;
  cache_read_nanos_per_million: number;
  output_nanos_per_million: number;
  currency: string;
}

export interface Conversation {
  id: string;
  title: string;
  provider_id: string | null;
  model_id: string | null;
  pinned_at: number | null;
  archived_at: number | null;
  updated_at: number;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content_json: string;
  reasoning_content: string | null;
  provider_name: string | null;
  model_name: string | null;
  status: string;
  attachments_json: string | null;
  search_metadata_json?: string | null;
  error?: string | null;
  created_at: number;
}

export type Page = 'chat' | 'provider' | 'stats' | 'settings';

export interface AppState {
  page: Page;
  conversations: Conversation[];
  currentConversationId: string | null;
  messages: Message[];
  providers: Provider[];
  models: Model[];
  isStreaming: boolean;
  sidebarCollapsed: boolean;
  rightPanelCollapsed: boolean;
}

export const state: AppState = {
  page: 'chat',
  conversations: [],
  currentConversationId: null,
  messages: [],
  providers: [],
  models: [],
  isStreaming: false,
  sidebarCollapsed: false,
  rightPanelCollapsed: false,
};
