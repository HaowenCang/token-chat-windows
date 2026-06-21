type PickerState = {
  input: HTMLInputElement;
  trigger: HTMLButtonElement;
  popover: HTMLDivElement;
  viewDate: Date;
};

let initialized = false;
let activePicker: PickerState | null = null;

const pad = (value: number) => String(value).padStart(2, '0');
const toDateKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

function calendarText() {
  const isZh = (document.documentElement.lang || '').toLowerCase().startsWith('zh');
  return isZh
    ? { start: '开始日期', end: '结束日期', select: '选择日期', previous: '上个月', next: '下个月', clear: '清除', today: '今天' }
    : { start: 'Start date', end: 'End date', select: 'Select date', previous: 'Previous month', next: 'Next month', clear: 'Clear', today: 'Today' };
}

function parseDateKey(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dateLabel(value: string, fallback: string): string {
  const parsed = parseDateKey(value);
  if (!parsed) return fallback;
  return new Intl.DateTimeFormat(document.documentElement.lang || undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(parsed);
}

function closePicker() {
  if (!activePicker) return;
  activePicker.trigger.setAttribute('aria-expanded', 'false');
  activePicker.popover.remove();
  activePicker = null;
}

function positionPopover(state: PickerState) {
  const rect = state.trigger.getBoundingClientRect();
  const width = Math.min(320, window.innerWidth - 24);
  const popoverHeight = Math.min(state.popover.scrollHeight || 400, window.innerHeight - 24);
  const below = window.innerHeight - rect.bottom;
  const top = below >= popoverHeight || rect.top < popoverHeight
    ? rect.bottom + 8
    : rect.top - popoverHeight - 8;
  const left = Math.min(Math.max(12, rect.left), window.innerWidth - width - 12);
  state.popover.style.width = `${width}px`;
  state.popover.style.left = `${left}px`;
  state.popover.style.top = `${Math.max(12, top)}px`;
}

function getRange(input: HTMLInputElement) {
  if (!input.id.startsWith('stats')) return { start: '', end: '' };
  return {
    start: (document.getElementById('statsStartDate') as HTMLInputElement | null)?.value || '',
    end: (document.getElementById('statsEndDate') as HTMLInputElement | null)?.value || '',
  };
}

function renderCalendar(state: PickerState) {
  const { viewDate, input, popover } = state;
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const monthTitle = new Intl.DateTimeFormat(document.documentElement.lang || undefined, {
    year: 'numeric',
    month: 'long',
  }).format(viewDate);
  const weekdayFormatter = new Intl.DateTimeFormat(document.documentElement.lang || undefined, { weekday: 'short' });
  const weekdays = Array.from({ length: 7 }, (_, index) => weekdayFormatter.format(new Date(2024, 0, 7 + index)));
  const firstDay = new Date(year, month, 1);
  const gridStart = new Date(year, month, 1 - firstDay.getDay());
  const todayKey = toDateKey(new Date());
  const { start, end } = getRange(input);
  const copy = calendarText();
  const rangeStart = start && end && start > end ? end : start;
  const rangeEnd = start && end && start > end ? start : end;

  const dayButtons = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    const key = toDateKey(date);
    const classes = ['glass-calendar-day'];
    if (date.getMonth() !== month) classes.push('is-outside');
    if (key === todayKey) classes.push('is-today');
    if (key === input.value) classes.push('is-selected');
    if (rangeStart && key === rangeStart) classes.push('is-range-start');
    if (rangeEnd && key === rangeEnd) classes.push('is-range-end');
    if (rangeStart && rangeEnd && key > rangeStart && key < rangeEnd) classes.push('is-range-middle');
    return `<button type="button" class="${classes.join(' ')}" data-date="${key}" aria-label="${key}" aria-selected="${key === input.value}">${date.getDate()}</button>`;
  }).join('');

  popover.innerHTML = `
    <div class="glass-calendar-header">
      <button type="button" class="glass-calendar-nav" data-calendar-nav="prev" aria-label="${copy.previous}">‹</button>
      <strong class="glass-calendar-title">${monthTitle}</strong>
      <button type="button" class="glass-calendar-nav" data-calendar-nav="next" aria-label="${copy.next}">›</button>
    </div>
    <div class="glass-calendar-weekdays">${weekdays.map(day => `<span>${day}</span>`).join('')}</div>
    <div class="glass-calendar-grid">${dayButtons}</div>
    <div class="glass-calendar-footer">
      <button type="button" class="glass-calendar-action" data-calendar-action="clear">${copy.clear}</button>
      <button type="button" class="glass-calendar-action is-primary" data-calendar-action="today">${copy.today}</button>
    </div>
  `;

  popover.querySelectorAll<HTMLButtonElement>('[data-calendar-nav]').forEach(button => {
    button.addEventListener('click', () => {
      state.viewDate = new Date(year, month + (button.dataset.calendarNav === 'next' ? 1 : -1), 1);
      renderCalendar(state);
    });
  });
  popover.querySelectorAll<HTMLButtonElement>('[data-date]').forEach(button => {
    button.addEventListener('click', () => selectDate(state, button.dataset.date || ''));
  });
  popover.querySelector<HTMLButtonElement>('[data-calendar-action="clear"]')?.addEventListener('click', () => selectDate(state, ''));
  popover.querySelector<HTMLButtonElement>('[data-calendar-action="today"]')?.addEventListener('click', () => selectDate(state, todayKey));
}

function selectDate(state: PickerState, value: string) {
  state.input.value = value;
  state.trigger.querySelector<HTMLElement>('.glass-date-value')!.textContent = dateLabel(value, state.trigger.dataset.placeholder || 'Select date');
  state.trigger.classList.toggle('has-value', Boolean(value));
  state.input.dispatchEvent(new Event('input', { bubbles: true }));
  state.input.dispatchEvent(new Event('change', { bubbles: true }));
  closePicker();
}

function openPicker(input: HTMLInputElement, trigger: HTMLButtonElement) {
  if (activePicker?.input === input) {
    closePicker();
    return;
  }
  closePicker();
  const selected = parseDateKey(input.value) || new Date();
  const popover = document.createElement('div');
  popover.className = 'glass-date-popover glass-dropdown';
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-modal', 'false');
  popover.setAttribute('aria-label', trigger.getAttribute('aria-label') || 'Choose date');
  document.body.appendChild(popover);
  activePicker = { input, trigger, popover, viewDate: new Date(selected.getFullYear(), selected.getMonth(), 1) };
  trigger.setAttribute('aria-expanded', 'true');
  renderCalendar(activePicker);
  positionPopover(activePicker);
}

function enhanceDateInput(input: HTMLInputElement) {
  if (input.dataset.glassDateEnhanced === 'true') return;
  input.dataset.glassDateEnhanced = 'true';
  const copy = calendarText();
  const placeholder = input.id.toLowerCase().includes('start') ? copy.start : input.id.toLowerCase().includes('end') ? copy.end : copy.select;
  const wrapper = document.createElement('span');
  wrapper.className = 'glass-date-picker';
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'glass-date-trigger glass-control';
  trigger.dataset.placeholder = placeholder;
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-label', placeholder);
  trigger.classList.toggle('has-value', Boolean(input.value));
  trigger.innerHTML = `
    <span class="glass-date-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="5" width="18" height="16" rx="4"/><path d="M8 3v4M16 3v4M3 10h18"/></svg></span>
    <span class="glass-date-value">${dateLabel(input.value, placeholder)}</span>
    <span class="glass-date-chevron" aria-hidden="true">⌄</span>
  `;
  input.before(wrapper);
  wrapper.append(trigger, input);
  input.classList.add('glass-date-native');
  input.tabIndex = -1;
  input.setAttribute('aria-hidden', 'true');
  trigger.addEventListener('click', () => openPicker(input, trigger));
  input.addEventListener('change', () => {
    trigger.querySelector<HTMLElement>('.glass-date-value')!.textContent = dateLabel(input.value, placeholder);
    trigger.classList.toggle('has-value', Boolean(input.value));
  });
}

function enhanceAll(root: ParentNode = document) {
  root.querySelectorAll<HTMLInputElement>('input[type="date"]').forEach(enhanceDateInput);
}

export function initCustomDatePickers() {
  if (initialized) return;
  initialized = true;
  enhanceAll();
  const observer = new MutationObserver(records => {
    for (const record of records) {
      record.addedNodes.forEach(node => {
        if (!(node instanceof Element)) return;
        if (node.matches('input[type="date"]')) enhanceDateInput(node as HTMLInputElement);
        enhanceAll(node);
      });
    }
    if (activePicker && !activePicker.input.isConnected) closePicker();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('pointerdown', event => {
    if (!activePicker) return;
    const target = event.target as Node;
    if (!activePicker.popover.contains(target) && !activePicker.trigger.contains(target)) closePicker();
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closePicker();
  });
  window.addEventListener('resize', () => activePicker && positionPopover(activePicker));
  window.addEventListener('scroll', () => activePicker && positionPopover(activePicker), true);
}
