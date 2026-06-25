/** @jsxImportSource preact */
import { render } from 'preact';
import { signal } from '@preact/signals';
import { state } from '../state';
import { renderRightPanelContent } from '../chat-token';

// ── Signal for triggering re-render ──

export const rightPanelVersion = signal(0);

export function syncRightPanel(): void {
  rightPanelVersion.value++;
}

// ── Component (uses dangerouslySetInnerHTML for gradual migration) ──

function RightPanelInner() {
  // Subscribe to signal to trigger re-renders
  void rightPanelVersion.value;
  const html = renderRightPanelContent();
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

// ── Mount function ──

export function mountRightPanel(container: HTMLElement): void {
  render(<RightPanelInner />, container);
}

export function updateRightPanel(): void {
  syncRightPanel();
  const panelBody = document.querySelector('.chat-right .panel-body');
  if (panelBody) {
    render(<RightPanelInner />, panelBody);
  }
}
