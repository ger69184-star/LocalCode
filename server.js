#!/usr/bin/env node
// LocalCode — локальный ИИ-редактор кода. Без зависимостей, нужен только Node.js 18+.
// Запуск: node server.js [папка] [--open] [--port 3000]
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const zlib = require('zlib');
const net = require('net');
const dns = require('dns').promises;
const { exec, execFile, spawn } = require('child_process');
const hwlib = require('./hw');
const integrity = require('./integrity');

// Язык сообщений сервера: берётся из заголовка x-lang (по умолчанию — язык системы)
let SLANG = /^ru/i.test(Intl.DateTimeFormat().resolvedOptions().locale || '') ? 'ru' : 'en';
const T = (ru, en) => (SLANG === 'en' ? en : ru);

const argv = process.argv.slice(2);
const optVal = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const positional = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--port');
const BASE_PORT = Number(optVal('--port') || process.env.PORT || 3000);
let PORT = BASE_PORT;
const HOST = '127.0.0.1';
const TOKEN = crypto.randomBytes(16).toString('hex');
let VERSION = '0'; try { VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version; } catch {}
const log = (...a) => console.error(new Date().toISOString().replace('T', ' ').slice(0, 19), ...a);   // stderr уходит в localcode.log
process.on('uncaughtException', (e) => log('uncaughtException:', e && e.stack || e));
process.on('unhandledRejection', (e) => log('unhandledRejection:', e && e.stack || e));
const IGNORE = new Set(['node_modules', '.git', '__pycache__', '.venv', 'venv', 'dist', 'build', '.next', '.DS_Store', '.idea', '.vscode']);

/* ---------- конфиг пользователя (~/.localcode/config.json) ---------- */
/* Портативный режим: настройки рядом с программой (удобно на флешке).
   Включается флагом --portable, переменной LOCALCODE_PORTABLE=1 или файлом portable.txt рядом с server.js. */
const PORTABLE = argv.includes('--portable') || process.env.LOCALCODE_PORTABLE === '1' || fs.existsSync(path.join(__dirname, 'portable.txt'));
const CFG_DIR = process.env.LOCALCODE_CONFIG_DIR ? path.resolve(process.env.LOCALCODE_CONFIG_DIR)
  : PORTABLE ? path.join(__dirname, 'data') : path.join(os.homedir(), '.localcode');
const CFG_FILE = path.join(CFG_DIR, 'config.json');
let conf = {};
/* Папка настроек доступна только владельцу: там лежат история проектов, профиль браузера и модели речи. */
const secureDir = (dir) => { try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); if (process.platform !== 'win32') fs.chmodSync(dir, 0o700); } catch {} };
const secureFile = (file) => { if (process.platform !== 'win32') { try { fs.chmodSync(file, 0o600); } catch {} } };
secureDir(CFG_DIR);
try {
  conf = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8'));
  if (!conf || typeof conf !== 'object' || Array.isArray(conf)) conf = {};
  conf.recent = (Array.isArray(conf.recent) ? conf.recent : []).filter(x => typeof x === 'string' && x.length > 0 && x.length < 4096).slice(0, 8);
  if (!conf.defaults || typeof conf.defaults !== 'object' || Array.isArray(conf.defaults)) delete conf.defaults;
  secureFile(CFG_FILE);
} catch { conf = {}; }
const saveConf = () => {
  const tmp = CFG_FILE + '.' + process.pid + '.tmp';
  try {
    secureDir(CFG_DIR);
    fs.writeFileSync(tmp, JSON.stringify(conf, null, 2), { mode: 0o600 });
    secureFile(tmp);
    fs.renameSync(tmp, CFG_FILE);   // атомарная запись: файл не останется «полузаписанным»
  } catch { try { fs.unlinkSync(tmp); } catch {} }
};

/* ---------- подлинность сборки (официальная подпись, см. integrity.js и INTEGRITY.md) ---------- */
const buildStatus = () => integrity.status(__dirname);
const BUILD0 = buildStatus();
if (BUILD0.state === 'modified' || BUILD0.state === 'tampered') {
  log('integrity: сборка отличается от подписанной', (BUILD0.files || []).join(', '), '— если вы не меняли код, скачайте программу заново с официального источника');
}
/* Предупреждения о типичных вирусных приёмах в коде — не блокируют работу. */
const warnList = (text) => integrity.scanSuspicious(text).map(w => ({
  id: w.id,
  text: T(w.ru, w.en) + ' ' + T('(строка ' + w.line + ')', '(line ' + w.line + ')'),
}));
const warnText = (ws) => ws.length ? T('ВНИМАНИЕ: в коде есть опасные конструкции — ', 'WARNING: the code contains dangerous patterns — ') + ws.map(w => w.text).join('; ') + T('. Проверьте код перед запуском.', '. Review the code before running it.') : '';

let ROOT;
function setRoot(p) {
  let dir = path.resolve(String(p || ''));
  if (isSystemDir(dir)) {                    // /etc, C:\Windows и т. п. папкой проекта быть не могут
    log('root rejected (system folder):', dir);
    dir = path.join(os.homedir(), 'LocalCodeProjects');
  }
  ROOT = dir;
  fs.mkdirSync(ROOT, { recursive: true });
  conf.recent = [ROOT, ...(conf.recent || []).filter(x => x !== ROOT)].slice(0, 8);
  saveConf();
}

/* ---------- файловые операции ---------- */
const firstDir = (names, fb) => names.map(n => path.join(os.homedir(), ...n)).find(d => fs.existsSync(d)) || path.join(os.homedir(), fb);
const docDir = () => firstDir([['Documents'], ['OneDrive', 'Documents'], ['Документы']], 'Documents');
const dlDir = () => firstDir([['Downloads'], ['Загрузки']], 'Downloads');
function expandHome(x) {
  x = String(x).trim();
  const dm = x.match(/^~[\\/](Desktop|Рабочий стол|Documents|Документы|Downloads|Загрузки)(?:[\\/](.*))?$/i);
  if (dm) { const k = dm[1].toLowerCase(); return path.join(/desktop|стол/.test(k) ? deskDir() : /doc|докум/.test(k) ? docDir() : dlDir(), dm[2] || ''); }
  return x.replace(/^~(?=$|[\\/])/, os.homedir());
}
// Системные и секретные папки: инструменты агента не имеют к ним доступа даже при работе в домашней папке.
const PROTECTED = /[\\/](windows|program files( \(x86\))?|programdata|system32|syswow64|\.ssh|\.gnupg|\.aws|\.azure|\.kube|\.docker|\.config|\.localcode|appdata|library[\\/]keychains|\.password-store|\.mozilla|\.thunderbird)([\\/]|$)/i;
const deskDir = () => [['Desktop'], ['OneDrive', 'Desktop'], ['Рабочий стол'], ['OneDrive', 'Рабочий стол']].map(a => path.join(os.homedir(), ...a)).find(d => fs.existsSync(d)) || path.join(os.homedir(), 'Desktop');
const inside = (full, base) => { const a = process.platform === 'win32' ? full.toLowerCase() : full, b = process.platform === 'win32' ? base.toLowerCase() : base; return a === b || a.startsWith(b + path.sep); };
const OUTSIDE = () => new Error(T('Путь вне разрешённой папки', 'Path is outside the allowed folder'));
const OUTSIDE_HOME = () => new Error(T('Путь вне домашней папки', 'Path is outside the home folder'));
const PROTECTED_ERR = () => new Error(T('Эта системная папка защищена', 'This system folder is protected'));
const SYSTEM_DIR = /^(?:\/(?:etc|usr|bin|sbin|lib|lib32|lib64|libx32|boot|dev|proc|sys|root|private|system|library|cores|var\/lib)(?:\/|$)|[a-z]:[\\/](?:windows|program files(?: \(x86\))?|programdata)(?:[\\/]|$))/i;
const PROTECTED_NAME = /^(windows|program files( \(x86\))?|programdata|system32|syswow64|\.ssh|\.gnupg|\.aws|\.azure|\.kube|\.docker|\.config|\.localcode|appdata|keychains|\.password-store|\.mozilla|\.thunderbird)$/i;
const SENSITIVE_DIR = /[\\/](\.ssh|\.gnupg|\.aws|\.azure|\.kube|\.docker|\.localcode|\.config|library[\\/]keychains|\.password-store|\.mozilla|\.thunderbird)([\\/]|$)/i;
function isSystemDir(dir) {
  const d = path.resolve(String(dir || ''));
  if (d === path.parse(d).root) return true;                       // корень диска или /
  if (d === os.homedir() || d === path.dirname(os.homedir())) return true;
  if (PROTECTED_NAME.test(path.basename(d))) return true;          // сама защищённая папка (AppData, .ssh…)
  if (SENSITIVE_DIR.test(d + path.sep)) return true;               // и всё внутри секретных папок
  return SYSTEM_DIR.test(d + path.sep);                            // системные каталоги и всё внутри них
}
/* Папка проекта: аргумент командной строки, последний проект или ~/LocalCodeProjects. */
const lastProject = (conf.recent || []).find(p => typeof p === 'string' && fs.existsSync(p) && !isSystemDir(p));
setRoot(positional[0] || lastProject || path.join(os.homedir(), 'LocalCodeProjects'));
const ABS_ERR = () => new Error(T('Абсолютные пути вне проекта не поддерживаются. Укажите путь внутри проекта, ~/Desktop/имя, ~/Documents/имя или ~/Downloads/имя', 'Absolute paths outside the project are not supported. Use a path inside the project, ~/Desktop/name, ~/Documents/name or ~/Downloads/name'));
const SYMLINK_ERR = () => new Error(T('Символическая ссылка ведёт за пределы разрешённой папки', 'A symbolic link points outside the allowed folder'));

/* Настоящий путь без символических ссылок. Проверяем ближайшего существующего предка:
   так блокируется и ссылка на папку, и запись нового файла через ссылку. */
const realOf = (p) => { try { return (fs.realpathSync.native || fs.realpathSync)(p); } catch { return null; } };
function canonicalPath(full) {
  let probe = path.resolve(full), rest = '';
  for (let i = 0; i < 64 && !fs.existsSync(probe); i++) {
    const parent = path.dirname(probe); if (parent === probe) break;
    rest = rest ? path.join(path.basename(probe), rest) : path.basename(probe);
    probe = parent;
  }
  const rp = realOf(probe); if (!rp) return null;
  return rest ? path.join(rp, rest) : rp;
}
function realInside(full, base) {
  const rb = realOf(path.resolve(base)), t = canonicalPath(full);
  return !!(rb && t && inside(t, rb));
}
/* Файлы с ключами и паролями: агент их не читает и не меняет (пользователь может открыть их в редакторе сам). */
const SECRET_BASE = /^(\.env|\.env\.(local|development|dev|production|prod|test|staging)|\.netrc|\.git-credentials|\.npmrc|\.pypirc|credentials\.json|secrets?\.(json|ya?ml|txt)|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?)$/i;
const SECRET_EXT = /\.(pem|key|p12|pfx|keystore|jks|asc|gpg)$/i;
function isSecretFile(full) {
  const s = String(full || ''), base = path.basename(s);
  if (SECRET_BASE.test(base) || SECRET_EXT.test(base)) return true;
  // .git/config может содержать токен в адресе удалённого репозитория
  return /[\\/]\.git[\\/](config|credentials|hooks)([\\/]|$)/i.test(s);
}
const SECRET_ERR = () => new Error(T('Это файл с секретами (ключи, пароли). Агент к таким файлам не допускается — откройте его вручную в редакторе.', 'This file contains secrets (keys, passwords). The agent may not touch such files — open it manually in the editor.'));
const assertNotSecret = (full, allowHome) => {
  if (!allowHome) return;
  if (isSecretFile(full) || isSecretFile(canonicalPath(full) || '')) throw SECRET_ERR();
};
function safe(p, allowHome = false) {
  if (allowHome && p) {
    let x = String(p).trim();
    x = expandHome(x);
    if (path.isAbsolute(x)) {
      const full = path.resolve(x);
      if (PROTECTED.test(full + path.sep) && !inside(full, ROOT)) throw PROTECTED_ERR();
      const base = inside(full, ROOT) ? ROOT : os.homedir();
      if (!inside(full, os.homedir()) && !inside(full, ROOT)) throw OUTSIDE_HOME();
      if (!realInside(full, base)) throw SYMLINK_ERR();
      const canon = canonicalPath(full);
      if (canon && PROTECTED.test(canon + path.sep) && !inside(canon, ROOT)) throw PROTECTED_ERR();
      return full;
    }
  }
  if (p && path.isAbsolute(String(p))) {   // абсолютный путь допустим только внутри проекта; иначе понятная ошибка вместо тихой подмены
    const abs = path.resolve(String(p));
    if (!inside(abs, ROOT)) throw ABS_ERR();
    if (!realInside(abs, ROOT)) throw SYMLINK_ERR();
    return abs;
  }
  const full = path.resolve(ROOT, '.' + path.sep + (p || ''));
  if (full !== ROOT && !inside(full, ROOT)) throw OUTSIDE();
  if (!realInside(full, ROOT)) throw SYMLINK_ERR();
  return full;
}
const rel = (f) => { const r = path.relative(ROOT, f); return (r.startsWith('..') || path.isAbsolute(r)) ? f : r.split(path.sep).join('/'); };

/* ---------- история правок: файл можно вернуть к состоянию до изменения ---------- */
const HIST_DIR = path.join(CFG_DIR, 'history');
const HIST_MAX = 300, HIST_MAX_BYTES = 512 * 1024;
function histSnapshot(full, before) {
  try {
    if (before === undefined) return;
    if (typeof before === 'string' && Buffer.byteLength(before) > HIST_MAX_BYTES) return;
    const rp = rel(full);
    if (!rp || path.isAbsolute(rp) || rp.startsWith('..')) return;
    secureDir(HIST_DIR);
    const id = Date.now().toString(36) + '-' + crypto.randomBytes(4).toString('hex');
    const file = path.join(HIST_DIR, id + '.json');
    fs.writeFileSync(file, JSON.stringify({ id, ts: Date.now(), path: rp, before }), { mode: 0o600 });
    secureFile(file);
    const all = fs.readdirSync(HIST_DIR).filter(f => f.endsWith('.json')).sort();
    for (const f of all.slice(0, Math.max(0, all.length - HIST_MAX))) { try { fs.unlinkSync(path.join(HIST_DIR, f)); } catch {} }
  } catch {}
}
function histList(filterPath, limit = 50) {
  let names = [];
  try { names = fs.readdirSync(HIST_DIR).filter(f => f.endsWith('.json')).sort().reverse(); } catch { return []; }
  const out = [];
  for (const n of names) {
    if (out.length >= Math.min(200, Math.max(1, Number(limit) || 50))) break;
    try {
      const j = JSON.parse(fs.readFileSync(path.join(HIST_DIR, n), 'utf8'));
      if (!j || !j.id) continue;
      if (filterPath && j.path !== filterPath) continue;
      out.push({ id: j.id, path: j.path, ts: j.ts, created: j.before === null, size: typeof j.before === 'string' ? j.before.length : 0 });
    } catch {}
  }
  return out;
}
function histRestore(id) {
  if (!/^[a-z0-9-]{5,40}$/i.test(String(id || ''))) throw new Error(T('Неверный идентификатор записи', 'Invalid history entry id'));
  let rec; try { rec = JSON.parse(fs.readFileSync(path.join(HIST_DIR, id + '.json'), 'utf8')); } catch { throw new Error(T('Запись не найдена', 'History entry not found')); }
  let full; try { full = safe(rec.path); } catch { throw new Error(T('Эта запись относится к другой папке проекта', 'This entry belongs to another project folder')); }
  const current = fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null;
  histSnapshot(full, current);                    // чтобы и сам возврат можно было отменить
  if (rec.before === null) { fs.rmSync(full, { force: true }); invalidateFiles(); return { path: rec.path, deleted: true }; }
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, rec.before, 'utf8');
  invalidateFiles();
  return { path: rec.path, restored: true };
}

function listDir(p, allowHome = false) {
  const dir = safe(p, allowHome);
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => !IGNORE.has(e.name) && !(allowHome && isSecretFile(path.join(dir, e.name))))
    .map(e => ({ name: e.name, path: rel(path.join(dir, e.name)), dir: e.isDirectory() }))
    .sort((a, b) => b.dir - a.dir || a.name.localeCompare(b.name))
    .slice(0, 5000);      // предохранитель от папок с сотнями тысяч файлов
}
const MAX_WALK_DEPTH = 24;   // защита от «бесконечных» и очень глубоких деревьев
function allFiles(limit = 6000) {
  const out = [];
  (function walk(dir, depth) {
    if (depth > MAX_WALK_DEPTH) return;
    let list; try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      if (out.length >= limit) return;
      if (IGNORE.has(e.name)) continue;
      if (e.isSymbolicLink()) continue;              // по ссылкам не ходим: они могут вести за пределы проекта
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1); else out.push(rel(full));
    }
  })(ROOT, 0);
  return out;
}
/* Список файлов нужен интерфейсу после каждой правки; дерево на 6000 файлов незачем обходить каждый раз. */
let filesCache = { root: null, at: 0, list: null };
function cachedAllFiles() {
  const now = Date.now();
  if (filesCache.list && filesCache.root === ROOT && now - filesCache.at < 2000) return filesCache.list;
  filesCache = { root: ROOT, at: now, list: allFiles() };
  return filesCache.list;
}
const invalidateFiles = () => { filesCache.at = 0; };
function readFile(p, allowHome = false) {
  const f = safe(p, allowHome);
  assertNotSecret(f, allowHome);
  const st = fs.statSync(f);
  if (!st.isFile()) throw new Error(T('Это не файл', 'Not a file'));
  if (st.size > 2 * 1024 * 1024) throw new Error(T('Файл больше 2 МБ', 'File is larger than 2 MB'));
  const buf = fs.readFileSync(f);
  if (buf.includes(0)) throw new Error(T('Это двоичный файл — откройте его в программе по умолчанию', 'This is a binary file — open it in the default app'));
  return buf.toString('utf8');
}
function writeFile(p, content, allowHome = false) {
  const f = safe(p, allowHome);
  assertNotSecret(f, allowHome);
  if (Buffer.byteLength(String(content ?? ''), 'utf8') > 5 * 1024 * 1024) throw new Error(T('Файл больше 5 МБ — столько не сохраняем', 'The file is larger than 5 MB — too big to save'));
  let before = null, snap = null;
  try {
    if (fs.existsSync(f)) {
      const stt = fs.statSync(f);
      if (stt.size <= 2 * 1024 * 1024) { before = fs.readFileSync(f, 'utf8'); snap = before; }
      else snap = undefined;                        // слишком большой файл в историю не кладём: откат не должен его удалить
    }
  } catch {}
  histSnapshot(f, snap);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, content, 'utf8');
  invalidateFiles();
  return { before, warnings: warnList(content) };
}
function replaceInFile(p, oldStr, newStr, allowHome = false) {
  if (typeof oldStr !== 'string' || oldStr === '') throw new Error(T('old_str пустой: укажите фрагмент, который нужно заменить', 'old_str is empty: give the fragment to replace'));
  const f = safe(p, allowHome);
  assertNotSecret(f, allowHome);
  if (fs.statSync(f).size > 5 * 1024 * 1024) throw new Error(T('Файл больше 5 МБ — правка по частям не поддерживается', 'The file is larger than 5 MB — piecewise editing is not supported'));
  const text = fs.readFileSync(f, 'utf8');
  const count = text.split(oldStr).length - 1;
  if (count === 0) throw new Error(T('old_str не найден в файле', 'old_str not found in the file'));
  if (count > 1) throw new Error(T(`old_str встречается ${count} раз — добавьте контекст, чтобы он был уникальным`, `old_str occurs ${count} times — add more context to make it unique`));
  histSnapshot(f, text);                          // снимок только когда замена точно состоится
  fs.writeFileSync(f, text.replace(oldStr, () => newStr), 'utf8');
  invalidateFiles();
  return text;
}
// Применение diff-патча (unified diff): удобно, когда нужно изменить несколько мест файла за раз
function applyPatch(p, patch, allowHome = false) {
  const f = safe(p, allowHome); assertNotSecret(f, allowHome);
  if (fs.statSync(f).size > 5 * 1024 * 1024) throw new Error(T('Файл больше 5 МБ — патч не поддерживается', 'The file is larger than 5 MB — patches are not supported'));
  const text = fs.readFileSync(f, 'utf8'), eol = text.includes('\r\n') ? '\r\n' : '\n';
  const src = String(patch || '').replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n'), hunks = []; let cur = null;
  for (const l of src) {
    if (/^@@/.test(l)) { const m = l.match(/^@@ -(\d+)/); cur = { old: [], neu: [], at: m ? +m[1] - 1 : 0 }; hunks.push(cur); continue; }
    if (!cur) continue;
    if (l.startsWith('+')) cur.neu.push(l.slice(1));
    else if (l.startsWith('-')) cur.old.push(l.slice(1));
    else if (l.startsWith('\\')) continue;
    else { const c = l.startsWith(' ') ? l.slice(1) : l; cur.old.push(c); cur.neu.push(c); }
  }
  if (!hunks.length) throw new Error(T('В патче нет блоков @@', 'The patch has no @@ hunks'));
  const lines = text.split(/\r?\n/); let from = 0;
  const eq = (a, b) => a === b || a.trimEnd() === b.trimEnd();
  const find = (old, start) => { for (let i = start; i + old.length <= lines.length; i++) { let ok = true; for (let k = 0; k < old.length; k++) if (!eq(lines[i + k], old[k])) { ok = false; break; } if (ok) return i; } return -1; };
  hunks.forEach((h, n) => {
    let at;
    if (!h.old.length) at = Math.min(Math.max(h.at, from), lines.length);
    else { at = find(h.old, Math.min(from, lines.length)); if (at < 0) at = find(h.old, 0); }
    if (at < 0) throw new Error(T(`Блок ${n + 1} патча не найден в файле: контекст не совпадает`, `Hunk ${n + 1} was not found in the file: context does not match`));
    lines.splice(at, h.old.length, ...h.neu); from = at + h.neu.length;
  });
  histSnapshot(f, text);                          // снимок только когда все блоки патча совпали
  fs.writeFileSync(f, lines.join(eol), 'utf8');
  invalidateFiles();
  return text;
}
function lineMatcher(query, regex) {
  if (regex) {
    if (String(query).length > 200) throw new Error(T('Слишком длинное регулярное выражение (максимум 200 символов)', 'Regular expression is too long (200 characters max)'));
    try { const re = new RegExp(query, 'i'); return (l) => re.test(l); } catch (e) { throw new Error(T('Неверное регулярное выражение: ', 'Invalid regular expression: ') + e.message); }
  }
  const q = query.toLowerCase(); return (l) => l.toLowerCase().includes(q);
}
// Простая поддержка .gitignore: имена, маски *.ext, каталоги/
function gitignoreFilter() {
  let rules = []; try {
    const gi = path.join(ROOT, '.gitignore');
    if (fs.lstatSync(gi).isFile()) rules = fs.readFileSync(gi, 'utf8').split(/\r?\n/).map(x => x.trim()).filter(x => x && !x.startsWith('#') && !x.startsWith('!'));
  } catch {}
  const res = rules.map(r => {
    const dirOnly = r.endsWith('/'), a = r.replace(/^\//, '').replace(/\/$/, '');
    const body = a.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0001').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0001/g, '.*');
    return new RegExp('(^|/)' + body + (dirOnly ? '/' : '(/|$)'));
  });
  return (relPath, isDir) => res.some(re => re.test(isDir ? relPath + '/' : relPath));
}
function search(query, p, regex, allowHome = false) {
  if (!query || !String(query).trim()) throw new Error(T('Пустой запрос поиска', 'Empty search query'));
  if (String(query).length > 500) throw new Error(T('Слишком длинный запрос поиска (максимум 500 символов)', 'Search query is too long (500 characters max)'));
  const out = [], test = lineMatcher(String(query), regex), ignored = gitignoreFilter();
  (function walk(dir, depth) {
    if (depth > MAX_WALK_DEPTH) return;
    let list; try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      if (out.length >= 200) return;
      if (IGNORE.has(e.name)) continue;
      if (e.isSymbolicLink()) continue;                // не идём по ссылкам: они могут вести за пределы проекта
      const full = path.join(dir, e.name), r = rel(full);
      if (ignored(r, e.isDirectory())) continue;
      if (allowHome && isSecretFile(full)) continue;   // секреты не попадают в результаты поиска агента
      if (e.isDirectory()) { walk(full, depth + 1); continue; }
      try {
        if (fs.statSync(full).size > 1024 * 1024) continue;
        const text = fs.readFileSync(full, 'utf8');
        if (text.includes('\0')) continue;                      // двоичные файлы не ищем
        text.split('\n').forEach((line, i) => { if (out.length < 200 && test(line)) out.push(`${r}:${i + 1}: ${line.trim().slice(0, 200)}`); });
      } catch {}
    }
  })(safe(p || '', allowHome), 0);
  return out.join('\n') || T('Ничего не найдено', 'Nothing found');
}
// Поиск в интернете (по желанию: включается в настройках) и чтение страниц. Через DuckDuckGo HTML, без ключей.
const decodeHtml = (t) => String(t).replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
function parseDdg(html) {
  const out = [], re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g; let m;
  while ((m = re.exec(html)) && out.length < 8) {
    let href = m[1].replace(/&amp;/g, '&'); const u = href.match(/[?&]uddg=([^&]+)/); if (u) { try { href = decodeURIComponent(u[1]); } catch {} }
    if (href.startsWith('//')) href = 'https:' + href;
    const rest = html.slice(re.lastIndex, re.lastIndex + 2500), sn = rest.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    out.push(`${out.length + 1}. ${decodeHtml(m[2])}\n   ${href}${sn ? '\n   ' + decodeHtml(sn[1]).slice(0, 300) : ''}`);
  }
  return out;
}
async function webSearch(q) {
  if (!q || !String(q).trim()) throw new Error(T('Пустой запрос', 'Empty query'));
  const r = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q), { headers: { 'User-Agent': 'Mozilla/5.0 (LocalCode)', 'Accept-Language': 'ru,en;q=0.8' }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const res = parseDdg((await readCapped(r, 2 * 1024 * 1024)).toString('utf8'));
  return res.length ? res.join('\n') : T('Ничего не найдено', 'Nothing found');
}
const PRIVATE_ERR = () => new Error(T('Адреса внутри вашего компьютера и сети закрыты', 'Local and private network addresses are blocked'));
const stripHost = (h) => String(h || '').trim().replace(/\.$/, '').replace(/^\[|\]$/g, '').toLowerCase();
function isPrivateIp(ip) {
  const s = stripHost(ip).replace(/%.*$/, '');
  if (net.isIPv4(s)) {
    const o = s.split('.').map(Number);
    if (o[0] === 0 || o[0] === 10 || o[0] === 127) return true;
    if (o[0] === 169 && o[1] === 254) return true;                       // link-local, облачные метаданные
    if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return true;
    if (o[0] === 192 && o[1] === 168) return true;
    if (o[0] === 100 && o[1] >= 64 && o[1] <= 127) return true;          // CGNAT
    if (o[0] === 192 && o[1] === 0 && o[2] === 0) return true;
    if (o[0] === 198 && (o[1] === 18 || o[1] === 19)) return true;       // тестовые сети
    return o[0] >= 224;                                                  // multicast и зарезервированные
  }
  if (net.isIPv6(s)) {
    if (s === '::' || s === '::1') return true;
    const m = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); if (m) return isPrivateIp(m[1]);
    const first = parseInt((s.split(':')[0] || '0') || '0', 16) || 0;
    if ((first & 0xfe00) === 0xfc00) return true;                        // fc00::/7 (уникальные локальные)
    if ((first & 0xffc0) === 0xfe80) return true;                        // fe80::/10 (link-local)
    if ((first & 0xff00) === 0xff00) return true;                        // multicast
    return false;
  }
  return false;
}
function isPrivateHost(h) {
  const s = stripHost(h);
  if (!s) return true;
  if (s === 'localhost' || s.endsWith('.localhost') || s.endsWith('.local') || s.endsWith('.internal') || s === 'metadata' || s === 'metadata.google.internal' || s === 'instance-data') return true;
  if (/^\d+$/.test(s) || /^0x[0-9a-f]+$/i.test(s)) return true;   // десятичный или hex-адрес вроде 2130706433
  if (net.isIP(s)) return isPrivateIp(s);
  return false;
}
/* Проверка ссылки перед запросом: протокол, адрес и все DNS-ответы. Локальная сеть недоступна. */
async function assertPublicUrl(u) {
  if (!/^https?:$/.test(u.protocol)) throw new Error(T('Разрешены только http и https', 'Only http and https are allowed'));
  const host = stripHost(u.hostname);
  if (isPrivateHost(host)) throw PRIVATE_ERR();
  if (net.isIP(host)) return;
  let addrs;
  try { addrs = await dns.lookup(host, { all: true, verbatim: true }); }
  catch { throw new Error(T('Адрес не найден: ', 'Address not found: ') + host); }
  if (!addrs.length || addrs.some(a => isPrivateIp(a.address))) throw PRIVATE_ERR();
}
/* Адрес сервера модели задаёт сам пользователь (в том числе Ollama на этом ПК), поэтому LAN разрешён,
   но облачные метаданные и link-local закрыты — иначе через настройки можно было бы увести токен облака. */
const isMetadataTarget = (host) => /^(169\.254\.169\.254|100\.100\.100\.200|metadata|metadata\.google\.internal|instance-data)$/i.test(host)
  || /^169\.254\./.test(host) || /^fe80:/i.test(host) || /^fd00:ec2/i.test(host);
async function assertProviderUrl(cfg) {
  const base = baseOf(cfg || {});
  let u; try { u = new URL(base); } catch { throw new Error(T('Неверный Base URL в настройках', 'Invalid Base URL in settings')); }
  if (!/^https?:$/.test(u.protocol)) throw new Error(T('Base URL должен начинаться с http:// или https://', 'Base URL must start with http:// or https://'));
  if (u.username || u.password) throw new Error(T('В Base URL не должно быть логина и пароля', 'Base URL must not contain a username or password'));
  if (isMetadataTarget(stripHost(u.hostname))) throw new Error(T('Этот адрес в настройках не разрешён', 'This address is not allowed in settings'));
}
function htmlToText(html) {
  const t = String(html).replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, ' ').replace(/<(br|p|div|li|h[1-6]|tr)[^>]*>/gi, '\n').replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;/g, ' ');
  return t.replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
const MAX_FETCH_BYTES = 1.5e6;
async function readCapped(resp, max) {
  if (!resp.body) return Buffer.alloc(0);
  const chunks = []; let size = 0;
  for await (const c of resp.body) {
    const buf = Buffer.from(c), left = max - size;
    if (left <= 0) break;
    chunks.push(buf.subarray(0, left)); size += Math.min(buf.length, left);
    if (size >= max) break;
  }
  try { await resp.body.cancel(); } catch {}
  return Buffer.concat(chunks, size);
}
async function fetchUrl(u) {
  let url; try { url = new URL(String(u)); } catch { throw new Error(T('Неверная ссылка', 'Invalid URL')); }
  for (let hop = 0; hop <= 5; hop++) {              // каждое перенаправление проверяем заново
    await assertPublicUrl(url);
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (LocalCode)' }, signal: AbortSignal.timeout(15000), redirect: 'manual' });
    if ([301, 302, 303, 307, 308].includes(r.status)) {
      const loc = r.headers.get('location');
      try { await r.body?.cancel(); } catch {}
      if (!loc) throw new Error('HTTP ' + r.status);
      try { url = new URL(loc, url); } catch { throw new Error(T('Неверная ссылка', 'Invalid URL')); }
      continue;
    }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const buf = await readCapped(r, MAX_FETCH_BYTES), text = buf.toString('utf8');
    const out = /html/i.test(r.headers.get('content-type') || '') ? htmlToText(text) : text;
    return out.slice(0, 12000) || T('Пустая страница', 'Empty page');
  }
  throw new Error(T('Слишком много перенаправлений', 'Too many redirects'));
}
const UTF_ENV = { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };
function wrapShell(command, ps) {
  if (process.platform !== 'win32') return command;
  return ps ? `[Console]::OutputEncoding=[Text.Encoding]::UTF8; ${command}` : `chcp 65001>nul & ${command}`;
}
function run(command, timeoutSec = 60, shell) {
  if (!command || !String(command).trim()) return Promise.reject(new Error(T('Пустая команда', 'Empty command')));
  const ps = process.platform === 'win32' && /^p(ower)?s/i.test(shell || '');
  const sec = Math.min(1800, Math.max(1, Number(timeoutSec) || 60));   // не больше 30 минут
  return new Promise((resolve) => {
    exec(wrapShell(command, ps), { cwd: ROOT, env: UTF_ENV, shell: ps ? 'powershell.exe' : undefined, timeout: sec * 1000, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        let text = (stdout || '') + (stderr ? '\n[stderr]\n' + stderr : '');
        if (err && err.killed) text += T('\n[процесс остановлен по таймауту]', '\n[process stopped: timeout]');
        else if (err) text += T(`\n[код выхода: ${err.code}]`, `\n[exit code: ${err.code}]`);
        if (text.length > 20000) text = text.slice(0, 10000) + T('\n…[обрезано]…\n', '\n…[truncated]…\n') + text.slice(-10000);
        resolve(text.trim() || T('(нет вывода)', '(no output)'));
      });
  });
}
/* ---------- открытие страниц и файлов в программе по умолчанию (музыка, видео, сайты, папки) ---------- */
const NO_OPEN_EXT = new Set(['.exe', '.bat', '.cmd', '.com', '.msi', '.ps1', '.psm1', '.vbs', '.vbe', '.js', '.mjs', '.cjs', '.jse', '.wsf', '.hta', '.scr', '.lnk', '.url', '.webloc', '.reg', '.dll', '.cpl', '.jar', '.sh', '.command', '.app', '.appimage', '.desktop', '.html', '.htm', '.xhtml', '.svg', '.scpt', '.appref-ms']);
function osOpen(arg) {
  const c = process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', arg]] : process.platform === 'darwin' ? ['open', [arg]] : ['xdg-open', [arg]];
  return new Promise((resolve, reject) => {
    const p = spawn(c[0], c[1], { detached: true, stdio: 'ignore', windowsHide: true });
    p.once('error', (e) => reject(new Error(T('Не удалось открыть: ', 'Cannot open: ') + e.message)));
    p.once('spawn', () => { p.unref(); resolve(); });
  });
}
async function openTarget(target) {
  target = String(target || '').trim();
  if (!target) throw new Error(T('Не указано, что открыть', 'Nothing to open'));
  if (/^ms-settings:[a-z0-9-]*$/i.test(target) && process.platform === 'win32') { await osOpen(target); return target; }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(target)) {
    let u; try { u = new URL(target); } catch { throw new Error(T('Неверная ссылка: ', 'Invalid link: ') + target); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error(T('Разрешены только ссылки http и https', 'Only http and https links are allowed'));
    await osOpen(u.href); return u.href;
  }
  const full = safe(target, true);      // только проект или домашняя папка, без системных каталогов
  if (fs.existsSync(full)) {
    if (!fs.statSync(full).isDirectory() && NO_OPEN_EXT.has(path.extname(full).toLowerCase()))
      throw new Error(T('Программы и скрипты этим инструментом не запускаются — используйте run_command (потребуется подтверждение).', 'Programs and scripts are not launched with this tool — use run_command (it asks for confirmation).'));
    await osOpen(full); return full;
  }
  if (/^(www\.[\w-]+(\.[\w-]+)+|[\w-]+(\.[\w-]+)*\.(com|org|net|ru|io|dev|app|ai|ua|by|kz|de|fr|uk|edu|gov|info|me|tv|fm|xyz|co|su|fi))(\/\S*)?$/i.test(target)) { const url = 'https://' + target; await osOpen(url); return url; }
  throw new Error(T('Не найден файл или папка: ', 'File or folder not found: ') + target);
}
// Поиск файла или папки по имени (регистр, пробелы и дефисы не важны): «local code» найдёт «LocalCode»
function findPaths(query, where) {
  const norm = (x) => String(x).toLowerCase().replace(/[\s_\-.]+/g, '');
  const q = norm(query); if (!q) return [];
  const home = os.homedir(), J = (...a) => path.join(home, ...a);
  const sets = { desk: [J('Desktop'), J('OneDrive', 'Desktop'), J('Рабочий стол'), J('OneDrive', 'Рабочий стол')], docs: [J('Documents'), J('Документы'), J('OneDrive', 'Documents')], dl: [J('Downloads'), J('Загрузки')] };
  const w = String(where || '').toLowerCase();
  const pick = /стол|desktop/.test(w) ? sets.desk : /документ|documents/.test(w) ? sets.docs : /загруз|download/.test(w) ? sets.dl : null;
  const run = (roots) => {
    const out = [], skip = new Set(['node_modules', '.git', 'appdata', '$recycle.bin', 'windows', 'program files', 'program files (x86)']);
    let seen = 0;
    const walk = (dir, depth) => {
      if (depth > 4 || seen > 30000 || out.length > 60) return;
      let items; try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of items) {
        seen++; const n = norm(e.name), full = path.join(dir, e.name);
        if (n.includes(q)) out.push({ path: full, dir: e.isDirectory(), score: n === q ? 0 : n.startsWith(q) ? 1 : 2, len: n.length });
        if (e.isDirectory() && !skip.has(e.name.toLowerCase()) && !e.name.startsWith('.')) walk(full, depth + 1);
      }
    };
    for (const r of roots) if (fs.existsSync(r)) walk(r, 0);
    return out;
  };
  let found = pick ? run(pick) : [];
  if (!found.length) found = run([...sets.desk, ...sets.docs, ...sets.dl, ROOT, home]);
  const uniq = new Map(); for (const f of found) if (!uniq.has(f.path)) uniq.set(f.path, f);
  return [...uniq.values()].sort((a, b) => a.score - b.score || a.len - b.len).slice(0, 12).map(f => ({ path: f.path, type: f.dir ? 'folder' : 'file' }));
}
function psRun(script, timeoutMs = 40000) {
  const full = '[Console]::OutputEncoding=[Text.Encoding]::UTF8;$ErrorActionPreference="Stop";' + script;
  return new Promise((resolve, reject) => execFile('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(full, 'utf16le').toString('base64')], { windowsHide: true, timeout: timeoutMs, maxBuffer: 4e6, encoding: 'utf8' },
    (e, so, se) => e ? reject(new Error((String(se || '').trim() || e.message).slice(-600))) : resolve(String(so).trim())));
}
const PS_RADIO = `Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
Function Await($t, $type) { $m = $asTask.MakeGenericMethod($type); $n = $m.Invoke($null, @($t)); $n.Wait(-1) | Out-Null; $n.Result }
[Windows.Devices.Radios.Radio,Windows.System.Devices,ContentType=WindowsRuntime] | Out-Null
[Windows.Devices.Radios.RadioAccessStatus,Windows.System.Devices,ContentType=WindowsRuntime] | Out-Null
Await ([Windows.Devices.Radios.Radio]::RequestAccessAsync()) ([Windows.Devices.Radios.RadioAccessStatus]) | Out-Null
$radios = Await ([Windows.Devices.Radios.Radio]::GetRadiosAsync()) ([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]])
$bt = $radios | Where-Object { $_.Kind -eq 'Bluetooth' } | Select-Object -First 1
if (-not $bt) { 'NO_BLUETOOTH'; exit }
`;
async function bluetooth(action) {
  if (process.platform !== 'win32') throw new Error(T('Управление Bluetooth из программы работает только в Windows', 'Bluetooth control works on Windows only'));
  const a = String(action || 'status').toLowerCase();
  if (a === 'settings' || a === 'connect' || a === 'pair') { await osOpen('ms-settings:bluetooth'); return T('Открыл настройки Bluetooth: выберите устройство в списке и нажмите «Подключить». Подтверждение сопряжения Windows просит у вас.', 'Opened Bluetooth settings: pick the device and press Connect. Windows asks you to confirm pairing.'); }
  if (a === 'devices' || a === 'list') return (await psRun(`Get-PnpDevice -Class Bluetooth -ErrorAction SilentlyContinue | Where-Object { $_.FriendlyName } | Select-Object Status,FriendlyName | Format-Table -AutoSize | Out-String -Width 200`)) || T('Устройств Bluetooth не найдено', 'No Bluetooth devices found');
  const st = a === 'on' ? 'On' : a === 'off' ? 'Off' : null;
  const out = await psRun(PS_RADIO + (st ? `Await ($bt.SetStateAsync('${st}')) ([Windows.Devices.Radios.RadioAccessStatus]) | Out-Null\n$bt = (Await ([Windows.Devices.Radios.Radio]::GetRadiosAsync()) ([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]])) | Where-Object { $_.Kind -eq 'Bluetooth' } | Select-Object -First 1\n` : '') + `$bt.State`);
  if (/NO_BLUETOOTH/.test(out)) return T('Bluetooth-адаптер не найден', 'No Bluetooth adapter found');
  return T('Bluetooth: ', 'Bluetooth: ') + (/On/i.test(out) ? T('включён', 'on') : T('выключен', 'off'));
}
function deleteToTrash(full) {
  const home = os.homedir();
  if (full === ROOT || full === home || full === deskDir() || path.dirname(full) === path.dirname(home)) throw new Error(T('Эту папку удалять нельзя', 'This folder cannot be deleted'));
  const st = fs.statSync(full);
  if (process.platform === 'win32') {
    const q = full.replace(/'/g, "''");
    return psRun(`Add-Type -AssemblyName Microsoft.VisualBasic; ` + (st.isDirectory() ? `[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory('${q}','OnlyErrorDialogs','SendToRecycleBin')` : `[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('${q}','OnlyErrorDialogs','SendToRecycleBin')`)).then(() => T('Перенесено в корзину: ', 'Moved to the Recycle Bin: ') + full);
  }
  fs.rmSync(full, { recursive: true, force: true }); return Promise.resolve(T('Удалено: ', 'Deleted: ') + full);
}
async function tool(name, a) {
  switch (name) {
    case 'make_dir': { const f = safe(a.path, true); fs.mkdirSync(f, { recursive: true }); return { result: T('Папка создана: ', 'Folder created: ') + f }; }
    case 'delete_path': { const f = safe(a.path, true); assertNotSecret(f, true); if (!fs.existsSync(f)) throw new Error(T('Не найдено: ', 'Not found: ') + f); return { result: await deleteToTrash(f) }; }
    case 'bluetooth': return { result: await bluetooth(a.action) };
    case 'find_path': { const r = findPaths(a.query, a.where); return { result: r.length ? JSON.stringify(r) : T('Ничего не найдено', 'Nothing found') }; }
    case 'list_dir': return { result: JSON.stringify(listDir(a.path || '', true)) };
    case 'read_file': return { result: readFile(a.path, true) };
    case 'write_file': { const w = writeFile(a.path, a.content, true); return { result: 'OK' + (w.warnings.length ? ' ' + warnText(w.warnings) : ''), before: w.before, warnings: w.warnings }; }
    case 'replace_in_file': { const before = replaceInFile(a.path, a.old_str, a.new_str, true); const warnings = warnList(fs.readFileSync(safe(a.path, true), 'utf8')); return { result: 'OK' + (warnings.length ? ' ' + warnText(warnings) : ''), before, warnings }; }
    case 'search': return { result: search(a.query, a.path, !!a.regex, true) };
    case 'apply_patch': { const before = applyPatch(a.path, a.patch, true); const warnings = warnList(fs.readFileSync(safe(a.path, true), 'utf8')); return { result: 'OK' + (warnings.length ? ' ' + warnText(warnings) : ''), before, warnings }; }
    case 'web_search': return { result: await webSearch(a.query) };
    case 'fetch_url': return { result: await fetchUrl(a.url) };
    case 'run_command': return { result: await run(a.command, a.timeout, a.shell) };
    case 'open': return { result: T('Открыто: ', 'Opened: ') + await openTarget(a.target) };
    default: throw new Error(T('Неизвестный инструмент: ', 'Unknown tool: ') + name);
  }
}
function fsop(b) {
  const { op, path: p, to } = b || {};
  if (!['mkdir', 'create', 'rename', 'delete'].includes(op)) throw new Error(T('Неизвестная операция', 'Unknown operation'));
  if (typeof p !== 'string' || !p.trim()) throw new Error(T('Не указан путь', 'Path is required'));
  const f = safe(p);
  if (op === 'rename' && (typeof to !== 'string' || !to.trim())) throw new Error(T('Не указан новый путь', 'New path is required'));
  if (op === 'mkdir') fs.mkdirSync(f, { recursive: true });
  else if (op === 'create') { fs.mkdirSync(path.dirname(f), { recursive: true }); if (fs.existsSync(f)) throw new Error(T('Уже существует', 'Already exists')); fs.writeFileSync(f, ''); }
  else if (op === 'rename') { const t = safe(to); if (fs.existsSync(t)) throw new Error(T('Уже существует', 'Already exists')); fs.mkdirSync(path.dirname(t), { recursive: true }); fs.renameSync(f, t); }
  else if (op === 'delete') { if (f === ROOT) throw new Error(T('Нельзя удалить корень', 'Cannot delete the project root')); fs.rmSync(f, { recursive: true, force: true }); }
  invalidateFiles();
  return 'OK';
}
/* ---------- замена по всему проекту ---------- */
function replaceAllInProject(query, replacement, opts = {}) {
  const q = String(query ?? ''), rep = String(replacement ?? '');
  if (!q.trim()) throw new Error(T('Пустой запрос', 'Empty query'));
  if (q.length > 500) throw new Error(T('Слишком длинный запрос (максимум 500 символов)', 'Query is too long (500 characters max)'));
  if (rep.length > 20000) throw new Error(T('Слишком длинная замена (максимум 20 000 символов)', 'Replacement is too long (20 000 characters max)'));
  const useRe = !!opts.regex, dry = opts.dry !== false;
  let re = null;
  if (useRe) {
    try { re = new RegExp(q, 'g'); } catch (e) { throw new Error(T('Неверное регулярное выражение: ', 'Invalid regular expression: ') + e.message); }
    if (new RegExp(q).test('')) throw new Error(T('Выражение совпадает с пустой строкой — уточните его', 'The expression matches an empty string — make it more specific'));
  }
  const MAX_MATCHES = 100000, MAX_RESULT = 5 * 1024 * 1024;
  const countMatches = (text) => {
    let n = 0;
    if (re) { re.lastIndex = 0; let m; while ((m = re.exec(text)) && n < MAX_MATCHES) { n++; if (!m[0].length) re.lastIndex++; } re.lastIndex = 0; }
    else { let i = 0; while (n < MAX_MATCHES) { const at = text.indexOf(q, i); if (at < 0) break; n++; i = at + q.length; } }
    return n;
  };
  const files = []; let total = 0, scanned = 0, partial = false, changed = 0;
  // Предпросмотр не должен читать весь проект: ограничиваем объём, для настоящей замены лимит выше.
  const budget = dry ? 8 * 1024 * 1024 : 300 * 1024 * 1024;
  const base = safe(opts.path || '');
  try {
  (function walk(dir, depth) {
    if (depth > MAX_WALK_DEPTH || files.length >= 300) return;
    let list; try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      if (files.length >= 300 || scanned > budget) { partial = partial || scanned > budget; return; }
      if (IGNORE.has(e.name) || e.isSymbolicLink()) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full, depth + 1); continue; }
      let text; try { const st = fs.statSync(full); if (!st.isFile() || st.size > 1024 * 1024) continue; scanned += st.size; text = fs.readFileSync(full, 'utf8'); } catch { continue; }
      if (text.includes('\0') || isSecretFile(full)) continue;
      let count = 0;
      try { count = countMatches(text); } catch { continue; }
      if (!count) continue;
      files.push({ path: rel(full), count }); total += count;
      if (!dry) {
        let out;
        try { out = useRe ? text.replace(re, () => rep) : text.split(q).join(rep); } catch { continue; }
        if (Buffer.byteLength(out) > MAX_RESULT) throw new Error(T('Результат замены слишком большой (больше 5 МБ) — уточните запрос', 'The replacement result is too large (over 5 MB) — narrow the query'));
        histSnapshot(full, text);
        fs.writeFileSync(full, out, 'utf8');
        changed++; invalidateFiles();
      }
    }
  })(base, 0);
  } catch (e) {
    if (changed) e.message += T(` (до ошибки изменено файлов: ${changed})`, ` (files changed before the error: ${changed})`);
    throw e;
  }
  return { dry, total, partial, filesCount: files.length, files };
}

/* ---------- ZIP без зависимостей: экспорт и импорт проекта ---------- */
const CRC_TABLE = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c; } return t; })();
function crc32(buf) { let c = ~0; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (~c) >>> 0; }
function dosStamp(d) {
  const dt = d instanceof Date ? d : new Date();
  return { time: (dt.getHours() << 11) | (dt.getMinutes() << 5) | (dt.getSeconds() >> 1), date: ((dt.getFullYear() - 1980) << 9) | ((dt.getMonth() + 1) << 5) | dt.getDate() };
}
function zipStore(entries) {
  const parts = [], central = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(String(e.name), 'utf8');
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(String(e.data ?? ''), 'utf8');
    const crc = crc32(data), { time, date } = dosStamp(e.mtime);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x800, 6); lh.writeUInt16LE(0, 8);
    lh.writeUInt16LE(time, 10); lh.writeUInt16LE(date, 12); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    parts.push(lh, name, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x800, 8); ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(time, 12); ch.writeUInt16LE(date, 14); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, eocd]);
}
function zipSafeName(name) {
  const n = String(name || '').replace(/\\/g, '/');
  if (!n || n.startsWith('/') || n.includes('\0') || /^[a-z]:/i.test(n) || n.length > 400) return null;
  if (n.split('/').some(seg => seg === '..' || seg === '' || seg === '.')) return null;
  return n;
}
function readZip(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new Error(T('Это не ZIP-архив', 'Not a ZIP archive'));
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error(T('Это не ZIP-архив', 'Not a ZIP archive'));
  const count = buf.readUInt16LE(end + 10), cdSize = buf.readUInt32LE(end + 12), cdOff = buf.readUInt32LE(end + 16);
  if (count > 5000) throw new Error(T('Слишком много файлов в архиве', 'Too many files in the archive'));
  if (cdOff + cdSize > buf.length || cdOff < 0) throw new Error(T('Архив повреждён', 'The archive is damaged'));
  const out = []; let p = cdOff, total = 0, declared = 0;
  const MAX_FILE = 25 * 1024 * 1024, MAX_TOTAL = 60 * 1024 * 1024;   // защита от «zip-бомбы»: маленький архив — гигабайты на диске
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error(T('Архив повреждён', 'The archive is damaged'));
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    declared += usize;
    if (usize > MAX_FILE || declared > MAX_TOTAL) throw new Error(T('Архив слишком большой после распаковки', 'The archive is too large once unpacked'));
    const nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), lo = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nl).toString('utf8');
    if (lo + 30 > buf.length) throw new Error(T('Архив повреждён', 'The archive is damaged'));
    const start = lo + 30 + buf.readUInt16LE(lo + 26) + buf.readUInt16LE(lo + 28);
    const raw = buf.slice(start, start + csize);
    let data;
    if (method === 0) data = raw;
    else if (method === 8) { try { data = zlib.inflateRawSync(raw); } catch { throw new Error(T('Не удалось распаковать файл: ', 'Cannot unpack file: ') + name); } }
    else throw new Error(T('Неподдерживаемый способ сжатия в архиве', 'Unsupported compression method in the archive'));
    total += data.length;
    if (total > MAX_TOTAL) throw new Error(T('Архив слишком большой', 'The archive is too large'));
    out.push({ name, data });
    p += 46 + nl + el + cl;
  }
  return out;
}
function extractZipInto(buf, dir) {
  const files = readZip(buf);
  let n = 0;
  for (const f of files) {
    const name = zipSafeName(f.name);
    if (!name) continue;
    const target = path.resolve(dir, name);
    if (target !== dir && !inside(target, dir)) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, f.data);
    n++;
  }
  return n;
}
function projectZipBytes() {
  const entries = []; let total = 0, stop = false;
  (function walk(dir, depth) {
    if (stop || depth > MAX_WALK_DEPTH) return;
    let list; try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      if (stop) return;
      if (IGNORE.has(e.name) || e.isSymbolicLink()) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full, depth + 1); continue; }
      try {
        const st = fs.statSync(full);
        if (!st.isFile() || st.size > 8 * 1024 * 1024 || isSecretFile(full)) continue;
        total += st.size;
        if (total > 25 * 1024 * 1024) { stop = true; return; }   // столько же, сколько принимает импорт
        entries.push({ name: rel(full), data: fs.readFileSync(full), mtime: st.mtime });
      } catch {}
    }
  })(ROOT, 0);
  if (stop) throw new Error(T('Проект больше 25 МБ — архив целиком не поместится. Скопируйте папку в проводнике.', 'The project is larger than 25 MB, too big for one archive. Copy the folder in your file manager instead.'));
  return zipStore(entries);
}
function importZip(data) {
  const files = readZip(data);
  let saved = 0, skipped = 0;
  for (const f of files) {
    const name = zipSafeName(f.name);
    if (!name) { skipped++; continue; }
    let target; try { target = safe(name); } catch { skipped++; continue; }
    if (isSecretFile(target)) { skipped++; continue; }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const isText = !f.data.includes(0) && f.data.length <= HIST_MAX_BYTES;
    histSnapshot(target, isText ? f.data.toString('utf8') : undefined);
    fs.writeFileSync(target, f.data);
    saved++;
  }
  if (saved) invalidateFiles();
  return { saved, skipped, total: files.length };
}

/* ---------- диагностика окружения и проверка обновлений ---------- */
async function envInfo() {
  const out = { version: VERSION, node: process.version, platform: process.platform, arch: process.arch, portable: PORTABLE, port: PORT, root: ROOT, cfgDir: CFG_DIR, uptime: Math.round(process.uptime()) };
  try { out.memory = { free: os.freemem(), total: os.totalmem() }; } catch {}
  try { const s = fs.statfsSync(ROOT); out.disk = { free: Number(s.bavail) * Number(s.bsize), total: Number(s.blocks) * Number(s.bsize) }; } catch {}
  out.git = await new Promise(res => execFile('git', ['--version'], { timeout: 2500, windowsHide: true }, (e, so) => res(e ? '' : String(so).trim())));
  try { const r = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(1500) }); out.ollama = r.ok; } catch { out.ollama = false; }
  return out;
}
function cmpVer(a, b) {
  const pa = String(a || '0').replace(/^v/i, '').split(/[.-]/).map(x => parseInt(x, 10) || 0);
  const pb = String(b || '0').replace(/^v/i, '').split(/[.-]/).map(x => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d > 0 ? 1 : -1; }
  return 0;
}
async function updateCheck() {
  const repo = 'ger69184-star/LocalCode', page = 'https://github.com/' + repo;
  const r = await fetch('https://api.github.com/repos/' + repo + '/releases/latest', {
    headers: { 'User-Agent': 'LocalCode/' + VERSION, Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(8000),
  });
  // 404 — либо репозиторий закрыт, либо релизов ещё нет: это не ошибка программы, просто сравнивать не с чем.
  if (r.status === 404) return { current: VERSION, latest: '', newer: false, url: page, notes: '', reason: 'no-releases' };
  if (!r.ok) throw new Error('GitHub: HTTP ' + r.status + (r.status === 403 ? T(' (слишком много запросов — попробуйте позже)', ' (rate limited — try again later)') : ''));
  const j = await r.json();
  const latest = String(j.tag_name || j.name || '').replace(/^v/i, '');
  return { current: VERSION, latest, newer: !!latest && cmpVer(latest, VERSION) > 0, url: String(j.html_url || page), notes: String(j.body || '').slice(0, 1500) };
}

function readRules() {
  for (const n of ['.localcode/rules.md', 'AGENTS.md', '.cursorrules', 'CLAUDE.md']) {
    const f = path.join(ROOT, n);
    try {
      if (!fs.lstatSync(f).isFile()) continue;        // символическую ссылку не читаем
      if (!realInside(f, ROOT)) continue;
      return fs.readFileSync(f, 'utf8').slice(0, 6000);
    } catch {}
  }
  return '';
}

/* ---------- системные диалоги ---------- */
function pickFolder() {
  return new Promise((res) => {
    const done = (e, out) => res(e ? null : (String(out).trim() || null));
    if (process.platform === 'win32') {
      const ps = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description='" + T('Выберите папку проекта', 'Select the project folder') + "'; if($d.ShowDialog() -eq 'OK'){$d.SelectedPath}";
      execFile('powershell', ['-NoProfile', '-STA', '-Command', ps], { windowsHide: true }, done);
    } else if (process.platform === 'darwin') execFile('osascript', ['-e', 'POSIX path of (choose folder)'], done);
    else execFile('zenity', ['--file-selection', '--directory'], (e, out) => e ? execFile('kdialog', ['--getexistingdirectory', os.homedir()], done) : done(null, out));
  });
}
let lastPing = Date.now();
function findAppBrowser() {
  const E = process.env, ex = (f) => { try { return fs.existsSync(f); } catch { return false; } };
  let list = [];
  if (process.platform === 'win32') {
    const bases = [E['ProgramFiles(x86)'], E.ProgramFiles, E.LOCALAPPDATA].filter(Boolean);
    const rel = ['Microsoft/Edge/Application/msedge.exe', 'Google/Chrome/Application/chrome.exe', 'Yandex/YandexBrowser/Application/browser.exe', 'BraveSoftware/Brave-Browser/Application/brave.exe', 'Chromium/Application/chrome.exe'];
    for (const r of rel) for (const b of bases) list.push(path.join(b, r));
  } else if (process.platform === 'darwin') {
    list = ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'];
  } else {
    list = ['/usr/bin/microsoft-edge', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'];
  }
  return list.find(ex) || null;
}
// Отдельное окно приложения (без вкладок и адресной строки). Закрыли окно — сервер сам завершается.
function openApp(url) {
  const bin = findAppBrowser();
  if (!bin) return openBrowser(url);
  const t0 = Date.now();
  try {
    const p = spawn(bin, ['--app=' + url, '--user-data-dir=' + path.join(CFG_DIR, 'app-profile'), '--window-size=1400,900', '--no-first-run', '--no-default-browser-check'], { stdio: 'ignore' });
    p.on('error', () => openBrowser(url));
    // Долго жил и закрылся — окно закрыли, выходим. Быстрый выход — браузер передал адрес уже работающему окну (второй запуск): сервер живёт, пока окно шлёт «пульс».
    p.on('exit', () => { if (Date.now() - t0 >= 4000) setTimeout(() => process.exit(0), 300); });
  } catch { openBrowser(url); }
  lastPing = Date.now();
  setInterval(() => { if (Date.now() - lastPing > 180000) { console.log('no window — exiting'); process.exit(0); } }, 15000).unref();
}
// Запускает Ollama в фоне (без окна), если она установлена, но не работает
async function ensureOllama() {
  try { if ((await fetch(OLLAMA + '/api/version', { signal: AbortSignal.timeout(1500) })).ok) return; } catch {}
  const cands = ['ollama'];
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) cands.unshift(path.join(process.env.LOCALAPPDATA, 'Programs', 'Ollama', 'ollama.exe'));
  if (process.platform === 'darwin') cands.push('/opt/homebrew/bin/ollama', '/usr/local/bin/ollama');
  for (const b of cands) {
    if (b !== 'ollama' && !fs.existsSync(b)) continue;
    try {
      const c = spawn(b, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, OLLAMA_NUM_PARALLEL: '1', OLLAMA_MAX_LOADED_MODELS: '1', OLLAMA_KEEP_ALIVE: '30m' } });
      c.on('error', () => {}); c.unref(); return;
    } catch {}
  }
}
function openBrowser(url) {
  const c = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(c[0], c[1], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref(); } catch {}
}

/* ---------- провайдеры ИИ ---------- */
const baseOf = (cfg) => String(cfg.baseUrl || '').replace(/\/+$/, '');
function authHeaders(cfg) {
  const h = { 'Content-Type': 'application/json' };
  if (cfg.kind === 'anthropic') { if (cfg.apiKey) h['x-api-key'] = cfg.apiKey; h['anthropic-version'] = '2023-06-01'; }
  else if (cfg.apiKey) h.Authorization = `${cfg.authPrefix || 'Bearer'} ${cfg.apiKey}`;
  return h;
}
/* ---------- автоключи: несколько ключей, при лимите или ошибке ключа — переключение на следующий ---------- */
class HttpError extends Error { constructor(msg, status, retryAfter) { super(msg); this.status = status; this.retryAfter = retryAfter || 0; } }
const keyState = new Map();   // ключ -> { uses, fails, until, reason }
const keyIdx = new Map();     // провайдер -> индекс текущего ключа (держимся за рабочий, пока он не откажет)
const mask = (k) => k.length > 10 ? k.slice(0, 4) + '…' + k.slice(-4) : '…';
const keyList = (cfg) => { const l = (Array.isArray(cfg.apiKeys) ? cfg.apiKeys : []).map(k => String(k).trim()).filter(Boolean); if (cfg.apiKey && String(cfg.apiKey).trim()) l.unshift(String(cfg.apiKey).trim()); return [...new Set(l)]; };
const stOf = (k) => { if (!keyState.has(k)) keyState.set(k, { uses: 0, fails: 0, until: 0, reason: '' }); return keyState.get(k); };
function classifyKeyError(e) {
  const s = e && e.status, msg = String((e && e.message) || '');
  if (s === 429) return { ms: Math.min(3600e3, Math.max(15000, (e.retryAfter || 60) * 1000)), reason: 'limit' };
  if (s === 402) return { ms: 6 * 3600e3, reason: 'balance' };
  if (s === 401 || s === 403) return { ms: 24 * 3600e3, reason: 'invalid' };
  if (s >= 400 && s < 500 && /quota|rate.?limit|insufficient|exceeded|resource.?exhausted/i.test(msg)) return { ms: 60000, reason: 'limit' };
  return null;   // это не вина ключа (сеть, 5xx, неверная модель) — не переключаем
}
async function withKeys(cfg, emit, fn) {
  const keys = keyList(cfg);
  if (keys.length <= 1 || isOllama(cfg)) return fn(keys.length ? { ...cfg, apiKey: keys[0] } : cfg);
  const sig = baseOf(cfg) + '|' + cfg.kind; let start = keyIdx.get(sig) || 0; if (start >= keys.length) start = 0;
  const order = keys.map((_, i) => (start + i) % keys.length), now = Date.now();
  const ready = order.filter(i => stOf(keys[i]).until <= now);
  let prev = null;
  for (const i of ready) {
    const k = keys[i], st = stOf(k);
    if (prev !== null) emit({ t: 'key', index: i + 1, total: keys.length, key: mask(k), from: prev.index, reason: prev.reason });
    try { const res = await fn({ ...cfg, apiKey: k }); st.uses++; keyIdx.set(sig, i); return res; }
    catch (e) {
      const c = classifyKeyError(e); if (!c) throw e;
      st.fails++; st.until = Date.now() + c.ms; st.reason = c.reason; prev = { index: i + 1, reason: c.reason };
      log('key', mask(k), 'paused:', c.reason, e.message && String(e.message).slice(0, 120));
    }
  }
  const soonest = Math.min(...keys.map(k => stOf(k).until)), wait = Math.max(1, Math.ceil((soonest - Date.now()) / 1000));
  throw new Error(T(`Все ключи (${keys.length}) сейчас недоступны (лимит, баланс или ошибка ключа). Ближайший освободится через ${wait < 90 ? wait + ' с' : Math.ceil(wait / 60) + ' мин'}. Добавьте ещё ключи в Настройках или подождите.`, `All ${keys.length} keys are unavailable right now (limit, balance or key error). The soonest frees up in ${wait < 90 ? wait + ' s' : Math.ceil(wait / 60) + ' min'}. Add more keys in Settings or wait.`));
}
async function httpErr(r) { return new HttpError(await errText(r), r.status, +r.headers.get('retry-after') || 0); }
async function testKeys(cfg) {
  await assertProviderUrl(cfg);
  const keys = keyList(cfg), out = [];
  for (const k of keys) {
    const st = stOf(k), left = Math.max(0, Math.ceil((st.until - Date.now()) / 1000));
    const row = { key: mask(k), uses: st.uses, fails: st.fails, pausedSec: left, reason: left ? st.reason : '' };
    try {
      const r = await fetch(baseOf(cfg) + '/models', { headers: authHeaders({ ...cfg, apiKey: k }), signal: AbortSignal.timeout(12000) });
      row.status = r.status; row.ok = r.ok ? true : (r.status === 404 ? null : false);
      if (!r.ok && r.status !== 404) row.msg = (await errText(r)).slice(0, 160);
    } catch (e) { row.ok = false; row.msg = e.name === 'TimeoutError' ? T('нет ответа', 'no response') : e.message; }
    out.push(row);
  }
  return out;
}
const resetKeys = () => { keyState.clear(); keyIdx.clear(); };
function statusHint(c) {
  if (c === 402) return T(' — на счёте провайдера нет денег. Пополните баланс или выберите бесплатного провайдера (Groq, Google Gemini).', ' — the provider account has no credit. Top up or pick a free provider (Groq, Google Gemini).');
  if (c === 401 || c === 403) return T(' — API-ключ неверный или не подходит этому провайдеру.', ' — the API key is wrong or does not belong to this provider.');
  if (c === 429) return T(' — слишком много запросов или исчерпан лимит. Подождите немного.', ' — too many requests or quota exhausted. Wait a bit.');
  return '';
}
async function errText(r) {
  const t = (await readCapped(r, 64 * 1024)).toString('utf8');
  try { const j = JSON.parse(t); return `HTTP ${r.status}: ` + (j.error?.message || j.error || j.message || t).toString().slice(0, 500) + statusHint(r.status); } catch { return `HTTP ${r.status}: ${t.slice(0, 500)}` + statusHint(r.status); }
}
function explain(e) {
  const c = e.cause || {}; const code = c.code || (c.errors && c.errors[0] && c.errors[0].code);
  if (code === 'ECONNREFUSED') return T('Не удаётся подключиться к серверу модели. Для Ollama: он запущен? (команда «ollama serve»)', 'Cannot connect to the model server. For Ollama: is it running? (command: ollama serve)');
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return T('Адрес не найден — проверьте Base URL и подключение к интернету.', 'Address not found — check the Base URL and your internet connection.');
  if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') return T('Таймаут подключения — сервис недоступен из вашей сети.', 'Connection timed out — the service is unreachable from your network.');
  if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS/i.test(String(code || '') + ' ' + String(e.message || '')))
    return T('Не удалось проверить сертификат защищённого соединения. Частая причина — VPN, антивирус или прокси; попробуйте отключить проверку HTTPS в антивирусе или другую сеть.', 'The TLS certificate could not be verified. A common cause is a VPN, antivirus or proxy; try disabling HTTPS scanning in the antivirus or use another network.');
  if (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET') return T('Соединение оборвалось — проверьте интернет и повторите.', 'The connection was reset — check the internet and try again.');
  return e.message || String(e);
}
async function* sseData(resp) {
  const dec = new TextDecoder(); let buf = '';
  for await (const chunk of resp.body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1);
      if (line.startsWith('data:')) yield line.slice(5).trim();
    }
  }
}
async function streamOpenAI(cfg, messages, tools, emit, signal, opts) {
  const body = { model: cfg.model, messages, temperature: opts.temperature ?? 0.2, stream: true };
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;
  if (opts.stop) body.stop = opts.stop;
  if (tools && tools.length) { body.tools = tools; body.tool_choice = 'auto'; }
  const r = await fetch(baseOf(cfg) + '/chat/completions', { method: 'POST', headers: authHeaders(cfg), body: JSON.stringify(body), signal });
  if (!r.ok) throw await httpErr(r);
  let content = ''; let calls = [];
  for await (const data of sseData(r)) {
    if (data === '[DONE]') break;
    let j; try { j = JSON.parse(data); } catch { continue; }
    const d = j.choices && j.choices[0] && j.choices[0].delta; if (!d) continue;
    if (d.content) { content += d.content; emit({ t: 'delta', v: d.content }); }
    for (const tc of d.tool_calls || []) {
      const i = tc.index ?? 0;
      calls[i] = calls[i] || { id: '', type: 'function', function: { name: '', arguments: '' } };
      if (tc.id) calls[i].id = tc.id;
      if (tc.function && tc.function.name) calls[i].function.name += tc.function.name;
      if (tc.function && tc.function.arguments) calls[i].function.arguments += tc.function.arguments;
    }
  }
  calls = calls.filter(Boolean); calls.forEach((c, i) => { if (!c.id) c.id = `call_${Date.now()}_${i}`; });
  return { role: 'assistant', content, ...(calls.length ? { tool_calls: calls } : {}) };
}
function toAnthropic(messages) {
  let system = ''; const out = [];
  const push = (role, blocks) => { const l = out[out.length - 1]; if (l && l.role === role) l.content.push(...blocks); else out.push({ role, content: blocks }); };
  for (const m of messages) {
    if (m.role === 'system') system += (system ? '\n\n' : '') + m.content;
    else if (m.role === 'user') push('user', [{ type: 'text', text: m.content || ' ' }]);
    else if (m.role === 'assistant') {
      const b = []; if (m.content) b.push({ type: 'text', text: m.content });
      for (const c of m.tool_calls || []) { let inp = {}; try { inp = JSON.parse(c.function.arguments || '{}'); } catch {} b.push({ type: 'tool_use', id: c.id, name: c.function.name, input: inp }); }
      if (b.length) push('assistant', b);
    } else if (m.role === 'tool') push('user', [{ type: 'tool_result', tool_use_id: m.tool_call_id, content: String(m.content) }]);
  }
  return { system, msgs: out };
}
async function streamAnthropic(cfg, messages, tools, emit, signal, opts) {
  const { system, msgs } = toAnthropic(messages);
  const body = { model: cfg.model, max_tokens: opts.maxTokens || 8192, messages: msgs, stream: true };
  if (system) body.system = system;
  if (opts.stop) body.stop_sequences = opts.stop;
  if (opts.temperature != null) body.temperature = opts.temperature;
  if (tools && tools.length) body.tools = tools.map(t => ({ name: t.function.name, description: t.function.description, input_schema: t.function.parameters }));
  const r = await fetch(baseOf(cfg) + '/messages', { method: 'POST', headers: authHeaders(cfg), body: JSON.stringify(body), signal });
  if (!r.ok) throw await httpErr(r);
  let content = ''; const blocks = {};
  for await (const data of sseData(r)) {
    let j; try { j = JSON.parse(data); } catch { continue; }
    if (j.type === 'content_block_start') blocks[j.index] = j.content_block.type === 'tool_use' ? { id: j.content_block.id, name: j.content_block.name, args: '' } : null;
    else if (j.type === 'content_block_delta') {
      if (j.delta.type === 'text_delta') { content += j.delta.text; emit({ t: 'delta', v: j.delta.text }); }
      else if (j.delta.type === 'input_json_delta' && blocks[j.index]) blocks[j.index].args += j.delta.partial_json;
    } else if (j.type === 'error') throw new Error(j.error && j.error.message || T('Ошибка API', 'API error'));
  }
  const calls = Object.values(blocks).filter(Boolean).map(b => ({ id: b.id, type: 'function', function: { name: b.name, arguments: b.args || '{}' } }));
  return { role: 'assistant', content, ...(calls.length ? { tool_calls: calls } : {}) };
}
// Ollama: /v1 не принимает num_ctx и молча обрезает длинный запрос (файл «пропадает»). Нативный /api/chat принимает.
const isOllama = (cfg) => cfg.kind !== 'anthropic' && /:11434\b/.test(cfg.baseUrl || '');
const jparse = (t) => { if (t && typeof t === 'object') return t; try { return JSON.parse(t || '{}'); } catch { return {}; } };
async function streamOllama(cfg, messages, tools, emit, signal, opts) {
  const origin = new URL(cfg.baseUrl).origin;
  const msgs = messages.map(m => {
    if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length) return { role: 'assistant', content: m.content || '', tool_calls: m.tool_calls.map(c => ({ function: { name: c.function.name, arguments: jparse(c.function.arguments) } })) };
    if (m.role === 'tool') return { role: 'tool', content: String(m.content ?? '') };
    return { role: m.role, content: m.content ?? '' };
  });
  const options = { num_ctx: opts.numCtx || 8192, temperature: opts.temperature ?? 0.2 };
  if (opts.maxTokens) options.num_predict = opts.maxTokens;
  if (opts.stop) options.stop = opts.stop;
  const body = { model: cfg.model, messages: msgs, stream: true, keep_alive: '30m', options };
  if (tools && tools.length) body.tools = tools;
  const r = await fetch(origin + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  if (!r.ok) throw new Error(await errText(r));
  let content = ''; const calls = [];
  for await (const o of ndjson(r)) {
    if (o.error) throw new Error(o.error);
    const m = o.message; if (!m) continue;
    if (m.content) { content += m.content; emit({ t: 'delta', v: m.content }); }
    for (const tc of m.tool_calls || []) calls.push({ id: `call_${Date.now()}_${calls.length}`, type: 'function', function: { name: tc.function.name, arguments: JSON.stringify(jparse(tc.function.arguments)) } });
  }
  return { role: 'assistant', content, ...(calls.length ? { tool_calls: calls } : {}) };
}
const streamer = (cfg) => cfg.kind === 'anthropic' ? streamAnthropic : isOllama(cfg) ? streamOllama : streamOpenAI;

async function handleChat(b, res) {
  const ac = new AbortController();
  res.on('close', () => ac.abort());
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache' });
  const emit = (o) => { if (!res.writableEnded) res.write(JSON.stringify(o) + '\n'); };
  try {
    if (!b || !b.cfg || !Array.isArray(b.messages)) throw new Error(T('Неверный запрос к модели', 'Invalid model request'));
    await assertProviderUrl(b.cfg);
    emit({ t: 'done', message: await withKeys(b.cfg, emit, (c) => streamer(c)(c, b.messages, b.tools, emit, ac.signal, b.opts || {})) });
  } catch (e) { emit({ t: 'error', v: e.name === 'AbortError' ? T('Остановлено', 'Stopped') : explain(e) }); }
  res.end();
}
const stripFence = (t) => String(t || '').replace(/^\s*```[^\n]*\n/, '').replace(/\n?```\s*$/, '');

async function complete(b) {
  const { cfg, prefix, suffix, path: p } = b || {};
  await assertProviderUrl(cfg);
  if (/:11434/.test(cfg.baseUrl || '')) {            // Ollama: настоящий fill-in-the-middle
    try {
      const r = await fetch(new URL(cfg.baseUrl).origin + '/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(20000),
        body: JSON.stringify({ model: cfg.model, prompt: prefix, suffix, stream: false, keep_alive: '30m', options: { num_predict: 80, temperature: 0.1, stop: ['\n\n\n'] } }) });
      if (r.ok) { const j = await r.json(); return stripFence(j.response); }
    } catch {}
  }
  const messages = [
    { role: 'system', content: 'You are a code autocompletion engine. Output ONLY the text to insert at the cursor position (up to 3 lines). No explanations, no markdown.' },
    { role: 'user', content: `File: ${p}\n<before>\n${prefix}\n</before>\n<after>\n${suffix}\n</after>\nContinue from the cursor.` }];
  const msg = await withKeys(cfg, () => {}, (c) => streamer(c)(c, messages, null, () => {}, undefined, { maxTokens: 100, temperature: 0.1 }));
  return stripFence(msg.content);
}
const listModels = (cfg) => withKeys(cfg, () => {}, listModelsOnce);
async function listModelsOnce(cfg) {
  await assertProviderUrl(cfg);
  const r = await fetch(baseOf(cfg) + '/models', { headers: authHeaders(cfg), signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw await httpErr(r);
  const j = await r.json();
  return (j.data || j.models || []).map(m => m.id || m.name).filter(Boolean);
}

/* ---------- каталог офлайн-моделей (Ollama) ---------- */
let MODELS = [];
try { MODELS = JSON.parse(fs.readFileSync(path.join(__dirname, 'models.json'), 'utf8')).models || []; } catch {}
const OLLAMA = process.env.OLLAMA_HOST_URL || 'http://127.0.0.1:11434';
let HW = null, hwPromise = null;
const hwFallback = () => ({ platform: process.platform, arch: process.arch, cpu: ((os.cpus() || [])[0] || {}).model || '?', threads: (os.cpus() || []).length || 1,
  ramGB: +(os.totalmem() / 2 ** 30).toFixed(1), gpus: [], vramGB: 0, appleSilicon: process.platform === 'darwin' && process.arch === 'arm64', avx: null });
/* Характеристики ПК считаются в отдельном процессе: nvidia-smi и PowerShell могут думать секундами. */
function hwDetect() {
  if (HW) return Promise.resolve(HW);
  if (hwPromise) return hwPromise;
  hwPromise = new Promise((resolve) => {
    execFile(process.execPath, ['-e', "process.stdout.write(JSON.stringify(require('./hw').detect()))"], { cwd: __dirname, timeout: 15000, windowsHide: true, encoding: 'utf8' },
      (e, out) => { if (!e) { try { HW = HW || JSON.parse(out); } catch {} } hwPromise = null; resolve(HW || hwFallback()); });
  });
  return hwPromise;
}
function warmHW() { if (!HW) hwDetect().catch(() => {}); }
async function installedModels() {
  try {
    const r = await fetch(OLLAMA + '/api/tags', { signal: AbortSignal.timeout(2000) });
    if (!r.ok) return null;
    return ((await r.json()).models || []).map(m => m.name);
  } catch { return null; }
}
async function catalog() {
  HW = await hwDetect();
  const inst = await installedModels();
  return { hw: HW, ollama: inst !== null, installed: inst || [], rec: hwlib.recommend(MODELS, HW),
    models: MODELS.map(m => ({ ...m, fit: hwlib.fit(m, HW) })) };
}
async function* ndjson(resp) {
  const dec = new TextDecoder(); let buf = '';
  for await (const chunk of resp.body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) { try { yield JSON.parse(line); } catch {} } }
  }
}
// Скачивает модель, затем создаёт «настроенную» localcode-<id> (контекст/длина ответа под ПК). Возвращает имя модели для чата.
async function pullModel(id, emit, signal) {
  const m = MODELS.find(x => x.id === id); if (!m) throw new Error(T('Неизвестная модель', 'Unknown model'));
  const tryPull = async (name) => {
    const ac = new AbortController(); let stalled = false, timer;
    const onAbort = () => ac.abort(); if (signal) signal.addEventListener('abort', onAbort);
    const arm = (ms) => { clearTimeout(timer); timer = setTimeout(() => { stalled = true; ac.abort(); }, ms); };
    arm(90000);
    try {
      const r = await fetch(OLLAMA + '/api/pull', { method: 'POST', body: JSON.stringify({ model: name, stream: true }), signal: ac.signal });
      if (!r.ok) throw new Error(await errText(r));
      let last = '';
      for await (const o of ndjson(r)) {
        if (o.error) throw new Error(o.error);
        const key = o.status + ':' + (o.completed || 0);
        if (key !== last) { last = key; arm(o.total ? 120000 : 90000); }
        emit({ t: 'progress', status: o.status, pct: o.total ? Math.round(100 * (o.completed || 0) / o.total) : null });
      }
    } catch (e) {
      if (stalled) throw new Error(T('Нет ответа от реестра моделей (проверьте интернет или включите VPN).', 'No response from the model registry (check your internet or enable a VPN).'));
      throw e;
    } finally { clearTimeout(timer); if (signal) signal.removeEventListener('abort', onAbort); }
  };
  let base = m.tag;
  try { await tryPull(base); }
  catch (e) { if (!m.hf || e.name === 'AbortError') throw e; emit({ t: 'progress', status: '@mirror', pct: null }); base = m.hf; await tryPull(base); }
  emit({ t: 'progress', status: '@tuning', pct: null });
  const name = 'localcode-' + m.id;
  try {
    const r = await fetch(OLLAMA + '/api/create', { method: 'POST', signal,
      body: JSON.stringify({ model: name, from: base, parameters: { num_ctx: m.ctx, num_predict: m.predict, temperature: 0.2 }, stream: false }) });
    if (r.ok) { await r.text(); return name; }
  } catch (e) { if (e.name === 'AbortError') throw e; }
  return base; // не вышло настроить — используем скачанную модель как есть
}
async function handlePull(b, res) {
  const ac = new AbortController();
  res.on('close', () => ac.abort());
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache' });
  const emit = (o) => { if (!res.writableEnded) res.write(JSON.stringify(o) + '\n'); };
  try { emit({ t: 'done', model: await pullModel(b.id, emit, ac.signal) }); }
  catch (e) { emit({ t: 'error', v: e.name === 'AbortError' ? T('Остановлено', 'Stopped') : explain(e) }); }
  res.end();
}

/* ---------- git (ветка и число изменённых файлов для статус-бара) ---------- */
const NO_HOOKS_DIR = path.join(CFG_DIR, 'no-git-hooks');
try { secureDir(NO_HOOKS_DIR); } catch {}
const GIT_SAFE = ['-c', 'core.fsmonitor=', '-c', 'core.pager=cat', '-c', 'core.hooksPath=' + NO_HOOKS_DIR, '-c', 'core.editor=true'];
function git(args) {
  return new Promise((res) => execFile('git', [...GIT_SAFE, ...args], {
    cwd: ROOT, timeout: 4000, windowsHide: true, maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_OPTIONAL_LOCKS: '0' },
  }, (e, out) => res(e ? null : String(out))));
}
let gitCache = { root: null, at: 0, val: null };
async function gitInfo() {
  if (gitCache.val && gitCache.root === ROOT && Date.now() - gitCache.at < 2000) return gitCache.val;
  const val = await gitInfoRaw();
  gitCache = { root: ROOT, at: Date.now(), val };
  return val;
}
async function gitInfoRaw() {
  let b = await git(['symbolic-ref', '--short', '-q', 'HEAD']);
  if (b === null) b = await git(['rev-parse', '--short', 'HEAD']);   // detached HEAD
  if (b === null) return { repo: false };
  const st = await git(['status', '--porcelain']);
  return { repo: true, branch: b.trim() || 'HEAD', changed: st ? st.split('\n').filter(Boolean).length : 0 };
}

/* ---------- офлайн-распознавание речи (whisper.cpp): скачивается один раз, дальше без интернета ---------- */
const STT_DIR = path.join(CFG_DIR, 'stt');
const STT_MODELS = { tiny: ['ggml-tiny-q5_1.bin', 'ggml-tiny.bin', 31], base: ['ggml-base-q5_1.bin', 'ggml-base.bin', 57], small: ['ggml-small-q5_1.bin', 'ggml-small.bin', 181] };
const HF_STT = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/';
function findFile(dir, names) {
  try { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); if (e.isDirectory()) { const r = findFile(f, names); if (r) return r; } else if (names.includes(e.name.toLowerCase())) return f; } } catch {}
  return null;
}
const sttBin = () => (process.env.WHISPER_CLI && fs.existsSync(process.env.WHISPER_CLI) ? process.env.WHISPER_CLI : (findFile(path.join(STT_DIR, 'bin'), ['whisper-cli.exe']) || findFile(path.join(STT_DIR, 'bin'), ['whisper-cli'])));
const sttModelFile = (size) => { const m = STT_MODELS[size] || STT_MODELS.base; for (const n of [m[0], m[1]]) { const f = path.join(STT_DIR, n); try { if (fs.statSync(f).size > 1e6) return f; } catch {} } return null; };
const sttStatus = () => ({ canInstall: process.platform === 'win32', bin: !!sttBin(), models: Object.fromEntries(Object.entries(STT_MODELS).map(([k, v]) => [k, { ready: !!sttModelFile(k), mb: v[2] }])) });
async function downloadTo(url, dest, onPct, signal) {
  await assertPublicUrl(new URL(url));
  const ac = new AbortController(); const onAbort = () => ac.abort(); if (signal) { if (signal.aborted) ac.abort(); else signal.addEventListener('abort', onAbort); }
  let t = setTimeout(() => ac.abort(), 30000), tmp = dest + '.part', out;
  try {
    const r = await fetch(url, { signal: ac.signal, headers: { 'User-Agent': 'LocalCode' } });
    if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
    const total = +r.headers.get('content-length') || 0; let got = 0; out = fs.createWriteStream(tmp);
    for await (const chunk of r.body) {
      clearTimeout(t); t = setTimeout(() => ac.abort(), 30000);
      if (!out.write(chunk)) await new Promise(res => out.once('drain', res));
      got += chunk.length; onPct && onPct(total ? Math.round(100 * got / total) : null);
    }
    await new Promise((res, rej) => out.end(e => e ? rej(e) : res()));
    fs.renameSync(tmp, dest);
  } catch (e) { if (out) out.destroy(); try { fs.unlinkSync(tmp); } catch {} throw (e.name === 'AbortError' && !(signal && signal.aborted) ? new Error(T('Нет ответа от сервера загрузки (проверьте интернет или VPN)', 'The download server is not responding (check internet or VPN)')) : e); }
  finally { clearTimeout(t); if (signal) signal.removeEventListener('abort', onAbort); }
}
async function sttInstall(size, emit, signal) {
  fs.mkdirSync(STT_DIR, { recursive: true });
  if (!sttBin()) {
    if (process.platform !== 'win32') throw new Error(T('Автоустановка есть только для Windows. Установите whisper.cpp сами и задайте переменную WHISPER_CLI.', 'Auto-install is Windows-only. Install whisper.cpp yourself and set WHISPER_CLI.'));
    let url = 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.2/whisper-bin-x64.zip';
    try {
      const r = await fetch('https://api.github.com/repos/ggml-org/whisper.cpp/releases/latest', { headers: { 'User-Agent': 'LocalCode', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(10000) });
      if (r.ok) { const a = ((await r.json()).assets || []).find(x => x.name === 'whisper-bin-x64.zip'); if (a) url = a.browser_download_url; }
    } catch {}
    const zip = path.join(STT_DIR, 'whisper-bin-x64.zip');
    await downloadTo(url, zip, pct => emit({ status: T('Скачиваю программу распознавания…', 'Downloading the recognizer…'), pct }), signal);
    emit({ status: T('Распаковываю…', 'Unpacking…'), pct: null });
    const binDir = path.join(STT_DIR, 'bin'); fs.rmSync(binDir, { recursive: true, force: true }); fs.mkdirSync(binDir, { recursive: true });
    extractZipInto(fs.readFileSync(zip), binDir);        // своя распаковка: пути из архива проверяются, за binDir выйти нельзя
    try { fs.unlinkSync(zip); } catch {}
    if (!sttBin()) throw new Error(T('В архиве не найден whisper-cli.exe', 'whisper-cli.exe was not found in the archive'));
  }
  if (!sttModelFile(size)) {
    const m = STT_MODELS[size] || STT_MODELS.base; let ok = false, last;
    for (const n of [m[0], m[1]]) {
      try { await downloadTo(HF_STT + n, path.join(STT_DIR, n), pct => emit({ status: T('Скачиваю модель речи…', 'Downloading the speech model…'), pct }), signal); ok = true; break; }
      catch (e) { if (signal && signal.aborted) throw e; last = e; }
    }
    if (!ok) throw last;
  }
}
const cleanStt = (t) => String(t).replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
let sttBusy = Promise.resolve();
function transcribe(wav, lang, size) {
  const job = async () => {
    const bin = sttBin(), model = sttModelFile(size);
    if (!bin || !model) throw new Error(T('Офлайн-распознавание речи не установлено', 'Offline speech recognition is not installed'));
    const f = path.join(os.tmpdir(), `lc-stt-${Date.now()}.wav`); fs.writeFileSync(f, wav);
    const args = ['-m', model, '-f', f, '-l', lang === 'en' ? 'en' : 'ru', '-nt', '-np', '-bs', '1', '-bo', '1', '-t', String(Math.max(1, Math.min(4, os.cpus().length)))];
    try {
      return cleanStt(await new Promise((res, rej) => execFile(bin, args, { cwd: path.dirname(bin), windowsHide: true, timeout: 120000, maxBuffer: 5e6, encoding: 'utf8' }, (e, so, se) => e ? rej(new Error((String(se || '').trim() || String(so || '').trim() || e.message).slice(-500))) : res(so))));
    } finally { try { fs.unlinkSync(f); } catch {} }
  };
  const p = sttBusy.then(job, job); sttBusy = p.catch(() => {}); return p;
}
function rawBody(req, limit = 40e6) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0, tooBig = false, done = false;
    const fail = (e) => { if (!done) { done = true; reject(e); } };
    req.on('data', c => { if (tooBig) return; size += c.length; if (size > limit) { tooBig = true; chunks.length = 0; } else chunks.push(c); });
    req.on('end', () => { if (done) return; if (tooBig) return fail(new HttpError(T('Слишком большая запись', 'Recording too large'), 413)); done = true; resolve(Buffer.concat(chunks)); });
    req.on('error', fail);
    req.on('aborted', () => fail(new HttpError(T('Запрос прерван', 'Request aborted'), 400)));
  });
}
async function handleSttInstall(b, res) {
  const ac = new AbortController(); res.on('close', () => ac.abort());
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache' });
  const emit = (o) => { if (!res.writableEnded) res.write(JSON.stringify(o) + '\n'); };
  try { await sttInstall(b.size || 'base', (o) => emit({ t: 'progress', ...o }), ac.signal); emit({ t: 'done' }); }
  catch (e) { emit({ t: 'error', v: e.name === 'AbortError' ? T('Остановлено', 'Stopped') : explain(e) }); }
  res.end();
}

/* ---------- терминал: потоковый вывод, ввод в запущенную программу, остановка ---------- */
const TERMS = new Map(); let termSeq = 0;
function killTree(child) {
  try { if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); else child.kill('SIGTERM'); } catch {}
}
function handleTermRun(b, res) {
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache' });
  let child = null, sent = 0, paused = false;
  const MAX_OUT = 20 * 1024 * 1024;   // больше 20 МБ в один терминал не отдаём
  const emit = (o) => {
    if (res.writableEnded || res.destroyed) return;
    const line = JSON.stringify(o) + '\n';
    sent += line.length;
    if (sent > MAX_OUT) {
      if (!res.writableEnded) res.write(JSON.stringify({ t: 'err', v: T('\n[остановлено: вывод больше 20 МБ]\n', '\n[stopped: output exceeded 20 MB]\n') }) + '\n');
      if (child) killTree(child);
      return;
    }
    /* Обратное давление: медленный клиент не заставит сервер копить гигабайты в памяти. */
    if (!res.write(line) && !paused) {
      paused = true;
      try { child && child.stdout.pause(); child && child.stderr.pause(); } catch {}
      res.once('drain', () => { paused = false; try { child && child.stdout.resume(); child && child.stderr.resume(); } catch {} });
    }
  };
  const win = process.platform === 'win32', ps = win && /^p(ower)?s/i.test(b.shell || '');
  const cwd = b.cwd && fs.existsSync(b.cwd) ? b.cwd : ROOT, cmd = String(b.command || '').trim();
  const cm = cmd.match(/^(?:cd|chdir|set-location)(?:\s+\/d)?(?:\s+(.*))?$/i);
  if (cm && !/[&|;]/.test(cmd)) {
    let t = (cm[1] || '').trim().replace(/^["']|["']$/g, ''); t = !t || t === '~' ? os.homedir() : t.replace(/^~(?=$|[\\/])/, os.homedir());
    const nd = path.resolve(cwd, t);
    if (fs.existsSync(nd) && fs.statSync(nd).isDirectory()) emit({ t: 'cwd', v: nd, code: 0 }); else emit({ t: 'err', v: T('Папка не найдена: ', 'Folder not found: ') + nd + '\n' });
    emit({ t: 'exit', code: 0 }); return res.end();
  }
  const full = wrapShell(cmd, ps);
  child = ps ? spawn('powershell.exe', ['-NoProfile', '-NoLogo', '-Command', full], { cwd, windowsHide: true, env: UTF_ENV }) : spawn(full, [], { cwd, shell: true, windowsHide: true, env: UTF_ENV });
  const id = ++termSeq; TERMS.set(id, child);
  emit({ t: 'start', id, cwd });
  for (const w of warnList(cmd)) emit({ t: 'warn', v: T('⚠ Опасная команда: ', '⚠ Dangerous command: ') + w.text + '\n' });
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', d => emit({ t: 'out', v: d })); child.stderr.on('data', d => emit({ t: 'err', v: d }));
  const timer = setTimeout(() => { emit({ t: 'err', v: T('\n[остановлено: прошло 30 минут]\n', '\n[stopped: 30 minutes passed]\n') }); killTree(child); }, 30 * 60 * 1000);
  child.on('error', e => emit({ t: 'err', v: e.message + '\n' }));
  child.on('close', code => { clearTimeout(timer); TERMS.delete(id); emit({ t: 'exit', code: code ?? -1 }); res.end(); });
  res.on('close', () => { if (TERMS.has(id)) { clearTimeout(timer); killTree(child); } });
}

/* ---------- HTTP ---------- */
/* Простой лимит частоты: защита от локального «шторма» запросов (и от чужих скриптов в системе).
   60 запросов подряд, восстановление 8 в секунду — обычной работе не мешает. */
const RL = new Map();
function rateOk(ip) {
  const now = Date.now();
  let b = RL.get(ip);
  if (!b) { if (RL.size > 500) RL.clear(); b = { n: 0, t: now }; RL.set(ip, b); }
  b.n = Math.max(0, b.n - (now - b.t) / 1000 * 8); b.t = now;
  if (b.n > 60) return false;
  b.n += 1;
  return true;
}
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png', '.json': 'application/json; charset=utf-8',
};
/* Интерфейс отдаётся только из этого списка файлов — выйти за папку через ../ или %2e%2e невозможно. */
const STATIC_FILES = new Set(['index.html', 'app.js', 'style.css', 'highlight.js', 'i18n.js']);
function staticPath(pathname) {
  let name;
  try { name = pathname === '/' ? 'index.html' : path.basename(decodeURIComponent(pathname)); } catch { return null; }
  if (!STATIC_FILES.has(name)) return null;
  const pub = path.join(__dirname, 'public');
  const f = path.join(fs.existsSync(pub) ? pub : __dirname, name);
  return fs.existsSync(f) ? f : null;
}
/* Статика: ETag + gzip/brotli из памяти. Файлы интерфейса небольшие, поэтому кэш держим целиком. */
const staticCache = new Map();
function staticEntry(f) {
  const st = fs.statSync(f);
  const key = f;
  let e = staticCache.get(key);
  if (e && e.mtimeMs === st.mtimeMs && e.size === st.size) return e;
  const raw = fs.readFileSync(f);
  e = { mtimeMs: st.mtimeMs, size: st.size, raw, gzip: null, br: null, etag: '"' + st.size.toString(16) + '-' + Math.round(st.mtimeMs).toString(16) + '"' };
  staticCache.set(key, e);
  return e;
}
function sendStatic(req, res, f) {
  const ext = path.extname(f), headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' };
  if (ext === '.html') headers['Content-Security-Policy'] = CSP;
  let e;
  try { e = staticEntry(f); } catch { return res.writeHead(404).end(); }
  headers.ETag = e.etag;
  const inm = String(req.headers['if-none-match'] || '');
  if (inm && inm.split(',').some(t => t.trim() === e.etag)) { res.writeHead(304, headers); return res.end(); }
  const compressible = /\.(js|css|html|json|svg|txt)$/i.test(ext);
  const ae = String(req.headers['accept-encoding'] || '');
  let body = e.raw;
  if (compressible) {
    try {
      if (/\bbr\b/.test(ae)) { e.br = e.br || zlib.brotliCompressSync(e.raw); body = e.br; headers['Content-Encoding'] = 'br'; }
      else if (/\bgzip\b/.test(ae)) { e.gzip = e.gzip || zlib.gzipSync(e.raw, { level: 9 }); body = e.gzip; headers['Content-Encoding'] = 'gzip'; }
    } catch {}
    if (headers['Content-Encoding']) headers.Vary = 'Accept-Encoding';
  }
  headers['Content-Length'] = body.length;
  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();
  res.end(body);
}

/* Заголовки безопасности — у всех ответов, включая потоковые. */
const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Permitted-Cross-Domain-Policies': 'none',
  'Permissions-Policy': 'camera=(), geolocation=(), payment=(), usb=(), microphone=(self)',
};
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'";
const MAX_JSON_BODY = 30e6;
const body = (req) => new Promise((resolve, reject) => {
  if (!/^application\/json\b/i.test(String(req.headers['content-type'] || '')))
    return reject(new HttpError(T('Нужен заголовок Content-Type: application/json', 'Content-Type: application/json is required'), 415));
  const chunks = []; let size = 0, tooBig = false, done = false;
  const fail = (e) => { if (!done) { done = true; reject(e); } };
  req.on('data', c => {
    if (tooBig) return;
    size += c.length;
    if (size > MAX_JSON_BODY) { tooBig = true; chunks.length = 0; return; }   // не копим тело, но и не рвём ответ: клиент должен увидеть 413
    chunks.push(c);
  });
  req.on('end', () => {
    if (done) return;
    if (tooBig) return fail(new HttpError(T('Слишком большой запрос', 'Request too large'), 413));
    let o;
    try { o = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}; }
    catch { return fail(new HttpError(T('Некорректный JSON', 'Invalid JSON'), 400)); }
    done = true; resolve(o && typeof o === 'object' && !Array.isArray(o) ? o : {});
  });
  req.on('error', fail);
  req.on('aborted', () => fail(new HttpError(T('Запрос прерван', 'Request aborted'), 400)));
  req.on('close', () => { if (!req.complete) fail(new HttpError(T('Запрос прерван', 'Request aborted'), 400)); });
});
/* Сравнение токена без утечки по времени. */
function tokenOk(v) {
  const t = String(v || '');
  if (t.length !== TOKEN.length) return false;
  try { return crypto.timingSafeEqual(Buffer.from(t, 'utf8'), Buffer.from(TOKEN, 'utf8')); } catch { return false; }
}
let activeChats = 0;
const server = http.createServer(async (req, res) => {
  for (const [k, v] of Object.entries(SEC_HEADERS)) res.setHeader(k, v);
  res.setHeader('Cache-Control', 'no-store');
  const json = (code, obj) => {
    if (res.headersSent) { try { res.end(); } catch {} return; }
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  };
  try {
    let url; try { url = new URL(req.url, `http://${HOST}:${PORT}`); } catch { return json(400, { error: 'bad request' }); }
    if (req.headers['x-lang'] === 'en' || req.headers['x-lang'] === 'ru') SLANG = req.headers['x-lang'];

    /* Host проверяется строго: защита от DNS-rebinding (чужой домен не «станет» localhost). */
    const hostHeader = String(req.headers.host || '').toLowerCase().replace(/\.(?=:|$)/, '');
    const allowedHosts = new Set([`${HOST}:${PORT}`, `localhost:${PORT}`, HOST, 'localhost']);
    if (!allowedHosts.has(hostHeader)) return json(403, { error: 'bad host' });

    const p = url.pathname, isApi = p.startsWith('/api/');
    if (isApi && !rateOk(req.socket.remoteAddress || '')) { res.setHeader('Retry-After', '1'); return json(429, { error: T('Слишком много запросов. Подождите секунду.', 'Too many requests. Wait a second.') }); }

    /* CSRF: браузер сам присылает Origin и Sec-Fetch-Site. Чужой сайт не может дёргать API даже с токеном. */
    if (isApi) {
      const origin = String(req.headers.origin || '').toLowerCase();
      const okOrigins = new Set([`http://${HOST}`, `http://localhost`, `http://${HOST}:${PORT}`, `http://localhost:${PORT}`]);
      if (origin && !okOrigins.has(origin)) return json(403, { error: T('Запросы с других сайтов запрещены', 'Requests from other sites are not allowed') });
      const site = req.headers['sec-fetch-site'];
      if (site && site !== 'same-origin' && site !== 'none') return json(403, { error: T('Запросы с других сайтов запрещены', 'Requests from other sites are not allowed') });
    }

    if (p === '/favicon.ico') { res.writeHead(204); return res.end(); }
    if ((req.method === 'GET' || req.method === 'HEAD') && !isApi) {
      const f = staticPath(p);
      if (!f) return json(404, { error: 'not found' });
      return sendStatic(req, res, f);
    }
    if (p === '/api/health') return json(200, { ok: true, version: VERSION });

    const token = String(req.headers['x-token'] || '').replace(/^Bearer\s+/i, '') || String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!tokenOk(token)) return json(401, { error: T('Неверный токен. Откройте ссылку из консоли.', 'Invalid token. Open the link printed in the console.') });
    if (!isApi) return json(404, { error: 'not found' });

    /* Метод проверяется явно: GET не должен ничего менять. */
    const only = (m) => { if (req.method === m) return true; json(405, { error: 'method not allowed' }); return false; };
    const str = (v, max = 1e6) => typeof v === 'string' && v.length <= max;

    if (p === '/api/integrity') { if (!only('GET')) return; return json(200, buildStatus()); }
    if (p === '/api/info') { if (!only('GET')) return; return json(200, { root: ROOT, name: path.basename(ROOT), platform: process.platform, version: VERSION, home: os.homedir(), defaults: conf.defaults || {}, recent: conf.recent || [], integrity: buildStatus() }); }
    if (p === '/api/env') { if (!only('GET')) return; return json(200, await envInfo()); }
    if (p === '/api/update-check') {
      if (!only('GET')) return;
      try { return json(200, await updateCheck()); }
      catch (e) { return json(502, { error: T('Не удалось проверить обновления: ', 'Could not check for updates: ') + explain(e) }); }
    }
    if (p === '/api/replace') {
      if (!only('POST')) return;
      const b = await body(req);
      if (!str(b.query, 500) || !String(b.query || '').trim()) return json(400, { error: T('Пустой запрос', 'Empty query') });
      if (b.replacement != null && !str(b.replacement, 20000)) return json(400, { error: T('Слишком длинная замена', 'Replacement is too long') });
      return json(200, replaceAllInProject(b.query, b.replacement, { regex: !!b.regex, dry: b.dry !== false, path: b.path }));
    }
    if (p === '/api/history') { if (!only('GET')) return; return json(200, { items: histList(url.searchParams.get('path') || '', Number(url.searchParams.get('limit')) || 50) }); }
    if (p === '/api/history/restore') {
      if (!only('POST')) return;
      const b = await body(req);
      if (!str(b.id, 64)) return json(400, { error: T('Не указана запись истории', 'History entry id is required') });
      return json(200, histRestore(String(b.id)));
    }
    if (p === '/api/export') {
      if (!only('GET')) return;
      const zip = projectZipBytes();
      const name = (path.basename(ROOT) || 'project').replace(/[^\w.-]+/g, '_') + '.zip';
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        'Content-Length': zip.length,
      });
      return res.end(zip);
    }
    if (p === '/api/import') {
      if (!only('POST')) return;
      const b = await body(req, 36e6);                       // base64 от 25 МБ — это ~34 МБ
      if (!str(b.data, 34e6)) return json(400, { error: T('Архив не передан или слишком большой (до 25 МБ)', 'The archive is missing or too large (up to 25 MB)') });
      let buf; try { buf = Buffer.from(String(b.data), 'base64'); } catch { return json(400, { error: T('Повреждённые данные архива', 'Damaged archive data') }); }
      const r = importZip(buf);
      return json(200, r);
    }
    if (p === '/api/tree') { if (!only('GET')) return; return json(200, listDir(url.searchParams.get('path') || '')); }
    if (p === '/api/files') { if (!only('GET')) return; return json(200, cachedAllFiles()); }
    if (p === '/api/rules') { if (!only('GET')) return; return json(200, { rules: readRules() }); }
    if (p === '/api/file') {
      if (req.method === 'GET') {
        const q = url.searchParams.get('path');
        if (!str(q)) return json(400, { error: T('Не указан путь', 'Path is required') });
        return json(200, { content: readFile(q) });
      }
      if (!only('POST')) return;
      const b = await body(req);
      if (!str(b.path) || !b.path) return json(400, { error: T('Не указан путь', 'Path is required') });
      if (!str(b.content, MAX_JSON_BODY)) return json(400, { error: T('Неверное содержимое', 'Invalid content') });
      const w = writeFile(b.path, b.content); return json(200, { before: w.before, warnings: w.warnings });
    }
    if (p === '/api/tool') {
      if (!only('POST')) return;
      const b = await body(req);
      if (!str(b.name)) return json(400, { error: T('Не указан инструмент', 'Tool name is required') });
      if (b.args != null && (typeof b.args !== 'object' || Array.isArray(b.args))) return json(400, { error: T('Аргументы должны быть объектом', 'Arguments must be an object') });
      return json(200, await tool(b.name, b.args || {}));
    }
    if (p === '/api/fsop') { if (!only('POST')) return; return json(200, { result: fsop(await body(req)) }); }
    if (p === '/api/chat') {
      if (!only('POST')) return;
      if (activeChats >= 3) return json(429, { error: T('Слишком много одновременных запросов к модели. Подождите завершения предыдущих.', 'Too many simultaneous model requests. Wait for the previous ones to finish.') });
      const b = await body(req);
      activeChats++; res.on('close', () => { activeChats = Math.max(0, activeChats - 1); });
      return await handleChat(b, res);
    }
    if (p === '/api/complete') { if (!only('POST')) return; return json(200, { text: await complete(await body(req)) }); }
    if (p === '/api/keys/test') { if (!only('POST')) return; return json(200, { keys: await testKeys((await body(req)).cfg) }); }
    if (p === '/api/keys/reset') { if (!only('POST')) return; resetKeys(); return json(200, { ok: true }); }
    if (p === '/api/models') { if (!only('POST')) return; return json(200, { models: await listModels((await body(req)).cfg) }); }
    if (p === '/api/catalog') { if (!only('GET')) return; return json(200, await catalog()); }
    if (p === '/api/installed') { if (!only('GET')) return; const inst = await installedModels(); return json(200, { ollama: inst !== null, installed: inst || [] }); }
    if (p === '/api/git') { if (!only('GET')) return; return json(200, await gitInfo()); }
    if (p === '/api/ping') { if (!only('GET')) return; lastPing = Date.now(); return json(200, { ok: true }); }
    if (p === '/api/term/run') {
      if (!only('POST')) return;
      const b = await body(req);
      if (!str(b.command)) return json(400, { error: T('Пустая команда', 'Empty command') });
      if (String(b.command).length > 10000) return json(413, { error: T('Слишком длинная команда', 'Command is too long') });
      if (TERMS.size >= 12) return json(429, { error: T('Уже запущено 12 терминалов — закройте лишние', '12 terminals are already running — close some') });
      return handleTermRun(b, res);
    }
    if (p === '/api/term/input') {
      if (!only('POST')) return;
      const b = await body(req), c = TERMS.get(+b.id), d = String(b.data ?? '');
      if (d.length > 65536) return json(413, { error: T('Слишком длинный ввод', 'Input is too long') });
      if (c && c.stdin.writable) c.stdin.write(d);
      return json(200, { ok: !!c });
    }
    if (p === '/api/term/kill') { if (!only('POST')) return; const b = await body(req), c = TERMS.get(+b.id); if (c) killTree(c); return json(200, { ok: !!c }); }
    if (p === '/api/stt/status') { if (!only('GET')) return; return json(200, sttStatus()); }
    if (p === '/api/stt/install') { if (!only('POST')) return; return await handleSttInstall(await body(req), res); }
    if (p === '/api/stt/remove') { if (!only('POST')) return; fs.rmSync(STT_DIR, { recursive: true, force: true }); return json(200, sttStatus()); }
    if (p === '/api/stt') {
      if (!only('POST')) return;
      if (!/^audio\//i.test(String(req.headers['content-type'] || ''))) return json(415, { error: T('Ожидается аудио', 'Audio is expected') });
      const wav = await rawBody(req);
      const size = url.searchParams.get('size') || 'base';
      return json(200, { text: await transcribe(wav, url.searchParams.get('lang'), STT_MODELS[size] ? size : 'base') });
    }
    if (p === '/api/pull') { if (!only('POST')) return; const b = await body(req); if (!str(b.id)) return json(400, { error: T('Не указана модель', 'Model is required') }); return await handlePull(b, res); }
    if (p === '/api/pick-folder') { if (!only('POST')) return; return json(200, { path: await pickFolder() }); }
    if (p === '/api/chdir') {
      if (!only('POST')) return;
      const b = await body(req);
      if (!str(b.path) || !path.isAbsolute(b.path)) return json(400, { error: T('Нужен абсолютный путь к папке', 'An absolute folder path is required') });
      let st; try { st = fs.statSync(b.path); } catch { throw new Error(T('Папка не найдена', 'Folder not found')); }
      if (!st.isDirectory()) return json(400, { error: T('Это не папка', 'This is not a folder') });
      if (isSystemDir(b.path)) return json(403, { error: T('Системная папка не может быть папкой проекта', 'A system folder cannot be the project folder') });
      setRoot(b.path);
      return json(200, { root: ROOT });
    }
    json(404, { error: 'not found' });
  } catch (e) {
    log(req.method, req.url && req.url.split('?')[0], e && e.message);
    json(e instanceof HttpError ? e.status : 500, { error: explain(e) });
  }
});

/* Адрес запущенного экземпляра: второй запуск не поднимает ещё один сервер, а открывает уже работающее окно. */
const SESSION_FILE = path.join(CFG_DIR, 'session.json');
function writeSession(url) {
  try { fs.mkdirSync(CFG_DIR, { recursive: true }); fs.writeFileSync(SESSION_FILE, JSON.stringify({ port: PORT, url, pid: process.pid }), { mode: 0o600 }); } catch {}
}
function clearSession() {
  try { const s = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8')); if (s.pid === process.pid) fs.unlinkSync(SESSION_FILE); } catch {}
}
async function existingInstance() {
  try {
    const s = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    if (!s || !s.url) return null;
    const tok = (String(s.url).split('#token=')[1] || '');
    const r = await fetch('http://127.0.0.1:' + s.port + '/api/ping', { headers: { 'x-token': tok }, signal: AbortSignal.timeout(1500) });
    return r.ok ? String(s.url) : null;
  } catch { return null; }
}

if (require.main === module) {
/* Тайм-ауты против «медленных» клиентов; локальному окну этого достаточно. */
server.headersTimeout = 20000;
server.requestTimeout = 120000;
server.maxHeadersCount = 100;
server.on('listening', () => {
  // Токен передаём во фрагменте ссылки (#): он не попадает в журналы сервера и в Referer.
  const url = `http://localhost:${PORT}/#token=${TOKEN}`;
  // Окно открывается само, поэтому в localcode.log токен не пишем: в журнале только безопасный адрес.
  const shown = argv.includes('--app') ? `http://localhost:${PORT}/` : url;
  console.log(T('\n  LocalCode запущен', '\n  LocalCode is running'));
  console.log(T('  Папка проекта:', '  Project folder:'), ROOT);
  console.log(T('  Откройте:     ', '  Open:          '), shown);
  if (argv.includes('--app')) console.log(T('  Ссылка с токеном — в открытом окне; для ручного входа запустите LocalCode.bat.', '  The link with the token is in the opened window; run LocalCode.bat to get it manually.'));
  console.log('');
  if (argv.includes('--app') || argv.includes('--open')) ensureOllama();
  setTimeout(warmHW, 4000).unref();   // определение железа в отдельном процессе, чтобы не тормозить окно
  writeSession(url);
  process.on('exit', clearSession);
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { clearSession(); process.exit(0); });
  if (argv.includes('--app')) openApp(url);
  else if (argv.includes('--open')) openBrowser(url);
});
server.on('error', async (e) => {
  if (e.code === 'EADDRINUSE') {
    const url = await existingInstance();
    if (url) {
      if (argv.includes('--app')) {
        console.log(T('  LocalCode уже запущен — открываю его окно.', '  LocalCode is already running — opening its window.'));
        try { await openApp(url); } catch {}
        console.log(T('  Откройте:     ', '  Open:          '), url);      // строку ждёт LocalCode.vbs
      } else if (argv.includes('--open')) {
        console.log(T('  LocalCode уже запущен — открываю его в браузере.', '  LocalCode is already running — opening it in the browser.'));
        try { await openBrowser(url); } catch {}
        console.log(T('  Откройте:     ', '  Open:          '), url);
      } else {
        console.log(T('  LocalCode уже запущен. Откройте: ', '  LocalCode is already running. Open: '), url);
      }
      process.exit(0);
    }
    if (argv.includes('--app') && PORT < BASE_PORT + 20) { PORT++; server.listen(PORT, HOST); return; }
  }
  console.error(e.code === 'EADDRINUSE' ? T(`Порт ${PORT} занят. Запустите с другим: node server.js --port 3001`, `Port ${PORT} is busy. Start with another: node server.js --port 3001`) : e.message); process.exit(1);
});
server.listen(PORT, HOST);
}
module.exports = { HttpError, withKeys, keyState, resetKeys, classifyKeyError, safe, setRoot, replaceInFile, applyPatch, run, search, allFiles, listDir, findPaths, parseDdg, htmlToText, isPrivateHost, isPrivateIp, assertPublicUrl, assertProviderUrl, isSecretFile, fetchUrl, openTarget, VERSION,
  replaceAllInProject, histSnapshot, histList, histRestore, zipStore, readZip, zipSafeName, crc32, projectZipBytes, importZip, extractZipInto, envInfo, updateCheck, cmpVer };
