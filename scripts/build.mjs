import { readFile, writeFile } from 'node:fs/promises';
import { renderHelp } from './help.mjs';
const root = new URL('../', import.meta.url);
const template = await readFile(new URL('src/template.html', root), 'utf8');
const app = await readFile(new URL('src/app.js', root), 'utf8');
const usage = await readFile(new URL('USAGE.md', root), 'utf8');
if (template.split('/*APP*/').length !== 2) {
  throw new Error('アプリの挿入位置は1つ必要です');
}
if (template.split('<!--USAGE-->').length !== 2) {
  throw new Error('使い方の挿入位置は1つ必要です');
}
const html = template
  .replace('<!--USAGE-->', () => renderHelp(usage).replace(/\n/g, '\n      '))
  .replace('/*APP*/', () => app);
await writeFile(new URL('index.html', root), html);
console.log('Built index.html');
