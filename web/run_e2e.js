/**
 * E2E Test Runner
 *
 * Starts backend (Python FastAPI) + frontend (Vite) servers,
 * runs Playwright tests, then cleans up.
 *
 * Usage: node run_e2e.js
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const BACKEND_PORT = 3000;
const FRONTEND_PORT = 5174;
const BACKEND_DIR = path.resolve(__dirname, '..', 'server');
const FRONTEND_DIR = __dirname;

let backendProc = null;
let frontendProc = null;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForServer(url, description, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const resp = await fetch(url, { method: 'GET' });
      if (resp.ok || resp.status === 404 || resp.status === 405) {
        console.log(`  ${description} ready (attempt ${i + 1})`);
        return true;
      }
    } catch {
      // server not ready yet
    }
    await sleep(1000);
  }
  throw new Error(`${description} failed to start after ${maxAttempts}s`);
}

async function main() {
  console.log('=== Visual Forge E2E Test Runner ===\n');

  // ── 1. Start backend ──
  console.log('[1/4] Starting backend (port ' + BACKEND_PORT + ')...');
  backendProc = spawn('python', ['main.py'], {
    cwd: BACKEND_DIR,
    stdio: 'pipe',
    shell: true,
  });
  backendProc.stderr.on('data', d => process.stderr.write('[backend] ' + d));
  await waitForServer(`http://localhost:${BACKEND_PORT}/api/providers`, 'Backend');

  // ── 2. Start frontend ──
  console.log('[2/4] Starting frontend (port ' + FRONTEND_PORT + ')...');
  frontendProc = spawn('node', ['node_modules/vite/bin/vite.js', '--port', String(FRONTEND_PORT), '--host', '0.0.0.0'], {
    cwd: FRONTEND_DIR,
    stdio: 'pipe',
    shell: true,
  });
  frontendProc.stderr.on('data', d => process.stderr.write('[vite] ' + d));
  await waitForServer(`http://localhost:${FRONTEND_PORT}`, 'Frontend', 40);

  // ── 3. Run Playwright tests ──
  console.log('[3/4] Running Playwright tests...');
  const playwrightBin = path.join(FRONTEND_DIR, 'node_modules', '@playwright', 'test', 'cli.js');

  return new Promise((resolve) => {
    const testProc = spawn('node', [playwrightBin, 'test', 'tests/e2e_workflow.spec.ts', '--project=chromium', '--reporter=list'], {
      cwd: FRONTEND_DIR,
      stdio: 'inherit',
      shell: true,
    });

    testProc.on('close', (code) => {
      console.log(`\n[4/4] Playwright tests ${code === 0 ? 'PASSED' : 'FAILED'} (exit code ${code})`);
      cleanup();
      resolve(code === 0);
    });

    testProc.on('error', (err) => {
      console.error('Playwright spawn error:', err.message);
      cleanup();
      resolve(false);
    });
  });
}

function cleanup() {
  console.log('Cleaning up servers...');
  if (frontendProc) { frontendProc.kill('SIGTERM'); }
  if (backendProc) { backendProc.kill('SIGTERM'); }
}

process.on('SIGINT', () => { cleanup(); process.exit(0); });
process.on('SIGTERM', () => { cleanup(); process.exit(0); });

main().then(success => {
  process.exit(success ? 0 : 1);
}).catch(err => {
  console.error('E2E runner error:', err.message);
  cleanup();
  process.exit(1);
});
