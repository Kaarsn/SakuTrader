const fs = require('fs');
const path = require('path');

const desktopRoot = path.resolve(__dirname, '..');
const projectRoot = path.resolve(desktopRoot, '..');
const runtimeRoot = path.join(desktopRoot, 'runtime');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function cleanDir(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
  ensureDir(dirPath);
}

function copyIfExists(src, dest) {
  if (!fs.existsSync(src)) return;
  ensureDir(path.dirname(dest));
  fs.cpSync(src, dest, { recursive: true });
}

function main() {
  cleanDir(runtimeRoot);

  const backendSrc = path.join(projectRoot, 'backend-node');
  const backendDst = path.join(runtimeRoot, 'backend-node');
  ensureDir(backendDst);
  copyIfExists(path.join(backendSrc, 'src'), path.join(backendDst, 'src'));
  copyIfExists(path.join(backendSrc, 'package.json'), path.join(backendDst, 'package.json'));
  copyIfExists(path.join(backendSrc, 'node_modules'), path.join(backendDst, 'node_modules'));
  copyIfExists(path.join(backendSrc, '.env'), path.join(backendDst, '.env'));

  const frontendSrc = path.join(projectRoot, 'frontend-next');
  const frontendDst = path.join(runtimeRoot, 'frontend');
  ensureDir(frontendDst);
  copyIfExists(path.join(frontendSrc, '.next', 'standalone'), frontendDst);
  copyIfExists(path.join(frontendSrc, '.next', 'static'), path.join(frontendDst, '.next', 'static'));
  copyIfExists(path.join(frontendSrc, 'public'), path.join(frontendDst, 'public'));

  const analyticsSrc = path.join(projectRoot, 'analytics-python');
  const analyticsDst = path.join(runtimeRoot, 'analytics-python');
  ensureDir(analyticsDst);
  copyIfExists(path.join(analyticsSrc, 'app'), path.join(analyticsDst, 'app'));
  copyIfExists(path.join(analyticsSrc, 'requirements.txt'), path.join(analyticsDst, 'requirements.txt'));

  // Strip common cache folders that are not needed at runtime.
  const cleanupCandidates = [
    path.join(backendDst, 'node_modules', '.cache'),
    path.join(frontendDst, '.next', 'cache'),
    path.join(analyticsDst, 'app', '__pycache__')
  ];

  cleanupCandidates.forEach((candidate) => {
    fs.rmSync(candidate, { recursive: true, force: true });
  });

  process.stdout.write(`Runtime prepared at: ${runtimeRoot}\n`);
}

main();
