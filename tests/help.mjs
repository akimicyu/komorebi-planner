import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderHelp } from '../scripts/help.mjs';

const rendered = renderHelp(`# 使い方

## 基本操作

1. タスクを追加
2. JSON保存

担当者を設定。
履歴も保存。

### 計算

- 終了→開始
- 土日を除く

ファイルは \`index.html\`。
`);
assert(!rendered.includes('<h1>'));
assert(rendered.includes('<h3>基本操作</h3>'));
assert(rendered.includes('<h4>計算</h4>'));
assert.match(rendered, /<ol>\s*<li>タスクを追加<\/li>\s*<li>JSON保存<\/li>\s*<\/ol>/);
assert.match(rendered, /<ul>\s*<li>終了→開始<\/li>\s*<li>土日を除く<\/li>\s*<\/ul>/);
assert(rendered.includes('担当者を設定。 履歴も保存。'));
assert(rendered.includes('<code>index.html</code>'));
assert(renderHelp('# Title\r\n\r\n3. Third\r\ncontinued').includes('<ol start="3">'));
assert(renderHelp('# Title\n\n- First\ncontinued').includes('<li>First continued</li>'));
const escaped = renderHelp('# Title\n\n<script>alert("x")</script> & \`<img>\`');
assert(!escaped.includes('<script>'));
assert(escaped.includes('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp;'));
assert(escaped.includes('<code>&lt;img&gt;</code>'));
assert.throws(() => renderHelp('## No title'), /タイトル/);
assert.throws(() => renderHelp('# Title\n\n```js\ncode\n```'), /未対応/);
assert.throws(() => renderHelp('# Title\n\n- item\n  - nested'), /未対応/);

const usage = await readFile(new URL('../USAGE.md', import.meta.url), 'utf8');
const help = renderHelp(usage);
assert(help.includes('↑ 上へ'));
assert(help.includes('基準日当日以降で最も近いマイルストーン'));
assert(help.includes('基準日より左は遅れ'));
console.log(
  'PASS: help Markdown headings, lists, paragraphs, inline code, escaping, unsupported syntax, current usage',
);
