/** @jsxImportSource preact */
import { render } from 'preact';
import { signal } from '@preact/signals';

const count = signal(0);

function TestWidget() {
  return (
    <div style={{ padding: '8px', color: 'var(--text-muted)', fontSize: '12px' }}>
      Preact OK · Count: {count.value}
      <button
        style={{ marginLeft: '8px', padding: '2px 8px', border: '1px solid var(--line)', borderRadius: '4px', background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer' }}
        onClick={() => count.value++}
      >
        +1
      </button>
    </div>
  );
}

export function mountTestWidget(container: HTMLElement) {
  render(<TestWidget />, container);
}
