/** @jsxImportSource preact */
import { render } from 'preact';
import { renderRightPanelContent } from '../chat-token';

// ── Component (uses dangerouslySetInnerHTML for gradual migration) ──

function RightPanelInner() {
  const html = renderRightPanelContent();
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

// ── Mount function ──

export function mountRightPanel(container: HTMLElement): void {
  render(<RightPanelInner />, container);
}
