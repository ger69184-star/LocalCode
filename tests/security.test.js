'use strict';
// Проверки защиты: приватные адреса, SSRF, секретные файлы, символические ссылки.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
process.env.LOCALCODE_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-sec-cfg-'));
const S = require('../app/server.js');
S.setFullAccess(false);   // в тестах проверяем обычный (ограниченный) режим

test('isPrivateIp: локальные, link-local, CGNAT, multicast и IPv6', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.1', '172.16.0.1', '172.31.255.255',
    '169.254.169.254', '0.0.0.0', '100.64.0.1', '192.0.0.1', '198.18.0.1', '224.0.0.1', '255.255.255.255',
    '::1', '::', '::ffff:127.0.0.1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1',
    '::ffff:7f00:1', '::ffff:a9fe:a9fe', '64:ff9b::7f00:1', '2002:7f00:1::']) {
    assert.equal(S.isPrivateIp(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2001:4860:4860::8888', '::ffff:808:808', '2001:db8::1']) assert.equal(S.isPrivateIp(ip), false, ip);
});

test('isPrivateHost: имена, десятичные и hex-адреса', () => {
  for (const h of ['localhost', 'LOCALHOST.', 'foo.local', 'foo.internal', 'metadata.google.internal',
    '127.0.0.1', '2130706433', '0x7f000001', '192.168.1.5', '[::1]']) assert.equal(S.isPrivateHost(h), true, h);
  assert.equal(S.isPrivateHost('example.com'), false);
  assert.equal(S.isPrivateHost('api.deepseek.com'), false);
});

test('assertPublicUrl: запрещает локальные адреса и неверные схемы', async () => {
  await assert.rejects(() => S.assertPublicUrl(new URL('http://127.0.0.1/')), /закрыты|blocked/);
  await assert.rejects(() => S.assertPublicUrl(new URL('http://[::1]/')), /закрыты|blocked/);
  await assert.rejects(() => S.assertPublicUrl(new URL('http://2130706433/')), /закрыты|blocked/);
  await assert.rejects(() => S.assertPublicUrl(new URL('http://169.254.169.254/latest/meta-data/')), /закрыты|blocked/);
  await assert.rejects(() => S.assertPublicUrl(new URL('file:///etc/passwd')), /http/);
  /* URL нормализует ::ffff:127.0.0.1 в ::ffff:7f00:1 — такой обход тоже должен закрываться. */
  await assert.rejects(() => S.assertPublicUrl(new URL('http://[::ffff:127.0.0.1]:11434/')), /закрыты|blocked/);
  await assert.rejects(() => S.assertPublicUrl(new URL('http://[64:ff9b::a9fe:a9fe]/')), /закрыты|blocked/);
  await assert.doesNotReject(() => S.assertPublicUrl(new URL('https://1.1.1.1/')));
});

test('assertProviderUrl: метаданные облака закрыты, локальная Ollama разрешена', async () => {
  await assert.rejects(() => S.assertProviderUrl({ baseUrl: 'file:///etc/passwd' }), /http/);
  await assert.rejects(() => S.assertProviderUrl({ baseUrl: 'http://169.254.169.254/v1' }), /не разрешён|not allowed/);
  await assert.rejects(() => S.assertProviderUrl({ baseUrl: 'http://[::ffff:a9fe:a9fe]/v1' }), /не разрешён|not allowed/);
  await assert.rejects(() => S.assertProviderUrl({ baseUrl: 'http://user:pass@example.com/v1' }), /логин|username/i);
  await assert.doesNotReject(() => S.assertProviderUrl({ baseUrl: 'http://127.0.0.1:11434/v1' }));
  await assert.doesNotReject(() => S.assertProviderUrl({ baseUrl: 'https://api.deepseek.com/v1' }));
});

test('isSecretFile: ключи, .env и git-конфиг защищены, шаблоны — нет', () => {
  for (const f of ['/p/.env', '/p/.env.local', '/p/.env.production', '/home/u/.ssh/id_rsa', '/p/id_ed25519',
    '/p/server.pem', '/p/cert.key', '/p/store.p12', '/p/.npmrc', '/p/.netrc', '/p/.git-credentials',
    '/p/credentials.json', '/p/secrets.yaml', '/p/.git/config', '/p/.git/hooks/pre-commit']) assert.equal(S.isSecretFile(f), true, f);
  for (const f of ['/p/.env.example', '/p/.env.sample', '/p/main.js', '/p/keys.md', '/p/README.txt', '/p/.gitignore']) assert.equal(S.isSecretFile(f), false, f);
});

test('safe: симлинк за пределы проекта запрещён', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-root-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-out-'));
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
  S.setRoot(root);
  try { fs.symlinkSync(outside, path.join(root, 'link'), 'dir'); }
  catch { t.skip('символические ссылки недоступны в этой системе'); return; }
  assert.throws(() => S.safe('link/secret.txt'), /символическая|symbolic/i);
  assert.throws(() => S.safe(path.join(root, 'link', 'secret.txt')), /символическая|symbolic/i);
  fs.writeFileSync(path.join(root, 'ok.txt'), 'ok');
  assert.equal(S.safe('ok.txt'), path.join(root, 'ok.txt'));
});

test('safe: агенту закрыты системные и секретные папки, но открыта домашняя', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-root2-'));
  S.setRoot(root);
  assert.throws(() => S.safe(path.join(os.homedir(), '.ssh', 'id_rsa'), true), /защищена|protected|секрет|secret/);
  assert.throws(() => S.safe(path.join(os.homedir(), '.localcode', 'config.json'), true), /защищена|protected/);
  const homeFile = path.join(os.homedir(), 'lc-test-' + process.pid + '.txt');
  assert.equal(S.safe(homeFile, true), homeFile);
  assert.throws(() => S.safe(path.resolve(path.parse(root).root, 'etc', 'passwd'), true), /вне|outside/i);
  // без allowHome домашняя папка недоступна
  assert.throws(() => S.safe(homeFile), /вне|outside|Абсолютн|Absolute/i);
});

test('search: не читает файлы через символические ссылки', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-root3-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-out3-'));
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'needle-in-secret\n');
  S.setRoot(root);
  try { fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'link.txt')); }
  catch { t.skip('символические ссылки недоступны в этой системе'); return; }
  assert.doesNotMatch(S.search('needle-in-secret'), /needle-in-secret/);
  fs.writeFileSync(path.join(root, 'normal.txt'), 'needle-in-normal\n');
  assert.match(S.search('needle-in-normal'), /normal\.txt/);
});

test('allFiles: не обходит символические ссылки и не читает чужое дерево', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-all-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-out2-'));
  fs.writeFileSync(path.join(outside, 'private.txt'), 'secret');
  fs.writeFileSync(path.join(root, 'own.txt'), 'ok');
  S.setRoot(root);
  try { fs.symlinkSync(outside, path.join(root, 'link'), 'dir'); }
  catch { t.skip('символические ссылки недоступны в этой системе'); return; }
  const list = S.allFiles();
  assert.ok(list.includes('own.txt'));
  assert.equal(list.some(f => f.includes('private.txt')), false);
});

test('полный доступ не снимает защиту секретов', () => {
  const prev = S.getFullAccess();
  S.setFullAccess(true);
  try {
    const key = path.join(os.homedir(), '.ssh', 'id_rsa');
    assert.throws(() => S.readFile(key, true), /секрет|secret|защищ/i);
    assert.equal(S.safe('/tmp', true), '/tmp');
  } finally { S.setFullAccess(prev); }
});
