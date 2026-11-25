'use strict';
/*
 * LocalCode — подлинность сборки и проверка кода на опасные конструкции.
 * © 2026 LocalCode. См. LICENSE.
 *
 * Программа бесплатная, ключей активации нет. Этот модуль решает две задачи:
 *  1) показать пользователю, что сборка официальная (файлы совпадают с
 *     подписанным манифестом integrity.json) — «кряки» и пересобранные
 *     «сборки» с вирусами сразу видны;
 *  2) предупредить, если в написанном коде есть типичные вирусные приёмы
 *     (скачать и выполнить, автозапуск, шифровальщик, майнер и т. п.).
 *
 * Ничего не блокирует и никуда не отправляет данные.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const APP = 'LocalCode';
const FILES = ['server.js', 'integrity.js', 'hw.js', 'public/index.html', 'public/app.js', 'public/i18n.js', 'public/highlight.js'];

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Buffer.from(String(s || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64');

function fileHashes(appDir, files = FILES) {
  const out = {};
  for (const rel of files) {
    try { out[rel.split(path.sep).join('/')] = sha256(fs.readFileSync(path.join(appDir, rel))); } catch {}
  }
  return out;
}
function manifestBody(o) {
  return JSON.stringify({ v: 1, alg: 'ed25519', app: o.app || APP, version: o.version || '', files: o.files || {} });
}
function signManifest(appDir, privateKey, { version = '', files } = {}) {
  const obj = { v: 1, alg: 'ed25519', app: APP, version, files: fileHashes(appDir, files) };
  obj.sig = b64u(crypto.sign(null, Buffer.from(manifestBody(obj), 'utf8'), privateKey));
  return obj;
}
function safeManifestPath(rel) {
  return typeof rel === 'string' && rel.length > 0 && rel.length < 400
    && !path.isAbsolute(rel) && !rel.split(/[\\/]/).includes('..') && !rel.includes('\0');
}
function verifyManifest(appDir, publicKey, man) {
  if (!man || man.v !== 1 || !man.files) return { ok: false, reason: 'malformed' };
  if (!Object.keys(man.files).every(safeManifestPath)) return { ok: false, reason: 'malformed' };
  let good = false;
  try { good = crypto.verify(null, Buffer.from(manifestBody(man), 'utf8'), publicKey, unb64u(man.sig)); } catch { good = false; }
  if (!good) return { ok: false, reason: 'signature' };
  const bad = [];
  for (const [rel, hash] of Object.entries(man.files)) {
    try { if (sha256(fs.readFileSync(path.join(appDir, rel))) !== hash) bad.push(rel); }
    catch { bad.push(rel); }
  }
  return bad.length ? { ok: false, reason: 'modified', files: bad } : { ok: true };
}

/* Состояние подлинности сборки. state:
   official  — подпись верна, все файлы на месте;
   modified  — подпись верна, но файлы изменены (обычно — «кряк» или чужая сборка);
   tampered  — манифест есть, но подпись не сходится (манифест подделали);
   unsigned  — манифеста/ключа нет (сборка из исходников, это нормально для разработки). */
function status(appDir, opts = {}) {
  const manFile = path.join(appDir, 'integrity.json'), pubFile = path.join(appDir, 'integrity-pub.pem');
  let man = null, pub = opts.publicKey || null;
  try { man = JSON.parse(fs.readFileSync(manFile, 'utf8')); } catch {}
  if (!pub) { try { pub = crypto.createPublicKey(fs.readFileSync(pubFile)); } catch {} }
  if (!man) return { state: 'unsigned', official: false, version: '', files: [], reason: 'no-manifest' };
  if (!pub) return { state: 'unsigned', official: false, version: String(man.version || ''), files: [], reason: 'no-key' };
  const v = verifyManifest(appDir, pub, man);
  if (v.ok) return { state: 'official', official: true, version: String(man.version || ''), files: Object.keys(man.files), reason: '' };
  if (v.reason === 'signature' || v.reason === 'malformed') return { state: 'tampered', official: false, version: String(man.version || ''), files: [], reason: v.reason };
  return { state: 'modified', official: false, version: String(man.version || ''), files: v.files || [], reason: 'modified' };
}

/* ---------- поиск опасных конструкций в коде ---------- */
const PATTERNS = [
  { id: 'download-exec',
    re: /\b(iwr|irm|invoke-webrequest|invoke-restmethod|downloadstring|downloadfile|start-bitstransfer|net\.webclient)\b[^\n]{0,300}?\b(iex|invoke-expression|start-process|&)\b|\b(curl|wget)\b[^\n]{0,300}\|\s*(sudo\s+)?(ba|z|k|da)?sh\b/i,
    ru: 'скачивает код из интернета и сразу выполняет его', en: 'downloads code from the internet and runs it right away' },
  { id: 'hidden-powershell',
    re: /powershell(\.exe)?[^\n]{0,120}(-enc|-encodedcommand|-windowstyle\s+hidden|-w\s+hidden)\b/i,
    ru: 'запускает скрытый PowerShell с закодированной командой', en: 'runs hidden PowerShell with an encoded command' },
  { id: 'eval-obfuscated',
    re: /eval\s*\(\s*(atob|buffer\.from|unescape)\s*\(|new\s+function\s*\(\s*atob\(/i,
    ru: 'выполняет зашифрованный (base64) код через eval', en: 'executes obfuscated (base64) code through eval' },
  { id: 'destructive',
    re: /\brm\s+-[a-z]*[rf][a-z]*\s+(\/|~|\$home)(\s|$|\*|;)|rm\s+-rf\s+--no-preserve-root|\bformat\s+[a-z]:|\bdel\s+\/[fsq]\b|\brd\s+\/s\s+\/q\b|remove-item[^\n]{0,80}-recurse[^\n]{0,80}-force[^\n]{0,80}[a-z]:\\/i,
    ru: 'удаляет или форматирует диск (необратимо)', en: 'erases or formats a disk (irreversible)' },
  { id: 'autorun',
    re: /\b(hkey_(local_machine|current_user)|hkcu|hklm)[^\n]{0,200}\\(run|runonce)\b|schtasks(\.exe)?\s+\/create\b|crontab\s+-|shell:startup|\\startup\\/i,
    ru: 'прописывается в автозапуск', en: 'adds itself to autostart' },
  { id: 'miner',
    re: /stratum\+tcp|xmrig|cryptonight|minergate|nicehash/i,
    ru: 'похоже на майнер криптовалюты', en: 'looks like a crypto miner' },
  { id: 'stealer',
    re: /mimikatz|\blsass\.exe\b|login data|wallet\.dat|\\cookies\b[^\n]{0,40}(copy|open)|stealc?er/i,
    ru: 'похоже на кражу паролей или кошельков', en: 'looks like password or wallet theft' },
  { id: 'reverse-shell',
    re: /\bnc\s+-[a-z]*e\b|\/dev\/tcp\/|bash\s+-i\s*>&|socat[^\n]{0,60}exec/i,
    ru: 'открывает удалённый доступ к компьютеру (reverse shell)', en: 'opens remote access to the computer (reverse shell)' },
];

function scanSuspicious(text, max = 6) {
  const s = String(text || '').slice(0, 300000);
  if (!s) return [];
  const out = [], lines = s.split(/\r?\n/), hit = new Set();
  for (const p of PATTERNS) {
    for (let i = 0; i < lines.length && out.length < max; i++) {
      if (!p.re.test(lines[i])) continue;
      if (hit.has(p.id)) break;
      hit.add(p.id);
      out.push({ id: p.id, ru: p.ru, en: p.en, line: i + 1 });
      break;
    }
    if (out.length >= max) break;
  }
  return out;
}

module.exports = { APP, FILES, fileHashes, signManifest, verifyManifest, status, scanSuspicious, sha256 };
