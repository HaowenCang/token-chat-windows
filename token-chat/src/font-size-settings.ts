import { t } from './i18n';
import { fontSizeOptions, getFontSize, resetFontSizes, setFontSize, type FontSizeKey } from './font-size';

export function renderFontSizeSettings(): string {
  return `
    <div class="settings-section">
      <div class="settings-section-heading">
        <h3 class="settings-section-title">${t('settings.fontSizes')}</h3>
        <button class="tool-btn" id="resetFontSizes">${t('settings.fontSizeReset')}</button>
      </div>
      <div class="font-size-grid">
        ${fontSizeOptions.map(option => {
          const value = getFontSize(option.key);
          return `
            <div class="font-size-setting">
              <label for="fontSize-${option.key}">${t(option.labelKey)}</label>
              <input
                id="fontSize-${option.key}"
                type="range"
                min="${option.min}"
                max="${option.max}"
                step="1"
                value="${value}"
                data-font-size-range="${option.key}"
              >
              <div class="font-size-number-wrap">
                <input
                  class="chat-search font-size-number"
                  type="number"
                  min="${option.min}"
                  max="${option.max}"
                  step="1"
                  value="${value}"
                  aria-label="${t(option.labelKey)}"
                  data-font-size-number="${option.key}"
                >
                <span class="settings-unit">px</span>
              </div>
            </div>
          `;
        }).join('')}
      </div>
      <div class="settings-hint">${t('settings.fontSizeHint')}</div>
    </div>
  `;
}

export function bindFontSizeSettings(): void {
  const syncInputs = (key: FontSizeKey, value: number) => {
    const range = document.querySelector<HTMLInputElement>(`[data-font-size-range="${key}"]`);
    const number = document.querySelector<HTMLInputElement>(`[data-font-size-number="${key}"]`);
    if (range) range.value = String(value);
    if (number) number.value = String(value);
  };

  document.querySelectorAll<HTMLInputElement>('[data-font-size-range]').forEach(input => {
    input.addEventListener('input', () => {
      const key = input.dataset.fontSizeRange as FontSizeKey;
      syncInputs(key, setFontSize(key, input.value));
    });
  });

  document.querySelectorAll<HTMLInputElement>('[data-font-size-number]').forEach(input => {
    const applyValue = () => {
      const key = input.dataset.fontSizeNumber as FontSizeKey;
      syncInputs(key, setFontSize(key, input.value));
    };
    input.addEventListener('change', applyValue);
    input.addEventListener('blur', applyValue);
  });

  document.getElementById('resetFontSizes')?.addEventListener('click', () => {
    resetFontSizes();
    fontSizeOptions.forEach(option => syncInputs(option.key, option.defaultValue));
  });
}
