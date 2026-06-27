export type LiquidGlassLayer = 'dropdown' | 'popover' | 'tooltip' | 'modal' | 'dialog' | 'notice' | 'date-picker';

export interface FloatingPlacementOptions {
  anchor?: Element;
  point?: { x: number; y: number };
  offset?: number;
  margin?: number;
  matchAnchorWidth?: boolean;
  minWidth?: number;
  maxWidth?: number;
}

const PORTAL_ROOT_ID = 'liquidGlassPortalRoot';

export function liquidGlassClasses(layer: LiquidGlassLayer, extra = ''): string {
  return `liquid-glass liquid-glass--${layer}${extra ? ` ${extra}` : ''}`;
}

export function liquidGlassLayers(content: string): string {
  return `
    <span class="liquid-glass__refract-layer" aria-hidden="true"></span>
    <span class="liquid-glass__rim" aria-hidden="true"></span>
    <div class="liquid-glass__content">${content}</div>
  `;
}

function getLiquidGlassPortalRoot(): HTMLElement {
  let root = document.getElementById(PORTAL_ROOT_ID);
  if (!root) {
    root = document.createElement('div');
    root.id = PORTAL_ROOT_ID;
    root.className = 'liquid-glass-portal-root';
    document.body.appendChild(root);
  }
  return root;
}

export function portalLiquidGlassElement<T extends HTMLElement>(element: T, owner?: string): T {
  if (owner) element.dataset.glassPortalOwner = owner;
  getLiquidGlassPortalRoot().appendChild(element);
  return element;
}

export function mountDeclaredGlassPortals(root: ParentNode, fallbackOwner = 'app'): void {
  const elements = Array.from(root.querySelectorAll<HTMLElement>('[data-glass-portal]'));
  elements.forEach(element => {
    element.dataset.glassPortalStatic = 'true';
    portalLiquidGlassElement(element, element.dataset.glassPortalOwner || fallbackOwner);
  });
}

export function clearDeclaredGlassPortals(owner?: string): void {
  const portalRoot = document.getElementById(PORTAL_ROOT_ID);
  if (!portalRoot) return;
  const selector = owner
    ? `[data-glass-portal-static="true"][data-glass-portal-owner="${CSS.escape(owner)}"]`
    : '[data-glass-portal-static="true"]';
  portalRoot.querySelectorAll(selector).forEach(element => element.remove());
}

export function placeLiquidGlassLayer(element: HTMLElement, options: FloatingPlacementOptions): void {
  const margin = options.margin ?? 12;
  const offset = options.offset ?? 8;
  const anchorRect = options.anchor?.getBoundingClientRect();

  if (anchorRect && options.matchAnchorWidth) element.style.width = `${anchorRect.width}px`;
  if (options.minWidth) element.style.minWidth = `${options.minWidth}px`;
  if (options.maxWidth) element.style.maxWidth = `${Math.min(options.maxWidth, window.innerWidth - margin * 2)}px`;

  const rect = element.getBoundingClientRect();
  let left: number;
  let top: number;

  if (options.point) {
    left = options.point.x + offset;
    top = options.point.y + offset;
  } else if (anchorRect) {
    left = anchorRect.left;
    const below = window.innerHeight - anchorRect.bottom - margin;
    const above = anchorRect.top - margin;
    const opensAbove = below < rect.height && above > below;
    element.dataset.placement = opensAbove ? 'top' : 'bottom';
    top = opensAbove ? anchorRect.top - rect.height - offset : anchorRect.bottom + offset;
  } else {
    left = margin;
    top = margin;
  }

  left = Math.min(Math.max(margin, left), Math.max(margin, window.innerWidth - rect.width - margin));
  top = Math.min(Math.max(margin, top), Math.max(margin, window.innerHeight - rect.height - margin));
  element.style.setProperty('left', `${left}px`, 'important');
  element.style.setProperty('top', `${top}px`, 'important');
}
