const TOOLTIP_STYLE_KEY = 'tc-tooltip-style';
const TOOLTIP_DELAY_KEY = 'tc-tooltip-delay';
const DEFAULT_STYLE = 'dark';
const DEFAULT_DELAY_MS = 80;

export const tooltipStyles = [
  { value: 'dark', label: 'Dark card' },
  { value: 'light', label: 'Light card' },
  { value: 'glass', label: 'Glass' },
  { value: 'compact', label: 'Compact' },
] as const;

type TooltipStyle = typeof tooltipStyles[number]['value'];

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

function isTooltipStyle(value: string | null): value is TooltipStyle {
  return tooltipStyles.some(style => style.value === value);
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
  tooltipEl.className = 'data-tooltip-bubble';
  tooltipEl.setAttribute('role', 'tooltip');
  document.body.appendChild(tooltipEl);
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

  return `
    <div class="data-tooltip-title">${escHtml(payload.title)}</div>
    ${rows ? `<div class="data-tooltip-rows">${rows}</div>` : ''}
  `;
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
  const rect = el.getBoundingClientRect();
  let x = lastPointer.x + 14;
  let y = lastPointer.y + 14;

  if (!lastPointer.x && !lastPointer.y) {
    const targetRect = target.getBoundingClientRect();
    x = targetRect.left + targetRect.width / 2 + 14;
    y = targetRect.top + targetRect.height / 2 + 14;
  }

  const margin = 10;
  if (x + rect.width > window.innerWidth - margin) x = window.innerWidth - rect.width - margin;
  if (y + rect.height > window.innerHeight - margin) y = window.innerHeight - rect.height - margin;
  if (x < margin) x = margin;
  if (y < margin) y = margin;

  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
}

function showTooltip(target: Element): void {
  const payload = parsePayload(target);
  if (!payload) return;
  const el = ensureTooltip();
  el.dataset.style = getTooltipStyle();
  el.innerHTML = renderTooltip(payload);
  el.classList.add('show');
  positionTooltip(target);
}

function hideTooltip(): void {
  clearShowTimer();
  activeTarget = null;
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

export function tooltipAttrs(title: string, rows: TooltipRow[]): string {
  const payload: TooltipPayload = { title, rows };
  return `data-detail-tooltip="${encodeURIComponent(JSON.stringify(payload))}" tabindex="0"`;
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

export function getTooltipDelay(): number {
  return clampDelay(Number(localStorage.getItem(TOOLTIP_DELAY_KEY) ?? DEFAULT_DELAY_MS));
}

export function setTooltipDelay(value: string | number): void {
  localStorage.setItem(TOOLTIP_DELAY_KEY, String(clampDelay(Number(value))));
  applyTooltipPreferences();
}

export function applyTooltipPreferences(): void {
  document.documentElement.setAttribute('data-tooltip-style', getTooltipStyle());
  document.documentElement.style.setProperty('--tooltip-delay', `${getTooltipDelay()}ms`);
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
    if (!target) return;
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
    if (!target || target !== activeTarget) return;
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

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hideTooltip();
  });
}
