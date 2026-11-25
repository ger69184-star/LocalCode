#!/usr/bin/env node
'use strict';
/*
 * LocalCode — инструмент владельца продукта для выпуска лицензий.
 * © 2026 LocalCode. Все права защищены. См. LICENSE.
 *
 * Закрытый ключ НИКОГДА не должен попадать в репозиторий и в сборку.
 * Скрипт не отправляет ничего в интернет.
 *
 * Примеры:
 *   node tools/license-cli.js keygen --out ~/.localcode/keys --install
 *   node tools/license-cli.js issue --key ~/.localcode/keys/private.pem --plan pro --days 365 --email user@mail.ru
 *   node tools/license-cli.js sign  --key ~/.localcode/keys/private.pem
 *   node tools/license-cli.js status
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const lib = require('../license');

const argv = process.argv.slice(2);
const cmd = argv[0] || 'help';
const opt = (name, def = null) => { const i = argv.indexOf('--' + name); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : def; };
const flag = (name) => argv.includes('--' + name);
const appDir = path.resolve(opt('app') || path.join(__dirname, '..'));
const cfgDir = path.resolve(process.env.LOCALCODE_CONFIG_DIR || path.join(os.homedir(), '.localcode'));
const say = (...a) => console.log(...a);
const die = (m) => { console.error('Ошибка: ' + m); process.exit(1); };
const keyFrom = (p) => {
  const file = p || process.env.LOCALCODE_LICENSE_KEY;
  if (!file || file === true) die('укажите --key <путь к private.pem> или LOCALCODE_LICENSE_KEY');
  const stat = fs.statSync(file);
  if (process.platform !== 'win32' && (stat.mode & 0o077)) console.error('Внимание: у файла закрытого ключа слишком открытые права. Выполните: chmod 600 ' + file);
  return crypto.createPrivateKey(fs.readFileSync(file));
};
const pubFrom = (p) => {
  const file = p || path.join(appDir, 'license-pub.pem');
  try { return crypto.createPublicKey(fs.readFileSync(file)); } catch { die('не найден открытый ключ: ' + file); }
};

function writeIfAbsent(file, data, mode = 0o644) {
  if (fs.existsSync(file) && !flag('force')) { say('  уже существует, пропускаю:', file); return false; }
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, data, { mode });
  if (process.platform !== 'win32' && mode === 0o600) { try { fs.chmodSync(file, 0o600); } catch {} }
  return true;
}

switch (cmd) {
  case 'keygen': {
    const out = path.resolve(opt('out') || path.join(cfgDir, 'license-keys'));
    fs.mkdirSync(out, { recursive: true, mode: 0o700 });
    const priv = path.join(out, 'private.pem'), pub = path.join(out, 'public.pem');
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const a = writeIfAbsent(priv, privateKey.export({ type: 'pkcs8', format: 'pem' }), 0o600);
    const b = writeIfAbsent(pub, publicKey.export({ type: 'spki', format: 'pem' }), 0o644);
    say('\nКлючи готовы:', out);
    say('  private.pem — ЗАКРЫТЫЙ ключ. Храните только у себя, не передавайте и не коммитьте.');
    say('  public.pem  — открытый ключ, его можно распространять.\n');
    if (flag('install')) {
      fs.copyFileSync(pub, path.join(appDir, 'license-pub.pem'));
      const pol = path.join(appDir, 'license-policy.json');
      if (!fs.existsSync(pol)) fs.writeFileSync(pol, JSON.stringify({ mode: 'trial', trialDays: 14, bindMachine: true, integrity: 'warn' }, null, 2) + '\n');
      say('Открытый ключ установлен в', path.join(appDir, 'license-pub.pem'));
      say('Политика:', pol, '(по умолчанию: пробный период 14 дней, затем нужен ключ)');
      say('После изменений в коде подпишите целостность: node tools/license-cli.js sign --key ' + priv + '\n');
    } else {
      say('Установите открытый ключ в приложение:');
      say('  скопируйте public.pem в ' + path.join(appDir, 'license-pub.pem'));
      say('  или повторите keygen с флагом --install\n');
    }
    if (!a && !b) say('Ключи уже существовали; используйте --force, чтобы перевыпустить (старые лицензии станут недействительны).\n');
    break;
  }
  case 'issue': {
    const key = keyFrom(opt('key'));
    const plan = String(opt('plan', 'personal')).replace(/[^a-z0-9_-]/gi, '').slice(0, 24) || 'personal';
    const email = opt('email') ? String(opt('email')).slice(0, 160) : '';
    const mid = opt('mid') ? String(opt('mid')).slice(0, 64) : '';
    const id = String(opt('id') || 'LC-' + crypto.randomBytes(4).toString('hex').toUpperCase());
    let expires = '';
    if (!flag('perpetual')) {
      const days = Math.min(3650, Math.max(1, Number(opt('days', 365)) || 365));
      expires = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
    }
    const token = lib.signToken({ id, plan, email, ...(expires ? { expires } : {}), ...(mid ? { mid } : {}) }, key);
    say('\nЛицензионный ключ (передайте покупателю):\n');
    say(token);
    say('\nПараметры: id=' + id + ' план=' + plan + (email ? ' email=' + email : '') + (mid ? ' машина=' + mid : '') + (expires ? ' до=' + expires : ' бессрочно'));
    if (!mid) say('Ключ не привязан к компьютеру. Для привязки добавьте --mid <id из настроек LocalCode>.');
    say('Проверить: node tools/license-cli.js verify --token <ключ>\n');
    break;
  }
  case 'policy': {
    const key = keyFrom(opt('key'));
    const mode = String(opt('mode', 'trial'));
    if (!['off', 'trial', 'enforce'].includes(mode)) die('mode должен быть off, trial или enforce');
    const integrity = String(opt('integrity', 'warn'));
    if (!['off', 'warn', 'block'].includes(integrity)) die('integrity должен быть off, warn или block');
    const days = Math.min(3650, Math.max(0, Number(opt('days', 14)) || 0));
    const policy = { mode, trialDays: days, bindMachine: !flag('no-bind'), integrity };
    const file = path.join(appDir, 'license-policy.json');
    fs.writeFileSync(file, JSON.stringify(policy, null, 2) + '\n');
    const man = lib.signIntegrity(appDir, key);
    fs.writeFileSync(path.join(appDir, 'integrity.json'), JSON.stringify(man, null, 2) + '\n');
    say('\nПолитика записана и подписана:', file);
    say(JSON.stringify(policy));
    say('Манифест целостности обновлён (в него входит и сама политика).');
    say('Проверить: node tools/license-cli.js status\n');
    break;
  }
  case 'sign': {
    const key = keyFrom(opt('key'));
    const man = lib.signIntegrity(appDir, key);
    const file = path.join(appDir, 'integrity.json');
    fs.writeFileSync(file, JSON.stringify(man, null, 2) + '\n');
    say('\nЦелостность подписана:', file);
    say('Файлов в манифесте:', Object.keys(man.files).length, '(style.css намеренно не входит — его можно менять)');
    say('В манифест входят license-policy.json и license-pub.pem: без подписи политика не применяется.');
    say('Внимание: любое изменение перечисленных файлов потребует повторной подписи.\n');
    break;
  }
  case 'verify': {
    const token = opt('token');
    if (!token || token === true) die('укажите --token <ключ>');
    const v = lib.verifyToken(String(token), pubFrom(opt('pub')));
    say(JSON.stringify(v.ok ? { ok: true, ...v.payload } : v, null, 2));
    process.exit(v.ok ? 0 : 2);
    break;
  }
  case 'machine': {
    const lic = lib.create({ appDir, cfgDir });
    say(lic.machineId());
    break;
  }
  case 'status': {
    const lic = lib.create({ appDir, cfgDir });
    const s = lic.publicStatus();
    say(JSON.stringify(s, null, 2));
    break;
  }
  default:
    say(`LocalCode license tool

  keygen  [--out DIR] [--install] [--force]   создать пару ключей (закрытый — только у вас)
  issue   --key FILE [--plan pro] [--days 365|--perpetual] [--email A] [--mid ID] [--id LC-XXXX]
  sign    --key FILE                           подписать integrity.json (защита от правки файлов)
  policy  --key FILE [--mode trial] [--days 14] [--integrity warn] [--no-bind]
                                               записать license-policy.json и подписать её
  verify  --token LC1.… [--pub public.pem]     проверить ключ
  machine                                      показать ID этого компьютера
  status                                       состояние лицензии в этой установке

  --app DIR   папка приложения (по умолчанию — эта)
  Закрытый ключ также можно задать в LOCALCODE_LICENSE_KEY.
`);
}
