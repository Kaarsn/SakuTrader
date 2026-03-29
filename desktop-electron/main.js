const { app, BrowserWindow, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

const appRoot = path.resolve(__dirname, '..');
const envPath = path.join(appRoot, '.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

const FRONTEND_PORT = Number(process.env.DESKTOP_FRONTEND_PORT || 3000);
const BACKEND_PORT = Number(process.env.DESKTOP_BACKEND_PORT || 4000);
const ANALYTICS_PORT = Number(process.env.DESKTOP_ANALYTICS_PORT || 8000);
const FRONTEND_URL = `http://localhost:${FRONTEND_PORT}`;
const FRONTEND_MODE = (process.env.DESKTOP_FRONTEND_MODE || 'dev').toLowerCase();
const NPM_COMMAND = process.platform === 'win32' ? 'npm.cmd' : 'npm';

let mainWindow = null;
const childProcesses = [];

function startProcess({ name, command, args, cwd, env }) {
  const proc = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    shell: process.platform === 'win32'
  });

  proc.stdout.on('data', (chunk) => {
    process.stdout.write(`[${name}] ${chunk}`);
  });

  proc.stderr.on('data', (chunk) => {
    process.stderr.write(`[${name}] ${chunk}`);
  });

  proc.on('exit', (code) => {
    process.stdout.write(`[${name}] exited with code ${code}\n`);
  });

  childProcesses.push(proc);
  return proc;
}

async function waitForHttp(url, timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url, { method: 'GET' });
      if (response.ok) return true;
    } catch {
      // service not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

function findUpPath(startDir, relativeTarget, maxDepth = 8) {
  let current = startDir;
  for (let i = 0; i <= maxDepth; i += 1) {
    const candidate = path.resolve(current, relativeTarget);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

function resolvePythonExecutable() {
  if (process.env.ANALYTICS_PYTHON && fs.existsSync(process.env.ANALYTICS_PYTHON)) {
    return process.env.ANALYTICS_PYTHON;
  }

  const searchRoots = [
    process.cwd(),
    path.dirname(process.execPath),
    appRoot,
    process.resourcesPath || ''
  ].filter(Boolean);

  for (const root of searchRoots) {
    const hit = findUpPath(root, path.join('.venv', 'Scripts', 'python.exe'), 10);
    if (hit) return hit;
  }

  return process.platform === 'win32' ? 'py' : 'python3';
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 1200,
    minHeight: 780,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadURL(FRONTEND_URL);
}

async function startServicesAndOpenWindow() {
  const packagedRuntimeRoot = path.join(process.resourcesPath, 'runtime');
  const devRuntimeRoot = path.join(appRoot, 'runtime');
  const serviceRoot = fs.existsSync(packagedRuntimeRoot)
    ? packagedRuntimeRoot
    : (fs.existsSync(devRuntimeRoot) ? devRuntimeRoot : appRoot);

  const backendDir = path.join(serviceRoot, 'backend-node');
  const frontendDir = path.join(serviceRoot, 'frontend');
  const analyticsDir = path.join(serviceRoot, 'analytics-python');
  const analyticsPython = resolvePythonExecutable();

  if (![backendDir, frontendDir, analyticsDir].every((dir) => fs.existsSync(dir))) {
    dialog.showErrorBox(
      'Service Folder Missing',
      'Folder backend-node/frontend-next/analytics-python tidak ditemukan. Jalankan build desktop lagi agar extra resources ikut terbawa.'
    );
    app.quit();
    return;
  }

  const frontendScript = FRONTEND_MODE === 'start' ? 'start' : 'dev';
  const standaloneServer = path.join(frontendDir, 'server.js');

  startProcess({
    name: 'analytics-python',
    command: analyticsPython,
    args: analyticsPython === 'py'
      ? ['-3', '-m', 'uvicorn', 'app.main:app', '--host', '0.0.0.0', '--port', String(ANALYTICS_PORT)]
      : ['-m', 'uvicorn', 'app.main:app', '--host', '0.0.0.0', '--port', String(ANALYTICS_PORT)],
    cwd: analyticsDir
  });

  startProcess({
    name: 'backend-node',
    command: 'node',
    args: ['src/server.js'],
    cwd: backendDir,
    env: {
      PORT: String(BACKEND_PORT),
      ANALYTICS_SERVICE_URL: `http://localhost:${ANALYTICS_PORT}`
    }
  });

  startProcess({
    name: 'frontend-next',
    command: fs.existsSync(standaloneServer) ? 'node' : NPM_COMMAND,
    args: fs.existsSync(standaloneServer) ? ['server.js'] : ['run', frontendScript],
    cwd: frontendDir,
    env: {
      PORT: String(FRONTEND_PORT),
      NEXT_PUBLIC_API_BASE: `http://localhost:${BACKEND_PORT}`
    }
  });

  const frontendReady = await waitForHttp(FRONTEND_URL, 180000);
  if (!frontendReady) {
    await dialog.showErrorBox(
      'Startup Failed',
      'Frontend service gagal start. Pastikan dependency sudah terinstall (npm install) dan Python env tersedia.'
    );
    app.quit();
    return;
  }

  createWindow();
}

function stopAllProcesses() {
  for (const proc of childProcesses) {
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(proc.pid), '/f', '/t'], { shell: true });
      } else {
        proc.kill('SIGTERM');
      }
    } catch {
      // ignore cleanup errors
    }
  }
}

app.whenReady().then(startServicesAndOpenWindow);

app.on('window-all-closed', () => {
  stopAllProcesses();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopAllProcesses();
});
