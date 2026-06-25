import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauriRuntime } from './platform/runtime';

const CUSTOM_ACCENT_KEY = 'tc-custom-accent';

function syncWindowTheme(theme: string): void {
  if (!isTauriRuntime()) return;
  const nativeTheme = theme === 'midnight' ? 'dark' : 'light';
  void getCurrentWindow().setTheme(nativeTheme).catch(() => {});
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const normalized = hex.trim();
  const match = /^#?([0-9a-f]{6})$/i.exec(normalized);
  if (!match) return null;
  const value = match[1];
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

export function getCustomAccentColor(): string {
  return localStorage.getItem(CUSTOM_ACCENT_KEY) || '#9589f7';
}

export function setCustomAccentColor(color: string): void {
  if (!hexToRgb(color)) return;
  localStorage.setItem(CUSTOM_ACCENT_KEY, color.startsWith('#') ? color : `#${color}`);
  applyThemePreferences();
}

export function resetCustomAccentColor(): void {
  localStorage.removeItem(CUSTOM_ACCENT_KEY);
  applyThemePreferences();
}

export function applyThemePreferences(): void {
  const theme = localStorage.getItem('tc-theme') || 'midnight';
  document.documentElement.setAttribute('data-theme', theme);
  syncWindowTheme(theme);

  const customAccent = localStorage.getItem(CUSTOM_ACCENT_KEY);
  const rgb = customAccent ? hexToRgb(customAccent) : null;
  if (!customAccent || !rgb) {
    document.documentElement.style.removeProperty('--accent');
    document.documentElement.style.removeProperty('--accent-soft');
    return;
  }

  document.documentElement.style.setProperty('--accent', customAccent);
  document.documentElement.style.setProperty('--accent-soft', `rgba(${rgb.r},${rgb.g},${rgb.b},.12)`);
}
