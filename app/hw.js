'use strict';
// Определение железа и подбор моделей. Без зависимостей. Любая ошибка определения безопасна: просто меньше данных.
const os = require('os');
const fs = require('fs');
const { execFileSync } = require('child_process');

function sh(cmd, args, timeout = 4000) {
  try { return execFileSync(cmd, args, { encoding: 'utf8', timeout, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return ''; }
}
const vendorOf = (n) => /nvidia|geforce|rtx|gtx|quadro/i.test(n) ? 'nvidia' : /amd|radeon|ati\b/i.test(n) ? 'amd' : /intel|iris|uhd|arc/i.test(n) ? 'intel' : /apple/i.test(n) ? 'apple' : 'other';

function detect() {
  const cpus = os.cpus() || [];
  const hw = { platform: process.platform, arch: process.arch, cpu: (cpus[0] || {}).model || '?', threads: cpus.length || 1,
    ramGB: +(os.totalmem() / 2 ** 30).toFixed(1), gpus: [], vramGB: 0, appleSilicon: process.platform === 'darwin' && process.arch === 'arm64', avx: null };
  // NVIDIA (любая ОС): единственный источник надёжного объёма видеопамяти
  for (const line of sh('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits']).split('\n').filter(Boolean)) {
    const [name, mem] = line.split(',').map(s => s.trim());
    if (name) hw.gpus.push({ vendor: 'nvidia', name, vramGB: +(parseInt(mem, 10) / 1024 || 0).toFixed(1) });
  }
  if (process.platform === 'win32') {
    try {
      const j = sh('powershell', ['-NoProfile', '-Command', 'Get-CimInstance Win32_VideoController | Select-Object Name | ConvertTo-Json -Compress']);
      for (const g of [].concat(JSON.parse(j || '[]'))) if (g && g.Name && !hw.gpus.some(x => x.name === g.Name)) hw.gpus.push({ vendor: vendorOf(g.Name), name: g.Name, vramGB: 0 });
    } catch {}
  } else if (process.platform === 'linux') {
    for (const l of sh('lspci', []).split('\n')) {
      if (!/vga|3d|display/i.test(l)) continue;
      const name = l.replace(/^[^:]+:[^:]+:\s*/, '').trim();
      if (name && !hw.gpus.some(x => x.vendor === 'nvidia' && vendorOf(name) === 'nvidia')) hw.gpus.push({ vendor: vendorOf(name), name, vramGB: 0 });
    }
    try { hw.avx = /\bavx\b/.test(fs.readFileSync('/proc/cpuinfo', 'utf8')); } catch {}
  } else if (hw.appleSilicon) hw.gpus.push({ vendor: 'apple', name: 'Apple Silicon (unified memory)', vramGB: 0 });
  hw.vramGB = Math.max(0, ...hw.gpus.filter(g => g.vendor === 'nvidia').map(g => g.vramGB));
  return hw;
}
// 'gpu' — влезет в видеопамять; 'ok' — комфортно на CPU; 'slow' — запустится, но медленно; 'no' — не хватает памяти
function fit(m, hw) {
  const budget = hw.vramGB || (hw.appleSilicon ? hw.ramGB * 0.6 : 0);
  if (budget && budget >= m.minVram) return 'gpu';
  if (hw.ramGB >= m.minRam) return hw.threads >= m.cpuThreads ? 'ok' : 'slow';
  return 'no';
}
function recommend(models, hw) {
  const coders = models.filter(m => m && m.coder).sort((a, b) => (a.sizeGB || 0) - (b.sizeGB || 0));
  if (!coders.length) return models.length ? (models[0].id || null) : null;
  const good = coders.filter(m => ['gpu', 'ok'].includes(fit(m, hw)));
  if (good.length) return good[good.length - 1].id;
  const any = coders.filter(m => fit(m, hw) !== 'no');
  return (any[0] || coders[0]).id;
}
module.exports = { detect, fit, recommend };
