import { getDisplayCurrency, type CurrencyCode } from './currency';
import { getCustomAccentColor, applyThemePreferences } from './theme';
import {
  readSettingsState,
  setGlobalPromptPreference,
  setSendKeyPreference,
  setThemePreference,
  type SettingsState,
} from './settings-state';

export interface AppearanceSettingsModel extends SettingsState {
  accentColor: string;
  displayCurrency: CurrencyCode;
}

export function getAppearanceSettingsModel(builtinPrompt = ''): AppearanceSettingsModel {
  const settings = readSettingsState(localStorage, builtinPrompt);

  return {
    ...settings,
    accentColor: getCustomAccentColor(),
    displayCurrency: getDisplayCurrency(),
  };
}

export function updateThemePreference(value: string): void {
  setThemePreference(value);
  applyThemePreferences();
}

export function updateSendKeyPreference(value: string): void {
  setSendKeyPreference(value);
}

export function updateGlobalPromptPreference(value: string): void {
  setGlobalPromptPreference(value);
}
