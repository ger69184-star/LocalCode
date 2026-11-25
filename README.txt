LocalCode 0.8.1 / локальный редактор кода с ИИ
============================================

РУССКИЙ
-------
Установка (один раз):
  1. Распакуйте архив в постоянную папку (например C:\LocalCode).
  2. Запустите install.bat  - поставит Node.js, Ollama и подходящую модель.
  3. Запустите Create-Shortcut.bat - создаст ярлык на рабочем столе.
Запуск: ярлык «LocalCode» (или LocalCode.vbs). Закроете окно - программа остановится.
Обновление: распакуйте новый архив поверх старой папки. install.bat повторно не нужен.

Файлы:
  server.js                  сервер (без зависимостей, Node.js 18+)
  public\                    интерфейс: index.html, app.js, style.css, i18n.js, highlight.js
  install.bat / install.sh   установка (Windows / Mac, Linux)
  Create-Shortcut.bat        ярлык на рабочем столе
  LocalCode.vbs              запуск без окна консоли (основной)
  LocalCode.bat              запуск с консолью (для отладки)
  Install-Model.bat          ручная загрузка модели, видны ошибки
  localcode.log              журнал сервера (создаётся при запуске)
  SECURITY.md                что защищено и какие есть ограничения
  INTEGRITY.md               подлинность сборки и защита от «кряков»
  tests\                     тесты:  npm test  (нужен Node 18+)

Возможности:
  - чат с ИИ: режимы «Агент» и «Вопрос», подтверждения действий, @файл, правка кода Ctrl+K;
  - офлайн-модели через Ollama (каталог с поиском и тегами) и облако (Groq, Gemini, DeepSeek и др.);
  - быстрые команды без модели: папки, файлы, программы Windows, Bluetooth, adb;
  - терминал с вводом, остановкой и выбором cmd/PowerShell; запуск F5 и отладка Shift+F5;
  - голос без интернета (Alt+M), 7 тем, свой цвет, шрифты, свой CSS;
  - инструменты агента: patch, вопрос пользователю, поиск в интернете (по желанию);
  - автоключи: несколько API-ключей (по одному в строке), при лимите программа сама берёт следующий;
  - палитра команд Ctrl+Shift+P, свои быстрые кнопки, сохранение чата и настроек в файл, много настроек оформления.
Подробности - в файле «Справочник» (LocalCode-spravochnik).

Диагностика: откройте http://localhost:3000/api/health (порт указан в localcode.log).

Безопасность (кратко; подробно — в SECURITY.md):
  - сервер доступен только с этого компьютера (127.0.0.1) и требует одноразовый токен;
  - агент не читает .env, ключи, .git/config и системные папки; символические ссылки наружу запрещены;
  - опасные действия (команды, правка и удаление файлов) подтверждаются кнопкой;
  - в окне браузера и в журнале токен не сохраняется;
  - не делайте проброс порта наружу и не отключайте подтверждения без необходимости.

Бесплатно и безопасно (подробно - в LICENSE, INTEGRITY.md и SECURITY.md):
  - программа бесплатная: ключей активации, подписки и пробного периода нет;
  - Настройки -> О программе показывают, совпадают ли файлы с официальной подписанной сборкой;
  - если файлы изменены, программа предупредит: «кряки» и чужие сборки часто содержат вирусы;
  - код и команды с типичными вирусными приёмами (скачать и запустить, автозапуск, майнер) помечаются предупреждением;
  - сервер доступен только с этого компьютера, агент не читает секреты и не выходит за папку проекта;
  - продавать программу и выдавать изменённые сборки за официальные запрещено (LICENSE).

ENGLISH
-------
Install (once): unpack the archive to a permanent folder, run install.bat, then Create-Shortcut.bat.
Start with the desktop shortcut (LocalCode.vbs). Closing the window stops the program.
Update: unpack the new archive over the old folder; no need to run install.bat again.
Offline models run through Ollama; cloud models (Groq, Gemini, DeepSeek, ...) need an API key.
Several API keys can be pasted (one per line): when one hits its limit the app switches to the next automatically.
Voice input works offline after a one-time download. Command palette: Ctrl+Shift+P. Run tests with: npm test (Node 18+).
Troubleshooting: see localcode.log, or start LocalCode.bat to see the console output.
