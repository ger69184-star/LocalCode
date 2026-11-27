'use strict';
// Проверяет логику окна (public/app.js) без браузера: подставной DOM, быстрые команды, разбор инструментов, звук, оформление.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), vm = require('vm');
const mk = () => { const store = {}; const f = function () {};
  const p = new Proxy(f, {
    get(t, k) {
      if (k === Symbol.toPrimitive) return () => ''; if (k === 'then') return undefined; if (k === 'length') return 0;
      if (k === 'classList') return { add() {}, remove() {}, toggle() {}, contains() { return false; } };
      if (k === 'style') return { setProperty() {}, removeProperty() {} }; if (k === 'dataset') return store;
      if (k === 'value' && !('value' in store)) return ''; if (k in store) return store[k];
      if (k === 'querySelectorAll') return () => []; if (k === 'getBoundingClientRect') return () => ({ left: 0, top: 0, bottom: 0, right: 0, width: 0, height: 0 });
      return p;
    }, set(t, k, v) { store[k] = v; return true; }, apply() { return p; }, construct() { return p; } });
  return p; };
const ctx = { console, setTimeout, clearTimeout, setInterval: () => 0, requestAnimationFrame: () => 0, cancelAnimationFrame() {},
  document: { querySelector: () => mk(), querySelectorAll: () => [], createElement: () => mk(), head: mk(), body: mk(), documentElement: mk(), addEventListener() {}, title: '' },
  localStorage: {}, sessionStorage: {}, location: { search: '', pathname: '/' }, history: { replaceState() {} }, navigator: { language: 'ru-RU' },
  fetch: () => Promise.reject(new Error('stub')), URLSearchParams, TextDecoder, AbortController, Blob, addEventListener() {}, removeEventListener() {},
  getComputedStyle: () => ({ getPropertyValue: () => '', lineHeight: '20px' }), innerWidth: 1400, innerHeight: 900, confirm: () => false, AudioContext: undefined };
ctx.URL = { createObjectURL: () => 'blob:x', revokeObjectURL() {} }; ctx.window = ctx; vm.createContext(ctx);
for (const f of ['highlight.js', 'i18n.js', 'app.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'app', 'public', f), 'utf8'), ctx, { filename: f });
const ev = (s) => vm.runInContext(s, ctx), R = (s) => ev(`routeIntent(${JSON.stringify(s)})`);
ev("files = ['src/app.js', 'README.md']; tabs = []; activePath = null;");

test('быстрые команды: открыть, создать, музыка, Bluetooth, adb', () => {
  assert.equal(R('открой папку local code на рабочем столе').kind, 'find_open');
  assert.equal(R('открой app.js').kind, 'editor');
  assert.equal(R('включи музыку').kind, 'url');
  assert.equal(R('открой github.com').url, 'https://github.com');
  assert.equal(R('создай папку Тест на рабочем столе').base, '~/Desktop');
  assert.equal(R('создай файл a.txt на рабочем столе с текстом привет').content, 'привет');
  assert.equal(R('удали папку Тест на рабочем столе').kind, 'delete');
  assert.equal(R('включи блютуз').args.action, 'on'); assert.equal(R('подключи наушники').args.action, 'settings');
  assert.match(R('подключись к телефону по adb 192.168.1.5').args.command, /adb connect 192\.168\.1\.5:5555/);
  assert.equal(R('открой калькулятор').args.command, 'start "" calc');
  assert.equal(R('создай калькулятор на питоне').kind, 'codegen');
});
test('быстрые команды: сложные просьбы уходят модели', () => {
  assert.equal(R('открой app.js и объясни что он делает'), null);
  assert.equal(R('объясни этот код'), null);
  assert.equal(R('удали последнюю строку из файла'), null);
});
test('текстовые инструменты и скрытие блоков', () => {
  assert.equal(ev(`parseTextTool('ok <tool>{"name":"find_path","args":{"query":"x",}}</tool>')`).name, 'find_path');
  assert.equal(ev(`parseTextTool('<tool>{"name":"rm_rf","args":{}}</tool>')`), null);
  assert.equal(ev(`visible('Открываю <tool>{"name":"open"')`), 'Открываю');
});
test('WAV 16 кГц собирается корректно', async () => {
  const size = await ev('(async () => { const b = toWav16k([new Float32Array(48000).fill(0.1)], 48000); return b.size; })()');
  assert.equal(size, 44 + 16000 * 2);
});
test('свои быстрые кнопки разбираются', () => {
  const l = ev(`parseQuick('Кратко | Перескажи {file}\\nбез черты\\n | пусто\\nТест | напиши | тест')`);
  assert.equal(l.length, 2); assert.equal(l[0].name, 'Кратко'); assert.equal(l[1].prompt, 'напиши | тест');
});
test('имена файлов для созданных программ', () => {
  assert.equal(ev("slugName('простой калькулятор')"), 'calculator');
  assert.equal(ev("slugName('игру змейка')"), 'game_snake');
});
test('палитра команд и оформление не падают', () => {
  assert.ok(ev('paletteActions().length') > 15);
  ev('applyUi({ ...UI_DEF, chatSide: "left", syntax: "monokai", quickList: "A | b" })');
  assert.equal(ev('uiCfg().asMs'), 1000);
});
test('битые настройки из localStorage нормализуются', () => {
  const c = ev("normalizeCfg({ mode: 'xxx', profile: 'nope', offline: null, online: { preset: 'nope', apiKeys: [' a ', 5, ''] }, theme: 'neon', lang: 'de' })");
  assert.equal(c.mode, 'offline'); assert.equal(c.profile, 'normal'); assert.equal(c.theme, 'dark'); assert.equal(c.lang, 'ru');
  assert.equal(c.offline.baseUrl, ev('PRESETS.offline.ollama.baseUrl'));
  assert.equal(c.offline.model, ev('PRESETS.offline.ollama.model'));
  assert.equal(c.online.preset, 'deepseek'); assert.deepEqual([...c.online.apiKeys], ['a']);
  assert.equal(ev('normalizeCfg(null).mode'), 'offline');
});
test('подсказки провайдеров не пустые', () => { assert.match(ev("presetNote('online','groq')"), /Groq|бесплат/i); });
test('дымовой прогон: функции интерфейса вызываются без ошибок', () => {
  ev("cfg = { mode: 'offline', profile: 'normal', theme: 'dark', lang: 'ru', offline: mkEp('offline', 'ollama'), online: mkEp('online', 'deepseek') }");
  ev("chatHist = [{ role: 'user', content: 'привет' }, { role: 'assistant', content: 'Здравствуйте' }]");
  const calls = ["buildQuick()", "renderQo()", "exportChat()", "copyLast()", "showStat(2.5, 400)", "beep()", "keyNotice({ from: 1, index: 2, total: 3, reason: 'limit' })",
    "choosePath('x', [{ path: 'C:/a' }], 'open')", "hlMatch('abc', 'b', false)", "patchHtml('+a\\n-b')", "askUser({ question: 'q', options: ['a'] })", "scheduleRender()", "renderTreeSoon()",
    "applyUi(UI_DEF)", "readUiForm()", "keysFromForm()", "updateStatus()", "textToolsPrompt()", "systemPrompt(false, true)", "activeTools()", "withCtx('')", "runCmdFor('a.py', true)", "downloadText('a.txt', 'x')", "syncActiveNode()"];
  for (const c of calls) { try { ev(c); } catch (e) { assert.fail(c + ' -> ' + e.message); } }
});
test('новые помощники: размер, время истории, окружение, клавиши', () => {
  assert.equal(ev('fmtSize(900)'), '900 Б');
  assert.match(ev('fmtSize(2048)'), /2 КБ/);
  assert.match(ev('histTime(Date.now())'), /сегодня|today/);
  assert.equal(ev('typeof envText'), 'function');
  assert.ok(ev('keyList().length') >= 17);
  assert.equal(ev("Object.keys(UI_DEF).includes('notify')"), true);
  assert.equal(ev('Object.keys(templates()).length'), 0);
});
setTimeout(() => process.exit(process.exitCode || 0), 50).unref();
