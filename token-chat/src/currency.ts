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
  if (typeof rate === 'number' && Number.isFinite(rate) && rate > 0) return rate;
  const fallback = DEFAULT_RATES[base]?.[source];
  return typeof fallback === 'number' && Number.isFinite(fallback) && fallback > 0 ? fallback : 1;
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

const DEFAULT_RATES: ExchangeRateStore = {
  CNY: { USD: 0.1471, EUR: 0.1292, GBP: 0.1114, JPY: 23.76 },
  USD: { CNY: 6.80, EUR: 0.8783, GBP: 0.7575, JPY: 161.56 },
  EUR: { CNY: 7.74, USD: 1.1386, GBP: 0.8627, JPY: 183.97 },
  GBP: { CNY: 8.98, USD: 1.3202, EUR: 1.1591, JPY: 213.26 },
  JPY: { CNY: 0.0421, USD: 0.0062, EUR: 0.0054, GBP: 0.0047 },
};

export async function fetchExchangeRates(): Promise<void> {
  const store = readRateStore();
  const hasAnyRate = Object.keys(store).some(base => Object.keys(store[base] ?? {}).length > 0);
  if (hasAnyRate) return;
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/CNY');
    if (!res.ok) throw new Error('fetch failed');
    const data = await res.json();
    if (data?.rates && typeof data.rates === 'object') {
      const cnyRates: Record<string, number> = {};
      for (const code of currencyOptions) {
        if (code.value !== 'CNY' && typeof data.rates[code.value] === 'number') {
          cnyRates[code.value] = data.rates[code.value];
        }
      }
      if (Object.keys(cnyRates).length > 0) {
        store['CNY'] = cnyRates;
        for (const base of currencyOptions) {
          if (base.value !== 'CNY' && cnyRates[base.value]) {
            store[base.value] = store[base.value] ?? {};
            store[base.value]['CNY'] = 1 / cnyRates[base.value];
            for (const src of currencyOptions) {
              if (src.value !== base.value && src.value !== 'CNY' && cnyRates[src.value]) {
                store[base.value][src.value] = cnyRates[src.value] / cnyRates[base.value];
              }
            }
          }
        }
        localStorage.setItem(EXCHANGE_RATE_KEY, JSON.stringify(store));
        return;
      }
    }
  } catch {}
  localStorage.setItem(EXCHANGE_RATE_KEY, JSON.stringify(DEFAULT_RATES));
}
