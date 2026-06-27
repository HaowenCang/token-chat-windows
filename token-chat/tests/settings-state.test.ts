import { describe, expect, it } from 'vitest';
import {
  getEffectiveGlobalPrompt,
  normalizeSendKey,
  normalizeTheme,
  readSettingsState,
  setSendKeyPreference,
  setThemePreference,
  type SettingsStorage,
} from '../src/settings-state';

class MemoryStorage implements SettingsStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe('settings state', () => {
  it('normalizes unsupported theme and send key values', () => {
    expect(normalizeTheme('forest')).toBe('forest');
    expect(normalizeTheme('unknown')).toBe('midnight');
    expect(normalizeSendKey('shift-enter')).toBe('shift-enter');
    expect(normalizeSendKey('space')).toBe('enter');
  });

  it('reads defaults and persists normalized preferences', () => {
    const storage = new MemoryStorage();
    expect(readSettingsState(storage, 'Builtin')).toEqual({
      theme: 'midnight',
      sendKey: 'enter',
      globalPrompt: 'Builtin',
    });

    expect(setThemePreference('rose', storage)).toBe('rose');
    expect(setThemePreference('invalid', storage)).toBe('midnight');
    expect(setSendKeyPreference('shift-enter', storage)).toBe('shift-enter');
    expect(readSettingsState(storage, 'Builtin')).toMatchObject({
      theme: 'midnight',
      sendKey: 'shift-enter',
    });
  });

  it('uses the builtin prompt when the custom prompt is blank', () => {
    const storage = new MemoryStorage();
    storage.setItem('tc-global-prompt', '   ');
    expect(readSettingsState(storage, 'Builtin').globalPrompt).toBe('   ');
    expect(getEffectiveGlobalPrompt('Builtin', storage)).toBe('Builtin');

    storage.setItem('tc-global-prompt', 'Custom');
    expect(getEffectiveGlobalPrompt('Builtin', storage)).toBe('Custom');
  });
});
