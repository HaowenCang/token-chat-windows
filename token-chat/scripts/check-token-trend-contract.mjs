import { readFileSync } from 'node:fs';

const stats = readFileSync(new URL('../src/stats.ts', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const failures = [];

if (/series-(?:entering|leaving)/.test(stats) || /series-(?:entering|leaving)/.test(css)) {
  failures.push('trend animation: persistent animation classes must not be used');
}

for (const marker of [
  'node.animate(keyframes',
  'animation.finished.catch',
  'if (animationId !== trendAnimationSequence) return',
  'setTrendLegendDisabled(true)',
  'setTrendLegendDisabled(false)',
]) {
  if (!stats.includes(marker)) failures.push(`trend animation: missing ${marker}`);
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('Token trend animation contract passed.');
