'use strict';
// Запуск: npm test   (нужен Node 18+; тесты используют встроенный node:test)
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
// Своя папка настроек: тесты не читают и не меняют настоящий ~/.localcode
process.env.LOCALCODE_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-cfg-'));
const S = require('../app/server.js');
S.setFullAccess(false);   // в тестах проверяем обычный (ограниченный) режим
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-test-'));
S.setRoot(tmp);
const w = (n, t) => { fs.mkdirSync(path.dirname(path.join(tmp, n)), { recursive: true }); fs.writeFileSync(path.join(tmp, n), t); };
const r = (n) => fs.readFileSync(path.join(tmp, n), 'utf8');

test('safe: относительные пути внутри проекта', () => {
  assert.equal(S.safe('a/b.txt'), path.join(tmp, 'a', 'b.txt'));
  assert.equal(S.safe(''), tmp);
});
test('safe: выход за проект через .. запрещён', () => { assert.throws(() => S.safe('../x')); assert.throws(() => S.safe('a/../../x')); });
test('safe: абсолютный путь вне проекта даёт понятную ошибку', () => {
  assert.throws(() => S.safe(path.resolve(path.parse(tmp).root, 'etc', 'passwd')), /Абсолютн|Absolute/);
  assert.equal(S.safe(path.join(tmp, 'ok.txt')), path.join(tmp, 'ok.txt'));
});
test('replaceInFile: пустой old_str отклоняется', () => { w('r.txt', 'abc'); assert.throws(() => S.replaceInFile('r.txt', '', 'x'), /old_str/); });
test('replaceInFile: не найдено, неоднозначно, успех', () => {
  w('r2.txt', 'a b a'); assert.throws(() => S.replaceInFile('r2.txt', 'zzz', 'x'));
  assert.throws(() => S.replaceInFile('r2.txt', 'a', 'x'));
  S.replaceInFile('r2.txt', 'b', 'B'); assert.equal(r('r2.txt'), 'a B a');
});
test('run: пустая команда отклоняется, обычная выполняется', async () => {
  await assert.rejects(() => S.run('   '), /Пуст|Empty/);
  const out = await S.run(process.platform === 'win32' ? 'echo hello' : 'echo hello', 10);
  assert.match(out, /hello/);
});
test('applyPatch: один и несколько блоков, CRLF сохраняется', () => {
  w('p.txt', 'one\ntwo\nthree\nfour\nfive\n');
  S.applyPatch('p.txt', '@@ -1,3 +1,3 @@\n one\n-two\n+TWO\n three\n@@ -4,2 +4,3 @@\n four\n+four-and-half\n five\n');
  assert.equal(r('p.txt'), 'one\nTWO\nthree\nfour\nfour-and-half\nfive\n');
  w('c.txt', 'a\r\nb\r\nc\r\n'); S.applyPatch('c.txt', '@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n');
  assert.equal(r('c.txt'), 'a\r\nB\r\nc\r\n');
});
test('applyPatch: несовпавший контекст — ошибка, файл не меняется', () => {
  w('q.txt', 'x\ny\n'); assert.throws(() => S.applyPatch('q.txt', '@@ -1,1 +1,1 @@\n-zzz\n+yyy\n'), /не найден|not found/);
  assert.equal(r('q.txt'), 'x\ny\n'); assert.throws(() => S.applyPatch('q.txt', 'просто текст'), /@@/);
});
test('search: подстрока, regex, неверный regex, .gitignore', () => {
  w('s/a.js', 'const Foo = 1;\nfoo2();\n'); w('s/ignored/b.js', 'foo here\n'); w('.gitignore', 'ignored/\n*.log\n'); w('s/x.log', 'foo log\n');
  const lit = S.search('foo'); assert.match(lit, /a\.js:1/); assert.doesNotMatch(lit, /ignored|x\.log/);
  assert.match(S.search('foo\\d', '', true), /a\.js:2/); assert.doesNotMatch(S.search('foo\\d', '', true), /a\.js:1/);
  assert.throws(() => S.search('(', '', true), /регуляр|regular/i); assert.throws(() => S.search('  '), /Пуст|Empty/);
});
test('parseDdg и htmlToText', () => {
  const html = '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa%3Fx%3D1&amp;rut=1">Пример &amp; тест</a><a class="result__snippet">Описание <b>страницы</b></a>';
  const res = S.parseDdg(html); assert.equal(res.length, 1); assert.match(res[0], /Пример & тест/); assert.match(res[0], /https:\/\/example\.com\/a\?x=1/); assert.match(res[0], /Описание страницы/);
  assert.equal(S.htmlToText('<script>x()</script><p>Привет</p><p>мир &amp; все</p>'), 'Привет\nмир & все');
});
test('fetchUrl и openTarget: защита от локальных адресов и неверных ссылок', async () => {
  for (const h of ['localhost', '127.0.0.1', '192.168.1.5', '10.0.0.2', '169.254.1.1', '172.16.0.1']) assert.ok(S.isPrivateHost(h), h);
  assert.ok(!S.isPrivateHost('example.com'));
  await assert.rejects(() => S.fetchUrl('http://127.0.0.1:11434/api/tags'), /закрыты|blocked/i);
  await assert.rejects(() => S.fetchUrl('file:///etc/passwd'), /http/);
  await assert.rejects(() => S.openTarget('http://'), /Неверная|Invalid/);
  await assert.rejects(() => S.openTarget('ftp://example.com/x'), /http/);
});
test('автоключи: переключение при лимите, память о рабочем ключе, паузы', async () => {
  S.resetKeys();
  const cfg = { baseUrl: 'https://api.example.com/v1', kind: 'openai', apiKeys: ['key-AAAAAAAAAA', 'key-BBBBBBBBBB', 'key-CCCCCCCCCC'] }, events = [], used = [];
  const emit = (e) => events.push(e);
  const mk = (bad) => async (c) => { used.push(c.apiKey); const st = bad[c.apiKey]; if (st) throw new S.HttpError('HTTP ' + st, st, 0); return 'ok:' + c.apiKey; };
  assert.equal(await S.withKeys(cfg, emit, mk({})), 'ok:key-AAAAAAAAAA');
  assert.equal(await S.withKeys(cfg, emit, mk({ 'key-AAAAAAAAAA': 429 })), 'ok:key-BBBBBBBBBB');
  const sw = events.find(e => e.t === 'key'); assert.equal(sw.index, 2); assert.equal(sw.total, 3); assert.equal(sw.from, 1); assert.equal(sw.reason, 'limit');
  used.length = 0; assert.equal(await S.withKeys(cfg, emit, mk({})), 'ok:key-BBBBBBBBBB'); assert.deepEqual(used, ['key-BBBBBBBBBB']);   // не возвращается на ключ в паузе
  assert.equal(await S.withKeys(cfg, emit, mk({ 'key-BBBBBBBBBB': 401 })), 'ok:key-CCCCCCCCCC');
  await assert.rejects(() => S.withKeys(cfg, emit, mk({ 'key-CCCCCCCCCC': 402 })), /Все ключи|All 3 keys/);
  S.resetKeys(); assert.equal(await S.withKeys(cfg, emit, mk({})), 'ok:key-AAAAAAAAAA');
});
test('автоключи: ошибки не про ключ не вызывают переключение; один ключ работает как раньше', async () => {
  S.resetKeys();
  const cfg = { baseUrl: 'https://api.example.com/v1', kind: 'openai', apiKeys: ['k1-AAAAAAAAAA', 'k2-BBBBBBBBBB'] };
  await assert.rejects(() => S.withKeys(cfg, () => {}, async () => { throw new S.HttpError('HTTP 500 server', 500); }), /500/);
  await assert.rejects(() => S.withKeys(cfg, () => {}, async () => { throw new S.HttpError('HTTP 404 model', 404); }), /404/);
  assert.equal(S.keyState.size === 0 || [...S.keyState.values()].every(v => v.until === 0), true);
  assert.equal(await S.withKeys({ ...cfg, apiKeys: undefined, apiKey: 'solo' }, () => {}, async (c) => c.apiKey), 'solo');
  assert.equal(await S.withKeys({ baseUrl: 'http://localhost:11434/v1' }, () => {}, async (c) => c.apiKey === undefined ? 'nokey' : 'x'), 'nokey');
  assert.deepEqual(S.classifyKeyError({ status: 429, retryAfter: 5 }), { ms: 15000, reason: 'limit' });
  assert.equal(S.classifyKeyError({ status: 402 }).reason, 'balance'); assert.equal(S.classifyKeyError({ status: 500 }), null);
});
test('zip: сборка и чтение архива, опасные имена отбрасываются', () => {
  const zip = S.zipStore([{ name: 'a.txt', data: Buffer.from('hello'), mtime: new Date() }]);
  const files = S.readZip(zip);
  assert.equal(files.length, 1); assert.equal(files[0].data.toString(), 'hello');
  for (const bad of ['../evil', 'C:/evil', '/abs', 'a/../../b', '', 'a//b', './a']) assert.equal(S.zipSafeName(bad), null, bad);
  assert.equal(S.zipSafeName('ok/dir/x.txt'), 'ok/dir/x.txt');
  // «zip-бомба»: заявленный размер распакованного файла больше лимита — архив отклоняется до распаковки
  const bomb = S.zipStore([{ name: 'a.txt', data: Buffer.from('x'), mtime: new Date() }]);
  const cd = bomb.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  bomb.writeUInt32LE(30 * 1024 * 1024, cd + 24);
  assert.throws(() => S.readZip(bomb), /слишком большой|too large/i);
});
test('zip: распаковка не выходит за пределы папки назначения', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-unz-'));
  const zip = S.zipStore([{ name: 'inner/ok.txt', data: Buffer.from('ok'), mtime: new Date() }, { name: '../evil.txt', data: Buffer.from('x'), mtime: new Date() }]);
  assert.equal(S.extractZipInto(zip, dir), 1);
  assert.equal(fs.readFileSync(path.join(dir, 'inner', 'ok.txt'), 'utf8'), 'ok');
  assert.equal(fs.existsSync(path.join(dir, '..', 'evil.txt')), false);
  fs.rmSync(dir, { recursive: true, force: true });
});
test('readZip: битые границы сжатых данных отклоняются', () => {
  const zip = S.zipStore([{ name: 'a.txt', data: Buffer.from('hello'), mtime: new Date() }]);
  let eocd = -1;
  for (let i = zip.length - 22; i >= 0; i--) if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  assert.ok(eocd > 0);
  const cdOff = zip.readUInt32LE(eocd + 16);
  const bad = Buffer.from(zip); bad.writeUInt32LE(100000, cdOff + 20);      // csize указывает за пределы файла
  assert.throws(() => S.readZip(bad), /повреждён|damaged/i);
  assert.deepEqual(S.readZip(zip).map(f => f.name), ['a.txt']);
});
test('replaceAllInProject: считает и заменяет, пустое совпадение отклоняется', () => {
  w('rep1.txt', 'beta beta'); w('rep2.txt', 'gamma');
  const dry = S.replaceAllInProject('beta', 'B', { dry: true });
  assert.equal(dry.total, 2); assert.equal(dry.filesCount, 1); assert.equal(dry.partial, false);
  assert.throws(() => S.replaceAllInProject('a*', 'x', { regex: true }), /пустой|empty/);
  const applied = S.replaceAllInProject('beta', 'B', { dry: false });
  assert.equal(applied.total, 2); assert.equal(r('rep1.txt'), 'B B'); assert.equal(r('rep2.txt'), 'gamma');
});
test.after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });
