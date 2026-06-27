/** @jsxImportSource preact */
import { render } from 'preact';
import { signal } from '@preact/signals';
import { t } from '../i18n';
import { getConversationListItems, type ConversationListItemView } from '../chat-view-model';
import styles from './ConversationList.module.css';

// ── Signals ──

const conversations = signal<ConversationListItemView[]>([]);

function syncConversationSignals(): void {
  conversations.value = getConversationListItems();
}

// ── Component ──

interface ConversationListProps {
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

function ConversationListInner({ onSelect, onDelete }: ConversationListProps) {
  const convs = conversations.value;

  if (convs.length === 0) {
    return <div class={styles.emptyState}>{t('chat.noConversations')}</div>;
  }

  return (
    <div>
      {convs.map(c => {
        return (
          <div
            class={`chat-item ${c.isActive ? 'active' : ''}`}
            data-conv-id={c.id}
            onClick={() => onSelect(c.id)}
            key={c.id}
          >
            <div class="chat-item-content">
              <div class="chat-item-title">{c.title}</div>
              <div class="chat-item-meta">
                {c.modelName && <span class="chat-item-model">{c.modelName}</span>}
                <span>{c.relativeUpdatedAt}</span>
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
): void {
  syncConversationSignals();
  render(<ConversationListInner onSelect={onSelect} onDelete={onDelete} />, container);
}
