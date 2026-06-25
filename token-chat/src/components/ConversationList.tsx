/** @jsxImportSource preact */
import { render } from 'preact';
import { signal } from '@preact/signals';
import { state, type Conversation } from '../state';
import { t } from '../i18n';
import { relativeTime } from '../chat-token';
import { escHtml } from '../chat-attachment';

// ── Signals ──

export const conversations = signal<Conversation[]>([]);
export const activeConversationId = signal<string | null>(null);

export function syncConversationSignals(): void {
  conversations.value = [...state.conversations];
  activeConversationId.value = state.currentConversationId;
}

// ── Component ──

interface ConversationListProps {
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
}

function ConversationListInner({ onSelect, onDelete, onNew }: ConversationListProps) {
  const convs = conversations.value;
  const activeId = activeConversationId.value;

  if (convs.length === 0) {
    return <div class="placeholder-content" style={{ height: '100%' }}>{t('chat.noConversations')}</div>;
  }

  return (
    <div>
      {convs.map(c => {
        const isActive = c.id === activeId;
        const model = state.models.find(m => m.id === c.model_id);
        const modelName = model?.display_name ?? model?.model_name ?? '';
        return (
          <div
            class={`chat-item ${isActive ? 'active' : ''}`}
            data-conv-id={c.id}
            onClick={() => onSelect(c.id)}
            key={c.id}
          >
            <div class="chat-item-content">
              <div class="chat-item-title">{c.title}</div>
              <div class="chat-item-meta">
                {modelName && <span class="chat-item-model">{modelName}</span>}
                <span>{relativeTime(c.updated_at)}</span>
              </div>
            </div>
            <button
              class="chat-item-delete"
              title={t('common.delete')}
              onClick={(e) => { e.stopPropagation(); onDelete(c.id); }}
            >
              &#10005;
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ── Mount function ──

export function mountConversationList(
  container: HTMLElement,
  onSelect: (id: string) => void,
  onDelete: (id: string) => void,
  onNew: () => void,
): void {
  syncConversationSignals();
  render(<ConversationListInner onSelect={onSelect} onDelete={onDelete} onNew={onNew} />, container);
}
