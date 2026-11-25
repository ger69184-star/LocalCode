// Русский / English. D[ключ] = [русский, английский]. Подстановки: {0}, {1}…
let LANG = (() => {
  try { const c = JSON.parse(localStorage.lc_cfg2 || 'null'); if (c && c.lang) return c.lang; } catch {}
  return /^ru/i.test(navigator.language || '') ? 'ru' : 'en';
})();
const D = {
  // шапка и общие
  m_offline: ['Офлайн', 'Offline'], m_online: ['Онлайн', 'Online'], m_title: ['Откуда берётся ИИ', 'Where the AI runs'],
  b_file: ['Файл…', 'File…'], b_term: ['Терминал', 'Terminal'], b_theme: ['Тема', 'Theme'], b_settings: ['Настройки', 'Settings'], b_lang: ['Язык', 'Language'],
  s_files: ['Файлы', 'Files'], s_search: ['Поиск', 'Search'], b_newfile: ['＋ файл', '＋ file'], b_newdir: ['＋ папка', '＋ folder'], b_refresh: ['Обновить', 'Refresh'],
  s_ph: ['Найти в проекте и Enter', 'Search project, press Enter'],
  e_html: ['<h2>LocalCode</h2>Откройте файл слева или <b>Ctrl+P</b>.<br><b>Ctrl+K</b> — изменить выделенный код через ИИ<br><b>Tab</b> — принять подсказку<br><b>Ctrl+L</b> — выделение в чат<br><b>@файл</b> в чате — прикрепить файл<br><b>Ctrl+Shift+F</b> — поиск по проекту',
    '<h2>LocalCode</h2>Open a file on the left or press <b>Ctrl+P</b>.<br><b>Ctrl+K</b> — edit selected code with AI<br><b>Tab</b> — accept suggestion<br><b>Ctrl+L</b> — send selection to chat<br><b>@file</b> in chat — attach a file<br><b>Ctrl+Shift+F</b> — search project'],
  i_ph: ['Что сделать с кодом? Enter — выполнить, Esc — закрыть', 'What to do with the code? Enter — run, Esc — close'],
  i_ok: ['Принять', 'Accept'], i_no: ['Отклонить', 'Reject'],
  i_insert: ['Код будет вставлен в позицию курсора', 'Code will be inserted at the cursor'], i_sel: ['Изменится выделенное: {0} стр.', 'Selection to change: {0} line(s)'], i_wait: ['ИИ пишет…', 'AI is writing…'],
  t_title: ['Терминал', 'Terminal'], t_clear: ['Очистить', 'Clear'], t_ph: ['команда и Enter', 'command, press Enter'],
  c_title: ['ИИ', 'AI'], c_agent: ['Агент', 'Agent'], c_ask: ['Вопрос', 'Ask'], c_new: ['Новый чат', 'New chat'],
  c_ph: ['Спросите или поручите задачу. @файл — прикрепить, Enter — отправить, Shift+Enter — перенос.', 'Ask or give a task. @file to attach, Enter to send, Shift+Enter for a new line.'],
  c_ctx: ['открытый файл', 'open file'], c_auto: ['без подтверждений', 'no confirmations'], c_stop: ['Стоп', 'Stop'], c_send: ['Отправить', 'Send'],
  q_ph: ['Имя файла…', 'File name…'], c_think: ['думаю…', 'thinking…'],
  // статус
  st_pos: ['Стр {0}, стлб {1}', 'Ln {0}, Col {1}'], st_ac: ['Автодополнение: {0}', 'Autocomplete: {0}'], on: ['вкл', 'on'], off: ['выкл', 'off'],
  st_notools: [' (без инструментов)', ' (no tools)'], st_aithink: ['ИИ думает…', 'AI thinking…'], st_mode_agent: ['агент', 'agent'], st_mode_ask: ['вопрос', 'ask'],
  st_hint_notools: ['Без инструментов: ИИ предлагает код, кнопка «Записать» применяет его к файлу.', 'No tools: the AI proposes code, the “Write” button applies it to the file.'],
  // сообщения
  saved: ['Сохранено', 'Saved'], open_file: ['Откройте файл', 'Open a file first'], cant_open: ['Не открыть {0}: {1}', 'Cannot open {0}: {1}'],
  unsaved: ['Есть несохранённые изменения. Закрыть?', 'You have unsaved changes. Close?'],
  new_file_q: ['Имя нового файла:', 'New file name:'], new_dir_q: ['Имя новой папки:', 'New folder name:'], rename_q: ['Новое имя:', 'New name:'],
  del_q: ['Удалить «{0}»? Это нельзя отменить.', 'Delete “{0}”? This cannot be undone.'],
  m_newfile: ['Новый файл…', 'New file…'], m_newdir: ['Новая папка…', 'New folder…'], m_rename: ['Переименовать…', 'Rename…'], m_delete: ['Удалить', 'Delete'], m_openfolder: ['Открыть папку…', 'Open folder…'],
  searching: ['Поиск…', 'Searching…'], folder_q: ['Путь к папке проекта:', 'Project folder path:'],
  no_server: ['Нет доступа к серверу. Откройте ссылку с токеном из консоли, где запущен <code>node server.js</code>.', 'No access to the server. Open the link with the token from the console where <code>node server.js</code> is running.'],
  err_resp: ['Ошибка ответа сервера', 'Bad server response'], err_empty: ['Пустой ответ от модели', 'Empty response from the model'],
  welcome_off: ['Режим «Офлайн»: ИИ работает на этом компьютере через Ollama. Облачный ИИ — переключите «Онлайн» вверху и вставьте API-ключ.', 'Offline mode: the AI runs on this computer via Ollama. For a cloud AI switch to “Online” at the top and paste an API key.'],
  welcome_on: ['Режим «Онлайн»: запросы идут к сервису, выбранному в настройках.', 'Online mode: requests go to the service chosen in Settings.'],
  rules_on: ['Подключены правила проекта (AGENTS.md / .cursorrules).', 'Project rules loaded (AGENTS.md / .cursorrules).'],
  need_key: ['Укажите API-ключ для онлайн-режима', 'Enter an API key for online mode'],
  stopped: ['Остановлено.', 'Stopped.'], cancelled: ['Отменено пользователем.', 'Cancelled by the user.'], declined: ['Пользователь отклонил действие.', 'The user declined the action.'],
  err_prefix: ['Ошибка: {0}', 'Error: {0}'], err_hint: ['Проверьте URL, ключ и модель в «Настройках».', 'Check the URL, key and model in Settings.'],
  err_tools: ['Похоже, модель не поддерживает вызов функций. В «Настройках» отключите «Модель умеет вызывать функции» — тогда ИИ будет давать код с кнопкой «Записать».', 'The model probably does not support function calling. Turn off “Model supports function calling” in Settings — the AI will then give code with a “Write” button.'],
  ask_allow: ['Разрешить: {0}?', 'Allow: {0}?'], allow: ['Разрешить', 'Allow'], deny: ['Отклонить', 'Deny'], denied: ['Отклонено', 'Denied'],
  revert: ['Откатить', 'Revert'], reverted: ['Откачено', 'Reverted'], new_file_tag: ['новый файл', 'new file'],
  copy: ['Копировать', 'Copy'], copied: ['Скопировано', 'Copied'], to_editor: ['В редактор', 'To editor'], write: ['Записать', 'Write'], code: ['код', 'code'],
  inserted: ['Вставлено в редактор', 'Inserted into the editor'], written: ['Записано: {0}', 'Written: {0}'], no_changes: ['(без изменений)', '(no changes)'],
  attached: ['Прикреплённые файлы:', 'Attached files:'], snippet: ['Фрагмент из {0} (с {1} стр.):', 'Snippet from {0} (from line {1}):'],
  ollama_down: ['Ollama не запущена. Запустите её (ярлык LocalCode сам это делает) или переключитесь на «Онлайн».', 'Ollama is not running. Start it (the LocalCode shortcut does it for you) or switch to Online.'],
  model_auto: ['Модель «{0}» не найдена в Ollama — выбрана «{1}».', 'Model “{0}” was not found in Ollama — using “{1}”.'],
  no_models: ['В Ollama нет моделей. Откройте Настройки → Офлайн и установите модель из каталога.', 'Ollama has no models. Open Settings → Offline and install a model from the catalog.'],
  // настройки
  set_title: ['Настройки', 'Settings'], set_off: ['Офлайн (на этом ПК)', 'Offline (on this PC)'], set_on: ['Онлайн (облако, API-ключ)', 'Online (cloud, API key)'],
  set_off_leg: ['Офлайн: модель работает на вашем компьютере, интернет не нужен', 'Offline: the model runs on your computer, no internet needed'],
  set_on_leg: ['Онлайн: облачная модель, нужен API-ключ', 'Online: a cloud model, API key required'],
  f_provider: ['Провайдер', 'Provider'], f_kind: ['Тип API', 'API type'], f_kind_oa: ['OpenAI-совместимый', 'OpenAI-compatible'], f_kind_an: ['Anthropic (Claude)', 'Anthropic (Claude)'],
  f_model: ['Модель', 'Model'], f_list: ['Список', 'List'], f_key: ['API-ключ (хранится только в этом браузере)', 'API key (stored only in this browser)'],
  f_auth: ['Префикс авторизации (обычно Bearer)', 'Auth prefix (usually Bearer)'], f_tools: ['Модель умеет вызывать функции (агент правит файлы сам)', 'Model supports function calling (the agent edits files itself)'],
  f_test: ['Проверить подключение', 'Test connection'], testing: ['Проверяю…', 'Testing…'], test_ok: ['✓ Работает: {0}', '✓ Works: {0}'], loading_list: ['Загружаю список…', 'Loading list…'],
  list_ok: ['Моделей: {0}. Выберите в поле «Модель».', 'Models: {0}. Pick one in the Model field.'],
  g_general: ['Общие', 'General'], f_profile: ['Производительность ПК', 'PC performance'], p_light: ['Слабый ПК (мало контекста, быстро)', 'Weak PC (small context, fast)'], p_normal: ['Обычный', 'Normal'], p_strong: ['Мощный (много контекста)', 'Powerful (large context)'],
  f_ac: ['Автодополнение кода по Tab (нагружает слабый ПК)', 'Code autocomplete with Tab (loads a weak PC)'], f_theme: ['Тема', 'Theme'], th_dark: ['Тёмная', 'Dark'], th_light: ['Светлая', 'Light'], f_lang: ['Язык интерфейса', 'Interface language'],
  cancel: ['Отмена', 'Cancel'], save: ['Сохранить', 'Save'],
  // каталог
  cat_title: ['Офлайн-модели (запускаются на вашем ПК)', 'Offline models (run on your PC)'],
  cat_hw: ['Ваш ПК: {0} · {1} потоков · ОЗУ {2} ГБ · {3}', 'Your PC: {0} · {1} threads · RAM {2} GB · {3}'], cat_nogpu: ['видеокарта не определена', 'no GPU detected'],
  cat_gpu_note: ['Видеокарты AMD/Intel Ollama использует не на всех моделях; расчёт идёт по процессору и ОЗУ.', 'Ollama does not use every AMD/Intel GPU; estimates assume CPU and RAM.'],
  cat_req: ['Мин. ОЗУ (на CPU): {0} ГБ · видеопамять (GPU): {1} ГБ · загрузка ≈{2} ГБ', 'Min RAM (CPU): {0} GB · VRAM (GPU): {1} GB · download ≈{2} GB'],
  cat_for: ['Для:', 'For:'], fit_gpu: ['Быстро на вашей видеокарте', 'Fast on your GPU'], fit_ok: ['Подходит вашему ПК', 'Fits your PC'], fit_slow: ['Запустится, но медленно', 'Runs, but slowly'], fit_no: ['Не хватает памяти', 'Not enough memory'],
  rec: ['Рекомендуем', 'Recommended'], tools_yes: ['агент с инструментами', 'agent with tools'], tools_no: ['чат + кнопка «Записать»', 'chat + “Write” button'],
  install: ['Установить', 'Install'], use: ['Использовать', 'Use'], installed: ['установлена', 'installed'], using: ['выбрано', 'selected'],
  pulling: ['Загрузка: {0}%', 'Downloading: {0}%'], tuning: ['Настройка под ваш ПК…', 'Tuning for your PC…'], pull_done: ['Готово. Нажмите «Использовать».', 'Done. Click “Use”.'],
  cat_nollama: ['Ollama не найдена или не запущена. Установите её (install.bat / install.sh) и запустите.', 'Ollama is not found or not running. Install it (install.bat / install.sh) and start it.'],
  cat_slow_confirm: ['Эта модель, скорее всего, будет работать медленно на вашем ПК. Всё равно установить?', 'This model will likely be slow on your PC. Install anyway?'],
  cat_no_confirm: ['Памяти не хватает — модель может не запуститься. Всё равно установить?', 'Not enough memory — the model may fail to start. Install anyway?'],
  // пресеты
  pr_ollama: ['Ollama (на этом ПК)', 'Ollama (on this PC)'], pr_lmstudio: ['LM Studio (на этом ПК)', 'LM Studio (on this PC)'], pr_localcustom: ['Другой локальный сервер', 'Other local server'],
  pr_anthropic: ['Anthropic (Claude)', 'Anthropic (Claude)'], pr_deepseek: ['DeepSeek', 'DeepSeek'], pr_openai: ['OpenAI', 'OpenAI'], pr_openrouter: ['OpenRouter (много моделей)', 'OpenRouter (many models)'],
  pr_qwen: ['Alibaba Qwen (DashScope)', 'Alibaba Qwen (DashScope)'], pr_moonshot: ['Moonshot (Kimi)', 'Moonshot (Kimi)'], pr_yandex: ['Yandex AI Studio', 'Yandex AI Studio'], pr_custom: ['Другой сервис (свой URL)', 'Other service (custom URL)'],
  n_ollama: ['Полностью офлайн. Модели ставятся из каталога ниже. Ключ не нужен.', 'Fully offline. Install models from the catalog below. No key needed.'],
  n_lmstudio: ['Запустите локальный сервер в LM Studio; имя модели — из его интерфейса.', 'Start the local server in LM Studio; take the model name from its UI.'],
  n_localcustom: ['llama.cpp server, vLLM и любой OpenAI-совместимый сервер.', 'llama.cpp server, vLLM or any OpenAI-compatible server.'],
  n_anthropic: ['Ключ из console.anthropic.com. Поддерживает агента (инструменты).', 'Key from console.anthropic.com. Supports the agent (tools).'],
  n_deepseek: ['Дёшево и хорошо пишет код. Ключ: platform.deepseek.com.', 'Cheap and good at code. Key: platform.deepseek.com.'],
  n_openai: ['Ключ: platform.openai.com.', 'Key: platform.openai.com.'], n_openrouter: ['Один ключ — сотни моделей.', 'One key — hundreds of models.'], n_none: ['', ''],
  n_yandex: ['В модели подставьте свой folder_id. Ключ — API-ключ сервисного аккаунта.', 'Put your folder_id into the model name. The key is a service-account API key.'],
  n_custom: ['Любой OpenAI-совместимый или Anthropic-совместимый API.', 'Any OpenAI-compatible or Anthropic-compatible API.'],
};
// --- v0.2 ---
Object.assign(D, {
  proj: ['Проект', 'Project'], b_help: ['Горячие клавиши (F1)', 'Keyboard shortcuts (F1)'], b_langtip: ['Сменить язык интерфейса', 'Switch interface language'],
  e_html: ['<h2>LocalCode</h2>Откройте файл слева или <b>Ctrl+P</b>.<br><b>Ctrl+K</b> — изменить выделенный код через ИИ<br><b>Tab</b> — принять подсказку<br><b>Ctrl+L</b> — выделение в чат<br><b>@файл</b> в чате — прикрепить файл<br><b>Ctrl+Shift+F</b> — поиск по проекту<br><b>F1</b> — все горячие клавиши',
    '<h2>LocalCode</h2>Open a file on the left or press <b>Ctrl+P</b>.<br><b>Ctrl+K</b> — edit selected code with AI<br><b>Tab</b> — accept suggestion<br><b>Ctrl+L</b> — send selection to chat<br><b>@file</b> in chat — attach a file<br><b>Ctrl+Shift+F</b> — search project<br><b>F1</b> — all keyboard shortcuts'],
  connecting: ['Подключаюсь…', 'Connecting…'], detecting: ['Определяю железо…', 'Detecting hardware…'],
  mirror: ['Реестр недоступен — пробую зеркало Hugging Face…', 'Registry unavailable — trying the Hugging Face mirror…'],
  pull_aborted: ['Загрузка прервана', 'Download interrupted'],
  f_autosave: ['Автосохранение файлов (через секунду после ввода)', 'Autosave files (one second after typing)'],
  st_autosave: ['Автосохр.: {0}', 'Autosave: {0}'], st_autosave_tip: ['Автосохранение файлов. Клик — переключить', 'File autosave. Click to toggle'],
  st_ac_tip: ['Автодополнение по Tab. Клик — переключить', 'Tab autocomplete. Click to toggle'],
  git_title: ['Ветка git и число изменённых файлов. Клик — обновить', 'Git branch and number of changed files. Click to refresh'],
  qa_explain: ['Объяснить', 'Explain'], qa_fix: ['Найти баги', 'Find bugs'], qa_tests: ['Тесты', 'Tests'], qa_refactor: ['Рефакторинг', 'Refactor'], qa_docs: ['Комментарии', 'Comment'],
  qp_explain: ['Объясни, как работает этот код.', 'Explain how this code works.'],
  qp_fix: ['Найди баги и потенциальные проблемы в этом коде и предложи исправления.', 'Find bugs and potential problems in this code and suggest fixes.'],
  qp_tests: ['Напиши тесты для этого кода.', 'Write tests for this code.'],
  qp_refactor: ['Улучши читаемость этого кода, не меняя его поведение.', 'Refactor this code for readability without changing its behavior.'],
  qp_docs: ['Добавь короткие понятные комментарии и документацию к этому коду.', 'Add short, clear comments and documentation to this code.'],
  h_title: ['Горячие клавиши', 'Keyboard shortcuts'], h_close: ['Закрыть', 'Close'],
  h_save: ['Сохранить файл', 'Save file'], h_open: ['Открыть файл по имени', 'Open file by name'], h_search: ['Поиск по проекту', 'Search project'],
  h_term: ['Терминал', 'Terminal'], h_settings: ['Настройки', 'Settings'], h_edit: ['Изменить выделенное через ИИ', 'Edit selection with AI'],
  h_chat: ['Выделение в чат', 'Send selection to chat'], h_accept: ['Принять автодополнение', 'Accept autocomplete'],
  h_comment: ['Закомментировать строки', 'Toggle line comment'], h_indent: ['Отступ / убрать отступ', 'Indent / outdent'],
  h_mention: ['Прикрепить файл в чате', 'Attach a file in chat'], h_help: ['Эта справка', 'This help'],
  model_picked: ['Модель «{0}» не найдена в Ollama — выбрана «{1}».', 'Model “{0}” was not found in Ollama — using “{1}”.'],
});

// --- v0.3 ---
Object.assign(D, {
  v_mic: ['Голосовой ввод (Alt+M). Команды: «стоп», «новый чат», «отправь», «очисти»', 'Voice input (Alt+M). Commands: “stop”, “new chat”, “send”, “clear”'],
  v_unsupported: ['Этот браузер не поддерживает распознавание речи. Откройте LocalCode в Chrome или Edge.', 'This browser does not support speech recognition. Open LocalCode in Chrome or Edge.'],
  v_denied: ['Нет доступа к микрофону. Разрешите его для этого сайта в настройках браузера.', 'Microphone access denied. Allow it for this site in the browser settings.'],
  v_network: ['Распознавание речи в браузере работает через интернет (серверы Google/Microsoft). Проверьте подключение.', 'Browser speech recognition needs the internet (Google/Microsoft servers). Check your connection.'],
  v_err: ['Ошибка распознавания речи: {0}', 'Speech recognition error: {0}'],
  v_listening: ['Слушаю…', 'Listening…'],
  v_code_skipped: ['Код пропущен.', 'Code skipped.'],
  f_sysprompt: ['Постоянный промпт (добавляется к каждому запросу в чате)', 'Persistent prompt (added to every chat request)'],
  f_sysprompt_ph: ['Например: «Отвечай по-русски. Перед удалением или переносом файлов показывай список. Музыку включай на YouTube.»', 'For example: “Always answer briefly. List files before moving or deleting them. Play music on YouTube.”'],
  f_vsend: ['Голос: отправлять сразу после распознавания', 'Voice: send right after recognition'],
  f_vspeak: ['Голос: озвучивать ответы ИИ', 'Voice: read AI replies aloud'],
  v_note: ['Голосовой ввод использует распознавание речи браузера (Chrome/Edge) — ему нужен интернет, даже если модель офлайн. Подтверждения действий голосом не принимаются: их нужно нажимать.', 'Voice input uses the browser speech recognition (Chrome/Edge) — it needs the internet even if the model is offline. Action confirmations are never accepted by voice: you must click them.'],
  h_voice: ['Голосовой ввод вкл/выкл', 'Voice input on/off'],
});

const tt = (a) => (Array.isArray(a) ? a[LANG === 'ru' ? 0 : 1] : a);
const t = (k, ...a) => { const v = D[k]; let s = v ? tt(v) : k; a.forEach((x, i) => { s = s.split('{' + i + '}').join(x); }); return s; };
function applyI18n() {
  document.documentElement.lang = LANG;
  document.querySelectorAll('[data-i18n]').forEach(e => { e.textContent = t(e.dataset.i18n); });
  document.querySelectorAll('[data-i18n-html]').forEach(e => { e.innerHTML = t(e.dataset.i18nHtml); });
  document.querySelectorAll('[data-i18n-ph]').forEach(e => { e.placeholder = t(e.dataset.i18nPh); });
  document.querySelectorAll('[data-i18n-title]').forEach(e => { e.title = t(e.dataset.i18nTitle); });
}

// --- v0.4 ---
Object.assign(D, {
  st_textagent: [' (текстовые инструменты)', ' (text tools)'],
  st_hint_textagent: ['Модель без вызова функций: действия на компьютере она выполняет через текстовые команды. Простые команды («открой папку X на рабочем столе») работают без модели.', 'Model without function calling: it acts through text commands. Simple commands (“open folder X on the desktop”) work without the model.'],
  err_nomodel: ['Модель не найдена в Ollama. Откройте Настройки → Офлайн и установите модель или выберите установленную.', 'Model not found in Ollama. Open Settings → Offline and install a model or pick an installed one.'],
  g_look: ['Оформление', 'Appearance'], f_accent: ['Акцентный цвет', 'Accent color'], f_accent_reset: ['Сбросить', 'Reset'],
  f_fs: ['Размер шрифта в редакторе', 'Editor font size'], f_lh: ['Межстрочный интервал', 'Line spacing'], f_cfs: ['Размер шрифта в чате', 'Chat font size'],
  f_radius: ['Скругление углов', 'Corner radius'], f_font: ['Шрифт редактора', 'Editor font'], f_font_def: ['По умолчанию', 'Default'],
  f_density: ['Плотность интерфейса', 'Interface density'], d_compact: ['Компактная', 'Compact'], d_normal: ['Обычная', 'Normal'], d_comfy: ['Свободная', 'Comfortable'],
  f_tab: ['Размер отступа (Tab)', 'Indent size (Tab)'], f_nums: ['Показывать номера строк', 'Show line numbers'], f_quick: ['Быстрые кнопки над полем ввода в чате', 'Quick buttons above the chat input'],
  f_css: ['Свой CSS (для продвинутых)', 'Custom CSS (advanced)'], f_uireset: ['Сбросить оформление', 'Reset appearance'],
  th_midnight: ['Полночь', 'Midnight'], th_dracula: ['Фиолетовая', 'Purple'], th_forest: ['Лесная', 'Forest'], th_sunset: ['Закат', 'Sunset'], th_contrast: ['Высокий контраст', 'High contrast'],
  g_voice: ['Голос', 'Voice'], f_vengine: ['Распознавание речи', 'Speech recognition'], ve_whisper: ['Офлайн (Whisper, без интернета)', 'Offline (Whisper, no internet)'], ve_browser: ['Через браузер (нужен интернет)', 'Browser (needs internet)'],
  f_vsize: ['Точность офлайн-распознавания', 'Offline accuracy'], vs_tiny: ['Быстро (tiny, ~31 МБ)', 'Fast (tiny, ~31 MB)'], vs_base: ['Баланс (base, ~57 МБ)', 'Balanced (base, ~57 MB)'], vs_small: ['Точнее, медленнее (small, ~181 МБ)', 'More accurate, slower (small, ~181 MB)'],
  f_vauto: ['Останавливать запись после паузы в речи', 'Stop recording after a pause in speech'], v_install: ['Скачать', 'Download'], v_remove: ['Удалить', 'Remove'],
  v_ready: ['Готово: распознавание работает без интернета.', 'Ready: recognition works without internet.'], v_notready: ['Не установлено. Нужно один раз скачать около {0} МБ.', 'Not installed. A one-time download of about {0} MB is needed.'],
  v_recognizing: ['Распознаю…', 'Recognizing…'], v_nospeech: ['Речь не распознана', 'No speech detected'], v_installed: ['Офлайн-распознавание речи установлено', 'Offline speech recognition installed'],
  v_ask_install: ['Для офлайн-распознавания речи нужно один раз скачать около {0} МБ. Потом интернет не понадобится. Скачать сейчас?', 'Offline speech recognition needs a one-time download of about {0} MB. No internet is needed afterwards. Download now?'],
  v_ask_remove: ['Удалить загруженное распознавание речи?', 'Delete the downloaded speech recognition?'],
  v_noinstall: ['Автоустановка офлайн-распознавания есть только для Windows. Выберите «Через браузер» в настройках голоса.', 'Auto-install of offline recognition is Windows-only. Choose “Browser” in the voice settings.'],
  v_note: ['Alt+M — начать и закончить запись, Esc — отмена. Подтверждения действий голосом не принимаются: их нужно нажимать.', 'Alt+M starts and stops recording, Esc cancels. Action confirmations by voice are not accepted: click them.'],
});

Object.assign(D, {
  b_run: ['▶ Запуск', '▶ Run'], b_debug: ['🐞 Отладка', '🐞 Debug'], h_run: ['Запустить файл (F5)', 'Run the file (F5)'], h_debug: ['Отладка файла (Shift+F5): пошаговый отладчик в терминале', 'Debug the file (Shift+F5): step debugger in the terminal'],
  t_stop: ['■ Стоп', '■ Stop'], t_fix: ['Исправить с ИИ', 'Fix with AI'], to_newfile: ['В новый файл', 'New file'],
});

Object.assign(D, {
  e_html: ['<h2>LocalCode</h2>Быстрый старт:<br>1. <b>＋ файл</b> слева или <b>Ctrl+P</b> — создать или открыть файл<br>2. Спросите ИИ в чате справа, например «создай калькулятор на питоне»<br>3. <b>F5</b> — запустить, <b>F1</b> — все горячие клавиши<br><span class="qs"><button data-qs="new">＋ Новый файл</button><button data-qs="open">📁 Открыть папку</button><button data-qs="ask">💬 Спросить ИИ</button><button data-qs="settings">⚙ Настройки</button></span>', '<h2>LocalCode</h2>Quick start:<br>1. <b>＋ file</b> on the left or <b>Ctrl+P</b> — create or open a file<br>2. Ask the AI in the chat on the right, e.g. “create a calculator in Python”<br>3. <b>F5</b> — run, <b>F1</b> — all hotkeys<br><span class="qs"><button data-qs="new">＋ New file</button><button data-qs="open">📁 Open folder</button><button data-qs="ask">💬 Ask the AI</button><button data-qs="settings">⚙ Settings</button></span>'],
  ollama_down: ['Ollama не запущена. Запустите программу через ярлык (она включает Ollama сама), установите Ollama через install.bat или переключитесь на «Онлайн» вверху.', 'Ollama is not running. Start the app from the shortcut (it starts Ollama itself), install Ollama via install.bat, or switch to “Online” at the top.'],
  pull_busy: ['Уже идёт загрузка другой модели. Дождитесь её окончания или нажмите «Отмена».', 'Another model is already downloading. Wait for it or press Cancel.'],
  pull_cancelled: ['Загрузка отменена', 'Download cancelled'],
  cat_search: ['Поиск модели: название, тег, описание…', 'Search models: name, tag, description…'], cat_none: ['Ничего не найдено. Сбросьте поиск или фильтр.', 'Nothing found. Clear the search or filter.'],
  tag_all: ['Все', 'All'], tag_coder: ['код', 'code'], tag_general: ['общая', 'general'], tag_agent: ['агент', 'agent'], 'tag_weak-pc': ['слабый ПК', 'weak PC'], tag_fast: ['быстрая', 'fast'], tag_balanced: ['баланс', 'balanced'], tag_strong: ['мощный ПК', 'strong PC'],
  s_regex: ['Регулярное выражение', 'Regular expression'], f_web: ['Разрешить ИИ искать в интернете и читать страницы (запросы уходят в DuckDuckGo)', 'Let the AI search the web and read pages (queries go to DuckDuckGo)'],
});

Object.assign(D, {
  f_key: ['API-ключи: один или несколько, каждый с новой строки. Когда у ключа кончится лимит, программа сама переключится на следующий. Ключи хранятся только на этом компьютере.', 'API keys: one or several, each on a new line. When a key hits its limit, the app switches to the next one by itself. Keys are stored on this computer only.'],
  f_keys_ph: ['Вставьте ключ. Несколько ключей — каждый с новой строки.', 'Paste a key. Several keys — one per line.'], f_keys_show: ['Показать ключи', 'Show keys'], f_keys_test: ['Проверить все ключи', 'Test all keys'], f_keys_reset: ['Сбросить паузы', 'Clear pauses'],
  keys_none: ['Сначала вставьте хотя бы один ключ.', 'Paste at least one key first.'], key_ok: ['работает', 'works'], key_unk: ['проверить нельзя (провайдер не отдаёт список моделей)', 'cannot be checked (the provider does not list models)'], key_uses: ['использований:', 'uses:'], key_pause: ['пауза {0} с', 'paused {0} s'], keys_reset_done: ['Паузы ключей сброшены', 'Key pauses cleared'],
});

Object.assign(D, {
  q_ph: ['Имя файла… (или > для команд)', 'File name… (or > for commands)'], c_export: ['Сохранить чат в файл', 'Save the chat to a file'],
  f_uifont: ['Шрифт интерфейса', 'Interface font'], f_ew: ['Толщина шрифта в редакторе', 'Editor font weight'], f_syntax: ['Цвета подсветки кода', 'Code highlight colors'], sx_default: ['Обычные', 'Default'], sx_pastel: ['Пастельные', 'Pastel'], sx_mono: ['Без цветов', 'No colors'],
  f_chatstyle: ['Вид сообщений в чате', 'Chat message style'], cs_bubbles: ['Пузырьки', 'Bubbles'], cs_flat: ['Плоский текст', 'Flat text'], f_chatside: ['Где чат', 'Chat position'], side_right: ['Справа', 'Right'], side_left: ['Слева', 'Left'],
  f_asms: ['Автосохранение через (мс)', 'Autosave after (ms)'], f_acms: ['Задержка автодополнения (мс, 0 = по профилю)', 'Autocomplete delay (ms, 0 = by profile)'],
  f_lig: ['Лигатуры в редакторе (например => как стрелка)', 'Ligatures in the editor (e.g. => as an arrow)'], f_anim: ['Анимации интерфейса', 'Interface animations'], f_statusbar: ['Показывать нижнюю строку состояния', 'Show the bottom status bar'],
  f_wrapcode: ['Переносить длинные строки кода в чате', 'Wrap long code lines in the chat'], f_sound: ['Звук, когда долгий ответ готов', 'Sound when a long answer is ready'],
  f_quicklist: ['Свои быстрые кнопки чата: по одной в строке, «Название | что попросить». Пусто — стандартные. {file} — имя открытого файла', 'Your own quick chat buttons: one per line, “Name | what to ask”. Empty — default ones. {file} — name of the open file'],
  f_export: ['Сохранить настройки в файл', 'Save settings to a file'], f_import: ['Загрузить из файла', 'Load from a file'], f_resetall: ['Сбросить всё', 'Reset everything'],
});

Object.assign(D, {
  about_title: ['О программе', 'About'],
  about_ver: ['Версия: {0}', 'Version: {0}'],
  about_free: ['Программа бесплатная: ни ключей, ни подписки, ни пробного периода — все функции доступны сразу.', 'The app is free: no keys, no subscription, no trial limits — every feature is available right away.'],
  about_crack: ['Здесь видно, совпадают ли файлы программы с официальной подписанной сборкой. «Кряки» и чужие сборки часто содержат вирусы: скачивайте LocalCode только с официального источника.', 'This shows whether the program files match the official signed build. “Cracks” and third-party builds often carry malware: download LocalCode only from the official source.'],
  build_official: ['✔ Официальная сборка, версия {0}. Файлы совпадают с подписью.', '✔ Official build, version {0}. Files match the signature.'],
  build_unsigned: ['Сборка без подписи (из исходников). Это нормально для разработки.', 'Unsigned build (from source). This is normal for development.'],
  build_modified: ['⚠ Файлы программы изменены: {0}. Если это не вы — скачайте программу заново с официального источника.', '⚠ Program files were changed: {0}. If that was not you, download the app again from the official source.'],
  build_tampered: ['⚠ Подпись сборки не сходится: файлы или манифест подделаны. Скачайте программу заново с официального источника.', '⚠ The build signature does not match: files or manifest were forged. Download the app again from the official source.'],
  build_boot_bad: ['⚠ Внимание: файлы программы изменены ({0}). «Кряки» и чужие сборки часто содержат вирусы — если вы не меняли код, скачайте LocalCode заново с официального источника.', '⚠ Warning: program files were changed ({0}). “Cracks” and third-party builds often contain malware — if you did not edit the code, download LocalCode again from the official source.'],
  warn_code: ['В коде есть опасные конструкции', 'The code contains dangerous patterns'],
  warn_code2: ['Ничего не запускайте, пока не поймёте, что делает этот код. Если код написал ИИ, проверьте его вручную.', 'Do not run anything until you understand what the code does. If the AI wrote it, review it by hand.'],
  // поиск и замена по проекту
  b_replace: ['Заменить всё', 'Replace all'], s_ph_r: ['Заменить на…', 'Replace with…'],
  rep_found: ['Найдено: {0} в {1} файл(ах)', 'Found: {0} in {1} file(s)'], rep_none: ['Совпадений нет', 'No matches'],
  rep_need: ['Введите, что искать', 'Enter what to search for'], rep_long: ['Слишком длинный запрос (до 500 символов)', 'The query is too long (500 characters max)'],
  rep_confirm: ['Заменить «{0}» на «{1}» во всём проекте? Изменения можно откатить через историю правок.', 'Replace “{0}” with “{1}” across the project? Changes can be rolled back from the edit history.'],
  rep_work: ['Заменяю…', 'Replacing…'], rep_done: ['Заменено: {0} совпадений в {1} файл(ах)', 'Replaced: {0} matches in {1} file(s)'],
  // история правок
  hist_title: ['История правок', 'Edit history'], hist_open: ['История правок', 'Edit history'],
  hist_note: ['Каждая правка сохраняется, и файл можно вернуть к состоянию до неё. Хранятся последние 300 записей.', 'Every save is recorded and a file can be rolled back. The last 300 entries are kept.'],
  hist_load: ['Загружаю…', 'Loading…'], hist_for: ['Записи по файлу: {0}', 'Entries for: {0}'], hist_all: ['Все файлы проекта', 'All project files'],
  hist_empty: ['Записей пока нет — они появятся после первого сохранения.', 'No entries yet — they appear after the first save.'],
  hist_today: ['сегодня, {0}', 'today, {0}'], hist_created: ['создан', 'created'], h_close: ['Закрыть', 'Close'],
  hist_openfile: ['Открыть', 'Open'], hist_restore: ['Восстановить', 'Restore'], hist_restored: ['Восстановлено: {0}', 'Restored: {0}'],
  // окружение и обновления
  about_env: ['Проверить окружение', 'Check environment'], about_upd: ['Проверить обновления', 'Check for updates'],
  env_wait: ['Проверяю…', 'Checking…'], env_ver: ['Версия программы', 'App version'], env_portable: ['переносимый режим', 'portable mode'],
  env_port: ['Порт', 'Port'], env_root: ['Папка проекта', 'Project folder'], env_cfg: ['Настройки', 'Settings'],
  env_mem: ['Память (свободно / всего)', 'Memory (free / total)'], env_disk: ['Диск (свободно / всего)', 'Disk (free / total)'],
  env_yes: ['да', 'yes'], env_no: ['нет', 'no'], env_uptime: ['Программа работает', 'Uptime'],
  upd_wait: ['Проверяю обновления…', 'Checking for updates…'], upd_none: ['Проверить не удалось: {0}', 'Could not check: {0}'],
  upd_norelease: ['на GitHub пока нет релизов', 'no releases on GitHub yet'],
  upd_new: ['Доступна версия {0} (у вас {1}) — открыть страницу загрузки', 'Version {0} is available (you have {1}) — open the download page'],
  upd_latest: ['У вас последняя версия ({0})', 'You have the latest version ({0})'], upd_fail: ['Не удалось проверить обновления: {0}', 'Could not check for updates: {0}'],
  // ZIP
  about_zip: ['Скачать проект в ZIP', 'Download project as ZIP'], about_unzip: ['Загрузить ZIP в проект', 'Upload a ZIP into the project'],
  zip_wait: ['Готовлю архив…', 'Preparing the archive…'], zip_done: ['Архив скачан ({0})', 'Archive downloaded ({0})'],
  zip_bad: ['Это не файл ZIP', 'This is not a ZIP file'], zip_big: ['Архив больше 25 МБ — не получится', 'The archive is larger than 25 MB'],
  zip_unzip_wait: ['Загружаю и распаковываю…', 'Uploading and unpacking…'], zip_unzip_done: ['Файлов записано: {0}, пропущено: {1}', 'Files written: {0}, skipped: {1}'],
  zip_readfail: ['Не удалось прочитать файл', 'Could not read the file'],
  // шаблоны файлов
  tpl_nofile: ['Сначала откройте файл', 'Open a file first'], tpl_name: ['Название шаблона:', 'Template name:'], tpl_saved: ['Шаблон сохранён: {0}', 'Template saved: {0}'],
  tpl_full: ['Хранилище браузера заполнено — шаблон не сохранён', 'Browser storage is full — the template was not saved'],
  tpl_confirm: ['Вставить шаблон «{0}»? Текущее содержимое файла заменится.', 'Insert template “{0}”? The current file content will be replaced.'],
  tpl_filename: ['Имя нового файла:', 'New file name:'], tpl_inserted: ['Шаблон вставлен: {0}', 'Template inserted: {0}'],
  // настройки интерфейса
  f_notify: ['Уведомление в системе, когда долгий ответ готов', 'Desktop notification when a long answer is ready'],
  th_auto: ['Как в системе', 'System default'], st_stats: ['{0} стр · {1} симв.', '{0} lines · {1} chars'],
  find_ph: ['Найти в файле', 'Find in file'], find_none: ['Нет совпадений', 'No matches'], find_cnt: ['{0} из {1}', '{0} of {1}'], find_prev: ['Предыдущее', 'Previous'], find_next: ['Следующее', 'Next'], find_close: ['Закрыть', 'Close'],
  c_wait: ['Дождитесь окончания ответа', 'Wait for the current answer to finish'], regen_none: ['Нет запроса, который можно повторить', 'There is no request to retry'],
  ed_same: ['Изменений нет', 'Nothing to change'], ed_needsel: ['Выделите строки для сортировки', 'Select lines to sort'], ed_json_bad: ['JSON с ошибкой:', 'Invalid JSON:'],
  h_find: ['Найти в файле', 'Find in the file'],  h_dup: ['Дублировать строку', 'Duplicate line'], h_del: ['Удалить строку', 'Delete line'], h_move: ['Переместить строки', 'Move lines'], h_goto: ['Перейти к строке', 'Go to line'],
});
