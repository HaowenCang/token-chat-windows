const FONT_SIZE_STORAGE_KEY = 'tc-font-sizes';

export const fontSizeOptions = [
  { key: 'pageTitle', cssVariable: '--fs-page-title', defaultValue: 28, min: 18, max: 40, labelKey: 'settings.fontSizePageTitle' },
  { key: 'sectionTitle', cssVariable: '--fs-section-title', defaultValue: 15, min: 12, max: 24, labelKey: 'settings.fontSizeSectionTitle' },
  { key: 'body', cssVariable: '--fs-body', defaultValue: 13, min: 10, max: 22, labelKey: 'settings.fontSizeBody' },
  { key: 'secondary', cssVariable: '--fs-secondary', defaultValue: 11, min: 9, max: 18, labelKey: 'settings.fontSizeSecondary' },
  { key: 'control', cssVariable: '--fs-control', defaultValue: 12, min: 10, max: 20, labelKey: 'settings.fontSizeControl' },
  { key: 'message', cssVariable: '--fs-message', defaultValue: 13, min: 11, max: 24, labelKey: 'settings.fontSizeMessage' },
  { key: 'markdownHeading', cssVariable: '--fs-markdown-heading', defaultValue: 22, min: 16, max: 36, labelKey: 'settings.fontSizeMarkdownHeading' },
  { key: 'code', cssVariable: '--fs-code', defaultValue: 12, min: 10, max: 22, labelKey: 'settings.fontSizeCode' },
  { key: 'math', cssVariable: '--fs-math', defaultValue: 17, min: 12, max: 28, labelKey: 'settings.fontSizeMath' },
  { key: 'chart', cssVariable: '--fs-chart', defaultValue: 12, min: 9, max: 16, labelKey: 'settings.fontSizeChart' },
  { key: 'data', cssVariable: '--fs-data', defaultValue: 26, min: 16, max: 40, labelKey: 'settings.fontSizeData' },
  { key: 'table', cssVariable: '--fs-table', defaultValue: 12, min: 10, max: 20, labelKey: 'settings.fontSizeTable' },
  { key: 'tooltip', cssVariable: '--fs-tooltip', defaultValue: 12, min: 10, max: 20, labelKey: 'settings.fontSizeTooltip' },
] as const;

export type FontSizeKey = typeof fontSizeOptions[number]['key'];
type FontSizePreferences = Partial<Record<FontSizeKey, number>>;

function readPreferences(): FontSizePreferences {
  try {
    const parsed = JSON.parse(localStorage.getItem(FONT_SIZE_STORAGE_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed as FontSizePreferences : {};
  } catch {
    return {};
  }
}

function clampValue(key: FontSizeKey, value: number): number {
  const option = fontSizeOptions.find(item => item.key === key)!;
  const normalized = Number.isFinite(value) ? Math.round(value) : option.defaultValue;
  return Math.min(option.max, Math.max(option.min, normalized));
}

export function getFontSize(key: FontSizeKey): number {
  const option = fontSizeOptions.find(item => item.key === key)!;
  const stored = readPreferences()[key];
  return typeof stored === 'number' ? clampValue(key, stored) : option.defaultValue;
}

export function setFontSize(key: FontSizeKey, value: number | string): number {
  const normalized = clampValue(key, Number(value));
  const preferences = readPreferences();
  preferences[key] = normalized;
  localStorage.setItem(FONT_SIZE_STORAGE_KEY, JSON.stringify(preferences));
  applyFontSizePreferences();
  return normalized;
}

export function resetFontSizes(): void {
  localStorage.removeItem(FONT_SIZE_STORAGE_KEY);
  applyFontSizePreferences();
}

export function applyFontSizePreferences(): void {
  const preferences = readPreferences();
  const rootStyle = document.documentElement.style;

  fontSizeOptions.forEach(option => {
    if (typeof preferences[option.key] === 'number') {
      rootStyle.setProperty(option.cssVariable, `${clampValue(option.key, preferences[option.key]!)}px`);
    } else {
      rootStyle.removeProperty(option.cssVariable);
    }
  });
}
