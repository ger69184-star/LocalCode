#!/usr/bin/env node
'use strict';
/*
 * LocalCode — подпись официальных сборок (для владельца проекта).
 * © 2026 LocalCode. См. LICENSE.
 *
 * Ключи активации не нужны: программа бесплатная. Подпись нужна только чтобы
 * пользователь мог отличить официальную сборку от «кряка» с вирусом.
 *
 *   node tools/integrity-cli.js keygen --out ./integrity-keys --install
 *   node tools/integrity-cli.js sign --key ./integrity-keys/private.pem
 *   node tools/integrity-cli.js status
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const I = require('../integrity');

const argv = process.argv.slice(2);
const cmd = argv[0] || 'help';
const opt = (n, d = null) => { const i = argv.indexOf('--' + n); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : d; };
const flag = (n) => argv.includes('--' + n);
const appDir = path.resolve(opt('app') || path.join(__dirname, '..'));
const say = (...a) => console.log(...a);
const die = (m) => { console.error('Ошибка: ' + m); process.exit(1); };
const keyFrom = (v) => {
  const f = v || process.env.LOCALCODE_SIGN_KEY;
  if (!f || f === true) die('укажите --key <private.pem>');
  try { return crypto.createPrivateKey(fs.readFileSync(f)); } catch (e) { die('не удалось прочитать закрытый ключ: ' + e.message); }
};
const version = () => { try { return JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8')).version || ''; } catch { return ''; } };

switch (cmd) {
  case 'keygen': {
    const out = path.resolve(opt('out') || path.join(os.homedir(), '.localcode', 'integrity-keys'));
    fs.mkdirSync(out, { recursive: true, mode: 0o700 });
    const priv = path.join(out, 'private.pem'), pub = path.join(out, 'public.pem');
    if (fs.existsSync(priv) && !flag('force')) die('ключи уже есть: ' + out + ' (используйте --force, чтобы перевыпустить)');
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    fs.writeFileSync(priv, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    if (process.platform !== 'win32') { try { fs.chmodSync(priv, 0o600); } catch {} }
    fs.writeFileSync(pub, publicKey.export({ type: 'spki', format: 'pem' }), { mode: 0o644 });
    say('\nКлючи созданы:', out);
    say('  private.pem — закрытый. Храните у себя, не публикуйте и не коммитьте.');
    say('  public.pem  — открытый, его можно распространять.\n');
    if (flag('install')) { fs.copyFileSync(pub, path.join(appDir, 'integrity-pub.pem')); say('Открытый ключ установлен в', path.join(appDir, 'integrity-pub.pem')); }
    else say('Скопируйте public.pem в ' + path.join(appDir, 'integrity-pub.pem') + ' или повторите с --install\n');
    break;
  }
  case 'sign': {
    const key = keyFrom(opt('key'));
    const man = I.signManifest(appDir, key, { version: version() });
    fs.writeFileSync(path.join(appDir, 'integrity.json'), JSON.stringify(man, null, 2) + '\n');
    say('\nПодписано:', path.join(appDir, 'integrity.json'));
    say('Версия:', man.version || '—', '· файлов:', Object.keys(man.files).length);
    say('style.css намеренно не входит — оформление можно менять без предупреждений.');
    say('После любой правки файлов из манифеста подпишите заново.\n');
    break;
  }
  case 'status': {
    const st = I.status(appDir);
    say(JSON.stringify(st, null, 2));
    if (st.state !== 'official') say('\nСборка ещё не подписана (это нормально для разработки).');
    break;
  }
  case 'scan': {
    const f = opt('file');
    if (!f || f === true) die('укажите --file <путь>');
    const r = I.scanSuspicious(fs.readFileSync(f, 'utf8'));
    say(r.length ? JSON.stringify(r, null, 2) : 'Подозрительных конструкций не найдено.');
    break;
  }
  default:
    say(`LocalCode integrity tool (ключи активации не используются)

  keygen  [--out DIR] [--install] [--force]   создать пару ключей для подписи сборок
  sign    --key FILE                           подписать integrity.json (официальная сборка)
  status                                       показать состояние подлинности
  scan    --file FILE                          проверить файл на опасные конструкции

  --app DIR   папка приложения (по умолчанию — эта)
`);
}
