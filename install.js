#!/usr/bin/env node
// Установщик LocalCode: ставит Ollama, подбирает и скачивает модель под ваш ПК, создаёт ярлыки запуска.
// Флаги: --profile ultra|light|normal|strong  --model <имя>  --gguf <файл.gguf>  --yes
//        --online-only (без локальной модели)  --skip-model  --dry-run (ничего не менять)
'use strict';
const os = require('os'), fs = require('fs'), path = require('path'), readline = require('readline');
const { spawnSync, spawn } = require('child_process');

const args = process.argv.slice(2);
const has = (n) => args.includes(n);
const val = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const WIN = process.platform === 'win32', MAC = process.platform === 'darwin';
const APP = fs.existsSync(path.join(__dirname, 'server.js')) ? __dirname : path.resolve(__dirname, '..');
const DRY = has('--dry-run');
const say = (...a) => console.log(...a);
const step = (s) => say('\n\u25B6 ' + s);

const PROFILES = {
  ultra:  { label: 'Ультра-лёгкий (≤4 ГБ ОЗУ)',   base: 'qwen2.5-coder:0.5b', hf: 'hf.co/Qwen/Qwen2.5-Coder-0.5B-Instruct-GGUF:Q4_K_M', ctx: 2048,  predict: 512,  tools: false, ac: false, ui: 'light'  },
  light:  { label: 'Слабый ПК (4–8 ГБ ОЗУ, i3)',  base: 'qwen2.5-coder:1.5b', hf: 'hf.co/Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF:Q4_K_M', ctx: 4096,  predict: 1024, tools: false, ac: false, ui: 'light'  },
  normal: { label: 'Обычный ПК (8–16 ГБ ОЗУ)',    base: 'qwen2.5-coder:3b',   hf: 'hf.co/Qwen/Qwen2.5-Coder-3B-Instruct-GGUF:Q4_K_M',   ctx: 8192,  predict: 2048, tools: false, ac: true,  ui: 'normal' },
  strong: { label: 'Мощный ПК (16+ ГБ ОЗУ)',      base: 'qwen2.5-coder:7b',   hf: 'hf.co/Qwen/Qwen2.5-Coder-7B-Instruct-GGUF:Q4_K_M',   ctx: 16384, predict: 4096, tools: true,  ac: true,  ui: 'strong' },
};
function detect() {
  const gb = os.totalmem() / 2 ** 30, threads = os.cpus().length;
  const key = gb < 4.5 ? 'ultra' : (gb < 10 || threads <= 4) ? 'light' : (gb < 20 || threads < 8) ? 'normal' : 'strong';
  return { gb, threads, cpu: (os.cpus()[0] || {}).model || '?', key };
}
async function ask(q, def = 'y') {
  if (has('--yes')) return def === 'y';
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const a = await new Promise(r => rl.question(`${q} [${def === 'y' ? 'Y/n' : 'y/N'}] `, r)); rl.close();
  return a.trim() ? /^(y|д)/i.test(a.trim()) : def === 'y';
}
const run = (cmd, a, o = {}) => DRY ? (say('  [dry-run]', cmd, a.join(' ')), { status: 0 }) : spawnSync(cmd, a, { stdio: 'inherit', shell: WIN && o.shell !== false, ...o });

function ollamaBin() {
  const c = ['ollama'];
  if (WIN) c.push(path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe'));
  if (MAC) c.push('/usr/local/bin/ollama', '/opt/homebrew/bin/ollama', '/Applications/Ollama.app/Contents/Resources/ollama');
  for (const b of c) { const r = spawnSync(b, ['--version'], { encoding: 'utf8', shell: false }); if (r.status === 0) return b; }
  return null;
}
async function download(url, dest) {
  if (new URL(url).protocol !== 'https:') throw new Error('Разрешены только https-загрузки');
  const r = await fetch(url); if (!r.ok) throw new Error('HTTP ' + r.status);
  if (!/^https:/.test(r.url)) throw new Error('Загрузка перенаправлена на небезопасный адрес');
  const total = +r.headers.get('content-length') || 0; let got = 0, last = 0;
  const out = fs.createWriteStream(dest);
  for await (const chunk of r.body) { out.write(chunk); got += chunk.length; if (total && Date.now() - last > 500) { last = Date.now(); process.stdout.write(`\r  ${(got / 2 ** 20).toFixed(0)} / ${(total / 2 ** 20).toFixed(0)} МБ`); } }
  await new Promise(r => out.end(r)); say('');
}
async function installOllama() {
  if (WIN) {
    say('  Ставлю через winget…'); run('winget', ['install', '-e', '--id', 'Ollama.Ollama', '--accept-source-agreements', '--accept-package-agreements']);
    if (ollamaBin()) return;
    say('  winget не сработал — скачиваю установщик напрямую…');
    const f = path.join(os.tmpdir(), 'OllamaSetup.exe'); await download('https://ollama.com/download/OllamaSetup.exe', f); run(f, ['/SILENT'], { shell: false });
  } else if (MAC) {
    if (spawnSync('brew', ['--version']).status === 0) run('brew', ['install', 'ollama']);
    else say('  Установите Ollama вручную: https://ollama.com/download и запустите установщик ещё раз.');
  } else run('sh', ['-c', "curl -fsSL --proto '=https' --tlsv1.2 https://ollama.com/install.sh | sh"], { shell: false });
}
async function alive() { try { return (await fetch('http://127.0.0.1:11434/api/version', { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; } }
const tuneEnv = (low) => ({ ...process.env, OLLAMA_NUM_PARALLEL: '1', OLLAMA_MAX_LOADED_MODELS: '1', OLLAMA_KEEP_ALIVE: '30m', ...(low ? { OLLAMA_FLASH_ATTENTION: '1', OLLAMA_KV_CACHE_TYPE: 'q8_0' } : {}) });
async function ensureServer(bin, low) {
  if (DRY || await alive()) return;
  say('  Запускаю сервер Ollama…'); spawn(bin, ['serve'], { detached: true, stdio: 'ignore', env: tuneEnv(low) }).unref();
  for (let i = 0; i < 30; i++) { if (await alive()) return; await new Promise(r => setTimeout(r, 1000)); }
  throw new Error('Ollama не отвечает на 127.0.0.1:11434');
}

async function main() {
  say('\n=== Установщик LocalCode ===');
  if (+process.versions.node.split('.')[0] < 18) throw new Error('Нужен Node.js 18 или новее: https://nodejs.org');
  const d = detect();
  say(`Компьютер: ${d.cpu}, потоков: ${d.threads}, ОЗУ: ${d.gb.toFixed(1)} ГБ, ${process.platform}`);
  let key = val('--profile') || d.key; if (!PROFILES[key]) throw new Error('Профиль: ultra | light | normal | strong');
  const P = PROFILES[key];
  say(`Подобран профиль: ${P.label}\n  модель ${P.base}, контекст ${P.ctx}`);
  const online = has('--online-only');
  const defaults = { mode: online ? 'online' : 'offline', profile: P.ui, autocomplete: P.ac, useTools: P.tools, model: online ? undefined : 'localcode-' + key };
  let bin = null;

  if (!online) {
    if (!has('--yes') && !DRY && !(await ask('Продолжить установку?'))) return say('Отменено.');
    step('1/4  Ollama (движок для локальных моделей)');
    bin = ollamaBin();
    if (bin) say('  уже установлен:', bin); else { await installOllama(); bin = ollamaBin(); if (!bin && !DRY) throw new Error('Не удалось установить Ollama. Скачайте вручную: https://ollama.com/download'); bin = bin || 'ollama'; }
    await ensureServer(bin, key === 'ultra' || key === 'light');

    if (!has('--skip-model')) {
      step(`2/4  Модель ${val('--model') || P.base} (скачивание)`);
      let base = val('--model') || P.base, ok = false;
      const gguf = val('--gguf');
      if (gguf) {
        const mf = path.join(os.tmpdir(), 'Modelfile.gguf');
        fs.writeFileSync(mf, `FROM ${path.resolve(gguf)}\nTEMPLATE """{{- if .System }}<|im_start|>system\n{{ .System }}<|im_end|>\n{{ end }}<|im_start|>user\n{{ .Prompt }}<|im_end|>\n<|im_start|>assistant\n"""\nPARAMETER stop "<|im_end|>"\n`);
        base = 'localcode-gguf-base'; ok = run(bin, ['create', base, '-f', mf]).status === 0;
      } else {
        ok = run(bin, ['pull', base]).status === 0;
        if (!ok && !val('--model')) { say('  Реестр Ollama недоступен — пробую зеркало Hugging Face…'); base = P.hf; ok = run(bin, ['pull', base]).status === 0; }
      }
      if (!ok && !DRY) throw new Error('Не удалось скачать модель. Варианты: повторить позже, или скачать файл *.gguf любым способом и запустить: install --gguf путь/к/файлу.gguf');

      step('3/4  Тонкая настройка под ваш ПК');
      const mf = path.join(os.tmpdir(), 'Modelfile.localcode');
      if (!DRY) fs.writeFileSync(mf, `FROM ${base}\nPARAMETER num_ctx ${P.ctx}\nPARAMETER num_predict ${P.predict}\nPARAMETER temperature 0.2\n`);
      if (run(bin, ['create', 'localcode-' + key, '-f', mf]).status !== 0 && !DRY) throw new Error('Не удалось создать модель localcode-' + key);
      if (WIN && (key === 'ultra' || key === 'light') && !DRY) for (const [k, v] of Object.entries({ OLLAMA_NUM_PARALLEL: 1, OLLAMA_MAX_LOADED_MODELS: 1, OLLAMA_KEEP_ALIVE: '30m', OLLAMA_FLASH_ATTENTION: 1, OLLAMA_KV_CACHE_TYPE: 'q8_0' })) spawnSync('setx', [k, String(v)], { stdio: 'ignore' });
    }
  }

  step(online ? '1/1  Настройка и ярлыки' : '4/4  Ярлыки запуска и настройки');
  if (!DRY) {
    const dir = path.join(os.homedir(), '.localcode'); fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, 'config.json'); let c = {}; try { c = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
    fs.writeFileSync(f, JSON.stringify({ ...c, defaults }, null, 2));
    writeLaunchers(bin, key);
  } else say('  [dry-run] настройки:', JSON.stringify(defaults));

  if (!online && !DRY && !has('--skip-model')) {
    step('Проверка скорости');
    try {
      const r = await (await fetch('http://127.0.0.1:11434/api/generate', { method: 'POST', body: JSON.stringify({ model: 'localcode-' + key, prompt: 'Напиши функцию сложения на Python', stream: false, options: { num_predict: 60 } }) })).json();
      const tps = r.eval_count / (r.eval_duration / 1e9);
      say(`  ~${tps.toFixed(1)} токенов/с` + (tps < 4 ? ' — медленно. Для режима «Слабый ПК» это нормально; попробуйте --profile ultra или онлайн-режим.' : ' — комфортно.'));
    } catch (e) { say('  пропущено:', e.message); }
  }
  say('\n\u2705 Готово! Запустите LocalCode ярлыком на рабочем столе или файлом ' + (WIN ? 'LocalCode.bat' : 'localcode.sh') + '\nВ приложении переключатель «Офлайн/Онлайн» вверху: для облака вставьте API-ключ в Настройках.\n');
}

function writeLaunchers(bin, key) {
  const low = key === 'ultra' || key === 'light';
  if (WIN) {
    const ol = bin && bin !== 'ollama' ? bin : 'ollama';
    const bat = `@echo off\r\nchcp 65001 >nul\r\ncd /d "%~dp0"\r\n${bin ? `set OLLAMA_NUM_PARALLEL=1\r\nset OLLAMA_MAX_LOADED_MODELS=1\r\nset OLLAMA_KEEP_ALIVE=30m\r\n${low ? 'set OLLAMA_FLASH_ATTENTION=1\r\nset OLLAMA_KV_CACHE_TYPE=q8_0\r\n' : ''}powershell -NoProfile -Command "try{Invoke-WebRequest -UseBasicParsing http://127.0.0.1:11434/api/version -TimeoutSec 2 | Out-Null}catch{Start-Process -WindowStyle Hidden '${ol}' 'serve'}"\r\n` : ''}node server.js --open %*\r\npause\r\n`;
    const f = path.join(APP, 'LocalCode.bat'); if (!fs.existsSync(f)) { fs.writeFileSync(f, bat); say('  создан', f); }
    const ps = `$d=[Environment]::GetFolderPath('Desktop');$s=(New-Object -ComObject WScript.Shell).CreateShortcut("$d\\LocalCode.lnk");$s.TargetPath='${fs.existsSync(path.join(APP, 'LocalCode.vbs')) ? path.join(APP, 'LocalCode.vbs') : f}';$s.WorkingDirectory='${APP}';$s.Save()`;
    if (spawnSync('powershell', ['-NoProfile', '-Command', ps], { stdio: 'ignore' }).status === 0) say('  ярлык на рабочем столе создан');
  } else {
    const sh = `#!/usr/bin/env sh\ncd "$(dirname "$0")"\n${bin ? `export OLLAMA_NUM_PARALLEL=1 OLLAMA_MAX_LOADED_MODELS=1 OLLAMA_KEEP_ALIVE=30m${low ? ' OLLAMA_FLASH_ATTENTION=1 OLLAMA_KV_CACHE_TYPE=q8_0' : ''}\ncurl -fs http://127.0.0.1:11434/api/version >/dev/null 2>&1 || (nohup "${bin}" serve >/dev/null 2>&1 &)\nsleep 1\n` : ''}exec node server.js --open "$@"\n`;
    for (const n of MAC ? ['localcode.sh', 'LocalCode.command'] : ['localcode.sh']) { const f = path.join(APP, n); fs.writeFileSync(f, sh, { mode: 0o755 }); say('  создан', f); }
  }
}
main().catch(e => { console.error('\n\u274C ' + e.message); process.exit(1); });
