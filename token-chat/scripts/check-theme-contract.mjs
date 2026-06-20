import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const themes = ['midnight', 'ocean', 'forest', 'sunset', 'rose', 'light'];
const required = ['--app-bg', '--sidebar-bg', '--surface', '--surface-raised', '--chart-bg', '--chart-grid', '--chart-axis', '--chart-text', '--chart-border', '--chart-muted', '--chart-control-bg', '--chart-control-active', '--chart-control-hover', '--line'];
const failures = [];

for (const theme of themes) {
  const block = new RegExp(`\\[data-theme="${theme}"\\]\\s*\\{([^}]*)\\}`).exec(css)?.[1];
  if (!block) {
    failures.push(`${theme}: theme block is missing`);
    continue;
  }
  for (const variable of required) {
    if (!block.includes(`${variable}:`)) failures.push(`${theme}: ${variable} is missing`);
  }
  if (theme !== 'midnight' && /--sidebar-bg:\s*#(?:fff|ffffff)\s*;/i.test(block)) {
    failures.push(`${theme}: sidebar background is still pure white`);
  }
}

const rules = [
  ['.token-trend-panel', 'background: var(--chart-bg)'],
  ['.token-trend-tabs', 'background: var(--chart-control-bg)'],
  ['.token-trend-tabs button.active', 'background: var(--chart-control-active)'],
  ['.token-trend-model-select', 'background: var(--chart-control-bg)'],
  ['.token-trend-legend-btn:hover', 'background: var(--chart-control-hover)'],
  ['.token-trend-line-swatch i', 'background: var(--chart-bg)'],
];

for (const [selector, declaration] of rules) {
  const escaped = selector.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
  const block = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1];
  if (!block?.includes(declaration)) failures.push(`${selector}: expected ${declaration}`);
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`Theme contract passed for ${themes.length} themes.`);
