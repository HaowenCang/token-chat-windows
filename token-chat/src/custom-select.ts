import { liquidGlassClasses, placeLiquidGlassLayer, portalLiquidGlassElement } from './liquid-glass';

let initialized = false;
let selectSequence = 0;

interface OpenSelectState {
  select: HTMLSelectElement;
  trigger: HTMLButtonElement;
  menu: HTMLDivElement;
}

let openState: OpenSelectState | null = null;

function closeOpenSelect(restoreFocus = false): void {
  if (!openState) return;
  const { trigger, menu } = openState;
  openState = null;
  trigger.setAttribute('aria-expanded', 'false');
  trigger.classList.remove('open');
  menu.classList.remove('open');
  menu.remove();
  if (restoreFocus && trigger.isConnected) trigger.focus();
}

function selectedLabel(select: HTMLSelectElement): string {
  return select.selectedOptions[0]?.textContent?.trim() || select.options[0]?.textContent?.trim() || '';
}

function syncTrigger(select: HTMLSelectElement, trigger: HTMLButtonElement): void {
  const label = trigger.querySelector<HTMLElement>('.custom-select-value');
  if (label) label.textContent = selectedLabel(select);
  trigger.disabled = select.disabled;
  trigger.setAttribute('aria-disabled', String(select.disabled));
}

function positionMenu(trigger: HTMLButtonElement, menu: HTMLDivElement): void {
  const triggerRect = trigger.getBoundingClientRect();
  menu.style.width = `${Math.min(Math.max(triggerRect.width, 176), window.innerWidth - 20)}px`;
  placeLiquidGlassLayer(menu, { anchor: trigger, offset: 8, margin: 10, minWidth: 176 });
}

function selectableOptions(menu: HTMLDivElement): HTMLButtonElement[] {
  return Array.from(menu.querySelectorAll<HTMLButtonElement>('.custom-select-option:not(:disabled)'));
}

function moveOptionFocus(menu: HTMLDivElement, direction: 1 | -1): void {
  const options = selectableOptions(menu);
  if (options.length === 0) return;
  const index = options.indexOf(document.activeElement as HTMLButtonElement);
  options[(index + direction + options.length) % options.length]?.focus();
}

function createOptionButton(
  select: HTMLSelectElement,
  option: HTMLOptionElement,
  trigger: HTMLButtonElement,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'custom-select-option';
  button.textContent = option.textContent?.trim() || option.value;
  button.disabled = option.disabled;
  button.dataset.value = option.value;
  button.setAttribute('role', 'option');
  button.setAttribute('aria-selected', String(option.selected));
  if (option.selected) button.classList.add('selected');
  button.addEventListener('click', () => {
    if (option.disabled) return;
    select.value = option.value;
    syncTrigger(select, trigger);
    closeOpenSelect(true);
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  return button;
}

function createMenu(select: HTMLSelectElement, trigger: HTMLButtonElement): HTMLDivElement {
  const menu = document.createElement('div');
  menu.className = liquidGlassClasses('dropdown', 'custom-select-menu glass-dropdown');
  menu.id = trigger.getAttribute('aria-controls') || `custom-select-menu-${++selectSequence}`;
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-label', select.getAttribute('aria-label') || selectedLabel(select));

  Array.from(select.children).forEach(child => {
    if (child instanceof HTMLOptGroupElement) {
      const group = document.createElement('div');
      group.className = 'custom-select-group';
      const label = document.createElement('div');
      label.className = 'custom-select-group-label';
      label.textContent = child.label;
      group.appendChild(label);
      Array.from(child.children).forEach(option => {
        if (option instanceof HTMLOptionElement) group.appendChild(createOptionButton(select, option, trigger));
      });
      menu.appendChild(group);
      return;
    }
    if (child instanceof HTMLOptionElement) menu.appendChild(createOptionButton(select, child, trigger));
  });

  menu.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      moveOptionFocus(menu, event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const options = selectableOptions(menu);
      options[event.key === 'Home' ? 0 : options.length - 1]?.focus();
    } else if (event.key === 'Escape' || event.key === 'Tab') {
      closeOpenSelect(event.key === 'Escape');
    }
  });
  return menu;
}

function openSelect(select: HTMLSelectElement, trigger: HTMLButtonElement, focusSelected = false): void {
  if (select.disabled) return;
  if (openState?.select === select) {
    closeOpenSelect();
    return;
  }
  closeOpenSelect();
  const menu = createMenu(select, trigger);
  portalLiquidGlassElement(menu, 'select');
  openState = { select, trigger, menu };
  trigger.setAttribute('aria-expanded', 'true');
  trigger.classList.add('open');
  positionMenu(trigger, menu);
  if (focusSelected) {
    (menu.querySelector<HTMLButtonElement>('.custom-select-option.selected') || selectableOptions(menu)[0])?.focus();
  }
  requestAnimationFrame(() => {
    if (openState?.menu !== menu) return;
    menu.classList.add('open');
  });
}

function enhanceSelect(select: HTMLSelectElement): void {
  if (select.dataset.customSelectEnhanced || select.multiple || select.size > 1 || select.dataset.nativeSelect !== undefined) return;
  select.dataset.customSelectEnhanced = 'true';

  const wrapper = document.createElement('span');
  wrapper.className = 'custom-select';
  if (select.classList.contains('topnav-select')) wrapper.classList.add('custom-select--topnav');
  if (select.classList.contains('model-select')) wrapper.classList.add('custom-select--model');
  if (select.classList.contains('chat-search')) wrapper.classList.add('custom-select--field');
  const declaredWidth = select.style.width;
  if (declaredWidth) wrapper.style.width = declaredWidth;

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'custom-select-trigger';
  trigger.innerHTML = `
    <span class="custom-select-value"></span>
    <svg class="custom-select-chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="m6 8 4 4 4-4"/></svg>
  `;
  const menuId = `custom-select-menu-${++selectSequence}`;
  trigger.setAttribute('role', 'combobox');
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', menuId);
  trigger.setAttribute('aria-label', select.getAttribute('aria-label') || selectedLabel(select));

  select.before(wrapper);
  wrapper.append(trigger, select);
  select.classList.add('custom-select-native');
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');
  syncTrigger(select, trigger);

  trigger.addEventListener('click', () => openSelect(select, trigger));
  trigger.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openSelect(select, trigger, true);
    } else if (event.key === 'Escape') {
      closeOpenSelect();
    }
  });
  select.addEventListener('change', () => syncTrigger(select, trigger));
}

function enhanceWithin(root: ParentNode): void {
  if (root instanceof HTMLSelectElement) enhanceSelect(root);
  root.querySelectorAll<HTMLSelectElement>('select').forEach(enhanceSelect);
}

export function initCustomSelects(): void {
  if (initialized) return;
  initialized = true;
  enhanceWithin(document);

  const observer = new MutationObserver(records => {
    if (openState && !openState.trigger.isConnected) closeOpenSelect();
    records.forEach(record => record.addedNodes.forEach(node => {
      if (node instanceof Element) enhanceWithin(node);
    }));
  });
  observer.observe(document.body, { childList: true, subtree: true });

  document.addEventListener('pointerdown', event => {
    if (!openState) return;
    const target = event.target as Node;
    if (!openState.menu.contains(target) && !openState.trigger.contains(target)) closeOpenSelect();
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && openState) closeOpenSelect(true);
  });
  window.addEventListener('resize', () => closeOpenSelect());
  window.addEventListener('scroll', event => {
    if (!openState) return;
    const target = event.target;
    if (target instanceof Node && openState.menu.contains(target)) return;
    closeOpenSelect();
  }, true);
}
