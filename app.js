'use strict';
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = HL.esc;
const escA = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const tr = (...a) => t(...a);                       // перевод (t из i18n.js; внутри функций с локальной t используем tr)
const L2 = (ru, en) => (LANG === 'ru' ? ru : en);   // двуязычные строки (промпты)
applyI18n();

/* ================= API ================= */
const sp = new URLSearchParams(location.search);
if (sp.get('token')) { sessionStorage.token = sp.get('token'); window.history.replaceState(null, '', '/'); }
const TOKEN = sessionStorage.token || '';
const H = () => ({ 'x-token': TOKEN, 'Content-Type': 'application/json', 'x-lang': LANG });
async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: H() });
  const j = await r.json().catch(() => ({ error: tr('err_resp') }));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}
const post = (p, d, signal) => api(p, { method: 'POST', body: JSON.stringify(d), signal });
function toast(t, ms = 2500) { const e = $('#toast'); e.textContent = t; e.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => e.hidden = true, ms); }

/* ================= Конфиг ================= */
const PRESETS = {
  offline: {
    ollama: { label: 'Ollama (на этом ПК)', baseUrl: 'http://localhost:11434/v1', model: 'localcode-light', kind: 'openai', authPrefix: 'Bearer', tools: false,
      models: ['localcode-light', 'qwen2.5-coder:1.5b', 'qwen2.5-coder:3b', 'qwen2.5-coder:7b'], note: 'Полностью офлайн. Установщик сам ставит Ollama и подходящую модель. Ключ не нужен.' },
    lmstudio: { label: 'LM Studio (на этом ПК)', baseUrl: 'http://localhost:1234/v1', model: 'local-model', kind: 'openai', authPrefix: 'Bearer', tools: false, models: [], note: 'Запустите локальный сервер в LM Studio; имя модели — из его интерфейса.' },
    custom: { label: 'Другой локальный сервер', baseUrl: 'http://localhost:8080/v1', model: '', kind: 'openai', authPrefix: 'Bearer', tools: false, models: [], note: 'llama.cpp server, vLLM и любой OpenAI-совместимый сервер.' },
  },
  online: {
    anthropic: { label: 'Anthropic (Claude)', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-5-5', kind: 'anthropic', authPrefix: 'Bearer', tools: true,
      models: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'], note: 'Ключ из console.anthropic.com. Поддерживает агента (инструменты). Доступность зависит от вашей сети/региона.' },
    deepseek: { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', kind: 'openai', authPrefix: 'Bearer', tools: true, models: ['deepseek-chat', 'deepseek-reasoner'], note: 'Дёшево и хорошо пишет код. Ключ: platform.deepseek.com.' },
    groq: { label: 'Groq (бесплатный тариф)', baseUrl: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-120b', kind: 'openai', authPrefix: 'Bearer', tools: true, models: ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'qwen/qwen3-32b'], note: 'Бесплатно, карта не нужна. Ключ: console.groq.com/keys. Если модель не найдена — нажмите «Список».' },
    gemini: { label: 'Google Gemini (бесплатный тариф)', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash', kind: 'openai', authPrefix: 'Bearer', tools: true, models: ['gemini-2.5-flash', 'gemini-2.5-pro'], note: 'Бесплатный ключ: aistudio.google.com/apikey. Если модель не найдена — нажмите «Список».' },
    openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1', kind: 'openai', authPrefix: 'Bearer', tools: true, models: ['gpt-4.1', 'gpt-4o', 'gpt-4o-mini'], note: 'Ключ: platform.openai.com.' },
    openrouter: { label: 'OpenRouter (много моделей)', baseUrl: 'https://openrouter.ai/api/v1', model: 'deepseek/deepseek-chat', kind: 'openai', authPrefix: 'Bearer', tools: true, models: ['deepseek/deepseek-chat', 'qwen/qwen-2.5-coder-32b-instruct'], note: 'Один ключ — сотни моделей.' },
    qwen: { label: 'Alibaba Qwen (DashScope)', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', kind: 'openai', authPrefix: 'Bearer', tools: true, models: ['qwen-plus', 'qwen3-coder-plus'], note: '' },
    moonshot: { label: 'Moonshot (Kimi)', baseUrl: 'https://api.moonshot.cn/v1', model: 'kimi-k2-0905-preview', kind: 'openai', authPrefix: 'Bearer', tools: true, models: ['kimi-k2-0905-preview'], note: '' },
    yandex: { label: 'Yandex AI Studio', baseUrl: 'https://llm.api.cloud.yandex.net/v1', model: 'gpt://<folder_id>/yandexgpt/latest', kind: 'openai', authPrefix: 'Api-Key', tools: false, models: [], note: 'В модели подставьте свой folder_id. Ключ — API-ключ сервисного аккаунта.' },
    custom: { label: 'Другой сервис (свой URL)', baseUrl: '', model: '', kind: 'openai', authPrefix: 'Bearer', tools: true, models: [], note: 'Любой OpenAI-совместимый или Anthropic-совместимый API.' },
  },
};
const PROFILES = {
  light: { ctxChars: 6000, hist: 6, acDelay: 1000, numCtx: 6144 },
  normal: { ctxChars: 20000, hist: 14, acDelay: 600, numCtx: 8192 },
  strong: { ctxChars: 40000, hist: 30, acDelay: 400, numCtx: 16384 },
};
const mkEp = (mode, preset) => { const p = PRESETS[mode][preset]; return { preset, baseUrl: p.baseUrl, model: p.model, kind: p.kind, authPrefix: p.authPrefix, useTools: p.tools, apiKey: '', apiKeys: [] }; };
let cfg = JSON.parse(localStorage.lc_cfg2 || 'null');
const saveCfg = () => localStorage.lc_cfg2 = JSON.stringify(cfg);
function initCfg(d) {
  if (cfg) return;
  cfg = { mode: d.mode || 'offline', profile: d.profile || 'normal', autocomplete: !!d.autocomplete, theme: 'dark', lang: LANG, autosave: false, offline: mkEp('offline', 'ollama'), online: mkEp('online', 'deepseek') };
  if (d.model) cfg.offline.model = d.model;
  if (d.useTools != null) cfg.offline.useTools = d.useTools;
  saveCfg();
}
const ep = () => cfg[cfg.mode];
const toServer = (e) => ({ baseUrl: e.baseUrl, apiKey: e.apiKey, apiKeys: e.apiKeys, authPrefix: e.authPrefix, kind: e.kind, model: e.model });
const P = () => PROFILES[cfg.profile] || PROFILES.normal;

/* ================= LLM ================= */
function keyNotice(o) {
  const why = L2({ limit: 'лимит запросов', balance: 'нет средств на счёте', invalid: 'ключ не принят' }[o.reason] || 'ошибка ключа', { limit: 'rate limit', balance: 'no credit', invalid: 'key rejected' }[o.reason] || 'key error');
  addMsg('sys', esc(L2(`🔑 Ключ №${o.from} недоступен (${why}) — автоматически переключился на ключ №${o.index} из ${o.total}.`, `🔑 Key #${o.from} unavailable (${why}) — switched automatically to key #${o.index} of ${o.total}.`)));
}
async function llm(messages, { tools, onDelta, signal, opts, e } = {}) {
  const r = await fetch('/api/chat', { method: 'POST', headers: H(),
    body: JSON.stringify({ cfg: toServer(e || ep()), messages, tools, opts: { numCtx: P().numCtx, ...(opts || {}) } }), signal });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const reader = r.body.getReader(), dec = new TextDecoder(); let buf = '', msg = null;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line) continue;
      const o = JSON.parse(line);
      if (o.t === 'delta') onDelta && onDelta(o.v);
      else if (o.t === 'error') throw new Error(o.v);
      else if (o.t === 'key') keyNotice(o);
      else if (o.t === 'done') msg = o.message;
    }
  }
  if (!msg) throw new Error(tr('err_empty'));
  return msg;
}

/* ================= Состояние ================= */
let info = {}, files = [], rules = '';
let tabs = [], activePath = null;
const ed = $('#editor'), hl = $('#hl');
const cur = () => tabs.find(t => t.path === activePath);
const langNow = () => cur() ? HL.langOf(cur().path) : 'txt';

/* ================= Дерево ================= */
const expanded = new Set(['']);
async function renderTree() {
  const box = $('#tree'); const frag = document.createDocumentFragment();
  async function walk(dir, depth) {
    let items; try { items = await api('/api/tree?path=' + encodeURIComponent(dir)); } catch { return; }
    for (const it of items) {
      const el = document.createElement('div');
      el.className = 'node' + (it.path === activePath ? ' active' : '');
      el.style.paddingLeft = 8 + depth * 14 + 'px';
      el.innerHTML = `<span class="ic">${it.dir ? (expanded.has(it.path) ? '▾' : '▸') : '·'}</span><span>${esc(it.name)}</span>`;
      el.onclick = () => { if (it.dir) { expanded.has(it.path) ? expanded.delete(it.path) : expanded.add(it.path); renderTree(); } else openFile(it.path); };
      el.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); nodeMenu(e, it); };
      frag.appendChild(el);
      if (it.dir && expanded.has(it.path)) await walk(it.path, depth + 1);
    }
  }
  await walk('', 0); box.replaceChildren(frag);
  api('/api/files').then(f => files = f).catch(() => {});
}
$('#tree').oncontextmenu = (e) => { e.preventDefault(); nodeMenu(e, null); };
$('#refresh').onclick = renderTree;
function showMenu(e, items) {
  const m = $('#menu'); m.innerHTML = '';
  for (const it of items) {
    if (it === '-') { m.appendChild(document.createElement('hr')); continue; }
    const d = document.createElement('div'); d.textContent = it[0]; d.onclick = () => { m.hidden = true; it[1](); }; m.appendChild(d);
  }
  m.hidden = false; m.style.left = Math.min(e.clientX, innerWidth - 200) + 'px'; m.style.top = Math.min(e.clientY, innerHeight - 40 * items.length) + 'px';
}
addEventListener('click', () => { $('#menu').hidden = true; });
function nodeMenu(e, it) {
  const dir = it ? (it.dir ? it.path : it.path.split('/').slice(0, -1).join('/')) : '';
  const items = [[tr('m_newfile'), () => newFile(dir)], [tr('m_newdir'), () => newDir(dir)]];
  if (it) items.push('-', [tr('m_rename'), () => renameNode(it)], [tr('m_delete'), () => deleteNode(it)]);
  showMenu(e, items);
}
const join = (d, n) => (d ? d + '/' : '') + n;
async function newFile(dir = '') { const n = prompt(tr('new_file_q')); if (!n) return; try { await post('/api/fsop', { op: 'create', path: join(dir, n) }); if (dir) expanded.add(dir); await renderTree(); openFile(join(dir, n)); } catch (e) { toast(e.message); } }
async function newDir(dir = '') { const n = prompt(tr('new_dir_q')); if (!n) return; try { await post('/api/fsop', { op: 'mkdir', path: join(dir, n) }); if (dir) expanded.add(dir); renderTree(); } catch (e) { toast(e.message); } }
async function renameNode(it) {
  const n = prompt(tr('rename_q'), it.name); if (!n || n === it.name) return;
  const to = join(it.path.split('/').slice(0, -1).join('/'), n);
  try { await post('/api/fsop', { op: 'rename', path: it.path, to }); tabs.forEach(t => { if (t.path === it.path) t.path = to; }); if (activePath === it.path) activePath = to; renderTabs(); renderTree(); } catch (e) { toast(e.message); }
}
async function deleteNode(it) {
  if (!confirm(tr('del_q', it.path))) return;
  try { await post('/api/fsop', { op: 'delete', path: it.path }); tabs = tabs.filter(t => t.path !== it.path && !t.path.startsWith(it.path + '/')); if (!cur()) activePath = tabs.length ? tabs[tabs.length - 1].path : null; activate(activePath); renderTree(); } catch (e) { toast(e.message); }
}
$('#newFile').onclick = () => newFile(''); $('#newDir').onclick = () => newDir('');
$$('.stabs button').forEach(b => b.onclick = () => { $$('.stabs button').forEach(x => x.classList.toggle('on', x === b)); $('#pFiles').hidden = b.dataset.p !== 'files'; $('#pSearch').hidden = b.dataset.p !== 'search'; if (b.dataset.p === 'search') $('#sQ').focus(); });
function hlMatch(text, q, isRe) {
  let re; try { re = new RegExp(isRe ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'); } catch { return esc(text); }
  let out = '', last = 0, m;
  while ((m = re.exec(text)) && m[0]) { out += esc(text.slice(last, m.index)) + '<mark>' + esc(m[0]) + '</mark>'; last = m.index + m[0].length; }
  return out + esc(text.slice(last));
}
$('#sQ').addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter' || !e.target.value.trim()) return;
  const box = $('#sRes'); box.textContent = tr('searching');
  try {
    const sq = e.target.value.trim(), isRe = $('#sRegex').checked;
    const { result } = await post('/api/tool', { name: 'search', args: { query: sq, regex: isRe } });
    box.innerHTML = '';
    for (const line of result.split('\n')) {
      const m = line.match(/^(.+?):(\d+): (.*)$/); if (!m) { box.textContent = line; continue; }
      const d = document.createElement('div'); d.className = 'hit'; d.innerHTML = `<b>${esc(m[1])}:${m[2]}</b><span>${hlMatch(m[3], sq, isRe)}</span>`;
      d.onclick = async () => { await openFile(m[1]); goToLine(+m[2]); }; box.appendChild(d);
    }
  } catch (er) { box.textContent = er.message; }
});

/* ================= Вкладки и редактор ================= */
function renderTabs() {
  const box = $('#tabs'); box.innerHTML = '';
  for (const t of tabs) {
    const el = document.createElement('div'); el.className = 'tab' + (t.path === activePath ? ' active' : ''); el.title = t.path;
    el.innerHTML = `<span>${esc(t.path.split('/').pop())}</span>${t.dirty ? '<span class="dot">●</span>' : ''}<span class="x">✕</span>`;
    el.onclick = (e) => e.target.classList.contains('x') ? closeTab(t.path) : activate(t.path);
    box.appendChild(el);
  }
  $('#empty').hidden = !!tabs.length;
  $('#stLang').textContent = cur() ? langNow().toUpperCase() : '';
  if (tabsReady && info.root) { try { localStorage['lc_tabs:' + info.root] = JSON.stringify({ paths: tabs.map(x => x.path), active: activePath }); } catch {} }
}
let tabsReady = false;
let rrId = 0;
function scheduleRender() { if (!rrId) rrId = requestAnimationFrame(() => { rrId = 0; render(); }); }
function render() {
  const t = cur(), code = ed.value;
  if (!t) { hl.innerHTML = ''; $('#gutIn').textContent = ''; return; }
  const lang = langNow();
  const plain = code.length > 150000;
  ed.classList.toggle('plain', plain); hl.hidden = plain;
  if (!plain) {
    if (ghost && ghost.pos <= code.length) hl.innerHTML = HL.highlight(code.slice(0, ghost.pos), lang) + `<span class="ghostText">${esc(ghost.text)}</span>` + HL.highlight(code.slice(ghost.pos), lang) + '\n';
    else hl.innerHTML = HL.highlight(code, lang) + '\n';
  }
  const n = code.split('\n').length;
  if (render.n !== n) { render.n = n; $('#gutIn').textContent = Array.from({ length: n }, (_, i) => i + 1).join('\n'); }
}
function activate(p) {
  const prevT = cur(); if (cfg.autosave && prevT && prevT.dirty && prevT.path !== p) saveTab(prevT, true);
  activePath = p; clearGhost(); hideInline();
  const t = cur(); ed.value = t ? t.content : ''; render.n = 0; render(); renderTabs(); renderTree(); syncScroll(); updateStatus();
  if (t) { ed.scrollTop = t.scroll || 0; syncScroll(); }
}
async function openFile(p, force) {
  let t = tabs.find(x => x.path === p);
  if (!t || force) {
    try {
      const { content } = await api('/api/file?path=' + encodeURIComponent(p));
      if (t) { t.content = content; t.dirty = false; } else { t = { path: p, content, dirty: false }; tabs.push(t); }
    } catch (e) { toast(tr('cant_open', p, e.message)); return; }
  }
  const prev = cur(); if (prev) prev.scroll = ed.scrollTop;
  activate(p);
}
function closeTab(p) {
  const t = tabs.find(x => x.path === p);
  if (t && t.dirty && !confirm(tr('unsaved'))) return;
  const i = tabs.indexOf(t); tabs = tabs.filter(x => x !== t);
  activate(activePath === p ? (tabs[Math.min(i, tabs.length - 1)] || {}).path || null : activePath);
}
async function saveTab(t, quiet) {
  const snap = t.content;
  try { await post('/api/file', { path: t.path, content: snap }); if (t.content === snap) t.dirty = false; renderTabs(); if (!quiet) toast(tr('saved'), 900); refreshGitSoon(); }
  catch (e) { toast(e.message); }
}
function save() { const t = cur(); if (t) return saveTab(t, false); }
let asTimer = 0;
function scheduleAutosave(t) { if (!cfg.autosave || !t) return; clearTimeout(asTimer); asTimer = setTimeout(() => { if (t.dirty && tabs.includes(t)) saveTab(t, true); }, uiCfg().asMs || 1000); }
function syncScroll() { hl.style.transform = `translate(${-ed.scrollLeft}px,${-ed.scrollTop}px)`; $('#gutIn').style.transform = `translateY(${-ed.scrollTop + 0}px)`; }
ed.addEventListener('scroll', syncScroll);
ed.addEventListener('input', () => { const t = cur(); if (t) { t.content = ed.value; t.dirty = true; renderTabs(); scheduleAutosave(t); } clearGhost(true); scheduleRender(); scheduleAC(); });
function goToLine(n) {
  const lines = ed.value.split('\n'); n = Math.max(1, Math.min(n, lines.length));
  const off = lines.slice(0, n - 1).reduce((a, l) => a + l.length + 1, 0);
  ed.focus(); ed.setSelectionRange(off, off + lines[n - 1].length); ed.scrollTop = Math.max(0, (n - 1) * (parseFloat(getComputedStyle(ed).lineHeight) || 20) - 120); syncScroll();
}
function updateStatus() {
  const p = ed.selectionStart, b = ed.value.slice(0, p), ln = b.split('\n');
  $('#stPos').textContent = cur() ? tr('st_pos', ln.length, ln[ln.length - 1].length + 1) : '';
}
document.addEventListener('selectionchange', () => { if (document.activeElement === ed) { updateStatus(); if (ghost && ed.selectionStart !== ghost.pos) clearGhost(); } });

/* ---- редактирование: отступы, пары, комментарии ---- */
const ins = (t) => document.execCommand('insertText', false, t);
const CLOSE = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' };
function lineRange() { const v = ed.value; const s = v.lastIndexOf('\n', ed.selectionStart - 1) + 1; let e = v.indexOf('\n', ed.selectionEnd); if (e < 0) e = v.length; return [s, e]; }
function replaceLines(fn) { const [s, e] = lineRange(); const out = fn(ed.value.slice(s, e).split('\n')).join('\n'); ed.setSelectionRange(s, e); ins(out); ed.setSelectionRange(s, s + out.length); }
ed.addEventListener('keydown', (e) => {
  if (ghost && e.key === 'Tab') { e.preventDefault(); acceptGhost(); return; }
  if (e.key === 'Escape' && ghost) { clearGhost(); return; }
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key === '/') { e.preventDefault(); const c = HL.commentOf(langNow()); if (!c) return; replaceLines(ls => { const all = ls.every(l => !l.trim() || l.trimStart().startsWith(c.trim())); return ls.map(l => !l.trim() ? l : all ? l.replace(c.trim() + ' ', '').replace(c.trim(), '') : l.replace(/^(\s*)/, '$1' + c)); }); return; }
  if (e.key === 'Tab') { e.preventDefault(); if (ed.selectionStart === ed.selectionEnd && !e.shiftKey) ins(IND()); else replaceLines(ls => ls.map(l => e.shiftKey ? l.replace(new RegExp('^( {1,' + IND().length + '}|\\t)'), '') : IND() + l)); return; }
  if (e.key === 'Enter' && !mod && !e.shiftKey && ed.selectionStart === ed.selectionEnd) {
    const v = ed.value, p = ed.selectionStart, ls = v.lastIndexOf('\n', p - 1) + 1, line = v.slice(ls, p), ind = line.match(/^\s*/)[0];
    const prev = v[p - 1], next = v[p]; e.preventDefault();
    if (prev && '{(['.includes(prev) && CLOSE[prev] === next) { ins('\n' + ind + '  \n' + ind); ed.setSelectionRange(p + 1 + ind.length + 2, p + 1 + ind.length + 2); }
    else ins('\n' + ind + (/[{(\[]$/.test(line.trimEnd()) || (langNow() === 'py' && /:$/.test(line.trimEnd())) ? IND() : ''));
    return;
  }
  if (!mod && e.key.length === 1) {
    const v = ed.value, p = ed.selectionStart, a = ed.selectionEnd, next = v[p], prev = v[p - 1];
    if (p === a && ')]}"\'`'.includes(e.key) && next === e.key) { e.preventDefault(); ed.setSelectionRange(p + 1, p + 1); return; }
    if (CLOSE[e.key] && (!next || /[\s)\]};,]/.test(next))) {
      if (p !== a) { e.preventDefault(); const sel = v.slice(p, a); ins(e.key + sel + CLOSE[e.key]); return; }
      if ('"\'`'.includes(e.key) && prev && /[\w]/.test(prev)) return;
      e.preventDefault(); ins(e.key + CLOSE[e.key]); ed.setSelectionRange(p + 1, p + 1);
    }
  }
});

/* ================= Автодополнение (ghost) ================= */
let ghost = null, acTimer = 0, acCtl = null, acSeq = 0;
function clearGhost(skipRender) { if (ghost) { ghost = null; if (!skipRender) render(); } }
function acceptGhost() { const g = ghost; ghost = null; ed.setSelectionRange(g.pos, g.pos); ins(g.text); }
function scheduleAC() {
  clearTimeout(acTimer); if (acCtl) acCtl.abort();
  if (!cfg.autocomplete || !cur()) return;
  acTimer = setTimeout(runAC, uiCfg().acMs || P().acDelay);
}
async function runAC() {
  const v = ed.value, pos = ed.selectionStart; if (pos !== ed.selectionEnd || pos < 3) return;
  const le = v.indexOf('\n', pos); if (v.slice(pos, le < 0 ? undefined : le).trim()) return;
  const seq = ++acSeq; acCtl = new AbortController(); $('#stAI').textContent = tr('st_aithink');
  try {
    const j = await post('/api/complete', { cfg: toServer(ep()), prefix: v.slice(Math.max(0, pos - 2000), pos), suffix: v.slice(pos, pos + 500), path: cur().path }, acCtl.signal);
    if (seq === acSeq && ed.selectionStart === pos && ed.value === v && j.text && j.text.trim()) { ghost = { pos, text: j.text }; render(); }
  } catch {} finally { if (seq === acSeq) $('#stAI').textContent = ''; }
}

/* ================= Diff ================= */
function diffLines(a, b) {
  const A = a.split('\n'), B = b.split('\n'); let s = 0;
  while (s < A.length && s < B.length && A[s] === B[s]) s++;
  let ea = A.length, eb = B.length;
  while (ea > s && eb > s && A[ea - 1] === B[eb - 1]) { ea--; eb--; }
  const a2 = A.slice(s, ea), b2 = B.slice(s, eb), ops = [];
  for (let i = 0; i < s; i++) ops.push([' ', A[i]]);
  if (a2.length * b2.length > 2.5e6) { a2.forEach(l => ops.push(['-', l])); b2.forEach(l => ops.push(['+', l])); }
  else {
    const n = a2.length, m = b2.length, W = m + 1, L = new Uint32Array((n + 1) * W);
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i * W + j] = a2[i] === b2[j] ? L[(i + 1) * W + j + 1] + 1 : Math.max(L[(i + 1) * W + j], L[i * W + j + 1]);
    let i = 0, j = 0;
    while (i < n && j < m) { if (a2[i] === b2[j]) { ops.push([' ', a2[i]]); i++; j++; } else if (L[(i + 1) * W + j] >= L[i * W + j + 1]) ops.push(['-', a2[i++]]); else ops.push(['+', b2[j++]]); }
    while (i < n) ops.push(['-', a2[i++]]); while (j < m) ops.push(['+', b2[j++]]);
  }
  for (let i = ea; i < A.length; i++) ops.push([' ', A[i]]);
  return ops;
}
function diffHtml(a, b) {
  const ops = diffLines(a, b), keep = new Set();
  ops.forEach((o, i) => { if (o[0] !== ' ') for (let k = i - 2; k <= i + 2; k++) keep.add(k); });
  let out = '', skipped = false;
  ops.forEach((o, i) => {
    if (o[0] === ' ' && !keep.has(i)) { if (!skipped) out += '<span class="dl skip">⋯</span>'; skipped = true; return; }
    skipped = false;
    out += `<span class="dl ${o[0] === '+' ? 'add' : o[0] === '-' ? 'del' : ''}">${o[0] === ' ' ? ' ' : o[0]} ${esc(o[1])}</span>`;
  });
  return out || `<span class="dl skip">${esc(tr('no_changes'))}</span>`;
}

/* ================= Ctrl+K: правка выделенного ================= */
let inl = null, inlCtl = null;
function hideInline() { $('#inline').hidden = true; inl = null; if (inlCtl) inlCtl.abort(); }
function openInline() {
  if (!cur()) return toast(tr('open_file'));
  inl = { s: ed.selectionStart, e: ed.selectionEnd, res: '' };
  $('#inline').hidden = false; $('#inlPrev').hidden = true; $('#inlInput').value = ''; $('#inlInput').focus();
  $('#inlHint').textContent = inl.s === inl.e ? tr('i_insert') : tr('i_sel', ed.value.slice(inl.s, inl.e).split('\n').length);
}
$('#inlInput').addEventListener('keydown', async (e) => {
  if (e.key === 'Escape') { hideInline(); ed.focus(); return; }
  if (e.key !== 'Enter' || !e.target.value.trim() || !inl) return;
  const v = ed.value, sel = v.slice(inl.s, inl.e);
  const ctx = P().ctxChars / 2;
  const msgs = [
    { role: 'system', content: 'You are a code editor. Return ONLY the new code that replaces the selected fragment (or is inserted at the cursor if the selection is empty) — no explanations and no markdown fences. Keep the indentation and style of the file.' },
    { role: 'user', content: `File: ${cur().path}\n\nCode before:\n${v.slice(Math.max(0, inl.s - ctx), inl.s)}\n\n<SELECTED>\n${sel}\n</SELECTED>\n\nCode after:\n${v.slice(inl.e, inl.e + ctx / 2)}\n\nTask (the user may write in any language): ${e.target.value.trim()}` }];
  $('#inlPrev').hidden = false; $('#inlOut').innerHTML = ''; $('#inlState').textContent = tr('i_wait'); $('#inlOk').disabled = true;
  inlCtl = new AbortController(); let acc = '';
  try {
    const m = await llm(msgs, { signal: inlCtl.signal, opts: { temperature: 0.1 }, onDelta: d => { acc += d; $('#inlOut').innerHTML = `<span class="dl add">${esc(acc.replace(/^```[^\n]*\n/, ''))}</span>`; } });
    inl.res = (m.content || '').replace(/^\s*```[^\n]*\n/, '').replace(/\n?```\s*$/, '');
    $('#inlOut').innerHTML = diffHtml(sel, inl.res); $('#inlState').textContent = ''; $('#inlOk').disabled = false;
  } catch (er) { $('#inlState').textContent = tr('err_prefix', er.message); }
});
$('#inlOk').onclick = () => { if (!inl) return; const r = inl; hideInline(); ed.focus(); ed.setSelectionRange(r.s, r.e); ins(r.res); };
$('#inlNo').onclick = () => { hideInline(); ed.focus(); };

/* ================= Терминал ================= */
let termCwd = '', termProc = 0, termLast = { code: 0, out: '' };
function termPrint(s, cls) {
  const o = $('#termOut'); if (!s) return;
  const sp = document.createElement('span'); if (cls) sp.className = cls; sp.textContent = s; o.appendChild(sp);
  while (o.childNodes.length > 1500) o.removeChild(o.firstChild);
  o.scrollTop = o.scrollHeight;
}
function toggleTerm(force) { const show = force ?? $('#term').hidden; $('#term').hidden = !show; $('#splitT').hidden = !show; if (show) $('#cmd').focus(); }
$('#termBtn').onclick = () => toggleTerm(); $('#clearTerm').onclick = () => { $('#termOut').textContent = ''; };
function setTermBusy(b) {
  $('#termStop').hidden = !b; $('#cmd').placeholder = b ? L2('ввод для программы и Enter (Ctrl+C — остановить)', 'input for the program and Enter (Ctrl+C stops)') : tr('t_ph');
  $('#termIn span').textContent = b ? '⏵' : ($('#termShell').value === 'powershell' ? 'PS>' : '$');
}
async function termRun(command) {
  setTermBusy(true); $('#termFix').hidden = true; let out = '', code = 0;
  try {
    const r = await fetch('/api/term/run', { method: 'POST', headers: H(), body: JSON.stringify({ command, cwd: termCwd, shell: $('#termShell').value }) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const rd = r.body.getReader(), dec = new TextDecoder(); let buf = '';
    for (;;) {
      const { done, value } = await rd.read(); if (done) break;
      buf += dec.decode(value, { stream: true }); let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line) continue;
        const o = JSON.parse(line);
        if (o.t === 'start') { termProc = o.id; termCwd = o.cwd; $('#cwd').textContent = o.cwd; }
        else if (o.t === 'out') { termPrint(o.v); out += o.v; }
        else if (o.t === 'err') { termPrint(o.v, 'te'); out += o.v; }
        else if (o.t === 'cwd') { termCwd = o.v; $('#cwd').textContent = o.v; }
        else if (o.t === 'exit') code = o.code;
      }
    }
  } catch (e) { termPrint(e.message + '\n', 'te'); code = -1; }
  termProc = 0; setTermBusy(false); termLast = { code, out: out.slice(-4000) };
  if (code) termPrint(L2(`[код выхода: ${code}]\n`, `[exit code: ${code}]\n`), 'tx');
  termPrint('\n'); $('#termFix').hidden = !code; renderTreeSoon(); refreshGitSoon();
  return termLast;
}
const termKill = () => { if (termProc) post('/api/term/kill', { id: termProc }).catch(() => {}); };
$('#termStop').onclick = termKill;
$('#termShell').onchange = () => setTermBusy(false);
$('#termFix').onclick = () => {
  $('#prompt').value = L2('Программа завершилась с ошибкой. Найди причину и исправь код. Вывод терминала:', 'The program failed. Find the cause and fix the code. Terminal output:') + '\n```\n' + termLast.out + '\n```';
  send({ force: true });
};
let rtT = 0; const renderTreeSoon = () => { clearTimeout(rtT); rtT = setTimeout(renderTree, 400); };
const cmdHist = []; let cmdI = 0;
$('#cmd').addEventListener('keydown', async (e) => {
  if (e.ctrlKey && e.key.toLowerCase() === 'c' && termProc && !String(getSelection()).length) { e.preventDefault(); return termKill(); }
  if (e.key === 'ArrowUp') { cmdI = Math.max(0, cmdI - 1); e.target.value = cmdHist[cmdI] || ''; return; }
  if (e.key === 'ArrowDown') { cmdI = Math.min(cmdHist.length, cmdI + 1); e.target.value = cmdHist[cmdI] || ''; return; }
  if (e.key !== 'Enter') return;
  const c = e.target.value; e.target.value = '';
  if (termProc) { termPrint(c + '\n', 'tx'); post('/api/term/input', { id: termProc, data: c + '\n' }).catch(() => {}); return; }
  if (!c.trim()) return;
  if (/^(cls|clear)$/i.test(c.trim())) { $('#termOut').textContent = ''; return; }
  cmdHist.push(c); cmdI = cmdHist.length; termPrint('$ ' + c + '\n', 'tc');
  termRun(c);
});

/* ---- запуск и отладка файла ---- */
function runCmdFor(path, debug) {
  const ext = path.split('.').pop().toLowerCase(), q = `"${path}"`;
  const map = { py: debug ? `python -m pdb ${q}` : `python ${q}`, js: debug ? `node inspect ${q}` : `node ${q}`, mjs: `node ${q}`, cjs: `node ${q}`, ts: `npx tsx ${q}`,
    ps1: `powershell -NoProfile -ExecutionPolicy Bypass -File ${q}`, bat: q, cmd: q, sh: `bash ${q}`, java: `java ${q}`, go: `go run ${q}`, rb: `ruby ${q}`, php: `php ${q}`, lua: `lua ${q}`, pl: `perl ${q}` };
  return map[ext] || null;
}
const NOTFOUND_RE = /не является внутренней|не распознан|is not recognized|was not found|не найден|not found|Python was not found/i;
async function runPath(path, debug) {
  const ext = path.split('.').pop().toLowerCase();
  if (ext === 'html' || ext === 'htm') { try { await post('/api/tool', { name: 'open', args: { target: path } }); toast(L2('Открыл в браузере', 'Opened in the browser')); } catch (e) { toast(e.message); } return; }
  const cmd = runCmdFor(path, debug); if (!cmd) return toast(L2('Для этого типа файла нет запуска', 'No runner for this file type'));
  toggleTerm(true); termCwd = ''; termPrint((debug ? '🐞 ' : '▶ ') + cmd + '\n', 'tc');
  if (debug) termPrint(L2('[отладчик] n — следующая строка · s — войти в функцию · c — продолжить · p имя — показать значение · l — код · q — выйти. Вводите команды внизу.\n', '[debugger] n — next line · s — step in · c — continue · p name — print value · l — list · q — quit. Type commands below.\n'), 'tx');
  let r = await termRun(cmd);
  if (r.code && ext === 'py' && NOTFOUND_RE.test(r.out)) { termPrint(L2('python не найден, пробую py…\n', 'python not found, trying py…\n'), 'tx'); r = await termRun(cmd.replace(/^python/, 'py')); }
  if (r.code && NOTFOUND_RE.test(r.out)) termPrint(L2('Не найден интерпретатор. Для Python: winget install Python.Python.3.12 (потом откройте программу заново). Для Node.js: winget install OpenJS.NodeJS.LTS\n', 'Interpreter not found. For Python: winget install Python.Python.3.12 (then restart the app). For Node.js: winget install OpenJS.NodeJS.LTS\n'), 'te');
}
async function runCurrent(debug) {
  const t = cur(); if (!t) return toast(tr('open_file'));
  if (t.dirty) await saveTab(t, true);
  return runPath(t.path, debug);
}
$('#runBtn').onclick = () => runCurrent(false); $('#dbgBtn').onclick = () => runCurrent(true);

/* ================= Чат и агент ================= */
const TOOLS = [
  fn('list_dir', 'List files and folders. path is relative to the project root; empty = root.', { path: { type: 'string' } }, []),
  fn('read_file', 'Read a whole text file.', { path: { type: 'string' } }, ['path']),
  fn('write_file', 'Create a file or overwrite it completely.', { path: { type: 'string' }, content: { type: 'string' } }, ['path', 'content']),
  fn('replace_in_file', 'Replace a unique fragment in a file (preferred for small edits).', { path: { type: 'string' }, old_str: { type: 'string' }, new_str: { type: 'string' } }, ['path', 'old_str', 'new_str']),
  fn('search', 'Case-insensitive text search across project files.', { query: { type: 'string' }, path: { type: 'string' } }, ['query']),
  fn('run_command', 'Run a shell command (tests, build, git, file sorting, app installs, network tools). Starts in the project root but can work anywhere on the computer. Non-interactive only.', { command: { type: 'string' }, timeout: { type: 'number' }, shell: { type: 'string', description: 'cmd (default) or powershell' } }, ['command']),
  fn('open', 'Open a web page (http/https URL) in the default browser, or a file/folder (music, video, document) in its default app. Relative paths are inside the project.', { target: { type: 'string' } }, ['target']),
];
function fn(name, description, props, required) { return { type: 'function', function: { name, description, parameters: { type: 'object', properties: props, required } } }; }
const NEEDS_OK = new Set(['write_file', 'replace_in_file', 'apply_patch', 'run_command', 'open', 'delete_path']);
const needsOk = (n, a) => NEEDS_OK.has(n) || (n === 'bluetooth' && /^(on|off)$/i.test((a && a.action) || ''));
let chatHist = [], busy = false, stopFlag = false, chatCtl = null, pendingAsk = null;

function useTools() { return ep().useTools && $('#chatMode').value === 'agent'; }
function systemPrompt(tools, textAgent) {
  let s = L2(`Ты — ИИ-ассистент программиста в редакторе LocalCode. Проект: «${info.name}» (${info.platform}). Отвечай на языке пользователя, кратко и по делу. `,
    `You are a programming assistant inside the LocalCode editor. Project: "${info.name}" (${info.platform}). Reply in the user's language, briefly and to the point. `);
  s += tools
    ? L2('Есть инструменты для чтения, поиска и правки файлов и запуска команд. Перед правкой читай файл, вноси минимальные изменения, после правок проверяй их (тесты/сборка), если это возможно.',
        'You have tools to read, search and edit files and run commands. Read a file before editing it, make minimal changes, and verify them (tests/build) when possible.')
    : textAgent ? textToolsPrompt() : L2('Инструментов нет. Если нужно создать или изменить файл — выведи ПОЛНЫЙ новый код в блоке с путём: ```язык:путь/к/файлу (например ```js:src/app.js). Тогда у пользователя появится кнопка «Записать». Простые вопросы объясняй текстом.',
        'You have no tools. To create or change a file, output the FULL new code in a block with a path: ```lang:path/to/file (for example ```js:src/app.js). The user then gets a "Write" button. Answer simple questions in plain text.');
  if (tools || textAgent) s += L2(`\n\nТы можешь управлять компьютером пользователя (${info.platform}, домашняя папка: ${info.home || '?'}): open — открыть сайт, файл, папку или трек в программе по умолчанию; run_command — сортировка и перенос файлов и ярлыков, установка программ (${info.platform === 'win32' ? 'winget' : info.platform === 'darwin' ? 'brew' : 'apt/dnf/pacman'}), сеть и подключение к другим устройствам (ping, ssh и т. п.). Перед массовыми операциями с файлами сначала посмотри содержимое и коротко скажи, что собираешься сделать; предпочитай перенос удалению; ничего не удаляй, если об этом не просили прямо. Каждое такое действие пользователь подтверждает кнопкой.`,
    `\n\nYou can control the user's computer (${info.platform}, home folder: ${info.home || '?'}): open — open a website, file, folder or track in the default app; run_command — sort and move files and shortcuts, install programs (${info.platform === 'win32' ? 'winget' : info.platform === 'darwin' ? 'brew' : 'apt/dnf/pacman'}), network tasks and connecting to other devices (ping, ssh, etc.). Before bulk file operations, look at the contents first and briefly say what you are going to do; prefer moving over deleting; never delete anything unless explicitly asked. The user confirms each such action with a button.`);
  if ((cfg.sysPrompt || '').trim()) s += L2('\n\nПостоянные инструкции пользователя (всегда соблюдай):\n', '\n\nStanding instructions from the user (always follow):\n') + cfg.sysPrompt.trim().slice(0, 4000);
  if (rules) s += L2('\n\nПравила проекта:\n', '\n\nProject rules:\n') + rules.slice(0, P().ctxChars / 3);
  return s;
}
function trimHistory() {
  let h = chatHist.slice(-P().hist);
  while (h.length && h[0].role !== 'user') h.shift();
  return h;
}
const scrollLog = () => { const l = $('#log'); l.scrollTop = l.scrollHeight; };
function addMsg(cls, html) { const d = document.createElement('div'); d.className = 'msg ' + cls; d.innerHTML = html; const lg = $('#log'); lg.appendChild(d); while (lg.children.length > 300) lg.removeChild(lg.firstChild); scrollLog(); return d; }
const inlineMd = (t) => esc(t).replace(/`([^`\n]+)`/g, '<code class="in">$1</code>').replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
function md(text) {
  return String(text).split('```').map((p, i) => {
    if (i % 2 === 0) return inlineMd(p);
    const nl = p.indexOf('\n'), header = (nl < 0 ? p : p.slice(0, nl)).trim(), code = nl < 0 ? '' : p.slice(nl + 1).replace(/\n$/, '');
    let lang = '', path = '';
    if (header.includes(':')) { const k = header.indexOf(':'); lang = header.slice(0, k); path = header.slice(k + 1).trim(); }
    else if (/[\/.]/.test(header) && !/\s/.test(header) && header.length > 2) path = header; else lang = header;
    return `<pre data-path="${escA(path)}" data-lang="${escA(lang)}"><div class="pbar"><span>${esc(path || lang || tr('code'))}</span><button data-act="copy">${esc(tr('copy'))}</button><button data-act="insert">${esc(tr('to_editor'))}</button><button data-act="saveas">${esc(tr('to_newfile'))}</button>${path ? `<button data-act="write">${esc(tr('write'))}</button>` : ''}</div><code>${HL.highlight(code, HL.langOf(path || 'x.' + lang))}</code></pre>`;
  }).join('');
}
$('#log').addEventListener('click', async (e) => {
  const pk = e.target.closest('button[data-pick]');
  if (pk) {
    pk.parentElement.querySelectorAll('button').forEach(x => x.disabled = true);
    const r = await execTool(pk.dataset.tool, { path: pk.dataset.pick, target: pk.dataset.pick }); renderTree();
    return say(declined(r) ? L2('Отменено.', 'Cancelled.') : failed(r) ? '`' + r + '`' : pk.dataset.tool === 'open' ? L2('Открыл: ', 'Opened: ') + '`' + pk.dataset.pick + '`' : r);
  }
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const pre = b.closest('pre'), code = pre.querySelector('code').textContent, act = b.dataset.act;
  if (act === 'copy') { navigator.clipboard.writeText(code); b.textContent = tr('copied'); setTimeout(() => b.textContent = tr('copy'), 1200); }
  if (act === 'insert') { if (cur()) { ed.focus(); ins(code); toast(tr('inserted')); } else await saveCodeAsFile(code, pre.dataset.path, pre.dataset.lang); }
  if (act === 'saveas') await saveCodeAsFile(code, pre.dataset.path, pre.dataset.lang);
  if (act === 'write') { const p = pre.dataset.path, ot = tabs.find(t => t.path === p); if (ot && ot.dirty && !confirm(tr('unsaved'))) return; try { await post('/api/file', { path: p, content: code + '\n' }); await openFile(p, true); renderTree(); toast(tr('written', p)); } catch (er) { toast(er.message); } }
});

function askApproval(name, args) {
  if ($('#auto').checked || !needsOk(name, args)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const detail = name === 'apply_patch' ? esc(args.path + '\n\n' + args.patch) : name === 'delete_path' ? esc(args.path + '\n' + L2('(будет перенесено в корзину)', '(goes to the Recycle Bin)')) : name === 'bluetooth' ? esc('Bluetooth: ' + args.action) : name === 'run_command' ? esc(args.command) : name === 'open' ? esc(args.target) : name === 'write_file' ? esc(`${args.path}\n\n${(args.content || '').slice(0, 4000)}`) : `${esc(args.path)}\n\n${diffHtml(args.old_str || '', args.new_str || '')}`;
    const d = addMsg('ask', `<b>${esc(tr('ask_allow', name))}</b><pre>${detail}</pre><div class="row"><button class="primary" data-a="1">${esc(tr('allow'))}</button><button data-a="0">${esc(tr('deny'))}</button></div>`);
    pendingAsk = (v) => { d.remove(); pendingAsk = null; resolve(v); };
    d.querySelectorAll('button[data-a]').forEach(b => b.onclick = () => pendingAsk(b.dataset.a === '1'));
  });
}
async function saveCodeAsFile(code, path, lang) {
  const lg = String(lang || '').toLowerCase(), ext = (LANG_DEFS.find(d => d[1] === lg || d[2] === lg) || [])[2] || 'txt';
  let name = path || prompt(tr('new_file_q'), 'main.' + ext); if (!name) return;
  try { await post('/api/file', { path: name, content: code + '\n' }); await renderTree(); await openFile(name, true); toast(tr('written', name)); } catch (e) { toast(e.message); }
}
const patchHtml = (p) => String(p || '').split('\n').map(l => `<span class="dl ${l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : 'skip'}">${esc(l) || ' '}</span>`).join('');
function askUser(args) {
  return new Promise((resolve) => {
    const opts = (Array.isArray(args.options) ? args.options : []).map(String).slice(0, 8);
    const bub = addMsg('ai', ''), q = document.createElement('div'), row = document.createElement('div'); q.textContent = args.question || ''; row.className = 'choices'; bub.append(q, row);
    let fin = false; const done = (v) => { if (fin) return; fin = true; row.querySelectorAll('button').forEach(b => b.disabled = true); const a = document.createElement('div'); a.className = 'hint'; a.textContent = '→ ' + v; bub.appendChild(a); resolve('User answered: ' + v); };
    for (const o of opts) { const b = document.createElement('button'); b.className = 'choice'; b.textContent = o; b.onclick = () => done(o); row.appendChild(b); }
    const own = document.createElement('button'); own.className = 'choice'; own.textContent = L2('Свой вариант…', 'Other…'); own.onclick = () => { const v = prompt(args.question || ''); if (v) done(v); }; row.appendChild(own);
    scrollLog(); if (chatCtl) chatCtl.signal.addEventListener('abort', () => done('cancelled'));
  });
}
async function runTool(call) {
  const name = call.function.name; let args;
  try { args = JSON.parse(call.function.arguments || '{}'); } catch { return 'Error: arguments are not valid JSON'; }
  if (name === 'ask_user') return askUser(args);
  const short = args.path || args.command || args.query || args.target || '';
  const card = addMsg('', `<details class="tool"><summary><b>${esc(name)}</b> ${esc(String(short).slice(0, 70))}</summary><div class="body"></div></details>`);
  const body = card.querySelector('.body');
  if (!(await askApproval(name, args))) { body.innerHTML = '<pre>' + esc(tr('denied')) + '</pre>'; return 'The user declined the action.'; }
  try {
    const r = await post('/api/tool', { name, args }, chatCtl && chatCtl.signal);
    if (name === 'write_file' || name === 'replace_in_file' || name === 'apply_patch') {
      const before = r.before, after = name === 'write_file' ? args.content : null;
      body.innerHTML = `<pre>${name === 'write_file' ? diffHtml(before ?? '', args.content) : name === 'apply_patch' ? patchHtml(args.patch) : diffHtml(args.old_str, args.new_str)}</pre><div class="bar"><button>${esc(tr('revert'))}</button><span>${before === null ? esc(tr('new_file_tag')) : ''}</span></div>`;
      body.querySelector('button').onclick = async (ev) => {
        try { if (before === null) await post('/api/fsop', { op: 'delete', path: args.path }); else await post('/api/file', { path: args.path, content: before });
          ev.target.disabled = true; ev.target.textContent = tr('reverted'); const o = tabs.find(t => t.path === args.path); if (o) { before === null ? closeTabForce(args.path) : await openFile(args.path, true); } renderTree(); } catch (er) { toast(er.message); }
      };
      const inProj = !/^(~|[a-zA-Z]:[\\/]|[\\/])/.test(args.path), open = tabs.find(t => t.path === args.path);
      if (inProj) { if (open && !open.dirty) await openFile(args.path, true); else if (!open) await openFile(args.path); }
      renderTree(); refreshGitSoon(); void after;
    } else {
      if (name === 'run_command') { termPrint(`$ ${args.command}\n${r.result}\n\n`); renderTree(); refreshGitSoon(); }
      body.innerHTML = `<pre>${esc(String(r.result).slice(0, 4000))}</pre>`;
    }
    return String(r.result).slice(0, 30000);
  } catch (e) { body.innerHTML = `<pre style="color:var(--err)">${esc(e.message)}</pre>`; return 'Error: ' + e.message; }
}
function closeTabForce(p) { tabs = tabs.filter(t => t.path !== p); activate(tabs.length ? tabs[tabs.length - 1].path : null); }

async function attachMentions(text) {
  const set = new Set(), out = [];
  for (const m of text.matchAll(/@([\w.\-\/\\]+)/g)) { const p = m[1].replace(/\\/g, '/'); if (files.includes(p)) set.add(p); }
  for (const p of set) { try { const { content } = await api('/api/file?path=' + encodeURIComponent(p)); out.push(`### ${p}\n\`\`\`\n${content.slice(0, P().ctxChars)}\n\`\`\``); } catch (er) { toast(L2(`Не удалось прикрепить ${p}: `, `Could not attach ${p}: `) + er.message, 5000); } }
  return out.length ? tr('attached') + '\n' + out.join('\n') : '';
}
function saveChat() { try { localStorage['lc_chat:' + info.root] = JSON.stringify(chatHist.slice(-40)); } catch {} }
function setBusy(b) { busy = b; $('#send').hidden = b; $('#stop').hidden = !b; }

/* ================= Агент для моделей без вызова функций + быстрые команды ================= */
TOOLS.push(fn('ask_user', L2('Задать пользователю уточняющий вопрос с вариантами ответа, если задача неоднозначна', 'Ask the user a clarifying question with answer options when the task is ambiguous'), { question: { type: 'string' }, options: { type: 'array', items: { type: 'string' } } }, ['question']));
TOOLS.push(fn('apply_patch', L2('Применить diff-патч (unified diff с блоками @@) к файлу: удобно для нескольких правок за раз', 'Apply a unified diff patch (@@ hunks) to a file: handy for several edits at once'), { path: { type: 'string' }, patch: { type: 'string' } }, ['path', 'patch']));
TOOLS.push(fn('web_search', L2('Поиск в интернете (результаты со ссылками)', 'Web search (results with links)'), { query: { type: 'string' } }, ['query']));
TOOLS.push(fn('fetch_url', L2('Прочитать текст веб-страницы по ссылке', 'Read the text of a web page by URL'), { url: { type: 'string' } }, ['url']));
const WEB_TOOLS = /^(web_search|fetch_url)$/;
const activeTools = () => TOOLS.filter(t => (cfg && cfg.webSearch) || !WEB_TOOLS.test(t.function.name));
TOOLS.push(fn('make_dir', L2('Создать папку (путь внутри проекта или ~/Desktop/имя, ~/Documents/имя, ~/Downloads/имя)', 'Create a folder (project path or ~/Desktop/name, ~/Documents/name, ~/Downloads/name)'), { path: { type: 'string' } }, ['path']));
TOOLS.push(fn('delete_path', L2('Удалить файл или папку (в корзину Windows). Нужно подтверждение', 'Delete a file or folder (to the Windows Recycle Bin). Needs confirmation'), { path: { type: 'string' } }, ['path']));
TOOLS.push(fn('bluetooth', L2('Bluetooth: status, on, off, devices (список), settings (открыть окно подключения устройств)', 'Bluetooth: status, on, off, devices (list), settings (open the device pairing page)'), { action: { type: 'string' } }, ['action']));
TOOLS.push(fn('find_path', L2('Найти файл или папку по имени на компьютере (рабочий стол, документы, загрузки, проект)', 'Find a file or folder by name on the computer (desktop, documents, downloads, project)'),
  { query: { type: 'string' }, where: { type: 'string', description: 'desktop | documents | downloads (optional)' } }, ['query']));
const TR_PREFIX = '[tool_result:';
const isToolRes = (m) => m.role === 'user' && typeof m.content === 'string' && m.content.startsWith(TR_PREFIX);
const visible = (t) => String(t || '').replace(/<tool>[\s\S]*?(?:<\/tool>|$)/gi, '').replace(/```(?:json)?\s*\{\s*"name"[\s\S]*?```/gi, '').trim();
function textToolsPrompt() {
  return textToolsBase() + L2('\nДополнительно:\nask_user {"question":"...","options":["вариант 1","вариант 2"]} — задать пользователю уточняющий вопрос\napply_patch {"path":"...","patch":"@@ -1,3 +1,3 @@\\n..."} — применить diff-патч' + ((cfg && cfg.webSearch) ? '\nweb_search {"query":"..."} — поиск в интернете\nfetch_url {"url":"https://..."} — прочитать страницу' : ''),
    '\nExtra:\nask_user {"question":"...","options":["option 1","option 2"]} — ask the user a clarifying question\napply_patch {"path":"...","patch":"@@ -1,3 +1,3 @@\\n..."} — apply a diff patch' + ((cfg && cfg.webSearch) ? '\nweb_search {"query":"..."} — web search\nfetch_url {"url":"https://..."} — read a page' : ''));
}
function textToolsBase() {
  return L2(
`Ты можешь выполнять действия на компьютере. Чтобы выполнить действие, ответь ТОЛЬКО одним блоком и больше ничего:
<tool>{"name":"ИМЯ","args":{...}}</tool>
Потом тебе придёт результат, и ты продолжишь. Когда всё готово — ответь обычным текстом без блока.
Блок нужен только для действий с файлами и компьютером. Вопросы и объяснения — обычным текстом.
Инструменты:
find_path {"query":"имя","where":"рабочем столе | документах | загрузках"} — найти файл или папку по имени
open {"target":"путь или https://ссылка"} — открыть папку, файл или сайт
list_dir {"path":""} — список файлов проекта
read_file {"path":"..."} — прочитать файл
write_file {"path":"...","content":"..."} — создать или перезаписать файл
replace_in_file {"path":"...","old_str":"...","new_str":"..."} — заменить фрагмент
search {"query":"..."} — поиск по проекту
run_command {"command":"...","shell":"powershell"} — команда в терминале (shell необязателен)
make_dir {"path":"~/Desktop/Новая папка"} — создать папку
delete_path {"path":"..."} — удалить в корзину
bluetooth {"action":"on | off | status | devices | settings"} — Bluetooth
Пути: без префикса — внутри проекта; ~/Desktop/имя — рабочий стол; ~/Documents/имя — документы; ~/Downloads/имя — загрузки.
Примеры:
Пользователь: открой папку Фото на рабочем столе
<tool>{"name":"find_path","args":{"query":"Фото","where":"рабочем столе"}}</tool>
Пользователь: создай файл hello.txt с текстом Привет
<tool>{"name":"write_file","args":{"path":"hello.txt","content":"Привет"}}</tool>`,
`You can perform actions on the computer. To do an action, reply with ONLY one block and nothing else:
<tool>{"name":"NAME","args":{...}}</tool>
You will then receive the result and continue. When everything is done, answer in plain text without a block.
Use a block only for file and computer actions. Questions and explanations are plain text.
Tools:
find_path {"query":"name","where":"desktop | documents | downloads"} — find a file or folder by name
open {"target":"path or https://link"} — open a folder, file or website
list_dir {"path":""} — list project files
read_file {"path":"..."} — read a file
write_file {"path":"...","content":"..."} — create or overwrite a file
replace_in_file {"path":"...","old_str":"...","new_str":"..."} — replace a fragment
search {"query":"..."} — search the project
run_command {"command":"...","shell":"powershell"} — terminal command (shell is optional)
make_dir {"path":"~/Desktop/New folder"} — create a folder
delete_path {"path":"..."} — delete to the Recycle Bin
bluetooth {"action":"on | off | status | devices | settings"} — Bluetooth
Paths: no prefix — inside the project; ~/Desktop/name — desktop; ~/Documents/name — documents; ~/Downloads/name — downloads.
Examples:
User: open the Photos folder on the desktop
<tool>{"name":"find_path","args":{"query":"Photos","where":"desktop"}}</tool>
User: create a file hello.txt with the text Hi
<tool>{"name":"write_file","args":{"path":"hello.txt","content":"Hi"}}</tool>`);
}
function parseTextTool(text) {
  const s = String(text || '');
  const m = s.match(/<tool>\s*([\s\S]*?)\s*<\/tool>/i) || s.match(/```(?:json)?\s*(\{\s*"name"[\s\S]*?\})\s*```/i) || s.match(/<tool>\s*(\{[\s\S]*\})\s*$/i);
  if (!m) return null;
  let o; try { o = JSON.parse(m[1]); } catch { try { o = JSON.parse(m[1].replace(/,\s*([}\]])/g, '$1')); } catch { return null; } }
  if (!o || !activeTools().some(t => t.function.name === o.name)) return null;
  return { name: o.name, args: o.args || o.arguments || o.parameters || {}, end: m.index + m[0].length };
}
// Файл кладём прямо в сообщение пользователя: системное сообщение у маленьких моделей теряется и обрезается
function fileContext(force) {
  const t = cur(); if (!t || !(force || $('#ctxFile').checked)) return '';
  const body0 = activePath === t.path ? ed.value : t.content, max = P().ctxChars;
  const sel = activePath === t.path ? ed.value.slice(ed.selectionStart, ed.selectionEnd) : '';
  let s = L2('Открытый файл: ', 'Open file: ') + t.path + '\n```\n' + (body0.length > max ? body0.slice(0, max) + L2('\n…[файл обрезан]', '\n…[file truncated]') : body0) + '\n```';
  if (sel) s += L2('\nВыделенный фрагмент:\n', '\nSelected snippet:\n') + '```\n' + sel.slice(0, max / 2) + '\n```';
  return s;
}
function withCtx(fctx) {
  const h = trimHistory().map(m => ({ ...m }));
  if (fctx) for (let k = h.length - 1; k >= 0; k--) if (h[k].role === 'user' && !isToolRes(h[k])) { h[k].content = fctx + '\n\n' + (h[k].content || ''); break; }
  return h;
}

// Быстрые команды выполняются без модели (работают и в режиме «Вопрос», и без установленной модели):
// папки и файлы, программы Windows, Bluetooth, телефон по adb, запуск и отладка, сайты, музыка, создание программ.
const SITES = { 'ютуб': 'https://www.youtube.com', 'youtube': 'https://www.youtube.com', 'гугл': 'https://www.google.com', 'google': 'https://www.google.com', 'яндекс': 'https://yandex.ru', 'yandex': 'https://yandex.ru', 'вк': 'https://vk.com', 'вконтакте': 'https://vk.com', 'vk': 'https://vk.com', 'википедия': 'https://ru.wikipedia.org', 'wikipedia': 'https://en.wikipedia.org', 'гитхаб': 'https://github.com', 'github': 'https://github.com', 'телеграм': 'https://web.telegram.org', 'telegram': 'https://web.telegram.org', 'почта': 'https://mail.google.com', 'gmail': 'https://mail.google.com' };
const APPS = { 'калькулятор': 'calc', 'calculator': 'calc', 'блокнот': 'notepad', 'notepad': 'notepad', 'paint': 'mspaint', 'пейнт': 'mspaint', 'проводник': 'explorer', 'диспетчер задач': 'taskmgr', 'командную строку': 'cmd', 'командная строка': 'cmd', 'консоль': 'cmd', 'powershell': 'powershell', 'панель управления': 'control', 'диспетчер устройств': 'devmgmt.msc', 'chrome': 'chrome', 'хром': 'chrome', 'edge': 'msedge', 'эдж': 'msedge', 'vscode': 'code', 'word': 'winword', 'excel': 'excel' };
const SETTINGS = { 'параметры': 'ms-settings:', 'настройки windows': 'ms-settings:', 'настройки виндовс': 'ms-settings:', 'настройки системы': 'ms-settings:', 'wifi': 'ms-settings:network-wifi', 'wi-fi': 'ms-settings:network-wifi', 'вайфай': 'ms-settings:network-wifi', 'звук': 'ms-settings:sound', 'экран': 'ms-settings:display', 'обновления': 'ms-settings:windowsupdate', 'блютуз': 'ms-settings:bluetooth', 'bluetooth': 'ms-settings:bluetooth' };
const WHERE_RE = /\s+(?:на\s+рабочем\s+столе|на\s+столе|в\s+документах|в\s+загрузках|в\s+папке\s+загрузки|on\s+(?:the\s+)?desktop|in\s+(?:my\s+)?(?:documents|downloads))\s*$/i;
const whereAlias = (w) => /стол|desktop/i.test(w) ? '~/Desktop' : /документ|documents/i.test(w) ? '~/Documents' : /загруз|download/i.test(w) ? '~/Downloads' : '';
const LANG_DEFS = [['питоне|питон|пайтон|python', 'python', 'py'], ['javascript|js|джаваскрипте|джаваскрипт|node\\.js|node|ноде', 'javascript', 'js'], ['typescript|тайпскрипте|ts', 'typescript', 'ts'], ['html', 'html', 'html'], ['css', 'css', 'css'], ['c\\+\\+|плюсах|cpp', 'cpp', 'cpp'], ['c#|шарпе', 'csharp', 'cs'], ['java|джаве', 'java', 'java'], ['golang|go|голанге', 'go', 'go'], ['rust|расте', 'rust', 'rs'], ['php', 'php', 'php'], ['bash|баше', 'bash', 'sh'], ['powershell|пауэршелле', 'powershell', 'ps1'], ['bat|батнике', 'batch', 'bat'], ['lua|луа', 'lua', 'lua'], ['ruby|руби', 'ruby', 'rb'], ['kotlin|котлине', 'kotlin', 'kt'], ['swift|свифте', 'swift', 'swift']];
const LANG_RE = new RegExp('^(?:создай|напиши|сделай|разработай|сгенерируй|write|create|make)\\s+(.+?)\\s+(?:на|in|using|with)\\s+(' + LANG_DEFS.map(d => d[0]).join('|') + ')(?=\\s|$|[.,!?;:])(.*)$', 'i');
const TL = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
const NOUNS = { 'калькулятор': 'calculator', 'игру': 'game', 'игра': 'game', 'бота': 'bot', 'бот': 'bot', 'сайт': 'site', 'парсер': 'parser', 'таймер': 'timer', 'секундомер': 'stopwatch', 'будильник': 'alarm', 'змейка': 'snake', 'змейку': 'snake' };
const SKIP_W = /^(простой|простую|простое|небольшой|небольшую|новый|новую|мне|для|с|и|в|на|программу|программа|приложение|скрипт|код|консольный|консольную|сделай|пожалуйста|a|the|simple|small|new|program|script|app)$/;
function slugName(subject) {
  const w = String(subject).toLowerCase().replace(/[^a-zа-яё0-9\s-]/gi, ' ').split(/\s+/).filter(x => x && !SKIP_W.test(x)).slice(0, 2);
  return w.map(x => NOUNS[x] || [...x].map(c => TL[c] ?? c).join('')).join('_').replace(/[^a-z0-9_-]/g, '') || 'program';
}
const stripQ = (t) => String(t).trim().replace(/^[«"'`]+|[»"'`]+$/g, '').trim();
function splitWhere(t) { const m = t.match(WHERE_RE); return m ? { name: stripQ(t.slice(0, m.index)), where: m[0].trim() } : { name: stripQ(t), where: '' }; }
function routeIntent(raw) {
  const s = raw.trim().replace(/[.!?…]+$/, '').trim(); if (!s || s.length > 240 || s.includes('\n')) return null;
  const low = s.toLowerCase().replace(/\s+/g, ' '); let m;
  // музыка и поиск
  if ((m = s.match(/^(?:включи|поставь|запусти|play)\s+(?:мне\s+)?(?:музыку|музон|песню|песенку|трек|клип|видео|music|song|track|video)(?:\s+(.*))?$/i))) {
    const q = (m[1] || '').replace(/^(?:про|от|группы|исполнителя|by)\s+/i, '').trim() || L2('музыка', 'music');
    return { kind: 'url', url: 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q), say: L2('Открыл поиск на YouTube: ', 'Opened YouTube search: ') + q };
  }
  if ((m = s.match(/^(?:найди|поищи)\s+в\s+(?:интернете|гугле|google|яндексе|сети)\s+(.+)$/i)) || (m = s.match(/^(?:загугли|погугли|google)\s+(.+)$/i)))
    return { kind: 'url', url: 'https://www.google.com/search?q=' + encodeURIComponent(m[1].trim()), say: L2('Открыл поиск: ', 'Opened search: ') + m[1].trim() };
  // Bluetooth
  if ((m = low.match(/^(включи|вруби|выключи|выруби|отключи)\s+(?:мне\s+)?(?:блютуз|блютус|bluetooth)$/))) return { kind: 'tool', name: 'bluetooth', args: { action: /^(включи|вруби)$/.test(m[1]) ? 'on' : 'off' } };
  if (/^(?:статус|состояние|включен ли|включён ли|есть ли|работает ли)\s+(?:блютуз|блютус|bluetooth)/.test(low)) return { kind: 'tool', name: 'bluetooth', args: { action: 'status' } };
  if (/(?:блютуз|блютус|bluetooth)/.test(low) && /(?:устройств|девайс|список|покажи)/.test(low) && !/подключ/.test(low)) return { kind: 'tool', name: 'bluetooth', args: { action: 'devices' }, say: L2('Устройства Bluetooth:', 'Bluetooth devices:') };
  if (/(?:подключи|подключись|соедини|сопряги|найди)/.test(low) && /(?:блютуз|блютус|bluetooth|наушник|колонк|мышь|мышку|клавиатур|гарнитур|геймпад|джойстик)/.test(low)) return { kind: 'tool', name: 'bluetooth', args: { action: 'settings' } };
  // телефон и устройства (adb = отладка Android)
  if (/^(?:adb devices|покажи (?:устройства|телефоны) adb|список (?:устройств|телефонов) adb|подключ[её]нные (?:телефоны|устройства|android)|какие устройства подключены)/.test(low)) return { kind: 'tool', name: 'run_command', args: { command: 'adb devices -l', timeout: 30 }, say: L2('Устройства adb:', 'adb devices:'), adb: true };
  if ((m = low.match(/(\d{1,3}(?:\.\d{1,3}){3})(?::(\d{2,5}))?/)) && /(?:подключись|подключи|соединись|connect)/.test(low) && /(?:adb|отладк|телефон|android|андроид)/.test(low)) return { kind: 'tool', name: 'run_command', args: { command: `adb connect ${m[1]}:${m[2] || 5555}`, timeout: 30 }, say: L2('Подключение по adb:', 'adb connect:'), adb: true };
  if (/(?:логи|logcat)/.test(low) && /(?:телефон|adb|android|андроид|устройств)/.test(low)) return { kind: 'tool', name: 'run_command', args: { command: 'adb logcat -d -t 200', timeout: 30 }, say: L2('Последние логи устройства:', 'Latest device logs:'), adb: true };
  if (/(?:покажи|список|какие)/.test(low) && /(?:usb|юсб)/.test(low)) return { kind: 'tool', name: 'run_command', args: { command: "Get-PnpDevice -PresentOnly -Class USB,Ports,Camera,AudioEndpoint -ErrorAction SilentlyContinue | Select-Object Status,Class,FriendlyName | Format-Table -AutoSize | Out-String -Width 200", shell: 'powershell', timeout: 40 }, say: L2('Подключённые устройства:', 'Connected devices:') };
  if (/(?:покажи|список|какие)/.test(low) && /(?:com|ком)[- ]?порт/.test(low)) return { kind: 'tool', name: 'run_command', args: { command: "Get-PnpDevice -Class Ports -PresentOnly -ErrorAction SilentlyContinue | Select-Object Status,FriendlyName | Format-Table -AutoSize | Out-String -Width 200", shell: 'powershell', timeout: 30 }, say: L2('COM-порты:', 'COM ports:') };
  // программы и настройки Windows
  if ((m = low.match(/^(?:открой|запусти|включи|open|start|launch)\s+(?:мне\s+)?(?:программу\s+|приложение\s+)?(.+)$/))) {
    const nm = m[1].trim();
    if (APPS[nm]) return { kind: 'tool', name: 'run_command', args: { command: `start "" ${APPS[nm]}`, timeout: 15 }, say: L2('Запустил: ', 'Started: ') + nm, quiet: true };
    if (SETTINGS[nm]) return { kind: 'tool', name: 'open', args: { target: SETTINGS[nm] }, say: L2('Открыл настройки: ', 'Opened settings: ') + nm, quiet: true };
  }
  // запуск и отладка кода
  if (/^(?:отлад(?:ь|ка|чик)|debug)(?:\s+(?:код|файл|программу|проект|это))?$/.test(low)) return { kind: 'run', debug: true };
  if (/^(?:запусти|выполни|run)\s+(?:этот\s+|текущий\s+)?(?:код|файл|программу|проект|скрипт)$/.test(low)) return { kind: 'run' };
  if ((m = s.match(/^(?:запусти|выполни|run)\s+(?:файл\s+|скрипт\s+|программу\s+)?(\S+\.\w{1,5})$/i))) { const f = files.find(x => x.toLowerCase() === m[1].toLowerCase()) || files.find(x => x.toLowerCase().endsWith('/' + m[1].toLowerCase())); if (f) return { kind: 'run', path: f }; return { kind: 'say', text: L2(`Файл ${m[1]} не найден в проекте. Откройте нужную папку через «📁» или создайте файл.`, `File ${m[1]} was not found in the project. Open the right folder with “📁” or create the file.`) }; }
  // создать папку / файл
  if ((m = s.match(/^(?:создай|сделай|new|create)\s+(?:мне\s+)?(?:новую\s+)?(?:папку|директорию|folder|directory)\s+(.+)$/i))) { const w = splitWhere(m[1]); if (w.name) return { kind: 'mkdir', name: w.name, base: whereAlias(w.where) }; }
  if ((m = s.match(/^(?:создай|сделай|new|create)\s+(?:мне\s+)?(?:новый\s+|пустой\s+)?(?:файл|file)\s+(.+)$/i))) {
    let rest = m[1], content = '';
    const cm = rest.match(/\s+(?:с\s+текстом|с\s+содержимым|со\s+словами|with\s+text|with\s+content)\s+([\s\S]+)$/i); if (cm) { content = stripQ(cm[1]); rest = rest.slice(0, cm.index); }
    const w = splitWhere(rest); if (w.name && !/\s{2,}/.test(w.name)) return { kind: 'newfile', name: /\.\w{1,8}$/.test(w.name) ? w.name : w.name + '.txt', base: whereAlias(w.where), content };
  }
  // удалить (в корзину, с подтверждением)
  if ((m = s.match(/^(?:удали|удалить|delete|remove)\s+(?:папку|файл|folder|file)?\s*(.+)$/i)) && !/(строк|функци|метод|класс|кусок|абзац|комментар|символ|слов)/i.test(s)) { const w = splitWhere(m[1]); if (w.name && w.name.length < 80) return { kind: 'delete', query: w.name, where: w.where }; }
  // написать программу: «создай калькулятор на питоне»
  if ((m = s.match(LANG_RE))) { const d = LANG_DEFS.find(x => new RegExp('^(?:' + x[0] + ')$', 'i').test(m[2])); if (d && !(cur() && /(?:эт(?:от|у|а|ого|ой|ом|и)|тут|здесь|выше|текущ)/i.test(m[1]))) return { kind: 'codegen', subject: m[1], lang: d[1], ext: d[2] }; }
  // открыть сайт, файл или папку
  if ((m = s.match(/^(?:открой|открыть|open)\s+(?:мне\s+)?(?:(?:папку|папка|директорию|файл|folder|file|directory|сайт|site|website)\s+)?(.+)$/i))) {
    const w = splitWhere(m[1]); const name = w.name, where = w.where;
    if (!name || /^(?:терминал|настройки|поиск|чат|terminal|settings|search|chat|help|справку)$/i.test(name)) return null;
    if (/^https?:\/\//i.test(name)) return { kind: 'url', url: encodeURI(decodeURI(name)), say: L2('Открыл ', 'Opened ') + name };
    if (/[,;]| и | затем| потом| чтобы| and then/i.test(name) || name.split(' ').length > 6) return null;   // сложная просьба — пусть решает модель
    const ln = name.toLowerCase();
    if (SITES[ln]) return { kind: 'url', url: SITES[ln], say: L2('Открыл ', 'Opened ') + name };
    if (/^(?:https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(name) && !/\.(?:js|py|html|css|json|md|txt|ts|java|c|cpp|cs|go|rs|php|rb)$/i.test(name))
      return { kind: 'url', url: /^https?:/i.test(name) ? name : 'https://' + name, say: L2('Открыл ', 'Opened ') + name };
    if (!where) { const f = files.find(x => x.toLowerCase() === ln) || files.find(x => x.toLowerCase().endsWith('/' + ln)); if (f) return { kind: 'editor', path: f }; }
    return { kind: 'find_open', query: name, where };
  }
  return null;
}
async function execTool(name, args) { return runTool({ id: 'q' + Date.now(), function: { name, arguments: JSON.stringify(args) } }); }
function say(text) { addMsg('ai', md(text)); chatHist.push({ role: 'assistant', content: text }); saveChat(); }
const declined = (r) => /declined|отклон/i.test(String(r));
const failed = (r) => /^Error/i.test(String(r));
const NOADB = /не является внутренней|не распознан|is not recognized|not found|не найден/i;
async function genProgram(raw, it) {
  const bub = addMsg('ai', `<span class="hint">${esc(tr('c_think'))}</span>`); let acc = '';
  const sys = L2(`Ты опытный программист. Напиши рабочую программу на ${it.lang} по запросу пользователя. Ответь ОДНИМ блоком кода в тройных обратных кавычках с названием языка и больше ничем: никаких пояснений до или после. В коде — короткие комментарии на русском.`, `You are an experienced programmer. Write a working ${it.lang} program for the user's request. Reply with ONE fenced code block with the language name and nothing else: no explanations before or after. Add short comments.`);
  const m = await llm([{ role: 'system', content: sys }, { role: 'user', content: raw }], { signal: chatCtl.signal, opts: { maxTokens: 2500 }, onDelta: d => { acc += d; bub.innerHTML = md(acc); scrollLog(); } });
  const text = m.content || '';
  const fm = text.match(/```[\w+#.-]*\n([\s\S]*?)```/) || text.match(/```[\w+#.-]*\n([\s\S]*)$/);
  const code = (fm ? fm[1] : text).replace(/\s+$/, '');
  if (!code.trim()) { bub.remove(); return say(L2('Модель не вернула код. Попробуйте переформулировать или выберите модель посильнее.', 'The model returned no code. Rephrase or pick a stronger model.')); }
  bub.innerHTML = md('```' + it.lang + '\n' + code + '\n```');
  let name = slugName(it.subject) + '.' + it.ext, n = 2; while (files.includes(name)) name = slugName(it.subject) + '_' + (n++) + '.' + it.ext;
  const r = await execTool('write_file', { path: name, content: code + '\n' });
  if (declined(r)) return say(L2('Файл не создан.', 'File not created.'));
  if (failed(r)) return say(r);
  say(L2(`Готово: создал \`${name}\` и открыл в редакторе. ${it.ext === 'html' ? 'Нажмите ▶ Запуск, чтобы открыть в браузере.' : 'Нажмите ▶ Запуск (F5), чтобы запустить, или 🐞 Отладка (Shift+F5).'}`, `Done: created \`${name}\` and opened it in the editor. ${it.ext === 'html' ? 'Press ▶ Run to open it in the browser.' : 'Press ▶ Run (F5) to run it or 🐞 Debug (Shift+F5).'}`));
}
function choosePath(title, list, tool) {
  addMsg('ai', `<div>${esc(title)}</div><div class="choices">` + list.map(x => `<button class="choice" data-pick="${escA(x.path)}" data-tool="${tool}">${esc(x.path)}</button>`).join('') + '</div>');
  chatHist.push({ role: 'assistant', content: title + '\n' + list.map(x => '- ' + x.path).join('\n') }); saveChat();
}
async function runIntent(it, raw) {
  const pathOf = (base, name) => base ? base + '/' + name : name;
  switch (it.kind) {
    case 'editor': await openFile(it.path); return say(L2('Открыл в редакторе: ', 'Opened in the editor: ') + it.path);
    case 'url': { const r = await execTool('open', { target: it.url }); return say(declined(r) ? L2('Отменено.', 'Cancelled.') : it.say); }
    case 'tool': {
      const r = await execTool(it.name, it.args);
      if (declined(r)) return say(L2('Отменено.', 'Cancelled.'));
      if (failed(r)) return say('`' + String(r).slice(0, 400) + '`');
      let msg = it.say ? (it.quiet ? it.say : it.say + '\n```\n' + String(r).slice(0, 3000) + '\n```') : String(r);
      if (it.adb && NOADB.test(r)) msg += L2('\n\nПрограмма adb не найдена. Установите: `winget install Google.PlatformTools`, перезапустите LocalCode, на телефоне включите «Отладку по USB» (или «Отладку по Wi-Fi») и подтвердите запрос на экране телефона.', '\n\nadb was not found. Install it: `winget install Google.PlatformTools`, restart LocalCode, enable USB (or Wi-Fi) debugging on the phone and accept the prompt on its screen.');
      return say(msg);
    }
    case 'mkdir': { const p = pathOf(it.base, it.name), r = await execTool('make_dir', { path: p }); renderTree(); return say(declined(r) ? L2('Отменено.', 'Cancelled.') : failed(r) ? '`' + r + '`' : r); }
    case 'newfile': { const p = pathOf(it.base, it.name), r = await execTool('write_file', { path: p, content: it.content }); renderTree(); return say(declined(r) ? L2('Отменено.', 'Cancelled.') : failed(r) ? '`' + r + '`' : L2('Создал файл: ', 'Created file: ') + '`' + p + '`'); }
    case 'delete': {
      const found = await execTool('find_path', { query: it.query, where: it.where }); let list = []; try { list = JSON.parse(found); } catch {}
      if (!list.length) return say(L2(`Не нашёл «${it.query}».`, `Could not find “${it.query}”.`));
      const bn = (p) => p.split(/[\\/]/).pop().toLowerCase(), same = list.filter(x => bn(x.path) === bn(list[0].path));
      if (same.length > 1) return choosePath(L2('Нашёл несколько совпадений. Что удалить?', 'Found several matches. Which one to delete?'), same.slice(0, 6), 'delete_path');
      const r = await execTool('delete_path', { path: list[0].path }); renderTree();
      return say(declined(r) ? L2('Отменено.', 'Cancelled.') : failed(r) ? '`' + r + '`' : r);
    }
    case 'run': { if (it.path) await openFile(it.path); return runCurrent(!!it.debug); }
    case 'codegen': return genProgram(raw, it);
    case 'say': return say(it.text);
    default: {
      const r = await execTool('find_path', { query: it.query, where: it.where });
      let list = []; try { list = JSON.parse(r); } catch {}
      if (!list.length) return say(L2(`Не нашёл «${it.query}». Проверьте название или откройте нужную папку через «📁» вверху.`, `Could not find “${it.query}”. Check the name or open the folder with “📁” at the top.`));
      const bn = (p) => p.split(/[\\/]/).pop().toLowerCase(), same = list.filter(x => bn(x.path) === bn(list[0].path));
      if (same.length > 1) return choosePath(L2('Нашёл несколько совпадений, выберите нужное:', 'Found several matches, pick one:'), same.slice(0, 6), 'open');
      const best = list[0], res = await execTool('open', { target: best.path });
      if (declined(res)) return say(L2('Отменено.', 'Cancelled.'));
      say(L2('Открыл: ', 'Opened: ') + '`' + best.path + '`' + (list.length > 1 ? L2('\nЕщё найдено: ', '\nAlso found: ') + list.slice(1, 4).map(x => '`' + x.path + '`').join(', ') : ''));
    }
  }
}

async function send(opts = {}) {
  const raw = $('#prompt').value.trim(); if (!raw || busy) return;
  const e = ep();
  if (!e.baseUrl || !e.model) return openSettings();
  if (cfg.mode === 'online' && !e.apiKey && !/localhost|127\.0\.0\.1/.test(e.baseUrl)) { toast(tr('need_key')); return openSettings('online'); }
  stopSpeak(); $('#prompt').value = ''; setBusy(true); stopFlag = false; chatCtl = new AbortController();
  addMsg('user', esc(raw));
  const att = await attachMentions(raw);
  chatHist.push({ role: 'user', content: att ? raw + '\n\n' + att : raw });
  const agent = !opts.quick && $('#chatMode').value === 'agent';
  const native = agent && ep().useTools, textAgent = agent && !native;
  const fctx = fileContext(!!opts.force), tStart = performance.now();
  try {
    if (!opts.quick) { const it = routeIntent(raw); if (it) { await runIntent(it, raw); setBusy(false); return; } }
    for (let i = 0; i < (textAgent ? 8 : 25) && !stopFlag; i++) {
      const bub = addMsg('ai', `<span class="hint">${esc(tr('c_think'))}</span>`); let acc = '', raf = 0;
      let m;
      const tLlm = performance.now();
      try { m = await llm([{ role: 'system', content: systemPrompt(native, textAgent) }, ...withCtx(fctx)], { tools: native ? activeTools() : null, signal: chatCtl.signal,
        onDelta: d => { acc += d; if (!raf) raf = setTimeout(() => { raf = 0; bub.innerHTML = md(textAgent ? visible(acc) : acc) || '<span class="hint">…</span>'; scrollLog(); }, 70); } }); }
      catch (er) { clearTimeout(raf); bub.remove(); throw er; }
      clearTimeout(raf); showStat((performance.now() - tLlm) / 1000, (m.content || '').length);
      let tcall = null;
      if (textAgent && m.content) { tcall = parseTextTool(m.content); if (tcall) m = { ...m, content: m.content.slice(0, tcall.end) }; }
      const shown = textAgent ? visible(m.content || '') : m.content;
      if (shown) bub.innerHTML = md(shown); else bub.remove();
      chatHist.push(m); saveChat();
      if (tcall) {
        const out = await runTool({ id: 'tc' + Date.now(), function: { name: tcall.name, arguments: JSON.stringify(tcall.args) } });
        chatHist.push({ role: 'user', content: TR_PREFIX + tcall.name + ']\n' + String(out).slice(0, Math.max(2000, P().ctxChars / 3)) }); saveChat();
        continue;
      }
      if (!m.tool_calls || !m.tool_calls.length) { speakReply(shown); break; }
      for (const c of m.tool_calls) { const out = await runTool(c); chatHist.push({ role: 'tool', tool_call_id: c.id, content: out }); if (stopFlag) break; }
      saveChat();
    }
    if (stopFlag) addMsg('sys', tr('stopped')); else if (uiCfg().sound && performance.now() - tStart > 3000) beep();
  } catch (er) {
    if (stopFlag || /Остановлено|Stopped|abort/i.test(er.message)) addMsg('sys', tr('stopped'));
    else {
      let hint = tr('err_hint');
      if (/tool|function/i.test(er.message)) hint = tr('err_tools');
      if (/not found/i.test(er.message) && cfg.mode === 'offline') hint = tr('err_nomodel');
      addMsg('sys', `<span style="color:var(--err)">${esc(tr('err_prefix', er.message))}</span><br>${esc(hint)}`);
      if (chatHist.length && chatHist[chatHist.length - 1].role === 'user') chatHist.pop();
    }
  }
  setBusy(false);
}

$('#send').onclick = () => send();
$('#stop').onclick = () => { stopSpeak(); stopFlag = true; if (chatCtl) chatCtl.abort(); if (pendingAsk) pendingAsk(false); };
$('#newChat').onclick = () => { stopSpeak(); chatHist = []; $('#log').innerHTML = ''; saveChat(); };
$('#chatMode').onchange = () => updateStatus2();

/* @-упоминания */
let mIdx = 0;
function mentionState() { const p = $('#prompt'), b = p.value.slice(0, p.selectionStart), m = b.match(/@([\w.\-\/]*)$/); return m ? { q: m[1], start: p.selectionStart - m[1].length - 1 } : null; }
function showMention() {
  const st = mentionState(), box = $('#mention');
  if (!st) { box.hidden = true; return; }
  const q = st.q.toLowerCase(); const list = files.filter(f => f.toLowerCase().includes(q)).slice(0, 30);
  if (!list.length) { box.hidden = true; return; }
  mIdx = Math.min(mIdx, list.length - 1); box.hidden = false; box.innerHTML = '';
  list.forEach((f, i) => { const d = document.createElement('div'); d.className = 'mi' + (i === mIdx ? ' on' : ''); d.textContent = f; d.onmousedown = (e) => { e.preventDefault(); pickMention(f); };
    d.onmouseenter = () => { box.querySelectorAll('.mi').forEach(x => x.classList.remove('on')); d.classList.add('on'); mIdx = i; previewMention(f); }; box.appendChild(d); });
  const pv = document.createElement('pre'); pv.className = 'mprev'; pv.id = 'mprev'; box.appendChild(pv); previewMention(list[mIdx]);
}
const prevCache = new Map();
async function previewMention(f) {
  const el = $('#mprev'); if (!el || !f) return; el.dataset.f = f;
  if (!prevCache.has(f)) { el.textContent = '…'; try { const { content } = await api('/api/file?path=' + encodeURIComponent(f)); prevCache.set(f, content.split('\n').slice(0, 10).map(l => l.slice(0, 110)).join('\n')); } catch { prevCache.set(f, ''); } }
  const now = $('#mprev'); if (now && now.dataset.f === f) now.textContent = prevCache.get(f);
}
function pickMention(f) { const p = $('#prompt'), st = mentionState(); if (!st) return; p.setRangeText('@' + f + ' ', st.start, p.selectionStart, 'end'); $('#mention').hidden = true; p.focus(); }
$('#prompt').addEventListener('input', () => { mIdx = 0; showMention(); });
$('#prompt').addEventListener('keydown', (e) => {
  const box = $('#mention');
  if (!box.hidden) {
    const items = box.querySelectorAll('.mi');
    if (e.key === 'ArrowDown') { e.preventDefault(); mIdx = (mIdx + 1) % items.length; showMention(); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); mIdx = (mIdx - 1 + items.length) % items.length; showMention(); return; }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickMention(items[mIdx].textContent); return; }
    if (e.key === 'Escape') { box.hidden = true; return; }
  }
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});

/* ================= Быстрое открытие ================= */
let qoSel = 0, qoItems = [];
function fuzzy(q, s) { q = q.toLowerCase(); s = s.toLowerCase(); let i = 0, score = 0, last = -1; for (const ch of q) { const k = s.indexOf(ch, i); if (k < 0) return -1; score += k === last + 1 ? 3 : 1; if (k === 0 || '/._-'.includes(s[k - 1])) score += 2; last = k; i = k + 1; } return score - s.length * 0.01; }
function paletteActions() {
  const sw = (m) => () => $('#modeSeg button[data-m=' + m + ']').click();
  return [
    [L2('Файл: новый файл', 'File: new file'), () => $('#newFile').click()], [L2('Файл: сохранить всё', 'File: save all'), async () => { for (const t of tabs) if (t.dirty) await saveTab(t, true); toast(tr('saved')); }],
    [L2('Проект: открыть другую папку', 'Project: open another folder'), () => openFolder()],
    [L2('Код: запустить файл (F5)', 'Code: run the file (F5)'), () => runCurrent(false)], [L2('Код: отладка (Shift+F5)', 'Code: debug (Shift+F5)'), () => runCurrent(true)],
    [L2('Терминал: показать или скрыть', 'Terminal: show or hide'), () => toggleTerm()], [L2('Терминал: очистить', 'Terminal: clear'), () => { $('#termOut').textContent = ''; }],
    [L2('Git: статус', 'Git: status'), () => { toggleTerm(true); termRun('git status'); }],
    [L2('Git: сохранить изменения (коммит)…', 'Git: commit changes…'), () => { const m = prompt(L2('Описание изменений:', 'Commit message:'), L2('Правки', 'Update')); if (m) { toggleTerm(true); termRun('git add -A && git commit -m "' + m.replace(/["`$\\]/g, ' ') + '"'); } }],
    [L2('Чат: новый чат', 'Chat: new chat'), () => $('#newChat').click()], [L2('Чат: сохранить в файл', 'Chat: export to a file'), () => exportChat()], [L2('Чат: скопировать последний ответ', 'Chat: copy the last answer'), () => copyLast()],
    [L2('Чат: режим «Агент»', 'Chat: Agent mode'), () => { $('#chatMode').value = 'agent'; updateStatus(); }], [L2('Чат: режим «Вопрос»', 'Chat: Ask mode'), () => { $('#chatMode').value = 'ask'; updateStatus(); }],
    [L2('ИИ: режим «Офлайн»', 'AI: Offline mode'), sw('offline')], [L2('ИИ: режим «Онлайн»', 'AI: Online mode'), sw('online')],
    [L2('ИИ: сбросить паузы ключей', 'AI: clear key pauses'), async () => { await post('/api/keys/reset', {}); toast(tr('keys_reset_done')); }],
    [L2('Голос: начать или закончить запись (Alt+M)', 'Voice: start or stop recording (Alt+M)'), () => toggleVoice()],
    [L2('Вид: светлая или тёмная тема', 'View: light or dark theme'), () => $('#themeBtn').click()], [L2('Вид: настройки оформления', 'View: appearance settings'), () => openSettings()],
    [L2('Помощь: горячие клавиши (F1)', 'Help: hotkeys (F1)'), () => openHelp()],
  ];
}
function renderQo() {
  const q = $('#qoIn').value.trim();
  if (q.startsWith('>')) { const w = q.slice(1).trim().toLowerCase(); qoItems = paletteActions().filter(a => !w || a[0].toLowerCase().includes(w)).map(a => ({ label: a[0], run: a[1] })); }
  else qoItems = (q ? files.map(f => [f, fuzzy(q, f)]).filter(x => x[1] >= 0).sort((a, b) => b[1] - a[1]).map(x => x[0]) : files).slice(0, 60);
  qoSel = Math.min(qoSel, Math.max(0, qoItems.length - 1));
  $('#qoList').innerHTML = ''; qoItems.forEach((f, i) => { const d = document.createElement('div'); d.className = 'mi' + (i === qoSel ? ' on' : ''); d.textContent = typeof f === 'string' ? f : f.label; d.onclick = () => pickQo(f); $('#qoList').appendChild(d); });
}
function pickQo(f) { $('#qo').classList.remove('open'); if (typeof f === 'string') openFile(f); else f.run(); }
function openQo(pref) { $('#qo').classList.add('open'); $('#qoIn').value = typeof pref === 'string' ? pref : ''; qoSel = 0; renderQo(); $('#qoIn').focus(); }
$('#qoBtn').onclick = () => openQo();
$('#qo').onclick = (e) => { if (e.target.id === 'qo') $('#qo').classList.remove('open'); };
let qoTimer = 0;
$('#qoIn').addEventListener('input', () => { qoSel = 0; clearTimeout(qoTimer); if (files.length > 2000) qoTimer = setTimeout(renderQo, 120); else renderQo(); });
$('#qoIn').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') $('#qo').classList.remove('open');
  else if (e.key === 'ArrowDown') { e.preventDefault(); qoSel = Math.min(qoItems.length - 1, qoSel + 1); renderQo(); $('#qoList .on')?.scrollIntoView({ block: 'nearest' }); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); qoSel = Math.max(0, qoSel - 1); renderQo(); $('#qoList .on')?.scrollIntoView({ block: 'nearest' }); }
  else if (e.key === 'Enter' && qoItems[qoSel]) pickQo(qoItems[qoSel]);
});

/* ================= Настройки ================= */
let draft, editMode;
function openSettings(mode) { draft = JSON.parse(JSON.stringify(cfg)); editMode = mode || cfg.mode; loadForm(); $('#modal').classList.add('open'); }
function readForm() {
  const e = draft[editMode];
  Object.assign(e, { preset: $('#fPreset').value, baseUrl: $('#fUrl').value.trim(), model: $('#fModel').value.trim(), ...keysFromForm(), authPrefix: $('#fAuth').value.trim() || 'Bearer', useTools: $('#fTools').checked, kind: $('#fKind').value });
  draft.ui = readUiForm(); draft.voiceEngine = $('#fVoiceEngine').value; draft.sttSize = $('#fSttSize').value; draft.voiceAuto = $('#fVoiceAuto').checked; draft.webSearch = $('#fWeb').checked;
}
const presetKey = (mode, k) => (mode === 'offline' && k === 'custom' ? 'localcustom' : k);
const presetLabel = (mode, k) => { const key = 'pr_' + presetKey(mode, k); return D[key] ? tr(key) : PRESETS[mode][k].label; };
const presetNote = (mode, k) => { const key = 'n_' + presetKey(mode, k); return D[key] ? tr(key) : ((PRESETS[mode][k] || {}).note || ''); };
function loadForm() {
  const e = draft[editMode], pr = PRESETS[editMode][e.preset];
  $$('#setSeg button').forEach(b => b.classList.toggle('on', b.dataset.m === editMode));
  $('#fPreset').innerHTML = Object.keys(PRESETS[editMode]).map(k => `<option value="${k}">${esc(presetLabel(editMode, k))}</option>`).join('');
  $('#fPreset').value = e.preset; $('#fUrl').value = e.baseUrl; $('#fModel').value = e.model; $('#fKeys').value = (e.apiKeys && e.apiKeys.length ? e.apiKeys : (e.apiKey ? [e.apiKey] : [])).join('\n'); $('#fKeysRes').textContent = ''; $('#fAuth').value = e.authPrefix; $('#fTools').checked = e.useTools; $('#fKind').value = e.kind;
  $('#modelList').innerHTML = (pr.models || []).map(m => `<option value="${escA(m)}">`).join('');
  $('#fNote').textContent = presetNote(editMode, e.preset); $('#fTestRes').textContent = '';
  $('#epLegend').textContent = tr(editMode === 'offline' ? 'set_off_leg' : 'set_on_leg');
  $('#fProfile').value = draft.profile; $('#fAC').checked = draft.autocomplete; $('#fTheme').value = draft.theme;
  $('#fLang').value = draft.lang || LANG; $('#fAutosave').checked = !!draft.autosave; $('#fWeb').checked = !!draft.webSearch;
  $('#fPrompt').value = draft.sysPrompt || ''; $('#fVoiceSend').checked = draft.voiceSend !== false; $('#fVoiceSpeak').checked = !!draft.voiceSpeak;
  $('#catBox').hidden = editMode !== 'offline';
  loadUiForm();
  if (editMode === 'offline') loadCatalog();
}

/* ---- каталог офлайн-моделей ---- */
let catData = null;
const FIT = { gpu: ['fit_gpu', 'var(--ok)'], ok: ['fit_ok', 'var(--ok)'], slow: ['fit_slow', 'var(--warn)'], no: ['fit_no', 'var(--err)'] };
async function loadCatalog() {
  const box = $('#catList'); box.textContent = tr('detecting'); $('#catHw').textContent = '';
  try { catData = await api('/api/catalog'); } catch (e) { box.textContent = e.message; return; }
  renderCatalog();
}
const catName = (m) => catData.installed.some(n => n.split(':')[0] === 'localcode-' + m.id) ? 'localcode-' + m.id : (catData.installed.includes(m.tag) ? m.tag : null);
const loc = (o) => (o && (o[LANG] || o.ru || o.en)) || '';
let catQ = '', catTag = '', pullAbort = null;
const tagLabel = (t) => D['tag_' + t] ? tr('tag_' + t) : t;
function renderCatTags() {
  const all = [...new Set(catData.models.flatMap(m => m.tags || []))], box = $('#catTags');
  box.innerHTML = ['', ...all].map(t => `<button type="button" class="chip${t === catTag ? ' on' : ''}" data-t="${escA(t)}">${esc(t ? tagLabel(t) : tr('tag_all'))}</button>`).join('');
}
function renderCatalog() {
  const c = catData, hw = c.hw, box = $('#catList');
  const gpus = hw.gpus.length ? hw.gpus.map(g => g.name + (g.vramGB ? ` ${g.vramGB} GB` : '')).join(', ') : tr('cat_nogpu');
  const weakGpu = hw.gpus.some(g => g.vendor === 'amd' || g.vendor === 'intel') && !hw.vramGB;
  $('#catHw').textContent = tr('cat_hw', hw.cpu, hw.threads, hw.ramGB, gpus) + (weakGpu ? ' · ' + tr('cat_gpu_note') : '') + (c.ollama ? '' : ' · ' + tr('cat_nollama'));
  box.innerHTML = '';
  renderCatTags();
  const shown = c.models.filter(m => (!catTag || (m.tags || []).includes(catTag)) && (!catQ || (m.name + ' ' + m.tag + ' ' + loc(m.desc) + ' ' + loc(m.pc) + ' ' + (m.tags || []).join(' ')).toLowerCase().includes(catQ)));
  if (!shown.length) box.innerHTML = `<div class="hint">${esc(tr('cat_none'))}</div>`;
  for (const m of shown) {
    const have = catName(m), sel = have && draft.offline.model === have, [fl, fc] = FIT[m.fit];
    const d = document.createElement('div'); d.className = 'cm' + (m.id === c.rec ? ' rec' : '');
    d.innerHTML = `<div class="t"><b>${esc(m.name)}</b>${m.id === c.rec ? `<span class="badge" style="color:var(--accent)">${esc(tr('rec'))}</span>` : ''}${(m.tags || []).map(t => `<span class="badge tg">${esc(tagLabel(t))}</span>`).join('')}<span class="badge" style="color:${fc}">${esc(tr(fl))}</span>${have ? `<span class="badge">${esc(tr('installed'))}</span>` : ''}</div>`
      + `<div class="hint">${esc(loc(m.desc))}</div><div class="hint">${esc(tr('cat_for'))} ${esc(loc(m.pc))}</div>`
      + `<div class="hint">${esc(tr('cat_req', m.minRam, m.minVram, m.sizeGB))} · ${esc(tr(m.tools ? 'tools_yes' : 'tools_no'))}</div>`
      + `<div class="row"><button type="button" class="cbtn ${have ? '' : 'primary'}">${esc(tr(have ? (sel ? 'using' : 'use') : 'install'))}</button><span class="prog"></span></div>`;
    const btn = d.querySelector('button'), prog = d.querySelector('.prog');
    btn.disabled = !!sel || (!have && !c.ollama);
    btn.onclick = () => have ? useCatModel(m, have) : pullCat(m, btn, prog);
    box.appendChild(d);
  }
}
function useCatModel(m, name) {
  readForm(); const e = draft.offline;
  Object.assign(e, { preset: 'ollama', baseUrl: PRESETS.offline.ollama.baseUrl, kind: 'openai', model: name, useTools: m.tools });
  draft.profile = m.ui; loadForm();
}
async function pullCat(m, btn, prog) {
  if (m.fit === 'no' && !confirm(tr('cat_no_confirm'))) return;
  if (m.fit === 'slow' && !confirm(tr('cat_slow_confirm'))) return;
  if (pullAbort) return toast(tr('pull_busy'));
  pullAbort = new AbortController(); $$('#catList .cbtn').forEach(b => b.disabled = true); $('#catQ').disabled = true; $('#catTags').style.pointerEvents = 'none';
  const cancelBtn = document.createElement('button'); cancelBtn.type = 'button'; cancelBtn.textContent = tr('cancel'); cancelBtn.onclick = () => pullAbort && pullAbort.abort(); prog.after(cancelBtn);
  prog.textContent = tr('connecting');
  try {
    const r = await fetch('/api/pull', { method: 'POST', headers: H(), body: JSON.stringify({ id: m.id }), signal: pullAbort.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const reader = r.body.getReader(), dec = new TextDecoder(); let buf = '', ok = false;
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true }); let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line) continue;
        const o = JSON.parse(line);
        if (o.t === 'progress') prog.textContent = o.pct != null ? tr('pulling', o.pct) : o.status === '@tuning' ? tr('tuning') : o.status === '@mirror' ? tr('mirror') : o.status;
        else if (o.t === 'error') throw new Error(o.v);
        else if (o.t === 'done') ok = true;
      }
    }
    if (!ok) throw new Error(tr('pull_aborted'));
    toast(tr('pull_done')); await loadCatalog();
  } catch (e) { toast(e.name === 'AbortError' ? tr('pull_cancelled') : '✗ ' + e.message, 6000); }
  finally { pullAbort = null; cancelBtn.remove(); $('#catQ').disabled = false; $('#catTags').style.pointerEvents = ''; if (catData) renderCatalog(); }
}
$('#catQ').addEventListener('input', (e) => { catQ = e.target.value.trim().toLowerCase(); renderCatalog(); });
$('#catTags').addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (!b) return; catTag = b.dataset.t; renderCatalog(); });
$$('#setSeg button').forEach(b => b.onclick = () => { readForm(); editMode = b.dataset.m; loadForm(); });
$('#fPreset').onchange = () => {
  const k = $('#fPreset').value, e = draft[editMode]; draft.keyMemo = draft.keyMemo || {};
  draft.keyMemo[editMode + ':' + e.preset] = keysFromForm().apiKeys;           // ключи помним отдельно для каждого провайдера
  const mem = draft.keyMemo[editMode + ':' + k] || [];
  draft[editMode] = { ...mkEp(editMode, k), apiKeys: mem, apiKey: mem[0] || '' }; loadForm();
};
const keysFromForm = () => { const ks = [...new Set($('#fKeys').value.split(/[\s,;]+/).map(x => x.trim()).filter(Boolean))]; return { apiKeys: ks, apiKey: ks[0] || '' }; };
$('#fKeysShow').onchange = () => $('#fKeys').classList.toggle('show', $('#fKeysShow').checked);
$('#fKeysTest').onclick = async () => {
  const out = $('#fKeysRes'), { apiKeys } = keysFromForm();
  if (!apiKeys.length) { out.textContent = tr('keys_none'); return; }
  out.textContent = tr('connecting');
  try {
    const { keys } = await post('/api/keys/test', { cfg: { baseUrl: $('#fUrl').value.trim(), kind: $('#fKind').value, authPrefix: $('#fAuth').value.trim() || 'Bearer', apiKeys } });
    out.innerHTML = keys.map((k, i) => `${i + 1}) <code class="in">${esc(k.key)}</code> — ` + (k.ok === true ? '✓ ' + esc(tr('key_ok')) : k.ok === null ? '? ' + esc(tr('key_unk')) : '✗ ' + esc(k.msg || 'HTTP ' + k.status)) + ' · ' + esc(tr('key_uses')) + ' ' + k.uses + (k.pausedSec ? ' · ⏸ ' + esc(tr('key_pause', k.pausedSec)) : '')).join('<br>');
  } catch (e) { out.textContent = e.message; }
};
$('#fKeysReset').onclick = async () => { await post('/api/keys/reset', {}); toast(tr('keys_reset_done')); $('#fKeysRes').textContent = ''; };
$('#fLoad').onclick = async () => {
  readForm(); $('#fTestRes').textContent = tr('loading_list');
  try { const { models } = await post('/api/models', { cfg: toServer(draft[editMode]) }); $('#modelList').innerHTML = models.map(m => `<option value="${escA(m)}">`).join(''); $('#fTestRes').textContent = tr('list_ok', models.length); }
  catch (er) { $('#fTestRes').textContent = '✗ ' + er.message; }
};
$('#fTest').onclick = async () => {
  readForm(); const el = $('#fTestRes'); el.textContent = tr('testing');
  try { const m = await llm([{ role: 'user', content: 'Reply with one word: ok' }], { e: draft[editMode], opts: { maxTokens: 16 } }); el.textContent = tr('test_ok', (m.content || '').slice(0, 40)); }
  catch (er) { el.textContent = '✗ ' + er.message; }
};
$('#setCancel').onclick = () => { $('#modal').classList.remove('open'); applyTheme(); };
$('#setSave').onclick = () => {
  readForm(); draft.profile = $('#fProfile').value; draft.autocomplete = $('#fAC').checked; draft.theme = $('#fTheme').value;
  draft.autosave = $('#fAutosave').checked; draft.lang = $('#fLang').value;
  draft.ui = readUiForm(); draft.voiceEngine = $('#fVoiceEngine').value; draft.sttSize = $('#fSttSize').value; draft.voiceAuto = $('#fVoiceAuto').checked; draft.webSearch = $('#fWeb').checked;
  draft.sysPrompt = $('#fPrompt').value; draft.voiceSend = $('#fVoiceSend').checked; draft.voiceSpeak = $('#fVoiceSpeak').checked; if (!draft.voiceSpeak) stopSpeak();
  cfg = draft; LANG = cfg.lang; saveCfg(); $('#modal').classList.remove('open'); applyTheme(); refreshLang();
};
$('#settingsBtn').onclick = () => openSettings();
$('#modal').onclick = (e) => { if (e.target.id === 'modal') { $('#modal').classList.remove('open'); applyTheme(); } };
$('#help').onclick = (e) => { if (e.target.id === 'help') $('#help').classList.remove('open'); };
$('#helpClose').onclick = () => $('#help').classList.remove('open');

function applyTheme() { document.documentElement.dataset.theme = cfg.theme || 'dark'; applyUi(); }
$('#themeBtn').onclick = () => { cfg.theme = cfg.theme === 'light' ? 'dark' : 'light'; saveCfg(); applyTheme(); };
function updateHeader() {
  $$('#modeSeg button').forEach(b => b.classList.toggle('on', b.dataset.m === cfg.mode));
  $('#modelLabel').textContent = ep().model + ((ep().apiKeys || []).length > 1 ? ' · 🔑' + ep().apiKeys.length : '');
  updateStatus2();
}
function updateStatus2() {
  $('#stMode').textContent = tr(cfg.mode === 'offline' ? 'm_offline' : 'm_online') + ' · ' + tr($('#chatMode').value === 'agent' ? 'st_mode_agent' : 'st_mode_ask') + (useTools() ? '' : ($('#chatMode').value === 'agent' ? tr('st_textagent') : tr('st_notools')));
  $('#stAC').textContent = tr('st_ac', tr(cfg.autocomplete ? 'on' : 'off')); $('#stAC').title = tr('st_ac_tip');
  $('#stSave').textContent = tr('st_autosave', tr(cfg.autosave ? 'on' : 'off')); $('#stSave').title = tr('st_autosave_tip');
  $('#prompt').title = useTools() ? '' : ($('#chatMode').value === 'agent' ? tr('st_hint_textagent') : tr('st_hint_notools'));
}
$('#stAC').onclick = () => { cfg.autocomplete = !cfg.autocomplete; saveCfg(); updateStatus2(); if (!cfg.autocomplete) clearGhost(); };
$('#stSave').onclick = () => { cfg.autosave = !cfg.autosave; saveCfg(); updateStatus2(); if (cfg.autosave) tabs.filter(x => x.dirty).forEach(x => saveTab(x, true)); };
$$('#modeSeg button').forEach(b => b.onclick = () => {
  cfg.mode = b.dataset.m; saveCfg(); updateHeader();
  if (cfg.mode === 'online' && !ep().apiKey) openSettings('online');
});

/* ================= Голос ================= */
// Голос. По умолчанию — офлайн-распознавание (whisper.cpp на этом ПК: после одноразовой загрузки интернет не нужен).
// Запасной вариант — распознавание браузера (нужен интернет). Alt+M включает и выключает запись, Esc отменяет.
const SRClass = window.SpeechRecognition || window.webkitSpeechRecognition;
const VOICE_CMDS = {
  stop: ['стоп', 'остановись', 'хватит', 'stop', 'cancel'],
  newchat: ['новый чат', 'new chat'],
  send: ['отправь', 'отправить', 'send', 'send it'],
  clear: ['очисти', 'очистить', 'стереть', 'clear'],
};
// Команда срабатывает, только если сказана ЦЕЛИКОМ (чтобы фраза «остановись на третьем пункте» ушла в чат как текст)
function voiceCommand(text) {
  const s = text.toLowerCase().replace(/[.,!?;:"«»]/g, '').trim(), is = (k) => VOICE_CMDS[k].includes(s);
  if (is('stop')) { stopSpeak(); if (busy) $('#stop').click(); return true; }
  if (is('newchat')) { $('#newChat').click(); return true; }
  if (is('send')) { send(); return true; }
  if (is('clear')) { $('#prompt').value = ''; return true; }
  return false;
}
function stopSpeak() { if ('speechSynthesis' in window) speechSynthesis.cancel(); }
function speakReply(text) {
  if (!cfg.voiceSpeak || !('speechSynthesis' in window) || !text) return;
  const plain = String(text).replace(/```[\s\S]*?```/g, ' ' + tr('v_code_skipped') + ' ').replace(/`([^`]+)`/g, '$1').replace(/[*_#>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 900);
  if (!plain) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(plain); u.lang = LANG === 'ru' ? 'ru-RU' : 'en-US';
  const v = speechSynthesis.getVoices().find(x => x.lang.toLowerCase().startsWith(LANG)); if (v) u.voice = v;
  speechSynthesis.speak(u);
}

const BAD_STT = /^(?:продолжение следует|субтитры\b.*|спасибо за просмотр|редактор субтитров.*|thanks for watching|thank you)[.!\s]*$/i;
let VS = 'idle', rc = null, voiceBase = '';
const sttSize = () => cfg.sttSize || 'base';
function setMic(s) {
  VS = s; $('#mic').classList.toggle('rec', s === 'rec'); $('#mic').classList.toggle('busy', s === 'busy');
  $('#stAI').textContent = s === 'rec' ? tr('v_listening') : s === 'busy' ? tr('v_recognizing') : '';
}
function handleVoiceText(text) {
  const txt = String(text || '').trim();
  if (!txt || BAD_STT.test(txt)) return toast(tr('v_nospeech'));
  if (voiceCommand(txt)) return;
  const pr = $('#prompt'); pr.value = voiceBase + txt;
  if (cfg.voiceSend !== false) send(); else pr.focus();
}
async function toggleVoice() {
  if (VS === 'rec') return (cfg.voiceEngine === 'browser') ? stopBrowser() : stopRec(true);
  if (VS === 'busy') return;
  stopSpeak();
  const pr = $('#prompt'); voiceBase = pr.value ? pr.value.replace(/\s+$/, '') + ' ' : '';
  if (cfg.voiceEngine === 'browser') return startBrowser();
  const st = await api('/api/stt/status').catch(() => null);
  if (!st) return toast(tr('v_err', 'server'));
  if (!st.bin || !st.models[sttSize()].ready) { if (!(await offerSttInstall(st))) return; }
  startRec();
}
async function offerSttInstall(st) {
  if (!st.bin && !st.canInstall) { toast(tr('v_noinstall'), 8000); return false; }
  const mb = st.models[sttSize()].mb + (st.bin ? 0 : 15);
  if (!confirm(tr('v_ask_install', mb))) return false;
  return installStt();
}
async function installStt() {
  const info2 = (o) => { const t = o.status + (o.pct != null ? ' ' + o.pct + '%' : ''); $('#stAI').textContent = t; const el = $('#vState'); if (el) el.textContent = t; };
  try {
    const r = await fetch('/api/stt/install', { method: 'POST', headers: H(), body: JSON.stringify({ size: sttSize() }) });
    const reader = r.body.getReader(), dec = new TextDecoder(); let buf = '', ok = false;
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true }); let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line) continue;
        const o = JSON.parse(line);
        if (o.t === 'progress') info2(o); else if (o.t === 'error') throw new Error(o.v); else if (o.t === 'done') ok = true;
      }
    }
    $('#stAI').textContent = ''; if (ok) { toast(tr('v_installed')); refreshSttState(); }
    return ok;
  } catch (e) { $('#stAI').textContent = ''; toast(tr('v_err', e.message), 9000); refreshSttState(); return false; }
}
async function refreshSttState() {
  const el = $('#vState'); if (!el) return;
  const st = await api('/api/stt/status').catch(() => null);
  if (!st) { el.textContent = ''; return; }
  const ready = st.bin && st.models[sttSize()].ready;
  el.textContent = ready ? tr('v_ready') : tr('v_notready', st.models[sttSize()].mb);
  $('#vInstall').hidden = ready; $('#vRemove').hidden = !(st.bin || Object.values(st.models).some(m => m.ready));
}

async function startRec() {
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } }); }
  catch { return toast(tr('v_denied'), 7000); }
  const ac = new (window.AudioContext || window.webkitAudioContext)(); try { await ac.resume(); } catch {}
  const src = ac.createMediaStreamSource(stream), proc = ac.createScriptProcessor(4096, 1, 1);
  const r = { stream, ac, src, proc, chunks: [], speech: false, rate: ac.sampleRate, t0: performance.now(), lastVoice: performance.now(), noise: [], peak: 0 };
  proc.onaudioprocess = (ev) => {
    if (rc !== r) return;
    const d = ev.inputBuffer.getChannelData(0); r.chunks.push(new Float32Array(d));
    let sum = 0; for (let i = 0; i < d.length; i++) sum += d[i] * d[i];
    const rms = Math.sqrt(sum / d.length), now = performance.now();
    if (r.noise.length < 4) { r.noise.push(rms); return; }
    const floor = r.noise.reduce((a, b) => a + b, 0) / r.noise.length, thr = Math.max(0.012, floor * 2.8);
    if (rms > thr) { r.speech = true; r.lastVoice = now; }
    if (cfg.voiceAuto !== false) {
      if (r.speech && now - r.lastVoice > 1500) stopRec(false);
      else if (!r.speech && now - r.t0 > 9000) stopRec(false);
    }
    if (now - r.t0 > 60000) stopRec(false);
  };
  src.connect(proc); proc.connect(ac.destination);
  rc = r; setMic('rec');
}
function releaseRec(r) { try { r.proc.onaudioprocess = null; r.proc.disconnect(); r.src.disconnect(); } catch {} try { r.stream.getTracks().forEach(t => t.stop()); } catch {} try { r.ac.close(); } catch {} }
function cancelVoice() {
  if (rc) { const r = rc; rc = null; releaseRec(r); setMic('idle'); }
  else if (VS === 'rec' && cfg.voiceEngine === 'browser') { try { brRec.abort(); } catch {} setMic('idle'); }
}
async function stopRec(manual) {
  if (!rc) return;
  const r = rc; rc = null; releaseRec(r);
  const n = r.chunks.reduce((a, c) => a + c.length, 0);
  if (n < r.rate * 0.4 || (!r.speech && !manual)) { setMic('idle'); return toast(tr('v_nospeech')); }
  setMic('busy');
  try {
    const resp = await fetch('/api/stt?lang=' + LANG + '&size=' + sttSize(), { method: 'POST', headers: { 'x-token': TOKEN, 'x-lang': LANG, 'Content-Type': 'audio/wav' }, body: toWav16k(r.chunks, r.rate) });
    const j = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(j.error || resp.statusText);
    setMic('idle'); handleVoiceText(j.text);
  } catch (e) { setMic('idle'); toast(tr('v_err', e.message), 9000); }
}
function toWav16k(chunks, rate) {
  const n = chunks.reduce((a, c) => a + c.length, 0), all = new Float32Array(n); let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.length; }
  let mx = 0; for (let i = 0; i < n; i++) { const v = Math.abs(all[i]); if (v > mx) mx = v; }
  const gain = mx > 0 ? Math.min(8, 0.9 / mx) : 1, ratio = rate / 16000, len = Math.floor(n / ratio), pcm = new Int16Array(len);
  for (let i = 0; i < len; i++) {
    const a = Math.floor(i * ratio), b = Math.max(a + 1, Math.min(n, Math.floor((i + 1) * ratio))); let s = 0;
    for (let j = a; j < b; j++) s += all[j];
    pcm[i] = Math.max(-1, Math.min(1, (s / (b - a)) * gain)) * 32767;
  }
  const buf = new ArrayBuffer(44 + len * 2), v = new DataView(buf), w = (p, t) => { for (let i = 0; i < t.length; i++) v.setUint8(p + i, t.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + len * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, len * 2, true);
  new Int16Array(buf, 44).set(pcm);
  return new Blob([buf], { type: 'audio/wav' });
}

// Запасной движок: распознавание браузера (серверы Google/Microsoft, нужен интернет)
let brRec = null, brTimer = 0;
function startBrowser() {
  if (!SRClass) return toast(tr('v_unsupported'), 6000);
  let fin = '', interim = '';
  brRec = new SRClass(); brRec.lang = LANG === 'ru' ? 'ru-RU' : 'en-US'; brRec.interimResults = true; brRec.continuous = true;
  brRec.onstart = () => setMic('rec');
  brRec.onresult = (ev) => { fin = ''; interim = ''; for (let i = 0; i < ev.results.length; i++) { const x = ev.results[i]; if (x.isFinal) fin += x[0].transcript; else interim += x[0].transcript; } $('#prompt').value = voiceBase + fin + interim; };
  brRec.onerror = (ev) => { if (ev.error === 'no-speech' || ev.error === 'aborted') return; toast(ev.error === 'not-allowed' || ev.error === 'service-not-allowed' ? tr('v_denied') : ev.error === 'network' ? tr('v_network') : tr('v_err', ev.error), 6000); };
  brRec.onend = () => finishBrowser();
  brRec.__get = () => (fin + interim).trim();
  try { brRec.start(); } catch (e) { toast(e.message); }
}
function stopBrowser() {
  clearTimeout(brTimer); try { brRec.stop(); } catch {}
  brTimer = setTimeout(() => { try { brRec.abort(); } catch {} finishBrowser(); }, 1200);   // без интернета onend может не прийти — не зависаем
}
function finishBrowser() {
  clearTimeout(brTimer); if (VS !== 'rec') return;
  const txt = brRec && brRec.__get ? brRec.__get() : ''; setMic('idle'); $('#prompt').value = voiceBase.trimEnd();
  handleVoiceText(txt);
}
$('#mic').onclick = toggleVoice;

/* ================= Оформление и кастомизация ================= */
const UI_DEF = { accent: '', fs: 13, lh: 1.55, font: '', chatFs: 13, radius: 8, density: 'normal', lineNums: true, quick: true, tab: 2, css: '', uiFont: '', lig: false, ew: 400, syntax: 'default', chatStyle: 'bubbles', chatSide: 'right', anim: true, statusBar: true, wrapCode: false, asMs: 1000, acMs: 0, quickList: '', sound: false };
const SWATCHES = ['#7c9cff', '#a78bfa', '#34d399', '#fbbf24', '#fb7185', '#22d3ee', '#f97316'];
const uiCfg = () => ({ ...UI_DEF, ...((cfg && cfg.ui) || {}) });
const IND = () => ' '.repeat(Math.max(1, Math.min(8, +uiCfg().tab || 2)));
function contrastOn(hex) { const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255; return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#0c1020' : '#ffffff'; }
function applyUi(u) {
  u = u || uiCfg(); const r = document.documentElement.style;
  const fs = Math.max(10, Math.min(28, +u.fs || 13)), lh = Math.round(fs * Math.max(1.2, Math.min(2.2, +u.lh || 1.55)));
  r.setProperty('--efs', fs + 'px'); r.setProperty('--elh', lh + 'px'); r.setProperty('--cfs', (+u.chatFs || 13) + 'px');
  r.setProperty('--r', (isNaN(+u.radius) ? 8 : +u.radius) + 'px'); r.setProperty('--tabsize', Math.max(1, +u.tab || 2));
  if (u.font) r.setProperty('--emono', u.font + ',var(--mono)'); else r.removeProperty('--emono');
  if (/^#[0-9a-f]{6}$/i.test(u.accent || '')) { r.setProperty('--accent', u.accent); r.setProperty('--accent-bg', `color-mix(in srgb, ${u.accent} 22%, var(--bg))`); r.setProperty('--on-accent', contrastOn(u.accent)); }
  else ['--accent', '--accent-bg', '--on-accent'].forEach(v => r.removeProperty(v));
  document.documentElement.dataset.density = u.density || 'normal';
  const dd = document.documentElement.dataset;
  if (u.uiFont) r.setProperty('--ui', u.uiFont + ', "Segoe UI", system-ui, sans-serif'); else r.removeProperty('--ui');
  r.setProperty('--lig', u.lig ? 'normal' : 'none'); r.setProperty('--ew', +u.ew || 400);
  dd.syntax = u.syntax || 'default'; dd.chat = u.chatStyle || 'bubbles'; dd.side = u.chatSide || 'right'; dd.anim = u.anim === false ? 'off' : 'on'; dd.wrapcode = u.wrapCode ? '1' : '0';
  $$('.split').forEach(s => { s.dataset.dir = ((s.dataset.v === '--sw') !== (dd.side === 'left')) ? '1' : '-1'; });
  $('#status').hidden = u.statusBar === false;
  if (buildQuick.last !== u.quickList) buildQuick();
  $('#editorWrap').classList.toggle('nonums', u.lineNums === false);
  $('#quick').hidden = u.quick === false;
  let st = $('#userCss'); if (!st) { st = document.createElement('style'); st.id = 'userCss'; document.head.appendChild(st); }
  st.textContent = u.css || '';
  if (typeof render === 'function' && cur && cur()) { render.n = 0; render(); syncScroll(); }
}
function readUiForm() {
  return { accent: $('#fAccent').dataset.on === '1' ? $('#fAccent').value : '', fs: +$('#fFs').value, lh: +$('#fLh').value, font: $('#fFont').value, chatFs: +$('#fChatFs').value,
    radius: +$('#fRadius').value, density: $('#fDensity').value, lineNums: $('#fNums').checked, quick: $('#fQuick').checked, tab: +$('#fTab').value, css: $('#fCss').value,
    uiFont: $('#fUiFont').value, lig: $('#fLig').checked, ew: +$('#fEw').value, syntax: $('#fSyntax').value, chatStyle: $('#fChatStyle').value, chatSide: $('#fChatSide').value, anim: $('#fAnim').checked, statusBar: $('#fStatusBar').checked,
    wrapCode: $('#fWrapCode').checked, asMs: Math.max(200, +$('#fAsMs').value || 1000), acMs: Math.max(0, +$('#fAcMs').value || 0), quickList: $('#fQuickList').value, sound: $('#fSound').checked };
}
function loadUiForm(u) {
  const d = (typeof draft !== 'undefined' && draft) || cfg; u = u || { ...UI_DEF, ...(d.ui || {}) };
  $('#fAccent').value = /^#[0-9a-f]{6}$/i.test(u.accent) ? u.accent : '#7c9cff'; $('#fAccent').dataset.on = u.accent ? '1' : '0';
  $('#fFs').value = u.fs; $('#fLh').value = u.lh; $('#fFont').value = u.font; $('#fChatFs').value = u.chatFs; $('#fRadius').value = u.radius;
  $('#fDensity').value = u.density; $('#fNums').checked = u.lineNums !== false; $('#fQuick').checked = u.quick !== false; $('#fTab').value = u.tab; $('#fCss').value = u.css || '';
  $('#fUiFont').value = u.uiFont; $('#fLig').checked = !!u.lig; $('#fEw').value = u.ew; $('#fSyntax').value = u.syntax; $('#fChatStyle').value = u.chatStyle; $('#fChatSide').value = u.chatSide; $('#fAnim').checked = u.anim !== false;
  $('#fStatusBar').checked = u.statusBar !== false; $('#fWrapCode').checked = !!u.wrapCode; $('#fAsMs').value = u.asMs; $('#fAcMs').value = u.acMs; $('#fQuickList').value = u.quickList || ''; $('#fSound').checked = !!u.sound;
  $('#fVoiceEngine').value = d.voiceEngine || 'whisper'; $('#fSttSize').value = d.sttSize || 'base'; $('#fVoiceAuto').checked = d.voiceAuto !== false;
  $('#swatches').innerHTML = SWATCHES.map(c => `<button type="button" class="sw" data-c="${c}" style="background:${c}" title="${c}"></button>`).join('');
  refreshSttState();
}
$('#uiBox').addEventListener('input', (e) => { if (e.target.id === 'fAccent') e.target.dataset.on = '1'; applyUi(readUiForm()); });
$('#swatches').addEventListener('click', (e) => { const b = e.target.closest('.sw'); if (!b) return; $('#fAccent').value = b.dataset.c; $('#fAccent').dataset.on = '1'; applyUi(readUiForm()); });
$('#fAccentReset').onclick = () => { $('#fAccent').dataset.on = '0'; applyUi(readUiForm()); };
$('#fTheme').addEventListener('change', () => { document.documentElement.dataset.theme = $('#fTheme').value; });
$('#fUiReset').onclick = () => { loadUiForm({ ...UI_DEF }); applyUi(readUiForm()); };
$('#fSttSize').addEventListener('change', () => { cfg.sttSize = $('#fSttSize').value; refreshSttState(); });
$('#vInstall').onclick = async () => { cfg.sttSize = $('#fSttSize').value; $('#vInstall').disabled = true; await installStt(); $('#vInstall').disabled = false; };
$('#vRemove').onclick = async () => { if (!confirm(tr('v_ask_remove'))) return; await api('/api/stt/remove', { method: 'POST' }); refreshSttState(); };


/* ================= Язык, git, быстрые действия, справка ================= */
function refreshLang() {
  applyI18n(); $('#langBtn').textContent = LANG.toUpperCase();
  buildQuick(); updateHeader(); updateStatus(); refreshGit();
}
$('#langBtn').onclick = () => { LANG = LANG === 'ru' ? 'en' : 'ru'; cfg.lang = LANG; saveCfg(); refreshLang(); };

let gitTimer = 0;
async function refreshGit() {
  const el = $('#stGit');
  try { const g = await api('/api/git'); if (!g.repo) { el.hidden = true; return; } el.hidden = false; el.textContent = '⎇ ' + g.branch + (g.changed ? ' ●' + g.changed : ''); el.title = tr('git_title'); }
  catch { el.hidden = true; }
}
function refreshGitSoon() { clearTimeout(gitTimer); gitTimer = setTimeout(refreshGit, 800); }
$('#stGit').onclick = refreshGit;

const QA = ['explain', 'fix', 'tests', 'refactor', 'docs'];
// Свои быстрые кнопки: в настройках строки вида «Название | что попросить». {file} заменяется на имя открытого файла.
const parseQuick = (t) => String(t || '').split('\n').map(l => l.split('|')).filter(p => p.length >= 2 && p[0].trim() && p.slice(1).join('|').trim()).map(p => ({ name: p[0].trim().slice(0, 24), prompt: p.slice(1).join('|').trim() }));
function buildQuick() {
  const box = $('#quick'); box.innerHTML = ''; buildQuick.last = (cfg && uiCfg().quickList) || '';
  const custom = parseQuick(buildQuick.last);
  if (custom.length) { for (const c of custom) { const b = document.createElement('button'); b.className = 'ghost'; b.textContent = c.name; b.title = c.prompt; b.onclick = () => customQuick(c.prompt); box.appendChild(b); } return; }
  for (const k of QA) { const b = document.createElement('button'); b.className = 'ghost'; b.textContent = tr('qa_' + k); b.onclick = () => quickAction(k); box.appendChild(b); }
}
function customQuick(prompt) {
  if (busy) return; const f = cur();
  $('#prompt').value = prompt.replace(/\{file\}/g, f ? f.path : L2('(файл не открыт)', '(no file open)'));
  send({ force: !!f, quick: true });
}
function quickAction(k) {
  const f = cur(); if (!f) return toast(tr('open_file')); if (busy) return;
  const sel = ed.value.slice(ed.selectionStart, ed.selectionEnd);
  $('#prompt').value = tr('qp_' + k) + (sel ? L2(' Работай с выделенным фрагментом.', ' Work on the selected snippet.') : L2(` Файл: ${f.path}.`, ` File: ${f.path}.`));
  send({ force: true, quick: true });
}

function keyList() { return [['Ctrl+S', 'h_save'], ['Ctrl+P', 'h_open'], ['Ctrl+Shift+F', 'h_search'], ['Ctrl+`', 'h_term'], ['Ctrl+,', 'h_settings'], ['Ctrl+K', 'h_edit'], ['Ctrl+L', 'h_chat'], ['Tab', 'h_accept'], ['Ctrl+/', 'h_comment'], ['Tab / Shift+Tab', 'h_indent'], [L2('@файл', '@file'), 'h_mention'], ['Alt+M', 'h_voice'], ['F5', 'h_run'], ['Shift+F5', 'h_debug'], ['F1', 'h_help']]; }
function openHelp() { $('#helpList').innerHTML = keyList().map(([k, d]) => `<div class="kb"><kbd>${esc(k)}</kbd><span>${esc(tr(d))}</span></div>`).join(''); $('#help').classList.add('open'); }
$('#helpBtn').onclick = openHelp;

async function restoreTabs(saved) {
  if (!saved || !Array.isArray(saved.paths)) return;
  for (const p of saved.paths.slice(0, 12)) { try { const { content } = await api('/api/file?path=' + encodeURIComponent(p)); tabs.push({ path: p, content, dirty: false }); } catch {} }
  if (tabs.length) activate(tabs.some(x => x.path === saved.active) ? saved.active : tabs[0].path);
}
// Если сохранённая модель Ollama не установлена — берём подходящую из установленных.
async function autoPickModel() {
  const e = cfg.offline;
  if (cfg.mode !== 'offline' || e.preset !== 'ollama' || !/:11434/.test(e.baseUrl)) return;
  let r; try { r = await api('/api/installed'); } catch { return; }
  if (!r.ollama) { addMsg('sys', esc(tr('ollama_down'))); return; }
  const have = r.installed;
  if (!have.length) { addMsg('sys', esc(tr('no_models'))); return; }
  if (have.includes(e.model) || have.includes(e.model + ':latest')) return;
  const pick = have.find(n => n.startsWith('localcode-')) || have.find(n => /coder/i.test(n)) || have[0];
  const old = e.model; e.model = pick; saveCfg(); updateHeader(); addMsg('sys', esc(tr('model_auto', old, pick)));
}

/* ================= Проект ================= */
async function openFolder() {
  let p = null; try { p = (await post('/api/pick-folder', {})).path; } catch {}
  if (!p) p = prompt(tr('folder_q')); if (!p) return;
  try { await post('/api/chdir', { path: p }); location.reload(); } catch (e) { toast(e.message); }
}
$('#projBtn').onclick = (e) => { e.stopPropagation(); const r = e.target.getBoundingClientRect(); showMenu({ clientX: r.left, clientY: r.bottom + 4 },
  [...(info.recent || []).filter(x => x !== info.root).slice(0, 6).map(p => [p, async () => { await post('/api/chdir', { path: p }); location.reload(); }]), '-', ['Открыть папку…', openFolder]]); };

/* ================= Панели и горячие клавиши ================= */
$$('.split').forEach(s => s.addEventListener('mousedown', (e) => {
  e.preventDefault(); s.classList.add('drag'); const v = s.dataset.v, dir = +s.dataset.dir;
  const mv = (ev) => { const w = dir > 0 ? ev.clientX : innerWidth - ev.clientX; document.documentElement.style.setProperty(v, Math.max(140, Math.min(w, innerWidth * 0.6)) + 'px'); };
  const up = () => { s.classList.remove('drag'); removeEventListener('mousemove', mv); removeEventListener('mouseup', up); localStorage['lc' + v] = getComputedStyle(document.documentElement).getPropertyValue(v); };
  addEventListener('mousemove', mv); addEventListener('mouseup', up);
}));
$('#splitT').addEventListener('mousedown', (e) => {
  e.preventDefault(); const s = e.target, b = $('#center').getBoundingClientRect(); s.classList.add('drag');
  const mv = (ev) => document.documentElement.style.setProperty('--th', Math.max(70, Math.min(b.bottom - ev.clientY, b.height * 0.7)) + 'px');
  const up = () => { s.classList.remove('drag'); removeEventListener('mousemove', mv); removeEventListener('mouseup', up); };
  addEventListener('mousemove', mv); addEventListener('mouseup', up);
});
['--sw', '--cw'].forEach(v => { if (localStorage['lc' + v]) document.documentElement.style.setProperty(v, localStorage['lc' + v]); });

addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (mod && k === 's') { e.preventDefault(); save(); }
  else if (mod && e.shiftKey && k === 'p') { e.preventDefault(); openQo('>'); }
  else if (mod && k === 'p') { e.preventDefault(); openQo(); }
  else if (mod && e.shiftKey && k === 'f') { e.preventDefault(); $('.stabs button[data-p=search]').click(); }
  else if (mod && k === '`') { e.preventDefault(); toggleTerm(); }
  else if (mod && k === ',') { e.preventDefault(); openSettings(); }
  else if (mod && k === 'k' && document.activeElement === ed) { e.preventDefault(); openInline(); }
  else if (mod && k === 'l') {
    e.preventDefault(); const t = cur(), sel = ed.value.slice(ed.selectionStart, ed.selectionEnd), pr = $('#prompt');
    if (t && sel) { const a = ed.value.slice(0, ed.selectionStart).split('\n').length; pr.value += `${pr.value ? '\n' : ''}${tr('snippet', t.path, a)}\n\`\`\`\n${sel}\n\`\`\`\n`; }
    pr.focus();
  }
  else if (e.altKey && e.code === 'KeyM') { e.preventDefault(); e.stopPropagation(); if (!e.repeat) toggleVoice(); }
  else if (e.key === 'F1') { e.preventDefault(); openHelp(); }
  else if (e.key === 'F5') { e.preventDefault(); runCurrent(e.shiftKey); }
  else if (e.key === 'Escape') { if (VS === 'rec') cancelVoice(); if ($('#modal').classList.contains('open')) applyTheme(); $('#modal').classList.remove('open'); $('#qo').classList.remove('open'); $('#help').classList.remove('open'); }
});
addEventListener('beforeunload', (e) => { if (tabs.some(t => t.dirty)) { e.preventDefault(); e.returnValue = ''; } });

/* ================= Старт ================= */
const ATT_RE = /\n\n(?:Прикреплённые файлы|Attached files):/;
(async function init() {
  try { info = await api('/api/info'); }
  catch { document.body.innerHTML = `<p style="padding:30px;font:14px system-ui">${tr('no_server')}</p>`; return; }
  initCfg(info.defaults || {}); applyTheme();
  if (cfg.lang && cfg.lang !== LANG) LANG = cfg.lang;
  let saved = null; try { saved = JSON.parse(localStorage['lc_tabs:' + info.root] || 'null'); } catch {}
  $('#projBtn').textContent = '📁 ' + info.name; $('#projBtn').title = info.root; $('#cwd').textContent = info.root;
  document.title = info.name + ' — LocalCode';
  try { rules = (await api('/api/rules')).rules; } catch {}
  try { chatHist = JSON.parse(localStorage['lc_chat:' + info.root] || '[]'); } catch { chatHist = []; }
  for (const m of chatHist) { if (m.role === 'user') { if (!isToolRes(m)) addMsg('user', esc(m.content.split(ATT_RE)[0])); } else if (m.role === 'assistant' && visible(m.content)) addMsg('ai', md(visible(m.content))); }
  refreshLang(); renderTabs(); renderTree();
  if (!chatHist.length) addMsg('sys', esc(tr(cfg.mode === 'offline' ? 'welcome_off' : 'welcome_on')));
  if (rules) addMsg('sys', esc(tr('rules_on')));
  await autoPickModel();
  await restoreTabs(saved); tabsReady = true; renderTabs();
  setInterval(() => { if (!document.hidden) refreshGit(); }, 20000);
})();
setInterval(() => { fetch('/api/ping', { headers: H() }).catch(() => {}); }, 10000);

$('#empty').addEventListener('click', (e) => {
  const b = e.target.closest('[data-qs]'); if (!b) return;
  ({ new: () => $('#newFile').click(), open: () => openFolder(), ask: () => $('#prompt').focus(), settings: () => openSettings() })[b.dataset.qs]();
});

/* ================= Дополнительно: экспорт чата, звук, статистика, резервная копия настроек ================= */
function downloadText(name, text, mime = 'text/plain') {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: mime + ';charset=utf-8' })); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
function exportChat() {
  const rows = chatHist.filter(m => (m.role === 'user' && !isToolRes(m)) || (m.role === 'assistant' && visible(m.content)));
  if (!rows.length) return toast(L2('Чат пуст', 'The chat is empty'));
  const md = rows.map(m => (m.role === 'user' ? '## ' + L2('Вы', 'You') : '## ' + L2('ИИ', 'AI')) + '\n\n' + (m.role === 'user' ? String(m.content).split(ATT_RE)[0] : visible(m.content))).join('\n\n');
  const d = new Date(), p2 = (n) => String(n).padStart(2, '0');
  downloadText(`chat-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}.md`, '# LocalCode\n\n' + md + '\n', 'text/markdown');
  toast(L2('Чат сохранён в файл (папка «Загрузки»)', 'Chat saved to a file (Downloads folder)'));
}
async function copyLast() {
  const m = [...chatHist].reverse().find(x => x.role === 'assistant' && visible(x.content));
  if (!m) return toast(L2('Ответов пока нет', 'No answers yet'));
  try { await navigator.clipboard.writeText(visible(m.content)); toast(L2('Скопировано', 'Copied')); } catch { toast(L2('Не удалось скопировать', 'Could not copy')); }
}
$('#exportChat').onclick = exportChat;
function beep() {
  try { const ac = new (window.AudioContext || window.webkitAudioContext)(), o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = 880; g.gain.value = 0.06; o.connect(g); g.connect(ac.destination); o.start(); o.stop(ac.currentTime + 0.14); setTimeout(() => ac.close(), 400); } catch {}
}
function showStat(sec, chars) {
  if (VS !== 'idle' || !chars) return; const tps = (chars / 3.5) / Math.max(0.1, sec), t = L2(`Ответ: ${sec.toFixed(1)} с · ≈${Math.round(tps)} ток/с`, `Answer: ${sec.toFixed(1)} s · ≈${Math.round(tps)} tok/s`);
  $('#stAI').textContent = t; clearTimeout(showStat.t); showStat.t = setTimeout(() => { if ($('#stAI').textContent === t) $('#stAI').textContent = ''; }, 12000);
}
$('#fExport').onclick = () => {
  const copy = JSON.parse(JSON.stringify(cfg)); delete copy.keyMemo;
  if (!confirm(L2('Добавить API-ключи в файл настроек?\n«Отмена» — сохранить без ключей (безопаснее). Файл с ключами нельзя никому показывать.', 'Include API keys in the settings file?\n“Cancel” saves without keys (safer). Never share a file that contains keys.'))) for (const m of ['offline', 'online']) { delete copy[m].apiKey; delete copy[m].apiKeys; }
  downloadText('localcode-settings.json', JSON.stringify({ localcode: 1, cfg: copy }, null, 2), 'application/json');
};
$('#fImport').onclick = () => $('#fImportFile').click();
$('#fImportFile').onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const j = JSON.parse(await f.text()), c = j.cfg || j;
    if (!c || typeof c !== 'object' || !c.offline || !c.online) throw new Error(L2('Это не файл настроек LocalCode', 'This is not a LocalCode settings file'));
    for (const m of ['offline', 'online']) { if (!(c[m].apiKeys && c[m].apiKeys.length) && !c[m].apiKey) { c[m].apiKeys = cfg[m].apiKeys || []; c[m].apiKey = cfg[m].apiKey || ''; } }
    cfg = { ...cfg, ...c }; saveCfg(); toast(L2('Настройки загружены, перезапускаю окно…', 'Settings loaded, reloading…')); setTimeout(() => location.reload(), 700);
  } catch (er) { toast(er.message, 6000); }
};
$('#fResetAll').onclick = () => { if (confirm(L2('Сбросить ВСЕ настройки (включая ключи API)? Проекты и файлы не пострадают.', 'Reset ALL settings (including API keys)? Projects and files are not affected.'))) { localStorage.removeItem('lc_cfg2'); location.reload(); } };
