const { spawn } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const VITE_BIN = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
const VITE_CONFIG = path.join(ROOT, 'packages', 'ui', 'vite.config.js');
const SERVER_ENTRY = path.join(ROOT, 'packages', 'server', 'index.js');

console.log('[MahatTV Dev] Iniciando build em watch (Vite) + servidor Node...');

const viteProc = spawn(process.execPath, [VITE_BIN, 'build', '--watch', '--config', VITE_CONFIG], {
  cwd: ROOT,
  stdio: 'inherit'
});

const serverProc = spawn(process.execPath, ['--watch', SERVER_ENTRY], {
  cwd: ROOT,
  stdio: 'inherit'
});

function shutdown(signal) {
  viteProc.kill(signal);
  serverProc.kill(signal);
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

serverProc.on('exit', (code) => {
  if (code && code !== 0) {
    viteProc.kill();
    process.exit(code);
  }
});
