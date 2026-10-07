const express = require('express');
const NodeCache = require('node-cache');
const path = require('path');

// ─── NEPSE API library (handles authentication, token management, SSL) ──────
let Nepse;
try {
  ({ Nepse } = require('@rumess/nepse-api'));
} catch (e) {
  console.warn('⚠️  @rumess/nepse-api not found. Live data will be unavailable.');
  Nepse = null;
}

const app = express();
// Refresh the intraday feed frequently enough for a live tracker while
// keeping one upstream request shared by all browser clients for each window.
const LIVE_MARKET_CACHE_SECONDS = 5;
const LIVE_MARKET_STALE_SECONDS = 10 * 60;
const UPSTREAM_TIMEOUT_MS = 12_000;
const cache = new NodeCache({ stdTTL: 60, checkperiod: 10, maxKeys: 1000 });

app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join('; '));
  next();
});

// The API is read-only and same-origin. Bound per-client request volume so
// callers cannot turn uncached requests into unbounded upstream traffic.
const apiRequestCounts = new Map();
const API_WINDOW_MS = 60_000;
const API_REQUEST_LIMIT = 120;
app.use('/api', (req, res, next) => {
  const now = Date.now();
  const clientKey = req.socket.remoteAddress || 'unknown';
  let entry = apiRequestCounts.get(clientKey);

  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + API_WINDOW_MS };
    apiRequestCounts.set(clientKey, entry);
  }

  // Bound limiter memory if a deployment receives many distinct client IPs.
  if (apiRequestCounts.size > 10_000) {
    for (const [key, value] of apiRequestCounts) {
      if (now >= value.resetAt) apiRequestCounts.delete(key);
    }
    if (apiRequestCounts.size > 10_000) {
      return res.status(503).json({ success: false, error: 'Service temporarily busy' });
    }
  }

  entry.count += 1;
  if (entry.count > API_REQUEST_LIMIT) {
    res.setHeader('Retry-After', Math.max(1, Math.ceil((entry.resetAt - now) / 1000)));
    return res.status(429).json({ success: false, error: 'Too many requests' });
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

// ─── NEPSE Client Setup ────────────────────────────────────────────────────
let nepseClient = null;

async function getNepseClient() {
  if (!Nepse) return null;
  if (nepseClient) return nepseClient;
  try {
    const client = new Nepse();
    // The library defaults to tlsVerify = false (rejectUnauthorized: false),
    // which lets a network attacker spoof the market-data endpoint. Turn
    // certificate verification back on — nepalstock.com.np presents a valid
    // certificate. Must run before the timeout tweak because it rebuilds
    // the underlying axios instance.
    if (typeof client.setTLSVerification === 'function') {
      client.setTLSVerification(true);
    }
    // The library defaults to 100 seconds, which can leave every browser
    // refresh waiting on a socket that is no longer responding.
    if (client.client?.defaults) {
      client.client.defaults.timeout = UPSTREAM_TIMEOUT_MS;
    }
    nepseClient = client;
    return nepseClient;
  } catch (e) {
    console.error('Failed to create NEPSE client:', e.message);
    return null;
  }
}

// ─── In-flight request de-duplication ───────────────────────────────────────
// All browser clients share one upstream call per cache window instead of
// stampeding the exchange the moment a cache entry expires.
const inFlight = new Map();
function deduped(key, run) {
  const existing = inFlight.get(key);
  if (existing) return existing;
  const pending = run().finally(() => inFlight.delete(key));
  inFlight.set(key, pending);
  return pending;
}

// ─── Live NEPSE Data Functions ─────────────────────────────────────────────

async function fetchNepseIndex() {
  const key = 'nepse_index';
  const cached = cache.get(key);
  if (cached) return cached;

  return deduped(key, async () => {
    try {
      const client = await getNepseClient();
      if (!client) return null;

      const data = await client.getNepseIndex();
      if (data) {
        cache.set(key, data, 60);
      }
      return data;
    } catch (e) {
      console.error('NEPSE index fetch failed:', e.message);
      return null;
    }
  });
}

async function fetchTopGainers() {
  const key = 'top_gainers';
  const cached = cache.get(key);
  if (cached) return cached;

  return deduped(key, async () => {
    try {
      const client = await getNepseClient();
      if (!client) return null;

      // BUG FIX: method is getTopTenGainers() (getTopGainers does not exist)
      const data = await client.getTopTenGainers();
      if (data) {
        cache.set(key, data, 60);
      }
      return data;
    } catch (e) {
      console.error('Top gainers fetch failed:', e.message);
      return null;
    }
  });
}

async function fetchTopLosers() {
  const key = 'top_losers';
  const cached = cache.get(key);
  if (cached) return cached;

  return deduped(key, async () => {
    try {
      const client = await getNepseClient();
      if (!client) return null;

      // BUG FIX: method is getTopTenLosers() (getTopLosers does not exist)
      const data = await client.getTopTenLosers();
      if (data) {
        cache.set(key, data, 60);
      }
      return data;
    } catch (e) {
      console.error('Top losers fetch failed:', e.message);
      return null;
    }
  });
}

async function fetchLiveMarket() {
  return deduped('live_market', fetchLiveMarketOnce);
}

async function fetchLiveMarketOnce() {
  const key = 'live_market';
  const cached = cache.get(key);
  if (cached) return cached;

  try {
    const client = await getNepseClient();
    if (!client) return cache.get('live_market_stale') || null;

    let data = null;
    try {
      data = await client.getLiveMarket();
    } catch (e) {
      console.warn('NEPSE live-market endpoint unavailable; trying today-price feed:', e.message);
    }

    // BUG FIX: after market close the intraday feed returns an empty array
    // and /api/stocks used to degrade to simulated data for the rest of the
    // day. Fall back to the EOD price list, normalized to the same field
    // names so the frontend merge keeps working unchanged.
    if ((!Array.isArray(data) || data.length === 0) &&
        typeof client.getTodaysPriceVolumeHistory === 'function') {
      try {
        const eod = await client.getTodaysPriceVolumeHistory({ page: 0, size: 250 });
        const rows = Array.isArray(eod) ? eod : (eod && Array.isArray(eod.content) ? eod.content : []);
        if (rows.length > 0) {
          data = rows.map(r => ({
            symbol: r.symbol,
            securityName: r.securityName,
            lastTradedPrice: r.lastUpdatedPrice ?? r.closePrice,
            previousClose: r.previousDayClosePrice,
            highPrice: r.highPrice,
            lowPrice: r.lowPrice,
            openPrice: r.openPrice,
            totalTradeQuantity: r.totalTradedQuantity,
            totalTradeValue: r.totalTradedValue
          }));
        }
      } catch (e2) {
        console.error('EOD price fallback failed:', e2.message);
      }
    }

    if (data) {
      cache.set(key, data, LIVE_MARKET_CACHE_SECONDS);
      cache.set('live_market_updated_at', new Date().toISOString(), LIVE_MARKET_CACHE_SECONDS);
      cache.set('live_market_stale', data, LIVE_MARKET_STALE_SECONDS);
      cache.set('live_market_stale_updated_at', new Date().toISOString(), LIVE_MARKET_STALE_SECONDS);
    }
    return data || cache.get('live_market_stale') || null;
  } catch (e) {
    console.error('Live market fetch failed:', e.message);
    return cache.get('live_market_stale') || null;
  }
}

async function fetchSectorData() {
  const key = 'sector_data';
  const cached = cache.get(key);
  if (cached) return cached;

  return deduped(key, async () => {
    try {
      const client = await getNepseClient();
      if (!client) return null;

      const data = await client.getNepseSubIndices();
      if (data) {
        cache.set(key, data, 120);
      }
      return data;
    } catch (e) {
      console.error('Sector data fetch failed:', e.message);
      return null;
    }
  });
}

async function fetchStockInfo(symbol) {
  const key = `stock_${symbol}`;
  const cached = cache.get(key);
  if (cached) return cached;

  return deduped(key, async () => {
    try {
      const client = await getNepseClient();
      if (!client) return null;

      // BUG FIX: method is getSecurityDetails() (getSecurityDetail was a typo)
      const data = await client.getSecurityDetails(symbol);
      if (data) {
        cache.set(key, data, 300);
      }
      return data;
    } catch (e) {
      console.error(`Stock info fetch failed for ${symbol}:`, e.message);
      return null;
    }
  });
}

// ─── Helper: Get Nepal Standard Time ────────────────────────────────────────
function getNPT() {
  const now = new Date();
  const nptOffset = 5 * 60 + 45; // minutes
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const nptMs = utcMs + nptOffset * 60000;
  return new Date(nptMs);
}

// ─── API Routes ──────────────────────────────────────────────────────────────

// Serialize the NPT wall time produced by getNPT()'s local getters with the
// +05:45 offset. npt.toISOString() emits the machine's UTC instant instead,
// which reports a completely wrong clock whenever the host is not on UTC.
function toNptIso(npt, hour, minute) {
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return `${npt.getFullYear()}-${pad(npt.getMonth() + 1)}-${pad(npt.getDate())}` +
    `T${pad(hour)}:${pad(minute)}:${pad(npt.getSeconds())}.${pad(npt.getMilliseconds(), 3)}+05:45`;
}

// getNepseIndex() returns several indices (Sensitive Float, Float, Sensitive,
// NEPSE). Select the actual NEPSE index instead of whatever the exchange
// happens to list first — otherwise the UI renders ~155 instead of ~2570.
function pickNepseIndex(live) {
  const entries = Array.isArray(live) ? live
    : (live && typeof live === 'object' ? [live] : []);
  if (!entries.length) return null;

  const entry = entries.find(e => e && /^nepse(\s+index)?$/i.test(String(e.index || '').trim()))
    || entries.find(e => e && /nepse/i.test(String(e.index || '')));
  if (!entry) return null;

  const value = Number(entry.currentValue);
  if (!Number.isFinite(value) || value <= 0) return null;
  const change = Number(entry.change);
  const pct = Number(entry.perChange);
  return {
    value,
    change: Number.isFinite(change) ? change : 0,
    pct: Number.isFinite(pct) ? pct : 0
  };
}

// Market status & NEPSE index
app.get('/api/market-status', async (req, res) => {
  try {
    const live = await fetchNepseIndex();
    const npt = getNPT();

    const day = npt.getDay(); // 0=Sun, 1=Mon..5=Fri, 6=Sat
    const hour = npt.getHours();
    const minute = npt.getMinutes();
    const totalMin = hour * 60 + minute;

    // NEPSE trades Sun-Thu (day 0-4) — Nepal calendar
    // Saturday (6) and Friday (5) are weekends
    // Pre-open: 10:30-11:00 (630-660)
    // Trading: 11:00-15:00 (660-900)
    let marketStatus = 'CLOSED';
    if (day >= 0 && day <= 4) {
      if (totalMin >= 630 && totalMin < 660) marketStatus = 'PRE-OPEN';
      else if (totalMin >= 660 && totalMin < 900) marketStatus = 'OPEN';
    }

    const payload = {
      status: marketStatus,
      nptTime: toNptIso(npt, hour, minute),
      nptHour: hour,
      nptMinute: minute,
      dayOfWeek: day,
      live: live || null,
      nepseIndex: pickNepseIndex(live),
      source: live ? 'live' : 'simulated'
    };

    res.json({ success: true, data: payload });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Live stock prices (BUG 2 FIX: this route was missing!)
app.get('/api/stocks', async (req, res) => {
  try {
    const liveData = await fetchLiveMarket();
    if (liveData && (Array.isArray(liveData) ? liveData.length > 0 : true)) {
      // Normalize the response to a consistent shape
      const stocks = Array.isArray(liveData) ? liveData : (liveData.content || []);
      return res.json({
        success: true,
        data: stocks,
        source: cache.has('live_market_updated_at') ? 'live' : 'stale',
        updatedAt: cache.get('live_market_updated_at') || cache.get('live_market_stale_updated_at') || null
      });
    }
    res.json({ success: false, data: null, source: 'unavailable', error: 'Live data unavailable' });
  } catch (err) {
    res.json({ success: false, data: null, source: 'unavailable', error: err.message });
  }
});

// Prediction summary (top gainers/losers)
app.get('/api/prediction-summary', async (req, res) => {
  try {
    const [gainers, losers] = await Promise.all([
      fetchTopGainers(),
      fetchTopLosers()
    ]);

    const profitStocks = [];
    const lossStocks = [];

    // BUG FIX: normalize TopTenItem fields (ltp, cp, percentChange) — the old
    // mapping (lastTradedPrice/previousClose/percentageChange) never exists
    // in the library response, so every value fell back to 0.
    // NEPSE also often omits `cp` in the top-movers payload, so derive the
    // previous close from LTP and %change when it is missing.
    const mapTopTen = s => {
      const ltp = s.ltp ?? s.lastTradedPrice ?? 0;
      const pct = s.percentChange ?? s.percentageChange ?? s.changePct ?? 0;
      let prevClose = s.cp ?? s.previousClose ?? s.prevClose;
      if (!prevClose && ltp && pct) {
        prevClose = Math.round((ltp / (1 + pct / 100)) * 100) / 100;
      }
      return {
        symbol: s.symbol || s.securityName,
        ltp,
        prevClose: prevClose || 0,
        changePct: pct
      };
    };

    if (Array.isArray(gainers)) {
      gainers.forEach(s => profitStocks.push({ ...mapTopTen(s), direction: 'UP' }));
    }

    if (Array.isArray(losers)) {
      losers.forEach(s => lossStocks.push({ ...mapTopTen(s), direction: 'DOWN' }));
    }

    res.json({
      success: profitStocks.length > 0 || lossStocks.length > 0,
      profit: profitStocks.slice(0, 10),
      loss: lossStocks.slice(0, 10),
      source: (profitStocks.length > 0 || lossStocks.length > 0) ? 'live' : 'simulated'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Individual stock info
app.get('/api/stock/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.trim().toUpperCase();
    if (!/^[A-Z0-9.-]{1,12}$/.test(symbol)) {
      return res.status(400).json({ success: false, error: 'Invalid stock symbol' });
    }
    const data = await fetchStockInfo(symbol);
    res.json({ success: true, data: data || null, source: data ? 'live' : 'simulated' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Sector summary
app.get('/api/sectors', async (req, res) => {
  try {
    const data = await fetchSectorData();
    res.json({ success: true, data: data || null, source: data ? 'live' : 'simulated' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    nepseLibrary: Nepse ? 'loaded' : 'unavailable'
  });
});

// Unknown API paths must answer JSON. Without this they fall through to the
// SPA catch-all and clients get 200 + HTML when they expect JSON.
app.use('/api', (req, res) => {
  res.status(404).json({ success: false, error: 'Not found' });
});

// ─── Serve index.html for all other routes ────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`\n🚀 NEPSE AI Analyzer running at http://localhost:${PORT}`);
  console.log(`📊 NEPSE API library: ${Nepse ? 'loaded ✓' : 'unavailable ✗ (using simulated data)'}`);
  console.log('📅 Trading days: Sun–Thu (Nepal calendar)');
  console.log('Press Ctrl+C to stop.\n');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ Port ${PORT} is already in use.`);
    console.error(`   Stop the process using it, or start with a different port:`);
    console.error(`   PORT=3001 npm start\n`);
    process.exit(1);
  }
  throw err;
});
