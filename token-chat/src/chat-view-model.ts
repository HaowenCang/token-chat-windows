import { state, type Conversation, type Message, type Model } from './state';
import { relativeTime } from './chat-token';
import { isSafeSourceUrl, parseSearchMetadata } from './web-search';

export interface ConversationListItemView {
  id: string;
  title: string;
  modelName: string;
  relativeUpdatedAt: string;
  isActive: boolean;
}

export interface MessageSearchSourceView {
  index: number;
  title: string;
  url: string;
  source: string;
  publishedAt: string | null;
}

export interface MessageSearchView {
  error: string | null;
  resultCount: number;
  sources: MessageSearchSourceView[];
}

function displayModelName(conversation: Conversation, models: Model[]): string {
  const model = models.find(m => m.id === conversation.model_id);
  return model?.display_name ?? model?.model_name ?? '';
}

function sourceHost(value: string): string {
  try {
    return new URL(value).hostname;
  } catch {
    return '';
  }
}

export function getConversationListItems(): ConversationListItemView[] {
  return state.conversations.map(conversation => ({
    id: conversation.id,
    title: conversation.title,
    modelName: displayModelName(conversation, state.models),
    relativeUpdatedAt: relativeTime(conversation.updated_at),
    isActive: conversation.id === state.currentConversationId,
  }));
}

export function getMessageSearchView(message: Message): MessageSearchView | null {
  const metadata = parseSearchMetadata(message.search_metadata_json);
  if (!metadata) return null;
  const sources = metadata.results
    .filter(result => isSafeSourceUrl(result.url))
    .map((result, index) => ({
      index: index + 1,
      title: result.title,
      url: result.url,
      source: result.source || sourceHost(result.url),
      publishedAt: result.publishedAt ?? null,
    }));
  return {
    error: metadata.error ?? null,
    resultCount: metadata.results.length,
    sources,
  };
}
