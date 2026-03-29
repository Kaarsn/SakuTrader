const fs = require('fs');
const path = require('path');

const distRoot = path.resolve(__dirname, '..', 'dist', 'IDX AI Analyst-win32-x64');
const localesDir = path.join(distRoot, 'locales');
const keepLocales = new Set(['en-US.pak', 'id.pak']);

function optimizeLocales() {
  if (!fs.existsSync(localesDir)) return;
  const files = fs.readdirSync(localesDir);
  files.forEach((name) => {
    const fullPath = path.join(localesDir, name);
    if (fs.statSync(fullPath).isFile() && !keepLocales.has(name)) {
      fs.rmSync(fullPath, { force: true });
    }
  });
}

function folderSizeBytes(target) {
  if (!fs.existsSync(target)) return 0;
  const stack = [target];
  let total = 0;

  while (stack.length) {
    const current = stack.pop();
    const stat = fs.statSync(current);
    if (stat.isFile()) {
      total += stat.size;
      continue;
    }

    const entries = fs.readdirSync(current);
    entries.forEach((entry) => stack.push(path.join(current, entry)));
  }

  return total;
}

function main() {
  optimizeLocales();
  const totalBytes = folderSizeBytes(distRoot);
  const totalMb = (totalBytes / (1024 * 1024)).toFixed(1);
  process.stdout.write(`Post-pack optimize done. Size: ${totalMb} MB\n`);
}

main();
