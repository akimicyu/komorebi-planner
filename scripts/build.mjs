import { readFile, writeFile } from 'node:fs/promises';
import { renderHelp } from './help.mjs';
const root = new URL('../', import.meta.url);
const template = await readFile(new URL('src/template.html', root), 'utf8');
const app = await readFile(new URL('src/app.js', root), 'utf8');
const license = (await readFile(new URL('LICENSE', root), 'utf8')).trim();
const usage = await readFile(new URL('USAGE.md', root), 'utf8');
const icon = (await readFile(new URL('src/icon.svg', root), 'utf8')).trim();
if (template.split('<!--LICENSE-->').length !== 2) {
  throw new Error('ライセンスの挿入位置は1つ必要です');
}
if (template.split('/*APP*/').length !== 2) {
  throw new Error('アプリの挿入位置は1つ必要です');
}
if (template.split('<!--USAGE-->').length !== 2) {
  throw new Error('使い方の挿入位置は1つ必要です');
}
if (template.split('<!--ICON-->').length !== 2 || template.split('ICON_DATA_URI').length !== 2) {
  throw new Error('アイコンとファビコンの挿入位置はそれぞれ1つ必要です');
}
// HTML単体を再配布しても、著作権表示とライセンス全文が残るようにする。
const html = template
  .replace('<!--LICENSE-->', () => `<!--\n${license}\n-->`)
  .replace('<!--ICON-->', () => icon.replace(/\n/g, '\n          '))
  .replace('ICON_DATA_URI', () => 'data:image/svg+xml,' + encodeURIComponent(icon))
  .replace('<!--USAGE-->', () => renderHelp(usage).replace(/\n/g, '\n      '))
  .replace('/*APP*/', () => app);
await writeFile(new URL('index.html', root), html);
console.log('Built index.html');
