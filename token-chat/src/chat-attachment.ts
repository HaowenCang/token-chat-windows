import type { ApiMessageContent } from './chat-token';
import { t } from './i18n';

// ── Attachment types ──

export interface MessageAttachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  kind: 'text' | 'image' | 'binary';
  content?: string;
  data_url?: string;
  truncated?: boolean;
}

// ── Attachment state ──

let _selectedAttachments: MessageAttachment[] = [];

export function getSelectedAttachments(): MessageAttachment[] {
  return _selectedAttachments;
}

export function clearSelectedAttachments(): void {
  _selectedAttachments = [];
}

export function pushSelectedAttachments(items: MessageAttachment[]): void {
  _selectedAttachments = [..._selectedAttachments, ...items];
}

// ── Helpers ──

const MAX_TEXT_ATTACHMENT_BYTES = 180_000;
const MAX_IMAGE_ATTACHMENT_BYTES = 4_000_000;

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function parseAttachments(json: string | null | undefined): MessageAttachment[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isTextLike(file: File): boolean {
  if (file.type.startsWith('text/')) return true;
  return /\.(csv|json|log|md|txt|xml|yaml|yml|ts|tsx|js|jsx|css|html|rs|py|java|go|sql)$/i.test(file.name);
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

async function fileToAttachment(file: File): Promise<MessageAttachment> {
  const base: MessageAttachment = {
    id: crypto.randomUUID(),
    name: file.name,
    mime: file.type || 'application/octet-stream',
    size: file.size,
    kind: 'binary',
  };

  if (file.type.startsWith('image/')) {
    if (file.size <= MAX_IMAGE_ATTACHMENT_BYTES) {
      return { ...base, kind: 'image', data_url: await readFileAsDataUrl(file) };
    }
    return { ...base, kind: 'image', truncated: true };
  }

  if (isTextLike(file)) {
    const truncated = file.size > MAX_TEXT_ATTACHMENT_BYTES;
    const slice = truncated ? file.slice(0, MAX_TEXT_ATTACHMENT_BYTES) : file;
    return {
      ...base,
      kind: 'text',
      content: await slice.text(),
      truncated,
    };
  }

  return base;
}

export async function addAttachmentFiles(files: FileList | null): Promise<void> {
  if (!files || files.length === 0) return;
  const additions = await Promise.all(Array.from(files).map(fileToAttachment));
  pushSelectedAttachments(additions);
}

// ── Rendering ──

export function renderMessageAttachments(attachments: MessageAttachment[]): string {
  if (attachments.length === 0) return '';
  return `
    <div class="msg-attachments">
      ${attachments.map(a => `
        <div class="msg-attachment">
          ${a.kind === 'image' && a.data_url ? `<img src="${escHtml(a.data_url)}" alt="${escHtml(a.name)}">` : ''}
          <div class="msg-attachment-name">${escHtml(a.name)}</div>
          <div class="msg-attachment-meta">${escHtml(a.mime)} · ${formatFileSize(a.size)}${a.truncated ? ' · truncated' : ''}</div>
        </div>
      `).join('')}
    </div>
  `;
}

// ── API content building ──

function buildTextWithAttachments(text: string, attachments: MessageAttachment[]): string {
  const parts: string[] = [];
  if (text.trim()) parts.push(text.trim());

  const attachmentTexts = attachments.map(a => {
    if (a.kind === 'text' && a.content) {
      return [
        `File: ${a.name}`,
        `Type: ${a.mime || 'text/plain'}`,
        a.truncated ? 'Note: content was truncated.' : '',
        'Content:',
        a.content,
      ].filter(Boolean).join('\n');
    }
    return `File: ${a.name}\nType: ${a.mime}\nSize: ${formatFileSize(a.size)}${a.truncated ? '\nNote: file was too large to embed.' : ''}`;
  });

  if (attachmentTexts.length > 0) {
    parts.push(`Attachments:\n\n${attachmentTexts.join('\n\n---\n\n')}`);
  }
  return parts.join('\n\n');
}

export function buildApiContent(text: string, attachments: MessageAttachment[]): ApiMessageContent {
  const imageAttachments = attachments.filter(a => a.kind === 'image' && a.data_url);
  const textPart = buildTextWithAttachments(text, attachments);
  if (imageAttachments.length === 0) return textPart;

  return [
    { type: 'text', text: textPart || 'Please review the attached file(s).' },
    ...imageAttachments.map(a => ({ type: 'image_url' as const, image_url: { url: a.data_url! } })),
  ];
}

export function titleFromContent(text: string, attachments: MessageAttachment[]): string {
  const source = text.trim() || attachments[0]?.name || t('chat.new');
  const cleaned = source
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#*_`>\[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > 28 ? `${cleaned.slice(0, 28)}...` : cleaned;
}

export function isDefaultConversationTitle(title: string): boolean {
  const normalized = title.trim().toLowerCase();
  return normalized === '' || normalized === 'new conversation' || title.trim() === '新对话';
}
