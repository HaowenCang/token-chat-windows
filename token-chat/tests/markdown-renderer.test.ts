import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../src/rendering/markdown-renderer';

describe('renderMarkdown', () => {
  it('renders common markdown through the stable chat interface', () => {
    const html = renderMarkdown([
      '# Title',
      '',
      '- one',
      '- **two**',
      '',
      '| A | B |',
      '| - | - |',
      '| 1 | `x` |',
      '',
      '```ts',
      'const value = 1;',
      '```',
      '',
      '[OpenAI](https://openai.com)',
    ].join('\n'));

    expect(html).toContain('class="markdown-body"');
    expect(html).toContain('class="md-heading md-h1"');
    expect(html).toContain('<ul class="md-list">');
    expect(html).toContain('<strong>two</strong>');
    expect(html).toContain('<table>');
    expect(html).toContain('class="md-inline-code"');
    expect(html).toContain('class="msg-code-block"');
    expect(html).toContain('class="msg-code-copy"');
    expect(html).not.toContain('onclick=');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('renders inline and block math through MathJax SVG output', () => {
    const html = renderMarkdown([
      'Inline $a^2 + b^2 = c^2$ and \\(x + y\\).',
      '',
      '$$',
      '\\frac{1}{x}',
      '$$',
      '',
      '\\[',
      'E = mc^2',
      '\\]',
    ].join('\n'));

    expect(html).toContain('class="math-inline"');
    expect(html).toContain('<mjx-container');
    expect(html).toContain('<svg');
    expect(html).toContain('class="math-block"');
    expect(html).toContain('data-mml-node="mfrac"');
    expect(html).toContain('data-mml-node="msup"');
  });

  it('does not allow raw html, event attributes, scripts, or dangerous links to become executable html', () => {
    const html = renderMarkdown([
      '<img src=x onerror="alert(1)">',
      '<script>alert(1)</script>',
      '[bad](javascript:alert(1))',
    ].join('\n'));

    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('&lt;img');
    expect(html).toContain('&lt;script&gt;');
  });

  it('is stable for streaming-style partial updates', () => {
    expect(() => renderMarkdown('Preparing ```ts\nconst x = 1;')).not.toThrow();
    expect(() => renderMarkdown('A partial inline math $a +')).not.toThrow();
    expect(renderMarkdown('A partial inline math $a +')).toContain('A partial inline math');
  });
});
