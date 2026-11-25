'use strict';
/* Тесты лицензирования: подпись, срок, привязка к машине, пробный период, целостность. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const lib = require('../license');

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const other = crypto.generateKeyPairSync('ed25519');

function dirs(files = {}) {
  const app = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-app-'));
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-cfg-'));
  for (const [name, data] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(app, name)), { recursive: true }); fs.writeFileSync(path.join(app, name), data); }
  return { app, cfg };
}
const make = (opts = {}) => lib.create({ publicKey, policy: { integrity: 'off', mode: 'trial', trialDays: 14 }, ...opts });

test('токен: подпись сходится, поля сохраняются', () => {
  const t = lib.signToken({ id: 'LC-1', plan: 'pro', email: 'a@b.c', mid: 'm1' }, privateKey);
  assert.match(t, /^LC1\.[\w-]+\.[\w-]+$/);
  const v = lib.verifyToken(t, publicKey, { mid: 'm1' });
  assert.equal(v.ok, true);
  assert.equal(v.payload.plan, 'pro');
  assert.equal(v.payload.id, 'LC-1');
});

test('токен: чужой ключ, правка полезной нагрузки и мусор отвергаются', () => {
  const t = lib.signToken({ plan: 'pro' }, privateKey);
  assert.equal(lib.verifyToken(t, other.publicKey).ok, false);
  assert.equal(lib.verifyToken(t, other.publicKey).reason, 'signature');
  const [p, body, sig] = t.split('.');
  const evil = JSON.parse(Buffer.from(body, 'base64').toString());
  evil.plan = 'owner';
  const forged = p + '.' + lib.b64u(JSON.stringify(evil)) + '.' + sig;
  assert.equal(lib.verifyToken(forged, publicKey).reason, 'signature');
  const broken = p + '.' + body + '.' + lib.b64u(Buffer.from('x'));
  assert.equal(lib.verifyToken(broken, publicKey).reason, 'signature');
  assert.equal(lib.verifyToken('не-ключ', publicKey).reason, 'malformed');
  assert.equal(lib.verifyToken('LC1.@@@.@@@', publicKey).reason, 'malformed');
  assert.equal(lib.verifyToken('', publicKey).reason, 'malformed');
});

test('токен: срок действия проверяется', () => {
  const old = lib.signToken({ expires: '2000-01-01' }, privateKey);
  assert.equal(lib.verifyToken(old, publicKey).reason, 'expired');
  const y = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  assert.equal(lib.verifyToken(lib.signToken({ expires: y }, privateKey), publicKey).ok, true);
  assert.equal(lib.verifyToken(lib.signToken({ expires: '31.12.2030' }, privateKey), publicKey).reason, 'malformed');
});

test('токен: привязка к компьютеру', () => {
  const t = lib.signToken({ mid: 'abc' }, privateKey);
  assert.equal(lib.verifyToken(t, publicKey, { mid: 'abc' }).ok, true);
  assert.equal(lib.verifyToken(t, publicKey, { mid: 'другой' }).reason, 'machine');
  assert.equal(lib.verifyToken(t, publicKey, { mid: null }).ok, true); // без привязки в политике
});

test('без открытого ключа лицензирование выключено и ничего не блокирует', () => {
  const { app, cfg } = dirs();
  const lic = lib.create({ appDir: app, cfgDir: cfg, policy: { mode: 'enforce' } });
  assert.equal(lic.status().state, 'disabled');
  assert.equal(lic.gate().ok, true);
});

test('пробный период идёт от первого запуска и заканчивается', () => {
  const { app, cfg } = dirs();
  const lic = make({ appDir: app, cfgDir: cfg });
  assert.equal(lic.status().state, 'trial');
  assert.equal(lic.status().trialDaysLeft, 14);
  assert.equal(lic.gate().ok, true);
  // «переводим часы»: файл первого запуска датирован 20 дней назад
  const old = Date.now() - 20 * 86400000;
  fs.writeFileSync(path.join(cfg, 'license-first-run'), JSON.stringify({ firstRun: old }));
  const lic2 = make({ appDir: app, cfgDir: cfg });
  const st = lic2.status();
  assert.equal(st.state, 'expired');
  assert.equal(st.trialDaysLeft, 0);
  assert.equal(lic2.gate().ok, false);
});

test('ключ активируется, сохраняется с правами 0600 и снимается', () => {
  const { app, cfg } = dirs();
  const lic = make({ appDir: app, cfgDir: cfg, policy: { mode: 'enforce', trialDays: 0, integrity: 'off' }, machineId: 'mid-1' });
  assert.equal(lic.status().state, 'expired');
  assert.equal(lic.gate().ok, false);
  const token = lib.signToken({ id: 'LC-9', plan: 'pro', mid: 'mid-1' }, privateKey);
  lic.activate(token);
  assert.equal(lic.status().state, 'licensed');
  assert.equal(lic.gate().ok, true);
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(cfg, 'license.json')).mode & 0o777, 0o600);
  lic.remove();
  assert.equal(lic.status().state, 'expired');
});

test('чужой, просроченный и битый ключ не активируются', () => {
  const { app, cfg } = dirs();
  const lic = make({ appDir: app, cfgDir: cfg, policy: { mode: 'enforce', trialDays: 0, integrity: 'off' }, machineId: 'mid-1' });
  assert.throws(() => lic.activate(lib.signToken({ mid: 'mid-2' }, privateKey)), (e) => e.code === 'machine');
  assert.throws(() => lic.activate(lib.signToken({ plan: 'pro' }, other.privateKey)), (e) => e.code === 'signature');
  assert.throws(() => lic.activate(lib.signToken({ expires: '2000-01-01' }, privateKey)), (e) => e.code === 'expired');
  assert.throws(() => lic.activate('LC1.aaaa.bbbb'), (e) => e.code === 'malformed');
  assert.equal(fs.existsSync(path.join(cfg, 'license.json')), false);
});

test('целостность: подпись манифеста, обнаружение правки', () => {
  const files = { 'server.js': 'console.log(1)\n', 'public/app.js': 'x\n' };
  const { app, cfg } = dirs(files);
  const man = lib.signIntegrity(app, privateKey, Object.keys(files));
  assert.deepEqual(lib.checkIntegrity(app, publicKey, man), { ok: true });
  fs.writeFileSync(path.join(app, 'public/app.js'), 'подмена\n');
  const bad = lib.checkIntegrity(app, publicKey, man);
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.files, ['public/app.js']);
  // чужой ключ не может подписать «правильный» манифест
  assert.equal(lib.checkIntegrity(app, other.publicKey, man).ok, false);
});

test('политика integrity=block: изменённые файлы блокируют ИИ', () => {
  const files = { 'server.js': 'v1\n' };
  const { app, cfg } = dirs(files);
  fs.writeFileSync(path.join(app, 'integrity.json'), JSON.stringify(lib.signIntegrity(app, privateKey, Object.keys(files))));
  const lic = lib.create({ appDir: app, cfgDir: cfg, publicKey, machineId: 'm', policy: { mode: 'trial', trialDays: 14, integrity: 'block' } });
  assert.equal(lic.status().state, 'trial');
  fs.writeFileSync(path.join(app, 'server.js'), 'v2\n');
  const lic2 = lib.create({ appDir: app, cfgDir: cfg, publicKey, machineId: 'm', policy: { mode: 'trial', trialDays: 14, integrity: 'block' } });
  assert.equal(lic2.status().state, 'tampered');
  assert.equal(lic2.gate().ok, false);
});

test('интерфейс статуса не отдаёт сам токен', () => {
  const { app, cfg } = dirs();
  const lic = make({ appDir: app, cfgDir: cfg, machineId: 'mid-1' });
  lic.activate(lib.signToken({ plan: 'pro', mid: 'mid-1' }, privateKey));
  const pub = JSON.stringify(lic.publicStatus());
  assert.equal(pub.includes('LC1.'), false);
  assert.equal(JSON.parse(pub).licensed, true);
});
