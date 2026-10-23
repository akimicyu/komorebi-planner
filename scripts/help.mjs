function escapeHtml(text) {
  return text.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character],
  );
}

function renderInline(text) {
  return text
    .split(/(`[^`]+`)/)
    .map((part) => {
      if (part.startsWith('`') && part.endsWith('`')) {
        return `<code>${escapeHtml(part.slice(1, -1))}</code>`;
      }
      return escapeHtml(part);
    })
    .join('');
}

// 利用説明で使う見出し・段落・平坦なリスト・インラインコードを変換する。
// HTMLは常にエスケープし、ブラウザでMarkdownを処理するコードは配布しない。
export function renderHelp(markdown) {
  const lines = markdown.replace(/\r\n?/g, '\n').trim().split('\n');
  if (!/^# .+/.test(lines[0])) {
    throw new Error('USAGE.mdの先頭には文書タイトルが必要です');
  }
  const html = [];
  let paragraph = [];
  let listType = null;
  let listItems = [];
  let listStart = 1;

  function flushParagraph() {
    if (paragraph.length) {
      html.push(`<p>\n  ${renderInline(paragraph.join(' '))}\n</p>`);
      paragraph = [];
    }
  }

  function flushList() {
    if (listType) {
      const startAttribute = listType === 'ol' && listStart !== 1 ? ` start="${listStart}"` : '';
      html.push(`<${listType}${startAttribute}>`);
      for (const item of listItems) {
        html.push(`  <li>${renderInline(item)}</li>`);
      }
      html.push(`</${listType}>`);
      listType = null;
      listItems = [];
    }
  }

  for (const line of lines.slice(1)) {
    const heading = /^(#{2,3}) (.+)$/.exec(line);
    const item = /^(?:- |(\d+)\. )(.+)$/.exec(line);
    if (!line.trim()) {
      flushParagraph();
      flushList();
    } else if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length + 1;
      html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
    } else if (item) {
      flushParagraph();
      const type = item[1] ? 'ol' : 'ul';
      if (listType !== type) {
        flushList();
        listType = type;
        listStart = item[1] ? Number(item[1]) : 1;
      }
      listItems.push(item[2]);
    } else {
      if (/^(?:\s{2,}\S|#{1,6} |```|~~~|> |\|)/.test(line)) {
        throw new Error(`USAGE.mdに未対応のMarkdown構文があります：${line}`);
      }
      if (listType) {
        listItems[listItems.length - 1] += ' ' + line;
      } else {
        paragraph.push(line);
      }
    }
  }
  flushParagraph();
  flushList();
  return html.join('\n');
}
