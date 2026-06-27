import MarkdownIt from 'markdown-it';
import { mathjax } from '@mathjax/src/js/mathjax.js';
import { liteAdaptor } from '@mathjax/src/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from '@mathjax/src/js/handlers/html.js';
import { TeX } from '@mathjax/src/js/input/tex.js';
import { SVG } from '@mathjax/src/js/output/svg.js';
import '@mathjax/src/js/input/tex/ams/AmsConfiguration.js';
import '@mathjax/src/js/input/tex/newcommand/NewcommandConfiguration.js';
import '@mathjax/src/js/input/tex/noundefined/NoUndefinedConfiguration.js';
import type StateBlock from 'markdown-it/lib/rules_block/state_block.mjs';
import type StateInline from 'markdown-it/lib/rules_inline/state_inline.mjs';
import type Token from 'markdown-it/lib/token.mjs';

const markdown = MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  typographer: false,
});

let codeCopyInstalled = false;
const mathAdaptor = liteAdaptor();
RegisterHTMLHandler(mathAdaptor);
const texInput = new TeX({ packages: ['base', 'ams', 'newcommand', 'noundefined'] });
const svgOutput = new SVG({ fontCache: 'none' });
const mathDocument = mathjax.document('', { InputJax: texInput, OutputJax: svgOutput });

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function isSafeMarkdownUrl(url: string): boolean {
  const normalized = url.trim().replace(/[\u0000-\u001F\u007F\s]+/g, '').toLowerCase();
  return normalized.startsWith('http://') || normalized.startsWith('https://') || normalized.startsWith('mailto:');
}

function addClass(token: Token, className: string): void {
  const current = token.attrGet('class');
  token.attrSet('class', current ? `${current} ${className}` : className);
}

function renderMathSvg(math: string, display: boolean): string {
  const source = math.trim();
  if (!source) return '';
  try {
    const node = mathDocument.convert(source, { display });
    return mathAdaptor.outerHTML(node);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `<span class="math-error" title="${escapeHtml(message)}">${escapeHtml(source)}</span>`;
  }
}

function findClosingDollar(src: string, start: number, max: number): number {
  for (let pos = start; pos < max; pos += 1) {
    if (src.charCodeAt(pos) !== 0x24) continue;
    if (src.charCodeAt(pos - 1) === 0x5C) continue;
    if (src.charCodeAt(pos - 1) === 0x20) continue;
    return pos;
  }
  return -1;
}

function mathInlineRule(state: StateInline, silent: boolean): boolean {
  const start = state.pos;
  const src = state.src;

  if (src.startsWith('\\(', start)) {
    const end = src.indexOf('\\)', start + 2);
    if (end < 0) return false;
    if (!silent) {
      const token = state.push('math_inline', 'math', 0);
      token.markup = '\\(';
      token.content = src.slice(start + 2, end);
    }
    state.pos = end + 2;
    return true;
  }

  if (src.charCodeAt(start) !== 0x24 || src.charCodeAt(start + 1) === 0x24) {
    return false;
  }
  if (src.charCodeAt(start + 1) === 0x20) return false;

  const end = findClosingDollar(src, start + 1, state.posMax);
  if (end < 0) return false;
  const content = src.slice(start + 1, end);
  if (!content || content.includes('\n')) return false;

  if (!silent) {
    const token = state.push('math_inline', 'math', 0);
    token.markup = '$';
    token.content = content;
  }
  state.pos = end + 1;
  return true;
}

function readBlockMathContent(state: StateBlock, startLine: number, endLine: number): { marker: '$$' | '\\['; content: string; nextLine: number } | null {
  const start = state.bMarks[startLine] + state.tShift[startLine];
  const max = state.eMarks[startLine];
  const line = state.src.slice(start, max).trim();
  const marker = line.startsWith('$$') ? '$$' : line.startsWith('\\[') ? '\\[' : null;
  if (!marker) return null;

  const close = marker === '$$' ? '$$' : '\\]';
  const firstContent = line.slice(marker.length);
  const sameLineClose = firstContent.indexOf(close);
  if (sameLineClose >= 0) {
    return {
      marker,
      content: firstContent.slice(0, sameLineClose).trim(),
      nextLine: startLine + 1,
    };
  }

  const lines = [firstContent.trimStart()];
  for (let nextLine = startLine + 1; nextLine < endLine; nextLine += 1) {
    const lineStart = state.bMarks[nextLine] + state.tShift[nextLine];
    const lineMax = state.eMarks[nextLine];
    const next = state.src.slice(lineStart, lineMax);
    const closeAt = next.indexOf(close);
    if (closeAt >= 0) {
      lines.push(next.slice(0, closeAt).trimEnd());
      return { marker, content: lines.join('\n').trim(), nextLine: nextLine + 1 };
    }
    lines.push(next);
  }

  return null;
}

function mathBlockRule(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  if (state.sCount[startLine] - state.blkIndent >= 4) return false;

  const math = readBlockMathContent(state, startLine, endLine);
  if (!math) return false;
  if (silent) return true;

  const token = state.push('math_block', 'math', 0);
  token.block = true;
  token.markup = math.marker;
  token.content = math.content;
  token.map = [startLine, math.nextLine];
  state.line = math.nextLine;
  return true;
}

markdown.validateLink = isSafeMarkdownUrl;
markdown.inline.ruler.before('escape', 'math_inline', mathInlineRule);
markdown.block.ruler.before('fence', 'math_block', mathBlockRule, {
  alt: ['paragraph', 'reference', 'blockquote', 'list'],
});

markdown.renderer.rules.heading_open = (tokens, idx, options, _env, self) => {
  const level = tokens[idx].tag.replace('h', '');
  addClass(tokens[idx], `md-heading md-h${level}`);
  return self.renderToken(tokens, idx, options);
};

markdown.renderer.rules.bullet_list_open = (tokens, idx, options, _env, self) => {
  addClass(tokens[idx], 'md-list');
  return self.renderToken(tokens, idx, options);
};

markdown.renderer.rules.ordered_list_open = (tokens, idx, options, _env, self) => {
  addClass(tokens[idx], 'md-list');
  return self.renderToken(tokens, idx, options);
};

markdown.renderer.rules.code_inline = (tokens, idx) => {
  return `<code class="md-inline-code">${escapeHtml(tokens[idx].content)}</code>`;
};

markdown.renderer.rules.fence = (tokens, idx) => {
  const token = tokens[idx];
  const lang = token.info.trim().split(/\s+/)[0] ?? '';
  const langHtml = lang ? `<span class="msg-code-lang">${escapeHtml(lang)}</span>` : '';
  return [
    '<div class="msg-code-block">',
    `<div class="msg-code-toolbar">${langHtml}<button class="msg-code-copy" type="button">Copy</button></div>`,
    `<pre><code>${escapeHtml(token.content)}</code></pre>`,
    '</div>',
  ].join('');
};

markdown.renderer.rules.link_open = (tokens, idx, options, _env, self) => {
  const href = tokens[idx].attrGet('href');
  if (href && isSafeMarkdownUrl(href)) {
    tokens[idx].attrSet('target', '_blank');
    tokens[idx].attrSet('rel', 'noopener noreferrer');
  }
  return self.renderToken(tokens, idx, options);
};

markdown.renderer.rules.math_inline = (tokens, idx) => {
  const token = tokens[idx];
  return `<span class="math-inline">${renderMathSvg(token.content, false)}</span>`;
};

markdown.renderer.rules.math_block = (tokens, idx) => {
  return `<div class="math-block">${renderMathSvg(tokens[idx].content, true)}</div>\n`;
};

function installCodeCopyHandler(): void {
  if (!isBrowser() || codeCopyInstalled) return;
  codeCopyInstalled = true;
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLButtonElement>('.msg-code-copy');
    if (!button) return;
    const block = button.closest('.msg-code-block');
    const code = block?.querySelector('code')?.textContent ?? '';
    if (!code) return;

    navigator.clipboard?.writeText(code).then(() => {
      const previous = button.textContent;
      button.textContent = 'Copied';
      window.setTimeout(() => {
        button.textContent = previous;
      }, 1200);
    }).catch(() => undefined);
  });
}

function installBrowserIntegrations(): void {
  if (!isBrowser()) return;
  installCodeCopyHandler();
}

export function renderMarkdown(content: string): string {
  const html = markdown.render(content.replace(/\r\n/g, '\n'));
  return `<div class="markdown-body">${html}</div>`;
}

installBrowserIntegrations();
