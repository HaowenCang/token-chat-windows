export const themeNames = ['midnight', 'ocean', 'forest', 'sunset', 'rose', 'light'] as const;

export type ThemeName = typeof themeNames[number];
export type SendKeyPreference = 'enter' | 'shift-enter';

export interface SettingsState {
  theme: ThemeName;
  sendKey: SendKeyPreference;
  globalPrompt: string;
}

export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const THEME_KEY = 'tc-theme';
const SEND_KEY = 'tc-send-key';
const GLOBAL_PROMPT_KEY = 'tc-global-prompt';

export function normalizeTheme(value: string | null | undefined): ThemeName {
  return themeNames.includes(value as ThemeName) ? value as ThemeName : 'midnight';
}

export function normalizeSendKey(value: string | null | undefined): SendKeyPreference {
  return value === 'shift-enter' ? 'shift-enter' : 'enter';
}

export function readSettingsState(storage: SettingsStorage, builtinPrompt = ''): SettingsState {
  const storedPrompt = storage.getItem(GLOBAL_PROMPT_KEY);
  return {
    theme: normalizeTheme(storage.getItem(THEME_KEY)),
    sendKey: normalizeSendKey(storage.getItem(SEND_KEY)),
    globalPrompt: storedPrompt === null ? builtinPrompt : storedPrompt,
  };
}

export function getThemePreference(storage: SettingsStorage = localStorage): ThemeName {
  return normalizeTheme(storage.getItem(THEME_KEY));
}

export function setThemePreference(value: string, storage: SettingsStorage = localStorage): ThemeName {
  const theme = normalizeTheme(value);
  storage.setItem(THEME_KEY, theme);
  return theme;
}

export function getSendKeyPreference(storage: SettingsStorage = localStorage): SendKeyPreference {
  return normalizeSendKey(storage.getItem(SEND_KEY));
}

export function setSendKeyPreference(value: string, storage: SettingsStorage = localStorage): SendKeyPreference {
  const sendKey = normalizeSendKey(value);
  storage.setItem(SEND_KEY, sendKey);
  return sendKey;
}

export function setGlobalPromptPreference(value: string, storage: SettingsStorage = localStorage): void {
  storage.setItem(GLOBAL_PROMPT_KEY, value);
}

export function getEffectiveGlobalPrompt(
  builtinPrompt: string,
  storage: SettingsStorage = localStorage,
): string {
  const customPrompt = storage.getItem(GLOBAL_PROMPT_KEY);
  return customPrompt !== null && customPrompt.trim() ? customPrompt : builtinPrompt;
}
