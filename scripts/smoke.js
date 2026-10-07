/**
 * End-to-end smoke test: boots the real server on an isolated port, hits the
 * routes a browser depends on, and asserts the response contracts.
 * Upstream NEPSE may be unreachable (offline CI), so live-data assertions are
 * conditional on the exchange actually answering.
 */
const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');

const root = path.join(__dirname, '..');
// Avoid the dev server's port 3000 so this never validates the wrong process.
const PORT = Number(process.env.SMOKE_PORT) || 4100 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}`;

let failures = 0;
const check = (name, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (!cond && detail ? ' -> ' + detail : ''));
  if (!cond) failures++;
};

function request(urlPath, timeoutMs = 45000) {
  return new Promise(resolve => {
    const req = http.get(BASE + urlPath, { timeout: timeoutMs }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { if (body.length < 2000000) body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on('timeout', () => req.destroy(new Error('request timeout')));
    req.on('error', err => resolve({ error: err.message }));
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let childLog = '';
  child.stdout.on('data', d => { childLog += d; });
  child.stderr.on('data', d => { childLog += d; });
  const kill = () => { if (!child.killed) child.kill(); };
  process.on('exit', kill);
  child.on('exit', code => { childLog += `\n[server exited with code ${code}]`; });

  // Wait for the port to come up.
  let up = false;
  for (let i = 0; i < 80; i++) {
    const health = await request('/api/health', 2000);
    if (health.status === 200 && child.exitCode === null) { up = true; break; }
    if (child.exitCode !== null) break;
    await sleep(250);
  }
  // Make sure it was our child answering, not some other listener on the port.
  if (up) {
    await sleep(150);
    if (child.exitCode !== null) up = false;
  }

  if (!up) {
    check('server boots and answers /api/health', false, childLog.trim().split('\n').slice(-6).join(' | '));
    console.log(failures ? `\nSMOKE FAILED (${failures})` : '\nSMOKE PASSED');
    kill();
    process.exit(1);
  }
  check('server boots and answers /api/health', true);

  const html = await request('/');
  check('GET / serves the app shell (200 + <title>NEPSE)', html.status === 200 && /<title>NEPSE/.test(html.body),
    `status=${html.status}`);
  check('GET / does not leak x-powered-by', !html.headers['x-powered-by']);

  const css = await request('/style.css');
  check('static asset /style.css served (200)', css.status === 200, `status=${css.status}`);

  const missing = await request('/api/definitely-not-a-route');
  let missingJson = null;
  try { missingJson = JSON.parse(missing.body); } catch (_) { /* not JSON */ }
  check('unknown /api/* returns JSON 404', missing.status === 404 && missingJson && missingJson.success === false,
    `status=${missing.status} body=${String(missing.body).slice(0, 60)}`);

  const badSym = await request('/api/stock/bad!sym');
  check('invalid symbol rejected with 400', badSym.status === 400, `status=${badSym.status}`);

  const stocks = await request('/api/stocks');
  let stocksJson = null;
  try { stocksJson = JSON.parse(stocks.body); } catch (_) { /* not JSON */ }
  check('/api/stocks answers a JSON envelope', stocks.status === 200 && stocksJson && 'success' in stocksJson,
    `status=${stocks.status}`);
  if (stocksJson && stocksJson.success) {
    check('/api/stocks data is an array with symbol fields',
      Array.isArray(stocksJson.data) && stocksJson.data.length > 0 && typeof stocksJson.data[0].symbol === 'string',
      `len=${Array.isArray(stocksJson.data) ? stocksJson.data.length : 'n/a'}`);
  }

  const ms = await request('/api/market-status');
  let msJson = null;
  try { msJson = JSON.parse(ms.body); } catch (_) { /* not JSON */ }
  check('/api/market-status answers JSON', ms.status === 200 && msJson && msJson.success === true,
    `status=${ms.status}`);

  if (msJson && msJson.success) {
    const data = msJson.data;
    check('nptTime carries the +05:45 Nepal offset',
      typeof data.nptTime === 'string' && /\+05:45$/.test(data.nptTime), String(data.nptTime));
    if (typeof data.nptTime === 'string' && data.nptTime.length >= 13) {
      check('nptTime hour matches nptHour field',
        Number(data.nptTime.slice(11, 13)) === data.nptHour,
        `iso=${data.nptTime.slice(11, 13)} field=${data.nptHour}`);
    }

    const live = Array.isArray(data.live) ? data.live : [];
    if (live.length > 0) {
      const idx = data.nepseIndex;
      check('live feed exposes a normalized nepseIndex',
        !!idx && Number.isFinite(idx.value) && idx.value > 0, JSON.stringify(idx));
      if (idx) {
        const first = live[0] || {};
        const firstIsNepse = /nepse/i.test(String(first.index || ''));
        check('nepseIndex is the NEPSE row, not whichever index is listed first',
          firstIsNepse || idx.value !== Number(first.currentValue),
          `nepseIndex=${idx.value} live[0]=${first.currentValue} (${first.index})`);
      }
    } else {
      console.log('  INFO  upstream live feed unavailable — skipping nepseIndex shape checks');
    }
  }

  kill();
  await sleep(200);
  console.log(failures ? `\nSMOKE FAILED (${failures})` : '\nSMOKE PASSED');
  process.exit(failures ? 1 : 0);
}

main().catch(err => {
  console.error('SMOKE ERROR', err);
  process.exit(1);
});
