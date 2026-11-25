const { spawn } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const electronBinary = require('electron');

const env = { ...process.env };
// Evita conflito quando executado dentro de terminais integrados de IDEs baseadas em Electron
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronBinary, ['.'], {
  cwd: ROOT,
  env,
  stdio: 'inherit'
});

child.on('exit', (code) => {
  process.exit(code || 0);
});
