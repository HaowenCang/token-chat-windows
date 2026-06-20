import { state } from './state';
import { t, getLang, setLang } from './i18n';
import { getBuiltinPromptSnapshot } from './prompt';
import { applyThemePreferences, getCustomAccentColor, resetCustomAccentColor, setCustomAccentColor } from './theme';
import {
  getTooltipDelay,
  getTooltipGlassLevel,
  getTooltipStyle,
  setTooltipDelay,
  setTooltipGlassLevel,
  setTooltipStyle,
  tooltipAttrs,
  tooltipGlassLevels,
  tooltipStyles,
} from './tooltip';
import { bindFontSizeSettings, renderFontSizeSettings } from './font-size-settings';

export function renderSettingsPage(): string {
  const sendKey = localStorage.getItem('tc-send-key') || 'enter';
  const currentTheme = localStorage.getItem('tc-theme') || 'midnight';
  const storedGlobalPrompt = localStorage.getItem('tc-global-prompt');
  const globalPrompt = storedGlobalPrompt !== null ? storedGlobalPrompt : getBuiltinPromptSnapshot();
  const customAccent = getCustomAccentColor();
  const tooltipStyle = getTooltipStyle();
  const tooltipGlassLevel = getTooltipGlassLevel();
  const tooltipDelay = getTooltipDelay();

  return `
    <div style="flex:1;display:flex;flex-direction:column;overflow:hidden">
      <div style="padding:20px 28px 0">
        <h2 style="font-size:var(--fs-page-title);font-weight:700">${t('settings.title')}</h2>
      </div>
      <div style="flex:1;overflow-y:auto;padding:20px 28px 28px">
        <div class="settings-section">
          <h3 class="settings-section-title">${t('settings.language')}</h3>
          <div class="settings-row">
            <label>${t('settings.language')}</label>
            <select class="chat-search" id="settingsLang" style="width:200px">
              <option value="zh" ${getLang() === 'zh' ? 'selected' : ''}>中文</option>
              <option value="en" ${getLang() === 'en' ? 'selected' : ''}>English</option>
            </select>
          </div>
        </div>

        <div class="settings-section">
          <h3 class="settings-section-title">${t('settings.theme')}</h3>
          <div class="settings-row">
            <label>${t('settings.theme')}</label>
            <select class="chat-search" id="settingsTheme" style="width:200px">
              <option value="midnight" ${currentTheme === 'midnight' ? 'selected' : ''}>${t('theme.midnight')}</option>
              <option value="ocean" ${currentTheme === 'ocean' ? 'selected' : ''}>${t('theme.ocean')}</option>
              <option value="forest" ${currentTheme === 'forest' ? 'selected' : ''}>${t('theme.forest')}</option>
              <option value="sunset" ${currentTheme === 'sunset' ? 'selected' : ''}>${t('theme.sunset')}</option>
              <option value="rose" ${currentTheme === 'rose' ? 'selected' : ''}>${t('theme.rose')}</option>
              <option value="light" ${currentTheme === 'light' ? 'selected' : ''}>${t('theme.light')}</option>
            </select>
          </div>
          <div class="settings-row">
            <label>Accent color</label>
            <div class="theme-color-control">
              <input type="color" id="settingsAccentColor" value="${escHtml(customAccent)}">
              <input class="chat-search" id="settingsAccentText" value="${escHtml(customAccent)}" style="width:120px">
              <button class="tool-btn" id="resetAccentColor">Reset</button>
            </div>
          </div>
        </div>

        <div class="settings-section">
          <h3 class="settings-section-title">${t('settings.dataDetailBubbles')}</h3>
          <div class="settings-row">
            <label>${t('settings.bubbleStyle')}</label>
            <select class="chat-search" id="settingsTooltipStyle" style="width:200px">
              ${tooltipStyles.map(style => `<option value="${style.value}" ${tooltipStyle === style.value ? 'selected' : ''}>${escHtml(t(style.labelKey))}</option>`).join('')}
            </select>
            <button class="tool-btn tooltip-preview-trigger" ${tooltipAttrs(t('settings.tooltipPreview'), [
              { label: t('settings.tooltipTotal'), value: '42,000 tokens', color: 'var(--chart-line)' },
              { label: t('settings.tooltipInput'), value: '28,000 tokens', color: 'var(--chart-input)' },
              { label: t('settings.tooltipOutput'), value: '14,000 tokens', color: 'var(--chart-output)' },
            ])}>${t('settings.tooltipPreview')}</button>
          </div>
          <div class="settings-row ${tooltipStyle === 'glass' ? '' : 'hidden'}" id="settingsTooltipGlassRow">
            <label>${t('settings.tooltipGlassLevel')}</label>
            <select class="chat-search" id="settingsTooltipGlassLevel" style="width:200px">
              ${tooltipGlassLevels.map(level => `<option value="${level.value}" ${tooltipGlassLevel === level.value ? 'selected' : ''}>${escHtml(t(level.labelKey))}</option>`).join('')}
            </select>
          </div>
          <div class="settings-row">
            <label>${t('settings.popupDelay')}</label>
            <input class="chat-search" id="settingsTooltipDelay" type="number" min="0" max="2000" step="25" value="${tooltipDelay}" style="width:120px">
            <span class="settings-unit">ms</span>
          </div>
          <div class="settings-hint">${t('settings.tooltipDelayHint')}</div>
        </div>

        ${renderFontSizeSettings()}

        <div class="settings-section">
          <h3 class="settings-section-title">${t('settings.sendKey')}</h3>
          <div class="settings-row">
            <label>${t('settings.sendKey')}</label>
            <select class="chat-search" id="settingsSendKey" style="width:200px">
              <option value="enter" ${sendKey === 'enter' ? 'selected' : ''}>${t('settings.enterToSend')}</option>
              <option value="shift-enter" ${sendKey === 'shift-enter' ? 'selected' : ''}>${t('settings.shiftEnterToSend')}</option>
            </select>
          </div>
          <div class="settings-hint">${t('settings.sendKeyHint')}</div>
        </div>

        <div class="settings-section">
          <h3 class="settings-section-title">${t('settings.globalPrompt')}</h3>
          <div class="settings-row" style="flex-direction:column;align-items:stretch">
            <label>${t('settings.globalPromptDesc')}</label>
            <textarea class="chat-search" id="settingsGlobalPrompt" style="width:100%;min-height:120px;resize:vertical;font-family:var(--font-mono);font-size:var(--fs-code)">${escHtml(globalPrompt)}</textarea>
            <div class="settings-hint">Default source: prompt.txt. Editing this field overrides the built-in prompt.</div>
          </div>
        </div>

        <div class="settings-section">
          <h3 class="settings-section-title">${t('settings.customPrompts')}</h3>
          <div class="settings-row" style="flex-direction:column;align-items:stretch">
            <div style="display:flex;gap:8px;margin-bottom:12px">
              <button class="test-btn" id="addPromptBtn">+ ${t('settings.addPrompt')}</button>
            </div>
            <div id="promptList">
              ${renderPromptList()}
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderPromptList(): string {
  const prompts = JSON.parse(localStorage.getItem('tc-custom-prompts') || '[]');
  if (prompts.length === 0) {
    return `<div style="color:var(--text-faint);font-size:var(--fs-secondary)">${t('settings.noPrompts')}</div>`;
  }
  return prompts.map((p: { name: string; prompt: string; scope: string }, i: number) => `
    <div class="prompt-item" style="display:flex;align-items:center;gap:12px;padding:10px 12px;background:var(--surface);border-radius:8px;margin-bottom:6px">
      <div style="flex:1">
        <div style="font-weight:500">${escHtml(p.name)}</div>
        <div style="font-size:var(--fs-secondary);color:var(--text-faint)">${p.scope}: ${escHtml(p.prompt.slice(0, 60))}${p.prompt.length > 60 ? '...' : ''}</div>
      </div>
      <button class="tool-btn" data-edit-prompt="${i}" style="font-size:var(--fs-secondary)">${t('common.edit')}</button>
      <button class="tool-btn" data-delete-prompt="${i}" style="font-size:var(--fs-secondary);color:var(--danger)">${t('common.delete')}</button>
    </div>
  `).join('');
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function bindSettingsEvents(): void {
  bindFontSizeSettings();

  const langSelect = document.getElementById('settingsLang') as HTMLSelectElement | null;
  if (langSelect) {
    langSelect.addEventListener('change', () => {
      setLang(langSelect.value as 'zh' | 'en');
      const app = document.getElementById('app');
      if (app) {
        const event = new CustomEvent('settings-changed');
        app.dispatchEvent(event);
      }
    });
  }

  const themeSelect = document.getElementById('settingsTheme') as HTMLSelectElement | null;
  if (themeSelect) {
    themeSelect.addEventListener('change', () => {
      const theme = themeSelect.value;
      localStorage.setItem('tc-theme', theme);
      applyThemePreferences();
    });
  }

  const accentColorInput = document.getElementById('settingsAccentColor') as HTMLInputElement | null;
  const accentTextInput = document.getElementById('settingsAccentText') as HTMLInputElement | null;
  const applyAccent = (value: string) => {
    setCustomAccentColor(value);
    const normalized = getCustomAccentColor();
    if (accentColorInput) accentColorInput.value = normalized;
    if (accentTextInput) accentTextInput.value = normalized;
  };
  if (accentColorInput) {
    accentColorInput.addEventListener('input', () => applyAccent(accentColorInput.value));
  }
  if (accentTextInput) {
    accentTextInput.addEventListener('change', () => applyAccent(accentTextInput.value));
  }
  document.getElementById('resetAccentColor')?.addEventListener('click', () => {
    resetCustomAccentColor();
    const normalized = getCustomAccentColor();
    if (accentColorInput) accentColorInput.value = normalized;
    if (accentTextInput) accentTextInput.value = normalized;
  });

  const tooltipStyleSelect = document.getElementById('settingsTooltipStyle') as HTMLSelectElement | null;
  const tooltipGlassRow = document.getElementById('settingsTooltipGlassRow');
  if (tooltipStyleSelect) {
    const syncGlassRow = () => {
      tooltipGlassRow?.classList.toggle('hidden', tooltipStyleSelect.value !== 'glass');
    };
    tooltipStyleSelect.addEventListener('change', () => {
      setTooltipStyle(tooltipStyleSelect.value);
      syncGlassRow();
    });
    syncGlassRow();
  }

  const tooltipGlassSelect = document.getElementById('settingsTooltipGlassLevel') as HTMLSelectElement | null;
  if (tooltipGlassSelect) {
    tooltipGlassSelect.addEventListener('change', () => {
      setTooltipGlassLevel(tooltipGlassSelect.value);
    });
  }

  const tooltipDelayInput = document.getElementById('settingsTooltipDelay') as HTMLInputElement | null;
  if (tooltipDelayInput) {
    const applyDelay = () => {
      setTooltipDelay(tooltipDelayInput.value);
      tooltipDelayInput.value = String(getTooltipDelay());
    };
    tooltipDelayInput.addEventListener('change', applyDelay);
    tooltipDelayInput.addEventListener('blur', applyDelay);
  }

  const sendKeySelect = document.getElementById('settingsSendKey') as HTMLSelectElement | null;
  if (sendKeySelect) {
    sendKeySelect.addEventListener('change', () => {
      localStorage.setItem('tc-send-key', sendKeySelect.value);
    });
  }

  const globalPrompt = document.getElementById('settingsGlobalPrompt') as HTMLTextAreaElement | null;
  if (globalPrompt) {
    globalPrompt.addEventListener('change', () => {
      localStorage.setItem('tc-global-prompt', globalPrompt.value);
    });
  }

  const addPromptBtn = document.getElementById('addPromptBtn');
  if (addPromptBtn) {
    addPromptBtn.addEventListener('click', () => {
      const prompts = JSON.parse(localStorage.getItem('tc-custom-prompts') || '[]');
      prompts.push({ name: 'New Prompt', prompt: '', scope: 'global' });
      localStorage.setItem('tc-custom-prompts', JSON.stringify(prompts));
      const promptList = document.getElementById('promptList');
      if (promptList) promptList.innerHTML = renderPromptList();
    });
  }

  document.querySelectorAll<HTMLElement>('[data-delete-prompt]').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.dataset.deletePrompt ?? '0', 10);
      const prompts = JSON.parse(localStorage.getItem('tc-custom-prompts') || '[]');
      prompts.splice(idx, 1);
      localStorage.setItem('tc-custom-prompts', JSON.stringify(prompts));
      const promptList = document.getElementById('promptList');
      if (promptList) promptList.innerHTML = renderPromptList();
      bindSettingsEvents();
    });
  });

  document.querySelectorAll<HTMLElement>('[data-edit-prompt]').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.dataset.editPrompt ?? '0', 10);
      const prompts = JSON.parse(localStorage.getItem('tc-custom-prompts') || '[]');
      const prompt = prompts[idx];
      if (!prompt) return;
      const promptList = document.getElementById('promptList');
      if (!promptList) return;
      promptList.innerHTML = `
        <div style="padding:16px;background:var(--surface);border-radius:8px;border:1px solid var(--accent)">
          <div style="display:flex;flex-direction:column;gap:12px">
            <div>
              <label style="display:block;font-size:var(--fs-secondary);color:var(--text-muted);margin-bottom:4px">${t('common.name')}</label>
              <input class="chat-search" type="text" id="editPromptName" value="${escHtml(prompt.name)}" style="width:100%">
            </div>
            <div>
              <label style="display:block;font-size:var(--fs-secondary);color:var(--text-muted);margin-bottom:4px">Scope</label>
              <select class="chat-search" id="editPromptScope" style="width:100%">
                <option value="global" ${prompt.scope === 'global' ? 'selected' : ''}>Global</option>
                <option value="conversation" ${prompt.scope === 'conversation' ? 'selected' : ''}>Per Conversation</option>
                <option value="model" ${prompt.scope === 'model' ? 'selected' : ''}>Per Model</option>
              </select>
            </div>
            <div>
              <label style="display:block;font-size:var(--fs-secondary);color:var(--text-muted);margin-bottom:4px">${t('common.systemPrompt')}</label>
              <textarea class="chat-search" id="editPromptContent" style="width:100%;min-height:100px;resize:vertical;font-family:var(--font-mono);font-size:var(--fs-code)">${escHtml(prompt.prompt)}</textarea>
            </div>
            <div style="display:flex;gap:8px;justify-content:flex-end">
              <button class="modal-footer-btn" id="cancelEditPrompt">${t('common.cancel')}</button>
              <button class="test-btn" id="saveEditPrompt" style="background:var(--accent);color:#fff">${t('common.save')}</button>
            </div>
          </div>
        </div>
      `;
      const cancelBtn = document.getElementById('cancelEditPrompt');
      if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
          promptList.innerHTML = renderPromptList();
          bindSettingsEvents();
        });
      }
      const saveBtn = document.getElementById('saveEditPrompt');
      if (saveBtn) {
        saveBtn.addEventListener('click', () => {
          const nameInput = document.getElementById('editPromptName') as HTMLInputElement | null;
          const scopeInput = document.getElementById('editPromptScope') as HTMLSelectElement | null;
          const contentInput = document.getElementById('editPromptContent') as HTMLTextAreaElement | null;
          prompts[idx] = {
            name: nameInput?.value || 'Untitled',
            scope: scopeInput?.value || 'global',
            prompt: contentInput?.value || '',
          };
          localStorage.setItem('tc-custom-prompts', JSON.stringify(prompts));
          promptList.innerHTML = renderPromptList();
          bindSettingsEvents();
        });
      }
    });
  });
}
