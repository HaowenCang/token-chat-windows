import { liquidGlassClasses, liquidGlassLayers, portalLiquidGlassElement } from './liquid-glass';
import { t } from './i18n';

interface DialogOptions {
  title: string;
  message?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  mode: 'alert' | 'confirm' | 'prompt';
}

function escHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showGlassDialog(options: DialogOptions): Promise<boolean | string | null> {
  return new Promise(resolve => {
    const backdrop = document.createElement('div');
    backdrop.className = 'glass-modal-backdrop glass-dialog-backdrop';
    backdrop.dataset.glassDialog = options.mode;
    const inputId = `glassDialogInput-${Date.now()}`;
    const input = options.mode === 'prompt'
      ? `<input class="glass-input glass-dialog-input" id="${inputId}" aria-label="${escHtml(options.title)}" value="${escHtml(options.defaultValue || '')}">`
      : '';
    const message = options.message ? `<p class="glass-dialog-message">${escHtml(options.message)}</p>` : '';
    const cancel = options.mode === 'alert' ? '' : `<button type="button" class="glass-button glass-button--secondary" data-dialog-cancel>${escHtml(options.cancelLabel || t('common.cancel'))}</button>`;
    const confirmClass = options.danger ? 'glass-button--danger' : 'glass-button--primary';
    const content = `
      <div class="glass-dialog-copy">
        <h2 id="glassDialogTitle">${escHtml(options.title)}</h2>
        ${message}
        ${input}
      </div>
      <div class="glass-dialog-actions">
        ${cancel}
        <button type="button" class="glass-button ${confirmClass}" data-dialog-confirm>${escHtml(options.confirmLabel || t('dialog.ok'))}</button>
      </div>
    `;
    backdrop.innerHTML = `<section class="${liquidGlassClasses('dialog', 'glass-dialog')}" role="dialog" aria-modal="true" aria-labelledby="glassDialogTitle">${liquidGlassLayers(content)}</section>`;
    portalLiquidGlassElement(backdrop, 'dialog');

    const dialog = backdrop.querySelector<HTMLElement>('.glass-dialog')!;
    const promptInput = backdrop.querySelector<HTMLInputElement>('input');
    const confirmButton = backdrop.querySelector<HTMLButtonElement>('[data-dialog-confirm]')!;
    const cancelButton = backdrop.querySelector<HTMLButtonElement>('[data-dialog-cancel]');
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)'));

    const finish = (value: boolean | string | null) => {
      document.removeEventListener('keydown', onKeyDown, true);
      backdrop.remove();
      resolve(value);
    };
    const confirmDialog = () => finish(options.mode === 'prompt' ? promptInput?.value ?? '' : true);
    const cancelDialog = () => finish(options.mode === 'confirm' ? false : null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancelDialog();
      } else if (event.key === 'Enter' && (options.mode !== 'prompt' || document.activeElement === promptInput)) {
        event.preventDefault();
        confirmDialog();
      } else if (event.key === 'Tab') {
        const items = focusable();
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    confirmButton.addEventListener('click', confirmDialog);
    cancelButton?.addEventListener('click', cancelDialog);
    backdrop.addEventListener('pointerdown', event => {
      if (event.target === backdrop) cancelDialog();
    });
    document.addEventListener('keydown', onKeyDown, true);
    window.requestAnimationFrame(() => (promptInput || confirmButton).focus());
  });
}

export function showGlassAlert(message: string, title = t('dialog.defaultTitle')): Promise<void> {
  return showGlassDialog({ mode: 'alert', title, message }).then(() => undefined);
}

export function showGlassConfirm(message: string, title = t('dialog.confirm'), danger = false): Promise<boolean> {
  return showGlassDialog({ mode: 'confirm', title, message, confirmLabel: t('dialog.confirm'), danger }).then(Boolean);
}

export function showGlassPrompt(title: string, defaultValue = ''): Promise<string | null> {
  return showGlassDialog({ mode: 'prompt', title, defaultValue, confirmLabel: t('common.save') }) as Promise<string | null>;
}
