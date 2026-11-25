const { spawn } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CAP_BIN = path.join(ROOT, 'node_modules', '@capacitor', 'cli', 'bin', 'capacitor');

const args = process.argv.slice(2);
if (!args.length) {
  console.log('Uso: node scripts/mobile.js <sync|add|open> [android|ios]');
  process.exit(0);
}

const child = spawn(process.execPath, [CAP_BIN, ...args], {
  cwd: ROOT,
  stdio: 'inherit'
});

child.on('exit', (code) => {
  process.exit(code || 0);
});
