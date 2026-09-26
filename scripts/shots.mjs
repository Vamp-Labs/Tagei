#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATALOGUE_FILE = path.join(WT, 'src/dev/scenes.json');
const DEFAULT_CHROME = path.join(
  os.homedir(),
  '.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell',
);
const VIEWPORT_WIDTH = 390;
const VIEWPORT_HEIGHT = 844;
const DEFAULT_DPR = 3;
const DEFAULT_JOBS = 3;
const READY_POLL_MS = 100;
const READY_TIMEOUT_MS = 20_000;
const PATH_WAIT_MS = 1500;
const ACTION_SETTLE_MS = 400;
const COMMAND_TIMEOUT_MS = 30_000;
const LAUNCH_TIMEOUT_MS = 15_000;

const USAGE = `Usage: node scripts/shots.mjs (--base URL | --port N) --out DIR (--scenes a,b | --all | --path P)
  [--reduced] [--query "dir=SHORT&asset=BTC"] [--jobs N]
  [--click CSS] [--hold CSS:MS] [--wait MS] [--eval JS]   (actions run in order, per page)
Env: CHROME=<binary>  DPR=<device pixel ratio>  RESKIN_TMP=<dir for the Chrome profile>`;

const PAUSE_LOOPS_JS = `(() => {
  let paused = 0;
  for (const animation of document.getAnimations()) {
    const timing = animation.effect ? animation.effect.getComputedTiming() : null;
    if (timing && timing.iterations === Infinity) {
      animation.pause();
      animation.currentTime = 0;
      paused += 1;
    }
  }
  return paused;
})()`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fail(message) {
  process.stderr.write(`shots: ${message}\n${USAGE}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const opts = { scenes: [], all: false, paths: [], reduced: false, query: '', jobs: DEFAULT_JOBS, actions: [] };
  for (let i = 0; i < argv.length; i += 1) {
    let key = argv[i];
    let value;
    const eq = key.indexOf('=');
    if (key.startsWith('--') && eq > 0) {
      value = key.slice(eq + 1);
      key = key.slice(0, eq);
    }
    const take = () => {
      if (value !== undefined) return value;
      i += 1;
      if (i >= argv.length) fail(`${key} needs a value`);
      return argv[i];
    };
    switch (key) {
      case '--base': opts.base = take().replace(/\/+$/, ''); break;
      case '--port': opts.base = `http://127.0.0.1:${take()}`; break;
      case '--out': opts.out = path.resolve(take()); break;
      case '--scenes': opts.scenes.push(...take().split(',').map((s) => s.trim()).filter(Boolean)); break;
      case '--all': opts.all = true; break;
      case '--path': opts.paths.push(take()); break;
      case '--reduced': opts.reduced = true; break;
      case '--query': opts.query = take().replace(/^[?&]/, ''); break;
      case '--jobs': opts.jobs = Math.max(1, Number.parseInt(take(), 10) || DEFAULT_JOBS); break;
      case '--click': opts.actions.push({ type: 'click', selector: take() }); break;
      case '--wait': opts.actions.push({ type: 'wait', ms: Number(take()) }); break;
      case '--eval': opts.actions.push({ type: 'eval', js: take() }); break;
      case '--hold': {
        const raw = take();
        const cut = raw.lastIndexOf(':');
        const ms = Number(raw.slice(cut + 1));
        if (cut <= 0 || !Number.isFinite(ms)) fail(`--hold expects CSS:MS, got "${raw}"`);
        opts.actions.push({ type: 'hold', selector: raw.slice(0, cut), ms });
        break;
      }
      case '-h':
      case '--help':
        process.stdout.write(`${USAGE}\n`);
        process.exit(0);
        break;
      default:
        fail(`unknown option ${key}`);
    }
  }
  if (!opts.base) fail('--base or --port is required');
  if (!opts.out) fail('--out is required');
  if (!opts.all && opts.scenes.length === 0 && opts.paths.length === 0) fail('pick --scenes, --all or --path');
  if (path.relative(path.join(WT, 'screenshots'), opts.out).split(path.sep)[0] !== '..') {
    fail('refusing to write into screenshots/');
  }
  return opts;
}

class Cdp {
  constructor(url) {
    this.url = url;
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Set();
  }

  async open() {
    this.ws = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', () => reject(new Error(`cannot connect to ${this.url}`)), { once: true });
    });
    this.ws.addEventListener('message', (event) => this.receive(String(event.data)));
    this.ws.addEventListener('close', () => {
      for (const { reject } of this.pending.values()) reject(new Error('DevTools socket closed'));
      this.pending.clear();
    });
  }

  receive(raw) {
    const message = JSON.parse(raw);
    if (message.id !== undefined) {
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      clearTimeout(waiter.timer);
      if (message.error) waiter.reject(new Error(`${waiter.method}: ${message.error.message}`));
      else waiter.resolve(message.result);
      return;
    }
    for (const listener of this.listeners) listener(message);
  }

  send(method, params = {}, sessionId) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, COMMAND_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer, method });
      this.ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    });
  }

  on(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  once(sessionId, method, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new Error(`${method} not received`));
      }, timeoutMs);
      const off = this.on((message) => {
        if (message.sessionId === sessionId && message.method === method) {
          clearTimeout(timer);
          off();
          resolve(message.params);
        }
      });
    });
  }

  close() {
    this.ws?.close();
  }
}

async function launchChrome(profileDir) {
  const binary = process.env.CHROME || DEFAULT_CHROME;
  const args = [
    '--remote-debugging-port=0',
    '--remote-allow-origins=*',
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    '--mute-audio',
    '--force-color-profile=srgb',
    '--font-render-hinting=none',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--run-all-compositor-stages-before-draw',
  ];
  if (!path.basename(binary).includes('headless-shell')) args.unshift('--headless=new');
  args.push('about:blank');

  const child = spawn(binary, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error('Chrome did not print its DevTools URL')), LAUNCH_TIMEOUT_MS);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Chrome exited early (${code}): ${buffer.slice(-800)}`));
    });
    child.stderr.on('data', (chunk) => {
      buffer += chunk;
      const match = buffer.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
  });
  child.removeAllListeners('exit');
  child.stderr.resume();
  return { child, wsUrl };
}

function pngSize(buffer) {
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function slugFor(pagePath) {
  return pagePath.replace(/^\/+/, '').replace(/\.html?$/, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'index';
}

function buildJobs(opts, catalogue) {
  const byName = new Map(catalogue.map((entry) => [entry.name, entry]));
  const suffix = opts.reduced ? '-rm' : '';
  const jobs = [];
  const names = opts.all ? catalogue.map((entry) => entry.name) : opts.scenes;
  for (const name of names) {
    const entry = byName.get(name);
    if (!entry) fail(`unknown scene "${name}" (see src/dev/scenes.json)`);
    const query = new URLSearchParams(opts.query);
    query.set('scene', name);
    query.set('freeze', '1');
    if (opts.reduced) query.set('rm', '1');
    jobs.push({
      kind: 'scene',
      name,
      id: entry.id,
      height: entry.height ?? VIEWPORT_HEIGHT,
      url: `${opts.base}/?${query.toString()}`,
      file: `${entry.id}-${name}${suffix}`,
    });
  }
  for (const pagePath of opts.paths) {
    const joiner = pagePath.includes('?') ? '&' : '?';
    const url = `${opts.base}${pagePath.startsWith('/') ? '' : '/'}${pagePath}${opts.query ? joiner + opts.query : ''}`;
    jobs.push({ kind: 'path', name: pagePath, id: '', height: VIEWPORT_HEIGHT, url, file: `${slugFor(pagePath)}${suffix}` });
  }
  return jobs;
}

async function evaluate(cdp, sessionId, expression) {
  const { result, exceptionDetails } = await cdp.send(
    'Runtime.evaluate',
    { expression, awaitPromise: true, returnByValue: true },
    sessionId,
  );
  if (exceptionDetails) {
    throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text ?? 'evaluation failed');
  }
  return result.value;
}

async function centerOf(cdp, sessionId, selector) {
  const point = await evaluate(
    cdp,
    sessionId,
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`,
  );
  if (!point) throw new Error(`no element matches ${selector}`);
  return point;
}

async function touch(cdp, sessionId, type, point) {
  await cdp.send(
    'Input.dispatchTouchEvent',
    { type, touchPoints: point ? [{ x: point.x, y: point.y, radiusX: 4, radiusY: 4, force: 1 }] : [] },
    sessionId,
  );
}

async function capture(cdp, sessionId, file) {
  await evaluate(cdp, sessionId, PAUSE_LOOPS_JS);
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
  const buffer = Buffer.from(data, 'base64');
  await writeFile(file, buffer);
  return pngSize(buffer);
}

async function waitReady(cdp, sessionId, job) {
  const started = Date.now();
  const limit = job.kind === 'scene' ? READY_TIMEOUT_MS : PATH_WAIT_MS;
  while (Date.now() - started < limit) {
    const ready = await evaluate(cdp, sessionId, `document.documentElement.dataset.sceneReady === '1'`);
    if (ready) return true;
    await sleep(READY_POLL_MS);
  }
  return job.kind === 'path';
}

async function shoot(cdp, job, opts, dpr, logConsole) {
  const started = Date.now();
  const record = { name: job.name, id: job.id, file: path.join(opts.out, `${job.file}.png`), ok: false, errors: [] };
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const offConsole = cdp.on((message) => {
    if (message.sessionId !== sessionId) return;
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      logConsole(job.name, message.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' '));
    } else if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params.exceptionDetails;
      logConsole(job.name, details.exception?.description ?? details.text);
    } else if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
      logConsole(job.name, `${message.params.entry.text} ${message.params.entry.url ?? ''}`.trim());
    }
  });

  try {
    await Promise.all([
      cdp.send('Page.enable', {}, sessionId),
      cdp.send('Runtime.enable', {}, sessionId),
      cdp.send('Log.enable', {}, sessionId),
    ]);
    await cdp.send(
      'Emulation.setDeviceMetricsOverride',
      { width: VIEWPORT_WIDTH, height: job.height, deviceScaleFactor: dpr, mobile: true, screenWidth: VIEWPORT_WIDTH, screenHeight: job.height },
      sessionId,
    );
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, sessionId);
    await cdp.send(
      'Emulation.setEmulatedMedia',
      { features: [{ name: 'prefers-reduced-motion', value: opts.reduced ? 'reduce' : 'no-preference' }] },
      sessionId,
    );

    const loaded = cdp.once(sessionId, 'Page.loadEventFired', READY_TIMEOUT_MS);
    await cdp.send('Page.navigate', { url: job.url }, sessionId);
    await loaded;

    if (!(await waitReady(cdp, sessionId, job))) throw new Error(`not ready after ${READY_TIMEOUT_MS} ms`);
    const report = await evaluate(cdp, sessionId, 'window.__scene ?? null');
    if (report) {
      record.fontsOk = report.fontsOk;
      record.errors.push(...report.errors);
    }

    for (const action of opts.actions) {
      if (action.type === 'wait') {
        await sleep(action.ms);
      } else if (action.type === 'eval') {
        await evaluate(cdp, sessionId, action.js);
      } else if (action.type === 'click') {
        const point = await centerOf(cdp, sessionId, action.selector);
        await touch(cdp, sessionId, 'touchStart', point);
        await touch(cdp, sessionId, 'touchEnd');
        await sleep(ACTION_SETTLE_MS);
      } else if (action.type === 'hold') {
        const point = await centerOf(cdp, sessionId, action.selector);
        await touch(cdp, sessionId, 'touchStart', point);
        await sleep(action.ms);
        record.hold = path.join(opts.out, `${job.file}-hold.png`);
        await capture(cdp, sessionId, record.hold);
        await touch(cdp, sessionId, 'touchEnd');
        await sleep(ACTION_SETTLE_MS);
      }
    }

    Object.assign(record, await capture(cdp, sessionId, record.file));
    record.ok = true;
  } catch (error) {
    record.errors.push(error instanceof Error ? error.message : String(error));
  } finally {
    offConsole();
    await cdp.send('Target.closeTarget', { targetId }).catch(() => undefined);
    record.ms = Date.now() - started;
  }
  return record;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const catalogue = JSON.parse(await readFile(CATALOGUE_FILE, 'utf8'));
  const jobs = buildJobs(opts, catalogue);
  const dpr = Number(process.env.DPR) || DEFAULT_DPR;
  await mkdir(opts.out, { recursive: true });
  const consoleFile = path.join(opts.out, 'console.log');
  await writeFile(consoleFile, '');
  let consoleErrors = 0;
  const logConsole = (name, text) => {
    consoleErrors += 1;
    void appendFile(consoleFile, `[${name}] ${text}\n`);
  };

  const tmpRoot = process.env.RESKIN_TMP || os.tmpdir();
  await mkdir(tmpRoot, { recursive: true });
  const profileDir = await mkdtemp(path.join(tmpRoot, 'shots-chrome-'));
  const started = Date.now();
  let chrome;
  let cdp;
  const shutdown = async () => {
    cdp?.close();
    if (chrome && chrome.exitCode === null) {
      const exited = new Promise((resolve) => chrome.once('exit', resolve));
      chrome.kill('SIGTERM');
      await Promise.race([exited, sleep(3000)]);
      if (chrome.exitCode === null) chrome.kill('SIGKILL');
    }
    await rm(profileDir, { recursive: true, force: true });
  };
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      void shutdown().finally(() => process.exit(130));
    });
  }

  const results = [];
  try {
    const launched = await launchChrome(profileDir);
    chrome = launched.child;
    cdp = new Cdp(launched.wsUrl);
    await cdp.open();

    let cursor = 0;
    const worker = async () => {
      while (cursor < jobs.length) {
        const job = jobs[cursor];
        cursor += 1;
        const record = await shoot(cdp, job, opts, dpr, logConsole);
        results.push(record);
        process.stderr.write(`${record.ok ? 'ok  ' : 'FAIL'} ${job.file} ${record.ms}ms${record.errors.length ? ` (${record.errors.join('; ')})` : ''}\n`);
      }
    };
    await Promise.all(Array.from({ length: Math.min(opts.jobs, jobs.length) }, worker));
  } finally {
    await shutdown();
  }

  const order = new Map(jobs.map((job, index) => [job.file, index]));
  results.sort((a, b) => order.get(path.basename(a.file, '.png')) - order.get(path.basename(b.file, '.png')));
  const summary = {
    base: opts.base,
    out: opts.out,
    reduced: opts.reduced,
    dpr,
    totalMs: Date.now() - started,
    consoleErrors,
    failed: results.filter((record) => !record.ok).map((record) => record.name),
    shots: results,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  process.exitCode = summary.failed.length > 0 ? 1 : 0;
}

main().catch((error) => {
  process.stderr.write(`shots: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
