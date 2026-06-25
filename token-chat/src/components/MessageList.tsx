/** @jsxImportSource preact */
import { render } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { messages, currentConversationId, isStreaming, syncMessages, getCachedMarkdown, getCachedReasoningMarkdown } from './chat-signals';
import { state, parseContent, type Message } from '../state';
import { t } from '../i18n';
import { parseAttachments, renderMessageAttachments, escHtml, formatFileSize } from '../chat-attachment';
import { isSafeSourceUrl } from '../web-search';
import { copyText } from '../chat-render';
import { renderMarkdown } from '../chat-markdown';
import { getMessageSearchView } from '../chat-view-model';

// ── Source URL click handler ──
async function openSourceUrl(url: string) {
  if (!isSafeSourceUrl(url)) return;
  try {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
  } catch (e) {
    console.error('Failed to open source URL:', e);
  }
}

// ── Search metadata rendering ──

function SearchMetadataView({ msg, isUser }: { msg: Message; isUser: boolean }) {
  const search = getMessageSearchView(msg);
  if (!search) return null;
  if (search.error) {
    if (!isUser) return null;
    const brief = search.error.length > 140 ? `${search.error.slice(0, 139)}...` : search.error;
    return <div class="message-search-state is-error" title={brief}><span aria-hidden="true">!</span> {t('chat.searchFailed')}</div>;
  }
  if (search.resultCount === 0) {
    return isUser ? <div class="message-search-state is-empty">{t('chat.noResults')}</div> : null;
  }
  if (isUser) {
    return <div class="message-search-state is-success"><span class="search-pulse-dot"></span>{t('chat.retrievedResults')} {search.resultCount}</div>;
  }
  const sources = search.sources.map(source => (
    <li class="message-source-item">
      <span class="message-source-index">{source.index}</span>
      <div class="message-source-copy">
        <button class="message-source-title" type="button" onClick={() => openSourceUrl(source.url)}>{source.title}</button>
        <div class="message-source-meta">
          <span>{source.source || t('chat.webSource')}</span>
          <span class="message-source-url">{source.url}</span>
          {source.publishedAt && <span>{source.publishedAt}</span>}
        </div>
      </div>
      <button class="message-source-open" type="button" onClick={() => openSourceUrl(source.url)} aria-label={t('chat.openSource')}>↗</button>
    </li>
  ));

  if (sources.length === 0) return null;
  return (
    <details class="message-sources">
      <summary><span>{t('chat.sources')}</span><span class="glass-chip">{search.resultCount}</span></summary>
      <ol>{sources}</ol>
    </details>
  );
}

// ── Message component ──

function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === 'user';
  const content = parseContent(msg.content_json);
  const attachments = parseAttachments(msg.attachments_json);

  const thinkingRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Update content during streaming without full re-render
  useEffect(() => {
    if (msg.status === 'streaming') {
      if (contentRef.current) {
        contentRef.current.innerHTML = renderMarkdown(content);
      }
      if (msg.reasoning_content && thinkingRef.current) {
        thinkingRef.current.innerHTML = renderMarkdown(msg.reasoning_content);
      }
    }
  }, [content, msg.reasoning_content, msg.status]);

  let statusHtml: preact.JSX.Element | null = null;
  if (msg.status === 'streaming') {
    statusHtml = <span class="msg-metric"><span class="spinner" style={{ display: 'inline-block' }}></span></span>;
  } else if (msg.status === 'cancelled') {
    statusHtml = <span style={{ color: 'var(--warning)', fontSize: 'var(--fs-secondary)' }}>{t('chat.cancelled')}</span>;
  } else if (msg.status === 'failed') {
    statusHtml = <span style={{ color: 'var(--danger)', fontSize: 'var(--fs-secondary)' }}>{t('chat.failed')}</span>;
  }

  const handleCopy = async () => {
    const parts = [content];
    if (attachments.length > 0) {
      parts.push(`Attachments:\n${attachments.map(a => `- ${a.name} (${a.mime}, ${formatFileSize(a.size)})`).join('\n')}`);
    }
    await copyText(parts.filter(Boolean).join('\n\n'));
  };

  return (
    <div class={`msg ${msg.role}`} data-msg-id={msg.id}>
      <div class="msg-bubble">
        {msg.reasoning_content && (
          <div class="msg-thinking" data-toggle-thinking onClick={(e) => {
            if (e.detail > 1) return;
            const sel = window.getSelection();
            if (sel && sel.toString().length > 0) return;
            const body = (e.currentTarget as HTMLElement).querySelector('.msg-thinking-body') as HTMLElement | null;
            if (body) body.style.display = body.style.display === 'none' ? '' : 'none';
          }}>
            <div class="msg-thinking-label">Thinking</div>
            <div class="msg-thinking-body" ref={thinkingRef} dangerouslySetInnerHTML={{ __html: getCachedReasoningMarkdown(msg.reasoning_content) }} />
          </div>
        )}
        <div class="msg-content" ref={contentRef} dangerouslySetInnerHTML={{ __html: getCachedMarkdown(msg.content_json) }} />
        <div dangerouslySetInnerHTML={{ __html: renderMessageAttachments(attachments) }} />
        <SearchMetadataView msg={msg} isUser={isUser} />
      </div>
      <div class="msg-meta">
        {!isUser && msg.model_name && <span class="msg-metric">{msg.model_name}</span>}
        {statusHtml}
        <button class="msg-copy-btn" onClick={handleCopy} title="Copy message">Copy</button>
      </div>
    </div>
  );
}

// ── Welcome screen ──

function WelcomeScreen() {
  if (!currentConversationId.value) {
    return (
      <div class="chat-welcome">
        <div class="welcome-orb" aria-hidden="true"><span></span></div>
        <h1>{t('chat.selectOrCreate')}</h1>
        <p>{t('chat.noConversations')}</p>
      </div>
    );
  }
  return (
    <div class="chat-welcome compact">
      <div class="welcome-orb" aria-hidden="true"><span></span></div>
      <h1>{t('chat.sendToBegin')}</h1>
    </div>
  );
}

// ── MessageList ──

function MessageList() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Auto-scroll on new messages
    if (containerRef.current) {
      requestAnimationFrame(() => {
        containerRef.current!.scrollTop = containerRef.current!.scrollHeight;
      });
    }
  }, [messages.value.length, messages.value[messages.value.length - 1]?.content_json]);

  if (messages.value.length === 0) {
    return <WelcomeScreen />;
  }

  return (
    <div ref={containerRef} style={{ display: 'contents' }}>
      {messages.value.map(msg => <MessageBubble key={msg.id} msg={msg} />)}
    </div>
  );
}

// ── Mount function ──

export function mountMessageList(container: HTMLElement): void {
  syncMessages();
  render(<MessageList />, container);
}

export function updateMessageList(): void {
  syncMessages();
  const container = document.getElementById('chatMessages');
  if (container) {
    render(<MessageList />, container);
  }
}

// ponytail: updateStreamingMessage replacement — direct DOM patch during streaming
// This avoids re-rendering the entire list for each token
export function patchStreamingMessage(msg: Message): void {
  const el = document.querySelector(`[data-msg-id="${msg.id}"]`);
  if (!el) return;

  const contentEl = el.querySelector('.msg-content');
  if (contentEl) {
    contentEl.innerHTML = renderMarkdown(parseContent(msg.content_json));
  }

  const thinkingEl = el.querySelector('.msg-thinking-body') as HTMLElement | null;
  if (msg.reasoning_content && thinkingEl) {
    thinkingEl.innerHTML = renderMarkdown(msg.reasoning_content);
  } else if (msg.reasoning_content && !thinkingEl) {
    const bubble = el.querySelector('.msg-bubble');
    if (bubble) {
      const thinkingDiv = document.createElement('div');
      thinkingDiv.className = 'msg-thinking';
      thinkingDiv.innerHTML = `
        <div class="msg-thinking-label">Thinking</div>
        <div class="msg-thinking-body">${renderMarkdown(msg.reasoning_content)}</div>
      `;
      bubble.insertBefore(thinkingDiv, bubble.firstChild);
    }
  }

  const metaEl = el.querySelector('.msg-meta');
  if (metaEl && !state.isStreaming) {
    const spinner = metaEl.querySelector('.spinner');
    if (spinner) spinner.remove();
    if (msg.status === 'cancelled') {
      metaEl.innerHTML += '<span style="color:var(--warning);font-size:var(--fs-secondary)">Cancelled</span>';
    }
  }

  // Auto-scroll
  const container = document.getElementById('chatMessages');
  if (container) {
    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
  }
}
