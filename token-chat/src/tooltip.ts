import {
  liquidGlassClasses,
  liquidGlassLayers,
  placeLiquidGlassLayer,
  portalLiquidGlassElement,
} from './liquid-glass';

const TOOLTIP_STYLE_KEY = 'tc-tooltip-style';
const TOOLTIP_DELAY_KEY = 'tc-tooltip-delay';
const TOOLTIP_GLASS_LEVEL_KEY = 'tc-tooltip-glass-level';
const DEFAULT_STYLE = 'dark';
const DEFAULT_DELAY_MS = 80;
const DEFAULT_GLASS_LEVEL = 'clear';

export const tooltipStyles = [
  { value: 'dark', labelKey: 'settings.tooltipStyleDark' },
  { value: 'light', labelKey: 'settings.tooltipStyleLight' },
  { value: 'glass', labelKey: 'settings.tooltipStyleGlass' },
  { value: 'compact', labelKey: 'settings.tooltipStyleCompact' },
] as const;

export const tooltipGlassLevels = [
  { value: 'ultra-clear', labelKey: 'settings.tooltipGlassUltraClear' },
  { value: 'clear', labelKey: 'settings.tooltipGlassClear' },
  { value: 'balanced', labelKey: 'settings.tooltipGlassBalanced' },
  { value: 'frosted', labelKey: 'settings.tooltipGlassFrosted' },
] as const;

type TooltipStyle = typeof tooltipStyles[number]['value'];
type TooltipGlassLevel = typeof tooltipGlassLevels[number]['value'];

interface TooltipRow {
  label: string;
  value: string;
  color?: string;
}

interface TooltipPayload {
  title: string;
  rows: TooltipRow[];
}

let tooltipEl: HTMLDivElement | null = null;
let activeTarget: Element | null = null;
let showTimer: number | null = null;
let lastPointer = { x: 0, y: 0 };
let bound = false;
let clickPinned = false;

function isTooltipStyle(value: string | null): value is TooltipStyle {
  return tooltipStyles.some(style => style.value === value);
}

function isTooltipGlassLevel(value: string | null): value is TooltipGlassLevel {
  return tooltipGlassLevels.some(level => level.value === value);
}

function clampDelay(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_DELAY_MS;
  return Math.max(0, Math.min(2000, Math.round(value)));
}

function escHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escAttr(value: string): string {
  return escHtml(value).replace(/'/g, '&#39;');
}

function parsePayload(target: Element): TooltipPayload | null {
  const raw = target.getAttribute('data-detail-tooltip');
  if (!raw) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(raw));
    if (!parsed || typeof parsed.title !== 'string' || !Array.isArray(parsed.rows)) return null;
    return {
      title: parsed.title,
      rows: parsed.rows
        .filter((row: any) => row && typeof row.label === 'string' && typeof row.value === 'string')
        .map((row: any) => ({
          label: row.label,
          value: row.value,
          color: typeof row.color === 'string' ? row.color : undefined,
        })),
    };
  } catch {
    return null;
  }
}

function ensureTooltip(): HTMLDivElement {
  if (tooltipEl) return tooltipEl;
  tooltipEl = document.createElement('div');
  tooltipEl.className = liquidGlassClasses('tooltip', 'data-tooltip-bubble glass-tooltip');
  tooltipEl.id = 'globalDataTooltip';
  tooltipEl.setAttribute('role', 'tooltip');
  portalLiquidGlassElement(tooltipEl, 'tooltip');
  return tooltipEl;
}

function renderTooltip(payload: TooltipPayload): string {
  const rows = payload.rows.map(row => {
    const style = row.color ? ` style="--tooltip-row-color:${escAttr(row.color)}"` : '';
    return `
      <div class="data-tooltip-row"${style}>
        <span class="data-tooltip-label">${escHtml(row.label)}</span>
        <span class="data-tooltip-value">${escHtml(row.value)}</span>
      </div>
    `;
  }).join('');

  const content = `
    <div class="data-tooltip-title">${escHtml(payload.title)}</div>
    ${rows ? `<div class="data-tooltip-rows">${rows}</div>` : ''}
  `;
  return liquidGlassLayers(content);
}

function findTooltipTarget(event: Event): Element | null {
  const target = event.target as Element | null;
  return target?.closest?.('[data-detail-tooltip]') ?? null;
}

function clearShowTimer(): void {
  if (showTimer !== null) {
    window.clearTimeout(showTimer);
    showTimer = null;
  }
}

function positionTooltip(target: Element): void {
  const el = ensureTooltip();
  placeLiquidGlassLayer(el, {
    anchor: lastPointer.x || lastPointer.y ? undefined : target,
    point: lastPointer.x || lastPointer.y ? lastPointer : undefined,
    offset: 14,
    margin: 10,
    minWidth: 180,
    maxWidth: 300,
  });
}

function showTooltip(target: Element): void {
  const payload = parsePayload(target);
  if (!payload) return;
  const el = ensureTooltip();
  el.dataset.style = getTooltipStyle();
  el.dataset.glassLevel = getTooltipGlassLevel();
  el.innerHTML = renderTooltip(payload);
  el.classList.add('show');
  target.setAttribute('aria-describedby', el.id);
  positionTooltip(target);
}

function hideTooltip(): void {
  clearShowTimer();
  if (activeTarget) activeTarget.removeAttribute('aria-describedby');
  activeTarget = null;
  clickPinned = false;
  if (tooltipEl) {
    tooltipEl.classList.remove('show');
  }
}

function scheduleTooltip(target: Element): void {
  clearShowTimer();
  activeTarget = target;
  const delay = getTooltipDelay();
  if (delay === 0) {
    showTooltip(target);
    return;
  }
  showTimer = window.setTimeout(() => {
    if (activeTarget === target) showTooltip(target);
  }, delay);
}

export function tooltipAttrs(
  title: string,
  rows: TooltipRow[],
  options: { trigger?: 'hover' | 'click' } = {},
): string {
  const payload: TooltipPayload = { title, rows };
  const trigger = options.trigger ? ` data-tooltip-trigger="${options.trigger}"` : '';
  return `data-detail-tooltip="${encodeURIComponent(JSON.stringify(payload))}"${trigger} tabindex="0"`;
}

export function getTooltipStyle(): TooltipStyle {
  const stored = localStorage.getItem(TOOLTIP_STYLE_KEY);
  return isTooltipStyle(stored) ? stored : DEFAULT_STYLE;
}

export function setTooltipStyle(value: string): void {
  if (!isTooltipStyle(value)) return;
  localStorage.setItem(TOOLTIP_STYLE_KEY, value);
  applyTooltipPreferences();
}

export function getTooltipGlassLevel(): TooltipGlassLevel {
  const stored = localStorage.getItem(TOOLTIP_GLASS_LEVEL_KEY);
  return isTooltipGlassLevel(stored) ? stored : DEFAULT_GLASS_LEVEL;
}

export function setTooltipGlassLevel(value: string): void {
  if (!isTooltipGlassLevel(value)) return;
  localStorage.setItem(TOOLTIP_GLASS_LEVEL_KEY, value);
  applyTooltipPreferences();
}

export function getTooltipDelay(): number {
  return clampDelay(Number(localStorage.getItem(TOOLTIP_DELAY_KEY) ?? DEFAULT_DELAY_MS));
}

export function setTooltipDelay(value: string | number): void {
  localStorage.setItem(TOOLTIP_DELAY_KEY, String(clampDelay(Number(value))));
  applyTooltipPreferences();
}

export function applyTooltipPreferences(): void {
  document.documentElement.setAttribute('data-tooltip-style', getTooltipStyle());
  document.documentElement.setAttribute('data-tooltip-glass-level', getTooltipGlassLevel());
  document.documentElement.style.setProperty('--tooltip-delay', `${getTooltipDelay()}ms`);
  if (tooltipEl) {
    tooltipEl.dataset.style = getTooltipStyle();
    tooltipEl.dataset.glassLevel = getTooltipGlassLevel();
  }
}

export function bindDataTooltips(): void {
  if (bound) {
    applyTooltipPreferences();
    return;
  }
  bound = true;
  applyTooltipPreferences();

  document.addEventListener('pointerover', (event) => {
    const target = findTooltipTarget(event);
    if (!target || target.getAttribute('data-tooltip-trigger') === 'click') return;
    const pointerEvent = event as PointerEvent;
    const related = pointerEvent.relatedTarget as Node | null;
    if (related && target.contains(related)) return;
    lastPointer = { x: pointerEvent.clientX, y: pointerEvent.clientY };
    scheduleTooltip(target);
  }, true);

  document.addEventListener('pointermove', (event) => {
    if (!activeTarget) return;
    const pointerEvent = event as PointerEvent;
    lastPointer = { x: pointerEvent.clientX, y: pointerEvent.clientY };
    if (tooltipEl?.classList.contains('show')) positionTooltip(activeTarget);
  }, true);

  document.addEventListener('pointerout', (event) => {
    const target = findTooltipTarget(event);
    if (!target || target !== activeTarget || clickPinned) return;
    const pointerEvent = event as PointerEvent;
    const related = pointerEvent.relatedTarget as Node | null;
    if (related && target.contains(related)) return;
    hideTooltip();
  }, true);

  document.addEventListener('focusin', (event) => {
    const target = findTooltipTarget(event);
    if (!target) return;
    lastPointer = { x: 0, y: 0 };
    scheduleTooltip(target);
  }, true);

  document.addEventListener('focusout', (event) => {
    if (findTooltipTarget(event)) hideTooltip();
  }, true);

  document.addEventListener('click', event => {
    const target = findTooltipTarget(event);
    if (target?.getAttribute('data-tooltip-trigger') === 'click') {
      if (activeTarget === target && tooltipEl?.classList.contains('show')) {
        hideTooltip();
        return;
      }
      clearShowTimer();
      activeTarget = target;
      clickPinned = true;
      lastPointer = { x: 0, y: 0 };
      showTooltip(target);
      return;
    }
    if (clickPinned) hideTooltip();
  }, true);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hideTooltip();
  });
}
