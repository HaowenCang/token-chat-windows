import { getLang } from './i18n';

const DISPLAY_CURRENCY_KEY = 'tc-display-currency';
const EXCHANGE_RATE_KEY = 'tc-exchange-rates';
const DEFAULT_DISPLAY_CURRENCY = 'CNY';

export const currencyOptions = [
  { value: 'CNY', labelKey: 'settings.currencyCny' },
  { value: 'USD', labelKey: 'settings.currencyUsd' },
  { value: 'EUR', labelKey: 'settings.currencyEur' },
  { value: 'GBP', labelKey: 'settings.currencyGbp' },
  { value: 'JPY', labelKey: 'settings.currencyJpy' },
] as const;

export type CurrencyCode = typeof currencyOptions[number]['value'];
type ExchangeRateStore = Record<string, Record<string, number>>;

export function isCurrencyCode(value: string | null): value is CurrencyCode {
  return currencyOptions.some(option => option.value === value);
}

export function normalizeCurrency(value: string | null | undefined): CurrencyCode {
  const normalized = value?.trim().toUpperCase() ?? '';
  return isCurrencyCode(normalized) ? normalized : DEFAULT_DISPLAY_CURRENCY;
}

export function getDisplayCurrency(): CurrencyCode {
  return normalizeCurrency(localStorage.getItem(DISPLAY_CURRENCY_KEY));
}

export function setDisplayCurrency(value: string): void {
  if (!isCurrencyCode(value)) return;
  localStorage.setItem(DISPLAY_CURRENCY_KEY, value);
}

function readRateStore(): ExchangeRateStore {
  try {
    const parsed = JSON.parse(localStorage.getItem(EXCHANGE_RATE_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed as ExchangeRateStore : {};
  } catch {
    return {};
  }
}

export function getExchangeRate(sourceCurrency: string, baseCurrency = getDisplayCurrency()): number {
  const source = normalizeCurrency(sourceCurrency);
  const base = normalizeCurrency(baseCurrency);
  if (source === base) return 1;
  const rate = readRateStore()[base]?.[source];
  return typeof rate === 'number' && Number.isFinite(rate) && rate > 0 ? rate : 1;
}

export function setExchangeRate(sourceCurrency: string, value: number | string): number {
  const source = normalizeCurrency(sourceCurrency);
  const base = getDisplayCurrency();
  const parsed = Number(value);
  const normalized = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  const store = readRateStore();
  store[base] = { ...(store[base] ?? {}), [source]: normalized };
  localStorage.setItem(EXCHANGE_RATE_KEY, JSON.stringify(store));
  return normalized;
}

export function convertCurrencyNanos(
  nanos: number,
  sourceCurrency: string,
  baseCurrency = getDisplayCurrency(),
): number {
  return Math.round(nanos * getExchangeRate(sourceCurrency, baseCurrency));
}

export function formatCurrencyAmount(
  amount: number,
  fractionDigits = 2,
  currency: string = getDisplayCurrency(),
): string {
  const normalizedCurrency = normalizeCurrency(currency);
  try {
    return new Intl.NumberFormat(getLang() === 'zh' ? 'zh-CN' : 'en-US', {
      style: 'currency',
      currency: normalizedCurrency,
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(amount);
  } catch {
    return `${normalizedCurrency} ${amount.toFixed(fractionDigits)}`;
  }
}

export function formatCurrencyNanos(
  nanos: number,
  fractionDigits = 4,
  currency: string = getDisplayCurrency(),
): string {
  return formatCurrencyAmount(nanos / 1_000_000_000, fractionDigits, currency);
}
