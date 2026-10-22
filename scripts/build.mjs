import { readFile, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const template = await readFile(new URL('src/template.html', root), 'utf8');
const app = await readFile(new URL('src/app.js', root), 'utf8');
if (template.split('/*APP*/').length !== 2) throw new Error('アプリの挿入位置は1つ必要です');
await writeFile(new URL('index.html', root), template.replace('/*APP*/', app));
console.log('Built index.html');
