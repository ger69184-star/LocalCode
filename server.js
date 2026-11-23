#!/usr/bin/env node
// LocalCode — локальный ИИ-редактор кода. Без зависимостей, нужен только Node.js 18+.
// Запуск: node server.js [папка] [--open] [--port 3000]
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { exec, execFile, spawn } = require('child_process');
const hwlib = require('./hw');

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
const CFG_DIR = path.join(os.homedir(), '.localcode');
const CFG_FILE = path.join(CFG_DIR, 'config.json');
let conf = {};
try { conf = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8')); } catch {}
const saveConf = () => { try { fs.mkdirSync(CFG_DIR, { recursive: true }); fs.writeFileSync(CFG_FILE, JSON.stringify(conf, null, 2)); } catch {} };

let ROOT;
function setRoot(p) {
  ROOT = path.resolve(p);
  fs.mkdirSync(ROOT, { recursive: true });
  conf.recent = [ROOT, ...(conf.recent || []).filter(x => x !== ROOT)].slice(0, 8);
  saveConf();
}
const lastProject = (conf.recent || []).find(p => fs.existsSync(p));
setRoot(positional[0] || lastProject || path.join(os.homedir(), 'LocalCodeProjects'));

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
let ANY = false;   // true только на время вызова инструментов агента: тогда разрешены пути в домашней папке
const PROTECTED = /[\\/](windows|program files( \(x86\))?|programdata|\.ssh|appdata)([\\/]|$)/i;
const deskDir = () => [['Desktop'], ['OneDrive', 'Desktop'], ['Рабочий стол'], ['OneDrive', 'Рабочий стол']].map(a => path.join(os.homedir(), ...a)).find(d => fs.existsSync(d)) || path.join(os.homedir(), 'Desktop');
const inside = (full, base) => { const a = process.platform === 'win32' ? full.toLowerCase() : full, b = process.platform === 'win32' ? base.toLowerCase() : base; return a === b || a.startsWith(b + path.sep); };
function safe(p) {
  if (ANY && p) {
    let x = String(p).trim();
    x = expandHome(x);
    if (path.isAbsolute(x)) {
      const full = path.resolve(x);
      if (PROTECTED.test(full + path.sep)) throw new Error(T('Эта системная папка защищена', 'This system folder is protected'));
      if (inside(full, os.homedir()) || inside(full, ROOT)) return full;
      throw new Error(T('Путь вне домашней папки', 'Path is outside the home folder'));
    }
  }
  if (p && path.isAbsolute(String(p))) {   // абсолютный путь допустим только внутри проекта; иначе понятная ошибка вместо тихой подмены
    const abs = path.resolve(String(p));
    if (inside(abs, ROOT)) return abs;
    throw new Error(T('Абсолютные пути вне проекта не поддерживаются. Укажите путь внутри проекта, ~/Desktop/имя, ~/Documents/имя или ~/Downloads/имя', 'Absolute paths outside the project are not supported. Use a path inside the project, ~/Desktop/name, ~/Documents/name or ~/Downloads/name'));
  }
  const full = path.resolve(ROOT, '.' + path.sep + (p || ''));
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) throw new Error(T('Путь вне рабочей папки', 'Path is outside the project folder'));
  return full;
}
const rel = (f) => { const r = path.relative(ROOT, f); return (r.startsWith('..') || path.isAbsolute(r)) ? f : r.split(path.sep).join('/'); };

function listDir(p) {
  const dir = safe(p);
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => !IGNORE.has(e.name))
    .map(e => ({ name: e.name, path: rel(path.join(dir, e.name)), dir: e.isDirectory() }))
    .sort((a, b) => b.dir - a.dir || a.name.localeCompare(b.name));
}
function allFiles(limit = 6000) {
  const out = [];
  (function walk(dir) {
    let list; try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      if (out.length >= limit) return;
      if (IGNORE.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full); else out.push(rel(full));
    }
  })(ROOT);
  return out;
}
function readFile(p) {
  const f = safe(p);
  if (fs.statSync(f).size > 2 * 1024 * 1024) throw new Error(T('Файл больше 2 МБ', 'File is larger than 2 MB'));
  return fs.readFileSync(f, 'utf8');
}
function writeFile(p, content) {
  const f = safe(p);
  const before = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, content, 'utf8');
  return before;
}
function replaceInFile(p, oldStr, newStr) {
  if (typeof oldStr !== 'string' || oldStr === '') throw new Error(T('old_str пустой: укажите фрагмент, который нужно заменить', 'old_str is empty: give the fragment to replace'));
  const f = safe(p);
  const text = fs.readFileSync(f, 'utf8');
  const count = text.split(oldStr).length - 1;
  if (count === 0) throw new Error(T('old_str не найден в файле', 'old_str not found in the file'));
  if (count > 1) throw new Error(T(`old_str встречается ${count} раз — добавьте контекст, чтобы он был уникальным`, `old_str occurs ${count} times — add more context to make it unique`));
  fs.writeFileSync(f, text.replace(oldStr, () => newStr), 'utf8');
  return text;
}
// Применение diff-патча (unified diff): удобно, когда нужно изменить несколько мест файла за раз
function applyPatch(p, patch) {
  const f = safe(p), text = fs.readFileSync(f, 'utf8'), eol = text.includes('\r\n') ? '\r\n' : '\n';
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
  fs.writeFileSync(f, lines.join(eol), 'utf8');
  return text;
}
function lineMatcher(query, regex) {
  if (regex) { try { const re = new RegExp(query, 'i'); return (l) => re.test(l); } catch (e) { throw new Error(T('Неверное регулярное выражение: ', 'Invalid regular expression: ') + e.message); } }
  const q = query.toLowerCase(); return (l) => l.toLowerCase().includes(q);
}
// Простая поддержка .gitignore: имена, маски *.ext, каталоги/
function gitignoreFilter() {
  let rules = []; try { rules = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8').split(/\r?\n/).map(x => x.trim()).filter(x => x && !x.startsWith('#') && !x.startsWith('!')); } catch {}
  const res = rules.map(r => {
    const dirOnly = r.endsWith('/'), a = r.replace(/^\//, '').replace(/\/$/, '');
    const body = a.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0001').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0001/g, '.*');
    return new RegExp('(^|/)' + body + (dirOnly ? '/' : '(/|$)'));
  });
  return (relPath, isDir) => res.some(re => re.test(isDir ? relPath + '/' : relPath));
}
function search(query, p, regex) {
  if (!query || !String(query).trim()) throw new Error(T('Пустой запрос поиска', 'Empty search query'));
  const out = [], test = lineMatcher(String(query), regex), ignored = gitignoreFilter();
  (function walk(dir) {
    let list; try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      if (out.length >= 200) return;
      if (IGNORE.has(e.name)) continue;
      const full = path.join(dir, e.name), r = rel(full);
      if (ignored(r, e.isDirectory())) continue;
      if (e.isDirectory()) { walk(full); continue; }
      try {
        if (fs.statSync(full).size > 1024 * 1024) continue;
        fs.readFileSync(full, 'utf8').split('\n').forEach((line, i) => { if (out.length < 200 && test(line)) out.push(`${r}:${i + 1}: ${line.trim().slice(0, 200)}`); });
      } catch {}
    }
  })(safe(p || ''));
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
  const res = parseDdg(await r.text());
  return res.length ? res.join('\n') : T('Ничего не найдено', 'Nothing found');
}
const isPrivateHost = (h) => /^(localhost|.*\.local|.*\.internal)$/i.test(h) || /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|::1$|\[::1\]|fc|fd|fe80)/i.test(h);
function htmlToText(html) {
  const t = String(html).replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, ' ').replace(/<(br|p|div|li|h[1-6]|tr)[^>]*>/gi, '\n').replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;/g, ' ');
  return t.replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
async function fetchUrl(u) {
  let url; try { url = new URL(String(u)); } catch { throw new Error(T('Неверная ссылка', 'Invalid URL')); }
  if (!/^https?:$/.test(url.protocol)) throw new Error(T('Разрешены только http и https', 'Only http and https are allowed'));
  if (isPrivateHost(url.hostname)) throw new Error(T('Адреса внутри вашего компьютера и сети закрыты', 'Local and private network addresses are blocked'));
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (LocalCode)' }, signal: AbortSignal.timeout(15000), redirect: 'follow' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const buf = Buffer.from(await r.arrayBuffer()).subarray(0, 1.5e6), text = buf.toString('utf8');
  const out = /html/i.test(r.headers.get('content-type') || '') ? htmlToText(text) : text;
  return out.slice(0, 12000) || T('Пустая страница', 'Empty page');
}
const UTF_ENV = { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };
function wrapShell(command, ps) {
  if (process.platform !== 'win32') return command;
  return ps ? `[Console]::OutputEncoding=[Text.Encoding]::UTF8; ${command}` : `chcp 65001>nul & ${command}`;
}
function run(command, timeoutSec = 60, shell) {
  if (!command || !String(command).trim()) return Promise.reject(new Error(T('Пустая команда', 'Empty command')));
  const ps = process.platform === 'win32' && /^p(ower)?s/i.test(shell || '');
  return new Promise((resolve) => {
    exec(wrapShell(command, ps), { cwd: ROOT, env: UTF_ENV, shell: ps ? 'powershell.exe' : undefined, timeout: timeoutSec * 1000, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
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
const NO_OPEN_EXT = new Set(['.exe', '.bat', '.cmd', '.com', '.msi', '.ps1', '.psm1', '.vbs', '.vbe', '.js', '.jse', '.wsf', '.hta', '.scr', '.lnk', '.reg', '.dll', '.cpl', '.jar', '.sh', '.command', '.app', '.appimage', '.desktop']);
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
  const full = path.resolve(ROOT, expandHome(target));
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
const withAny = (f) => { ANY = true; try { return f(); } finally { ANY = false; } };
async function tool(name, a) {
  switch (name) {
    case 'make_dir': return withAny(() => { const f = safe(a.path); fs.mkdirSync(f, { recursive: true }); return { result: T('Папка создана: ', 'Folder created: ') + f }; });
    case 'delete_path': { const f = withAny(() => safe(a.path)); if (!fs.existsSync(f)) throw new Error(T('Не найдено: ', 'Not found: ') + f); return { result: await deleteToTrash(f) }; }
    case 'bluetooth': return { result: await bluetooth(a.action) };
    case 'find_path': { const r = findPaths(a.query, a.where); return { result: r.length ? JSON.stringify(r) : T('Ничего не найдено', 'Nothing found') }; }
    case 'list_dir': return withAny(() => ({ result: JSON.stringify(listDir(a.path || '')) }));
    case 'read_file': return withAny(() => ({ result: readFile(a.path) }));
    case 'write_file': return withAny(() => { const before = writeFile(a.path, a.content); return { result: 'OK', before }; });
    case 'replace_in_file': return withAny(() => { const before = replaceInFile(a.path, a.old_str, a.new_str); return { result: 'OK', before }; });
    case 'search': return withAny(() => ({ result: search(a.query, a.path, !!a.regex) }));
    case 'apply_patch': return withAny(() => { const before = applyPatch(a.path, a.patch); return { result: 'OK', before }; });
    case 'web_search': return { result: await webSearch(a.query) };
    case 'fetch_url': return { result: await fetchUrl(a.url) };
    case 'run_command': return { result: await run(a.command, a.timeout, a.shell) };
    case 'open': return { result: T('Открыто: ', 'Opened: ') + await openTarget(a.target) };
    default: throw new Error(T('Неизвестный инструмент: ', 'Unknown tool: ') + name);
  }
}
function fsop({ op, path: p, to }) {
  const f = safe(p);
  if (op === 'mkdir') fs.mkdirSync(f, { recursive: true });
  else if (op === 'create') { fs.mkdirSync(path.dirname(f), { recursive: true }); if (fs.existsSync(f)) throw new Error(T('Уже существует', 'Already exists')); fs.writeFileSync(f, ''); }
  else if (op === 'rename') { const t = safe(to); if (fs.existsSync(t)) throw new Error(T('Уже существует', 'Already exists')); fs.mkdirSync(path.dirname(t), { recursive: true }); fs.renameSync(f, t); }
  else if (op === 'delete') { if (f === ROOT) throw new Error(T('Нельзя удалить корень', 'Cannot delete the project root')); fs.rmSync(f, { recursive: true, force: true }); }
  else throw new Error(T('Неизвестная операция', 'Unknown operation'));
  return 'OK';
}
function readRules() {
  for (const n of ['.localcode/rules.md', 'AGENTS.md', '.cursorrules', 'CLAUDE.md']) {
    const f = path.join(ROOT, n);
    if (fs.existsSync(f)) { try { return fs.readFileSync(f, 'utf8').slice(0, 6000); } catch {} }
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
const REASON_RU = { limit: 'лимит запросов', balance: 'нет средств на счёте', invalid: 'ключ не принят' }, REASON_EN = { limit: 'rate limit', balance: 'no credit', invalid: 'key rejected' };
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
  const t = await r.text();
  try { const j = JSON.parse(t); return `HTTP ${r.status}: ` + (j.error?.message || j.error || j.message || t).toString().slice(0, 500) + statusHint(r.status); } catch { return `HTTP ${r.status}: ${t.slice(0, 500)}` + statusHint(r.status); }
}
function explain(e) {
  const c = e.cause || {}; const code = c.code || (c.errors && c.errors[0] && c.errors[0].code);
  if (code === 'ECONNREFUSED') return T('Не удаётся подключиться к серверу модели. Для Ollama: он запущен? (команда «ollama serve»)', 'Cannot connect to the model server. For Ollama: is it running? (command: ollama serve)');
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return T('Адрес не найден — проверьте Base URL и подключение к интернету.', 'Address not found — check the Base URL and your internet connection.');
  if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') return T('Таймаут подключения — сервис недоступен из вашей сети.', 'Connection timed out — the service is unreachable from your network.');
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
  try { emit({ t: 'done', message: await withKeys(b.cfg, emit, (c) => streamer(c)(c, b.messages, b.tools, emit, ac.signal, b.opts || {})) }); }
  catch (e) { emit({ t: 'error', v: e.name === 'AbortError' ? T('Остановлено', 'Stopped') : explain(e) }); }
  res.end();
}
const stripFence = (t) => String(t || '').replace(/^\s*```[^\n]*\n/, '').replace(/\n?```\s*$/, '');

async function complete(b) {
  const { cfg, prefix, suffix, path: p } = b;
  if (/:11434/.test(cfg.baseUrl || '')) {            // Ollama: настоящий fill-in-the-middle
    try {
      const r = await fetch(new URL(cfg.baseUrl).origin + '/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' },
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
  const r = await fetch(baseOf(cfg) + '/models', { headers: authHeaders(cfg) });
  if (!r.ok) throw await httpErr(r);
  const j = await r.json();
  return (j.data || j.models || []).map(m => m.id || m.name).filter(Boolean);
}

/* ---------- каталог офлайн-моделей (Ollama) ---------- */
let MODELS = [];
try { MODELS = JSON.parse(fs.readFileSync(path.join(__dirname, 'models.json'), 'utf8')).models || []; } catch {}
const OLLAMA = process.env.OLLAMA_HOST_URL || 'http://127.0.0.1:11434';
let HW = null;
function warmHW() {   // считаем характеристики ПК вне основного процесса: nvidia-smi и PowerShell могут думать по нескольку секунд
  execFile(process.execPath, ['-e', "process.stdout.write(JSON.stringify(require('./hw').detect()))"], { cwd: __dirname, timeout: 25000, windowsHide: true, encoding: 'utf8' }, (e, out) => { if (!e) { try { HW = HW || JSON.parse(out); } catch {} } });
}
async function installedModels() {
  try {
    const r = await fetch(OLLAMA + '/api/tags', { signal: AbortSignal.timeout(2000) });
    if (!r.ok) return null;
    return ((await r.json()).models || []).map(m => m.name);
  } catch { return null; }
}
async function catalog() {
  HW = HW || hwlib.detect();
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
function git(args) { return new Promise((res) => execFile('git', args, { cwd: ROOT, timeout: 4000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (e, out) => res(e ? null : String(out)))); }
async function gitInfo() {
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
    const q = (x) => x.replace(/'/g, "''");
    await new Promise((res, rej) => execFile('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${q(zip)}' -DestinationPath '${q(binDir)}' -Force`], { windowsHide: true }, (e) => e ? rej(e) : res()));
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
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error(T('Слишком большая запись', 'Recording too large'))); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
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
  const emit = (o) => { if (!res.writableEnded) res.write(JSON.stringify(o) + '\n'); };
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
  const child = ps ? spawn('powershell.exe', ['-NoProfile', '-NoLogo', '-Command', full], { cwd, windowsHide: true, env: UTF_ENV }) : spawn(full, [], { cwd, shell: true, windowsHide: true, env: UTF_ENV });
  const id = ++termSeq; TERMS.set(id, child);
  emit({ t: 'start', id, cwd });
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', d => emit({ t: 'out', v: d })); child.stderr.on('data', d => emit({ t: 'err', v: d }));
  const timer = setTimeout(() => { emit({ t: 'err', v: T('\n[остановлено: прошло 30 минут]\n', '\n[stopped: 30 minutes passed]\n') }); killTree(child); }, 30 * 60 * 1000);
  child.on('error', e => emit({ t: 'err', v: e.message + '\n' }));
  child.on('close', code => { clearTimeout(timer); TERMS.delete(id); emit({ t: 'exit', code: code ?? -1 }); res.end(); });
  res.on('close', () => { if (TERMS.has(id)) { clearTimeout(timer); killTree(child); } });
}

/* ---------- HTTP ---------- */
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
function body(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > 30e6) { reject(new Error(T('Слишком большой запрос', 'Request too large'))); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(e); } });
  });
}
let activeChats = 0;
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  if (req.headers['x-lang'] === 'en' || req.headers['x-lang'] === 'ru') SLANG = req.headers['x-lang'];
  const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
  if (![`${HOST}:${PORT}`, `localhost:${PORT}`].includes(req.headers.host)) return json(403, { error: 'bad host' });

  if (url.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
  if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
    const name = url.pathname === '/' ? 'index.html' : path.basename(url.pathname);
    const f = path.join(__dirname, 'public', name);
    if (!fs.existsSync(f) || !MIME[path.extname(f)]) return json(404, { error: 'not found' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] + '; charset=utf-8', 'Cache-Control': 'no-cache' });
    return res.end(fs.readFileSync(f));
  }
  if (url.pathname === '/api/health') return json(200, { ok: true, version: VERSION, node: process.version, uptime: Math.round(process.uptime()) });
  if (req.headers['x-token'] !== TOKEN) return json(401, { error: T('Неверный токен. Откройте ссылку из консоли.', 'Invalid token. Open the link printed in the console.') });

  try {
    const p = url.pathname;
    if (p === '/api/info') return json(200, { root: ROOT, name: path.basename(ROOT), platform: process.platform, home: os.homedir(), defaults: conf.defaults || {}, recent: conf.recent || [] });
    if (p === '/api/tree') return json(200, listDir(url.searchParams.get('path') || ''));
    if (p === '/api/files') return json(200, allFiles());
    if (p === '/api/rules') return json(200, { rules: readRules() });
    if (p === '/api/file' && req.method === 'GET') return json(200, { content: readFile(url.searchParams.get('path')) });
    if (p === '/api/file') { const b = await body(req); return json(200, { before: writeFile(b.path, b.content) }); }
    if (p === '/api/tool') { const b = await body(req); return json(200, await tool(b.name, b.args || {})); }
    if (p === '/api/fsop') return json(200, { result: fsop(await body(req)) });
    if (p === '/api/chat') {
      if (activeChats >= 3) return json(429, { error: T('Слишком много одновременных запросов к модели. Подождите завершения предыдущих.', 'Too many simultaneous model requests. Wait for the previous ones to finish.') });
      activeChats++; res.on('close', () => { activeChats = Math.max(0, activeChats - 1); });
      return await handleChat(await body(req), res);
    }
    if (p === '/api/complete') return json(200, { text: await complete(await body(req)) });
    if (p === '/api/keys/test') return json(200, { keys: await testKeys((await body(req)).cfg) });
    if (p === '/api/keys/reset') { resetKeys(); return json(200, { ok: true }); }
    if (p === '/api/models') return json(200, { models: await listModels((await body(req)).cfg) });
    if (p === '/api/catalog') return json(200, await catalog());
    if (p === '/api/installed') { const inst = await installedModels(); return json(200, { ollama: inst !== null, installed: inst || [] }); }
    if (p === '/api/git') return json(200, await gitInfo());
    if (p === '/api/ping') { lastPing = Date.now(); return json(200, { ok: true }); }
    if (p === '/api/term/run') return handleTermRun(await body(req), res);
    if (p === '/api/term/input') { const b = await body(req), c = TERMS.get(+b.id); if (c && c.stdin.writable) c.stdin.write(String(b.data ?? '')); return json(200, { ok: !!c }); }
    if (p === '/api/term/kill') { const b = await body(req), c = TERMS.get(+b.id); if (c) killTree(c); return json(200, { ok: !!c }); }
    if (p === '/api/stt/status') return json(200, sttStatus());
    if (p === '/api/stt/install') return await handleSttInstall(await body(req), res);
    if (p === '/api/stt/remove') { fs.rmSync(STT_DIR, { recursive: true, force: true }); return json(200, sttStatus()); }
    if (p === '/api/stt') { const wav = await rawBody(req); return json(200, { text: await transcribe(wav, url.searchParams.get('lang'), url.searchParams.get('size') || 'base') }); }
    if (p === '/api/pull') return await handlePull(await body(req), res);
    if (p === '/api/pick-folder') return json(200, { path: await pickFolder() });
    if (p === '/api/chdir') { const b = await body(req); if (!fs.existsSync(b.path)) throw new Error(T('Папка не найдена', 'Folder not found')); setRoot(b.path); return json(200, { root: ROOT }); }
    json(404, { error: 'not found' });
  } catch (e) { log(req.method, url.pathname, e && e.message); if (!res.headersSent) json(500, { error: explain(e) }); else res.end(); }
});

if (require.main === module) {
server.on('listening', () => {
  const url = `http://localhost:${PORT}/?token=${TOKEN}`;
  console.log(T('\n  LocalCode запущен', '\n  LocalCode is running'));
  console.log(T('  Папка проекта:', '  Project folder:'), ROOT);
  console.log(T('  Откройте:     ', '  Open:          '), url, '\n');
  if (argv.includes('--app') || argv.includes('--open')) ensureOllama();
  setTimeout(warmHW, 4000).unref();   // определение железа в отдельном процессе, чтобы не тормозить окно
  if (argv.includes('--app')) openApp(url);
  else if (argv.includes('--open')) openBrowser(url);
});
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE' && argv.includes('--app') && PORT < BASE_PORT + 20) { PORT++; server.listen(PORT, HOST); return; }
  console.error(e.code === 'EADDRINUSE' ? T(`Порт ${PORT} занят. Запустите с другим: node server.js --port 3001`, `Port ${PORT} is busy. Start with another: node server.js --port 3001`) : e.message); process.exit(1);
});
server.listen(PORT, HOST);
}
module.exports = { HttpError, withKeys, keyState, resetKeys, classifyKeyError, safe, setRoot, replaceInFile, applyPatch, run, search, findPaths, parseDdg, htmlToText, isPrivateHost, fetchUrl, openTarget, VERSION };
