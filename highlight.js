// Лёгкая подсветка синтаксиса без зависимостей
(function () {
  const esc = (s) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const words = (s) => '\\b(?:' + s.trim().split(/\s+/).join('|') + ')\\b';
  const KW = {
    js: 'break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof let new of return super switch this throw try typeof var void while with yield async await static get set null undefined true false interface type enum implements public private protected readonly from as declare namespace abstract',
    py: 'and as assert async await break class continue def del elif else except finally for from global if import in is lambda None nonlocal not or pass raise return try while with yield True False self match case',
    c: 'auto break case char class const continue default do double else enum extern float for goto if inline int long namespace new null nullptr private protected public register return short signed sizeof static struct switch template this throw true false try typedef union unsigned using virtual void volatile while bool string fn let mut impl pub use mod match loop where trait func package go defer chan range select map interface var type final abstract override import extends implements throws synchronized boolean byte object fun val when is as in out echo function foreach elseif endif isset array',
    sh: 'if then else elif fi for while do done case esac function in echo export local return exit cd ls cat grep sed awk set unset source true false',
    sql: 'select from where insert into values update set delete create table drop alter add join left right inner outer on group by order having limit as and or not null primary key foreign references index distinct union all case when then else end like in is',
  };
  const EXT = {
    js: 'js', jsx: 'js', ts: 'js', tsx: 'js', mjs: 'js', cjs: 'js', javascript: 'js', typescript: 'js',
    py: 'py', python: 'py',
    c: 'c', h: 'c', cpp: 'c', hpp: 'c', cc: 'c', cs: 'c', java: 'c', go: 'c', rs: 'c', rust: 'c', kt: 'c', swift: 'c', php: 'c', dart: 'c', scala: 'c',
    sh: 'sh', bash: 'sh', zsh: 'sh', yml: 'sh', yaml: 'sh', toml: 'sh', ini: 'sh', rb: 'sh', ps1: 'sh', dockerfile: 'sh',
    sql: 'sql', json: 'json', jsonc: 'json', html: 'html', htm: 'html', xml: 'html', svg: 'html', vue: 'html',
    css: 'css', scss: 'css', less: 'css', md: 'md', markdown: 'md',
  };
  const STR = '"(?:\\\\.|[^"\\\\\\n])*"?|\'(?:\\\\.|[^\'\\\\\\n])*\'?';
  const NUM = '\\b0x[\\da-fA-F]+\\b|\\b\\d[\\d_]*\\.?\\d*(?:e[+-]?\\d+)?\\b';
  const R = {
    js: [['c', '//[^\\n]*|/\\*[\\s\\S]*?(?:\\*/|$)'], ['s', STR + '|`(?:\\\\.|[^`\\\\])*`?'], ['n', NUM], ['k', words(KW.js)], ['f', '\\b[A-Za-z_$][\\w$]*(?=\\()'], ['t', '\\b[A-Z][A-Za-z0-9_]*\\b']],
    c: [['c', '//[^\\n]*|/\\*[\\s\\S]*?(?:\\*/|$)|^\\s*#[^\\n]*'], ['s', STR + '|`[^`]*`?'], ['n', NUM], ['k', words(KW.c)], ['f', '\\b[A-Za-z_]\\w*(?=\\()'], ['t', '\\b[A-Z][A-Za-z0-9_]*\\b']],
    py: [['c', '#[^\\n]*'], ['s', '"""[\\s\\S]*?(?:"""|$)|\'\'\'[\\s\\S]*?(?:\'\'\'|$)|' + STR], ['n', NUM], ['k', words(KW.py)], ['f', '\\b[A-Za-z_]\\w*(?=\\()'], ['t', '\\b[A-Z][A-Za-z0-9_]*\\b']],
    sh: [['c', '#[^\\n]*'], ['s', STR], ['n', NUM], ['k', words(KW.sh)], ['t', '\\$\\{?\\w+\\}?']],
    sql: [['c', '--[^\\n]*|/\\*[\\s\\S]*?(?:\\*/|$)'], ['s', "'(?:''|[^'])*'?"], ['n', NUM], ['k', '(?i:)' ]],
    json: [['a', '"(?:\\\\.|[^"\\\\\\n])*"(?=\\s*:)'], ['s', '"(?:\\\\.|[^"\\\\\\n])*"?'], ['n', '-?\\b\\d[\\d.eE+-]*\\b'], ['k', '\\b(?:true|false|null)\\b']],
    html: [['c', '<!--[\\s\\S]*?(?:-->|$)'], ['t', '</?[A-Za-z][\\w:-]*'], ['s', '"[^"\\n]*"?|\'[^\'\\n]*\'?'], ['t', '/?>'], ['n', '&\\w+;'], ['a', '\\s[\\w:@.-]+(?==)']],
    css: [['c', '/\\*[\\s\\S]*?(?:\\*/|$)'], ['s', '"[^"\\n]*"?|\'[^\'\\n]*\'?'], ['k', '@[\\w-]+'], ['n', '#[\\da-fA-F]{3,8}\\b|-?\\d*\\.?\\d+(?:px|em|rem|%|vh|vw|s|ms|deg|fr)?\\b'], ['f', '[\\w-]+(?=\\s*:)'], ['t', '[.#][\\w-]+']],
    md: [['k', '^#{1,6} [^\\n]*'], ['s', '`[^`\\n]+`'], ['f', '\\[[^\\]\\n]+\\]\\([^)\\n]+\\)'], ['c', '^>[^\\n]*']],
  };
  R.sql[3] = ['k', words(KW.sql)];
  const cache = {};
  function compile(lang) {
    if (cache[lang]) return cache[lang];
    const spec = R[lang]; if (!spec) return null;
    const flags = lang === 'sql' ? 'gim' : 'gm';
    return (cache[lang] = { re: new RegExp(spec.map(s => '(' + s[1] + ')').join('|'), flags), cls: spec.map(s => s[0]) });
  }
  function langOf(p) {
    const base = String(p || '').split('/').pop().toLowerCase();
    if (base === 'dockerfile') return 'sh';
    const ext = base.includes('.') ? base.split('.').pop() : base;
    return EXT[ext] || 'txt';
  }
  function highlight(code, lang) {
    const c = compile(lang);
    if (!c) return esc(code);
    let out = '', last = 0, m;
    c.re.lastIndex = 0;
    while ((m = c.re.exec(code))) {
      if (m[0] === '') { c.re.lastIndex++; continue; }
      let g = 1; while (g < m.length && m[g] === undefined) g++;
      out += esc(code.slice(last, m.index)) + `<span class="tk-${c.cls[g - 1]}">${esc(m[0])}</span>`;
      last = m.index + m[0].length;
    }
    return out + esc(code.slice(last));
  }
  // null = у языка нет однострочных комментариев (оператор ?? тут нельзя: он превращал null в '// ')
  const COMMENTS = { py: '# ', sh: '# ', sql: '-- ', html: null, css: null, json: null, md: null };
  const commentOf = (lang) => (lang in COMMENTS ? COMMENTS[lang] : '// ');
  window.HL = { highlight, langOf, commentOf, esc };
})();
