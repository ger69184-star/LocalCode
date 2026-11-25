'use strict';
/*
 * LocalCode — лицензирование (офлайн, без обращений в интернет).
 * © 2026 LocalCode. Все права защищены. См. LICENSE.
 *
 * Токен: LC1.<base64url(payload)>.<base64url(ed25519-подпись)>
 * Подпись проверяется открытым ключом из license-pub.pem; закрытый ключ
 * хранится ТОЛЬКО у владельца продукта и в поставку не входит.
 *
 * Политика — license-policy.json рядом с server.js:
 *   { "mode": "off|trial|enforce", "trialDays": 14, "bindMachine": true,
 *     "integrity": "off|warn|block" }
 * Если открытого ключа нет — лицензирование выключено (режим разработки).
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const PREFIX = 'LC1';
const DAY = 86400000;
const DEFAULT_POLICY = { mode: 'trial', trialDays: 14, bindMachine: true, integrity: 'warn' };
const INTEGRITY_FILES = ['server.js', 'license.js', 'hw.js', 'license-pub.pem', 'license-policy.json', 'public/index.html', 'public/app.js', 'public/i18n.js', 'public/highlight.js'];

const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Buffer.from(String(s || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const today = () => new Date().toISOString().slice(0, 10);
const secureFile = (f) => { if (process.platform !== 'win32') { try { fs.chmodSync(f, 0o600); } catch {} } };
const atomicWrite = (file, data) => {
  const tmp = file + '.' + process.pid + '.tmp';
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(tmp, data, { mode: 0o600 });
  secureFile(tmp);
  fs.renameSync(tmp, file);
};

/* ---------- подпись и проверка токена ---------- */
function signToken(payload, privateKey) {
  const body = { v: 1, issued: today(), ...payload };
  const data = PREFIX + '.' + b64u(Buffer.from(JSON.stringify(body), 'utf8'));
  const sig = crypto.sign(null, Buffer.from(data, 'utf8'), privateKey);
  return data + '.' + b64u(sig);
}
function verifyToken(token, publicKey, { now = Date.now(), mid = null } = {}) {
  const t = String(token || '').trim();
  if (t.length < 40 || t.length > 8192) return { ok: false, reason: 'malformed' };
  const parts = t.split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX) return { ok: false, reason: 'malformed' };
  const data = parts[0] + '.' + parts[1];
  let payload;
  try { payload = JSON.parse(unb64u(parts[1]).toString('utf8')); } catch { return { ok: false, reason: 'malformed' }; }
  if (!payload || typeof payload !== 'object' || payload.v !== 1) return { ok: false, reason: 'malformed' };
  let good = false;
  try { good = crypto.verify(null, Buffer.from(data, 'utf8'), publicKey, unb64u(parts[2])); } catch { good = false; }
  if (!good) return { ok: false, reason: 'signature' };
  if (payload.expires) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(payload.expires))) return { ok: false, reason: 'malformed' };
    if (Date.parse(payload.expires + 'T23:59:59Z') < now) return { ok: false, reason: 'expired', payload };
  }
  if (payload.mid && mid && String(payload.mid) !== String(mid)) return { ok: false, reason: 'machine', payload };
  return { ok: true, payload };
}

/* ---------- идентификатор компьютера ---------- */
function systemMachineId() {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { encoding: 'utf8', timeout: 2000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
      const m = out.match(/MachineGuid\s+REG_SZ\s+([\w-]+)/i); if (m) return m[1];
    } else if (process.platform === 'darwin') {
      const out = execFileSync('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] });
      const m = out.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/); if (m) return m[1];
    } else {
      for (const f of ['/etc/machine-id', '/var/lib/dbus/machine-id']) { try { const s = fs.readFileSync(f, 'utf8').trim(); if (s) return s; } catch {} }
    }
  } catch {}
  return 'host:' + os.hostname() + ':' + (os.userInfo && os.userInfo().username || '');
}

/* ---------- целостность файлов (необязательно) ---------- */
function fileHashes(appDir, files = INTEGRITY_FILES) {
  const out = {};
  for (const rel of files) {
    try { out[rel.split(path.sep).join('/')] = sha256(fs.readFileSync(path.join(appDir, rel))); } catch {}
  }
  return out;
}
function integrityBody(obj) { return JSON.stringify({ v: 1, alg: 'ed25519', files: obj.files || {} }); }
function signIntegrity(appDir, privateKey, files) {
  const obj = { v: 1, alg: 'ed25519', files: fileHashes(appDir, files) };
  const sig = crypto.sign(null, Buffer.from(integrityBody(obj), 'utf8'), privateKey);
  return { ...obj, sig: b64u(sig) };
}
function checkIntegrity(appDir, publicKey, manifest) {
  if (!manifest || manifest.v !== 1 || !manifest.files) return { ok: false, reason: 'missing' };
  let good = false;
  try { good = crypto.verify(null, Buffer.from(integrityBody(manifest), 'utf8'), publicKey, unb64u(manifest.sig)); } catch {}
  if (!good) return { ok: false, reason: 'signature' };
  const bad = [];
  for (const [rel, hash] of Object.entries(manifest.files)) {
    try { if (sha256(fs.readFileSync(path.join(appDir, rel))) !== hash) bad.push(rel); }
    catch { bad.push(rel); }
  }
  return bad.length ? { ok: false, reason: 'modified', files: bad } : { ok: true };
}

/* ---------- экземпляр для конкретной установки ---------- */
function create(opts = {}) {
  const appDir = opts.appDir || __dirname;
  const cfgDir = opts.cfgDir || path.join(os.homedir(), '.localcode');
  const log = opts.log || (() => {});
  const policyFile = path.join(appDir, 'license-policy.json');
  const pubFile = path.join(appDir, 'license-pub.pem');
  const manifestFile = path.join(appDir, 'integrity.json');
  const stateFile = path.join(cfgDir, 'license.json');
  const machineFile = path.join(cfgDir, 'machine-id');
  const firstRunFile = path.join(cfgDir, 'license-first-run');

  let publicKey = null;
  if (opts.publicKey) publicKey = opts.publicKey;
  else {
    try { publicKey = crypto.createPublicKey(fs.readFileSync(pubFile)); }
    catch { publicKey = null; }
  }

  /* Политику принимаем, только если она входит в подписанный манифест целостности.
     Иначе правка license-policy.json ("mode": "off") работала бы как выключатель защиты.
     Нет манифеста или подпись не сходится — действуют значения по умолчанию. */
  function signedPolicy() {
    let raw = null, man = null;
    try { raw = fs.readFileSync(policyFile, 'utf8'); } catch { return null; }
    try { man = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); } catch { return null; }
    if (!man || !man.files || !man.files['license-policy.json'] || !publicKey) return null;
    let good = false;
    try { good = crypto.verify(null, Buffer.from(integrityBody(man), 'utf8'), publicKey, unb64u(man.sig)); } catch { good = false; }
    if (!good || sha256(raw) !== man.files['license-policy.json']) return null;
    try { const p = JSON.parse(raw); return p && typeof p === 'object' ? p : null; } catch { return null; }
  }
  let policy = { ...DEFAULT_POLICY };
  if (opts.policy) policy = { ...policy, ...opts.policy };
  else {
    const p = signedPolicy();
    if (p) policy = { ...DEFAULT_POLICY, ...p };
    else if (fs.existsSync(policyFile) && publicKey) log('license: policy is not covered by a signed manifest — using defaults');
  }
  if (!['off', 'trial', 'enforce'].includes(policy.mode)) policy.mode = 'trial';
  policy.trialDays = Math.min(3650, Math.max(0, Number(policy.trialDays) || 0));
  if (!['off', 'warn', 'block'].includes(policy.integrity)) policy.integrity = 'warn';

  let machine = opts.machineId || null;
  function machineId() {
    if (machine) return machine;
    let stored = '';
    try { stored = fs.readFileSync(machineFile, 'utf8').trim(); } catch {}
    if (!/^[a-f0-9]{32}$/i.test(stored)) {
      stored = crypto.randomBytes(16).toString('hex');
      try { atomicWrite(machineFile, stored + '\n'); } catch {}
    }
    machine = sha256(systemMachineId() + '|' + stored).slice(0, 32);
    return machine;
  }

  function firstRun() {
    let first = 0;
    for (const f of [stateFile, firstRunFile]) {
      try { const j = JSON.parse(fs.readFileSync(f, 'utf8')); if (j && +j.firstRun > 0) first = first || +j.firstRun; } catch {}
      try { const s = fs.statSync(f); if (!first && s.isFile()) first = s.mtimeMs; } catch {}
    }
    const now = Date.now();
    if (!first || first > now) first = now;
    if (!fs.existsSync(firstRunFile)) { try { atomicWrite(firstRunFile, JSON.stringify({ firstRun: first })); } catch {} }
    return first;
  }

  function readState() {
    try { const j = JSON.parse(fs.readFileSync(stateFile, 'utf8')); return j && typeof j === 'object' ? j : null; } catch { return null; }
  }

  let last = null, lastAt = 0, runCache = 0;
  let integ = { at: 0, val: { ok: true } };
  function integrityNow() {
    if (policy.integrity === 'off') return { ok: true };
    if (Date.now() - integ.at < 15000) return integ.val;
    let man = null;
    try { man = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); } catch {}
    integ = { at: Date.now(), val: man ? checkIntegrity(appDir, publicKey, man) : { ok: true } };
    return integ.val;
  }
  function status() {
    const base = { mode: policy.mode, enabled: policy.mode !== 'off' && !!publicKey, trialDays: policy.trialDays, machine: '' };
    if (!publicKey) return { ...base, state: 'disabled', licensed: false, reason: 'no-public-key' };
    if (policy.mode === 'off') return { ...base, enabled: false, state: 'disabled', licensed: false, reason: 'mode-off' };
    base.machine = machineId();          // дорогое определение железа — только когда лицензии включены
    const st = readState();
    let trialDaysLeft = 0;
    if (policy.mode === 'trial') {
      runCache = runCache || firstRun();
      const passed = Math.floor((Date.now() - runCache) / DAY);
      trialDaysLeft = Math.max(0, policy.trialDays - passed);
    }
    const integrity = integrityNow();
    if (integrity.ok === false && policy.integrity === 'block') {
      last = { ...base, state: 'tampered', licensed: false, reason: 'integrity', files: integrity.files || [], trialDaysLeft, integrity };
      lastAt = Date.now();
      return last;
    }
    if (st && st.token) {
      const v = verifyToken(st.token, publicKey, { mid: policy.bindMachine ? machineId() : null });
      if (v.ok) {
        last = { ...base, state: 'licensed', licensed: true, plan: v.payload.plan || 'personal', email: v.payload.email || '', expires: v.payload.expires || '', licenseId: v.payload.id || '', trialDaysLeft, integrity };
        lastAt = Date.now();
        return last;
      }
      last = { ...base, state: policy.mode === 'trial' && trialDaysLeft > 0 ? 'trial' : 'invalid', licensed: false, reason: v.reason, trialDaysLeft, integrity };
      lastAt = Date.now();
      return last;
    }
    const state = policy.mode === 'trial' && trialDaysLeft > 0 ? 'trial' : 'expired';
    last = { ...base, state, licensed: false, trialDaysLeft, integrity };
    lastAt = Date.now();
    return last;
  }

  function publicStatus() {
    const s = last && Date.now() - lastAt < 3000 ? last : status();
    lastAt = Date.now();
    return {
      mode: s.mode, state: s.state, licensed: !!s.licensed, plan: s.plan || '', email: s.email || '',
      expires: s.expires || '', licenseId: s.licenseId || '', trialDaysLeft: s.trialDaysLeft || 0,
      machine: s.machine, reason: s.reason || '', integrity: s.integrity ? { ok: s.integrity.ok, reason: s.integrity.reason, files: s.integrity.files } : undefined,
    };
  }

  function activate(token) {
    if (!publicKey) throw new Error('Лицензирование не настроено: нет открытого ключа');
    const v = verifyToken(token, publicKey, { mid: policy.bindMachine ? machineId() : null });
    if (!v.ok) {
      const msg = { signature: 'Подпись не совпала — проверьте ключ', expired: 'Срок действия ключа истёк', machine: 'Ключ выдан для другого компьютера', malformed: 'Ключ повреждён или имеет неверный формат' }[v.reason] || 'Ключ не принят';
      const err = new Error(msg); err.code = v.reason; throw err;
    }
    atomicWrite(stateFile, JSON.stringify({ token, activatedAt: new Date().toISOString(), firstRun: firstRun() }, null, 2));
    last = null;
    return status();
  }
  function remove() { try { fs.unlinkSync(stateFile); } catch {} last = null; return status(); }
  function gate() {
    const s = status();
    if (!s.enabled) return { ok: true };
    if (s.licensed || s.state === 'trial') return { ok: true };
    return { ok: false, state: s.state, reason: s.reason || '' };
  }
  function init() {
    const s = status();
    if (s.enabled && s.state !== 'licensed' && s.state !== 'trial') log('license:', s.state, s.reason || '');
    if (s.integrity && s.integrity.ok === false) log('integrity:', s.integrity.reason, (s.integrity.files || []).join(', '));
    return s;
  }

  return { policy, appDir, cfgDir, machineId, status, publicStatus, activate, remove, gate, init, verify: (t) => verifyToken(t, publicKey, { mid: policy.bindMachine ? machineId() : null }) };
}

module.exports = { create, signToken, verifyToken, signIntegrity, checkIntegrity, fileHashes, b64u, unb64u, INTEGRITY_FILES, DEFAULT_POLICY };
