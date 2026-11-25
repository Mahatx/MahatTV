const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ANDROID_DIR = path.join(ROOT, 'apps', 'mobile', 'android');
const RELEASE_DIR = path.join(ROOT, 'release');

const localAndroidBase = path.join(process.env.LOCALAPPDATA || '', 'Android');
const defaultJdk = path.join(localAndroidBase, 'jdk-21');
const defaultSdk = path.join(localAndroidBase, 'Sdk');

const env = { ...process.env };
if (!env.JAVA_HOME && fs.existsSync(defaultJdk)) {
  env.JAVA_HOME = defaultJdk;
  env.PATH = `${path.join(defaultJdk, 'bin')};${env.PATH || ''}`;
}
if (!env.ANDROID_HOME && fs.existsSync(defaultSdk)) {
  env.ANDROID_HOME = defaultSdk;
  env.ANDROID_SDK_ROOT = defaultSdk;
}

if (!env.JAVA_HOME) {
  console.error('❌ JAVA_HOME não encontrado. Instale o JDK 21 antes de compilar o APK.');
  process.exit(1);
}
if (!env.ANDROID_HOME) {
  console.error('❌ ANDROID_HOME não encontrado. Configure o Android SDK antes de compilar o APK.');
  process.exit(1);
}

const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
console.log(`[MahatTV APK] Compilando Android APK...`);
console.log(`  JAVA_HOME   : ${env.JAVA_HOME}`);
console.log(`  ANDROID_HOME: ${env.ANDROID_HOME}`);

const res = spawnSync(gradlew, ['assembleDebug'], {
  cwd: ANDROID_DIR,
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32'
});

if (res.status !== 0) {
  process.exit(res.status || 1);
}

const apkSrc = path.join(ANDROID_DIR, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
if (!fs.existsSync(apkSrc)) {
  console.error('❌ APK não encontrado após o build:', apkSrc);
  process.exit(1);
}

if (!fs.existsSync(RELEASE_DIR)) {
  fs.mkdirSync(RELEASE_DIR, { recursive: true });
}
const apkDest = path.join(RELEASE_DIR, 'MahatTV-debug.apk');
fs.copyFileSync(apkSrc, apkDest);

const sizeMB = (fs.statSync(apkDest).size / (1024 * 1024)).toFixed(2);
console.log(`\n✅ APK gerado com sucesso (${sizeMB} MB): ${apkDest}\n`);
