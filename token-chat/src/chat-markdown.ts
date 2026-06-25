function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function placeholderToken(index: number): string {
  return `${index}`;
}

function restorePlaceholders(html: string, placeholders: string[]): string {
  return html.replace(/(\d+)/g, (_, idx) => placeholders[Number(idx)] ?? '');
}

export function renderLatex(math: string, block: boolean): string {
  let html = escHtml(math.trim());
  html = html.replace(/\\mathbf\{([^{}]+)\}/g, '<span class="math-vector">$1</span>');
  html = html.replace(/\\mathrm\{([^{}]+)\}/g, '<span class="math-roman">$1</span>');

  for (let i = 0; i < 4; i += 1) {
    html = html.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '<span class="math-frac"><span>$1</span><span>$2</span></span>');
  }

  const commands: Record<string, string> = {
    '\\varepsilon': 'ε',
    '\\epsilon': 'ε',
    '\\partial': '∂',
    '\\nabla': '∇',
    '\\cdot': '·',
    '\\times': '×',
    '\\rho': 'ρ',
    '\\mu': 'μ',
    '\\pi': 'π',
    '\\alpha': 'α',
    '\\beta': 'β',
    '\\gamma': 'γ',
    '\\Delta': 'Δ',
    '\\delta': 'δ',
    '\\leq': '≤',
    '\\geq': '≥',
    '\\neq': '≠',
    '\\infty': '∞',
    '\\left': '',
    '\\right': '',
  };
  for (const [cmd, value] of Object.entries(commands).sort((a, b) => b[0].length - a[0].length)) {
    html = html.split(cmd).join(value);
  }
  html = html.replace(/\\([a-zA-Z]+)/g, '$1');
  html = html.replace(/_\{([^{}]+)\}/g, '<sub>$1</sub>');
  html = html.replace(/_([A-Za-z0-9]+)/g, '<sub>$1</sub>');
  html = html.replace(/\^\{([^{}]+)\}/g, '<sup>$1</sup>');
  html = html.replace(/\^([A-Za-z0-9+\-=]+)/g, '<sup>$1</sup>');

  const cls = block ? 'math-block' : 'math-inline';
  const tag = block ? 'div' : 'span';
  return `<${tag} class="${cls}" title="${escHtml(math.trim())}">${html}</${tag}>`;
}

function renderInlineMarkdown(text: string): string {
  const placeholders: string[] = [];
  let working = text.replace(/`([^`]+)`/g, (_, code) => {
    const token = placeholderToken(placeholders.length);
    placeholders.push(`<code class="md-inline-code">${escHtml(code)}</code>`);
    return token;
  });
  working = working.replace(/\$([^$\n]+)\$/g, (_, math) => {
    const token = placeholderToken(placeholders.length);
    placeholders.push(renderLatex(math, false));
    return token;
  });

  let html = escHtml(working);
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  return restorePlaceholders(html, placeholders);
}

export function renderMarkdown(text: string): string {
  const blockPlaceholders: string[] = [];
  let source = text.replace(/\r\n/g, '\n');
  source = source.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const label = lang ? `<span class="msg-code-lang">${escHtml(lang)}</span>` : '';
    const token = placeholderToken(blockPlaceholders.length);
    blockPlaceholders.push(`<div class="msg-code-block"><div class="msg-code-toolbar">${label}<button class="msg-code-copy" onclick="navigator.clipboard.writeText(this.closest('.msg-code-block').querySelector('code').textContent)">Copy</button></div><pre><code>${escHtml(code)}</code></pre></div>`);
    return `\n${token}\n`;
  });
  source = source.replace(/\$\$([\s\S]*?)\$\$/g, (_, math) => {
    const token = placeholderToken(blockPlaceholders.length);
    blockPlaceholders.push(renderLatex(math, true));
    return `\n${token}\n`;
  });

  const parts: string[] = [];
  let paragraph: string[] = [];
  let listType: 'ul' | 'ol' | null = null;

  const closeList = () => {
    if (listType) {
      parts.push(`</${listType}>`);
      listType = null;
    }
  };
  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    closeList();
    parts.push(`<p>${paragraph.map(renderInlineMarkdown).join('<br>')}</p>`);
    paragraph = [];
  };
  const openList = (type: 'ul' | 'ol', start = 1) => {
    flushParagraph();
    if (listType === type) return;
    closeList();
    listType = type;
    parts.push(type === 'ol'
      ? `<ol class="md-list" start="${start}">`
      : '<ul class="md-list">');
  };

  for (const line of source.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      closeList();
      continue;
    }
    if (/^\d+$/.test(trimmed)) {
      flushParagraph();
      closeList();
      parts.push(trimmed);
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      closeList();
      const level = Math.min(6, heading[1].length);
      parts.push(`<h${level} class="md-heading md-h${level}">${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    const unordered = /^[-*+]\s+(.+)$/.exec(trimmed);
    if (unordered) {
      openList('ul');
      parts.push(`<li>${renderInlineMarkdown(unordered[1])}</li>`);
      continue;
    }

    const ordered = /^(\d+)\.\s+(.+)$/.exec(trimmed);
    if (ordered) {
      const ordinal = Math.max(1, Number.parseInt(ordered[1], 10) || 1);
      openList('ol', ordinal);
      parts.push(`<li value="${ordinal}">${renderInlineMarkdown(ordered[2])}</li>`);
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  closeList();
  return `<div class="markdown-body">${restorePlaceholders(parts.join(''), blockPlaceholders)}</div>`;
}
