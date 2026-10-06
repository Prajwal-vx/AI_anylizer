/**
 * NEPSE AI ANALYZER — Main Application
 * Handles: live data fetching, real-time clock, charts, UI rendering,
 * AI analysis, alerts, and all user interactions.
 */

'use strict';

// ════════════════════════════════════════════════════════════════════════════
// STATE
// ════════════════════════════════════════════════════════════════════════════
const State = {
  stocks: [...NEPSE_STOCKS],          // working stock list
  indexHistory: [...NEPSE_HISTORY_90],
  marketStatus: 'CLOSED',
  nepseIndex: { value: 0, change: 0, pct: 0 },
  liveDataActive: false,
  lastLiveUpdate: null,
  liveFetchInProgress: false,
  chartRange: 7,
  activeTab: 'dashboard',
  // BUG FIX: guard against corrupt localStorage — a JSON.parse throw here
  // used to crash the whole app before it could even render.
  alerts: (() => {
    try {
      const raw = JSON.parse(localStorage.getItem('nepse_alerts') || '[]');
      if (!Array.isArray(raw)) return [];
      const symbols = new Set(NEPSE_STOCKS.map(stock => stock.symbol));
      return raw.filter(alert => alert && typeof alert === 'object' &&
        symbols.has(alert.symbol) && ['above', 'below'].includes(alert.type) &&
        Number.isFinite(alert.price) && alert.price > 0 &&
        Number.isSafeInteger(alert.id)).slice(0, 100);
    } catch (e) {
      console.warn('Corrupt nepse_alerts in localStorage — resetting.', e);
      return [];
    }
  })(),
  analyses: null,
  marketAnalysis: null,
  nepseChart: null,
  modalChart: null,
  currentModalStock: null,
  alertCheckInterval: null,
  lastApiAttempt: 0
};

// ════════════════════════════════════════════════════════════════════════════
// NPT CLOCK & MARKET STATUS
// ════════════════════════════════════════════════════════════════════════════
function getNPTNow() {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const nptMs = utcMs + (5 * 60 + 45) * 60000;
  return new Date(nptMs);
}

function getMarketStatus(npt) {
  const day = npt.getDay(); // 0=Sun, 1=Mon..4=Thu, 5=Fri, 6=Sat
  const h = npt.getHours();
  const m = npt.getMinutes();
  const totalMin = h * 60 + m;
  // NEPSE trades Sun–Thu (day 0-4). Friday (5) and Saturday (6) are weekends.
  if (day > 4) return 'CLOSED'; // Fri or Sat = weekend
  if (totalMin >= 630 && totalMin < 660) return 'PRE-OPEN';
  if (totalMin >= 660 && totalMin < 900) return 'OPEN';
  return 'CLOSED';
}

function getCountdownInfo(npt, status) {
  const h = npt.getHours();
  const m = npt.getMinutes();
  const s = npt.getSeconds();
  const totalSec = h * 3600 + m * 60 + s;
  const day = npt.getDay();
  const preOpenSec = 10.5 * 3600; // 10:30 AM

  if (status === 'OPEN') {
    const closeAt = 15 * 3600;
    const diff = closeAt - totalSec;
    if (diff > 0) return { label: 'Market closes in', secs: diff };
  }
  if (status === 'PRE-OPEN') {
    const openAt = 11 * 3600;
    const diff = openAt - totalSec;
    if (diff > 0) return { label: 'Trading opens in', secs: diff };
  }

  // Closed — find next trading day
  // Nepal calendar: Sun(0)-Thu(4) = trading days, Fri(5)+Sat(6) = weekends
  if (day >= 0 && day <= 3) {
    // Sun-Wed: if market already closed today, next open is tomorrow
    if (totalSec >= 15 * 3600 || totalSec < preOpenSec) {
      const secsToTomorrow = (totalSec >= preOpenSec)
        ? (24 * 3600 - totalSec + preOpenSec)
        : (preOpenSec - totalSec);
      return { label: 'Pre-open in', secs: secsToTomorrow };
    }
  }
  if (day === 4) {
    // Thursday: if market closed, next open is Sunday (2 days away)
    if (totalSec >= 15 * 3600) {
      const secsToSun = 3 * 24 * 3600 - totalSec + preOpenSec; // Thu→Sun = 3 days
      return { label: 'Opens Sunday in', secs: secsToSun };
    }
    if (totalSec < preOpenSec) {
      return { label: 'Pre-open in', secs: preOpenSec - totalSec };
    }
  }
  if (day === 5) {
    // Friday (weekend): next open is Sunday (2 days away)
    const secsToSun = 2 * 24 * 3600 - totalSec + preOpenSec;
    return { label: 'Opens Sunday in', secs: secsToSun };
  }
  if (day === 6) {
    // Saturday (weekend): next open is Sunday (1 day away)
    const secsToSun = 1 * 24 * 3600 - totalSec + preOpenSec;
    return { label: 'Opens Sunday in', secs: secsToSun };
  }
  return { label: 'Market closed', secs: 0 };
}

function formatSecs(s) {
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2,'0')}m`;
  return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}

const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function tickClock() {
  const npt = getNPTNow();
  const h   = String(npt.getHours()).padStart(2, '0');
  const m   = String(npt.getMinutes()).padStart(2, '0');
  const sec = String(npt.getSeconds()).padStart(2, '0');

  document.getElementById('clock-display').textContent = `${h}:${m}:${sec}`;
  document.getElementById('clock-date').textContent =
    `${DAYS[npt.getDay()]}, ${MONTHS[npt.getMonth()]} ${npt.getDate()} NPT`;

  const status = getMarketStatus(npt);
  const prevStatus = State.marketStatus;
  State.marketStatus = status;

  // Update badge
  const dot = document.getElementById('status-dot');
  const label = document.getElementById('status-label');
  dot.className = 'status-dot ' + status.toLowerCase().replace('-','');
  if (status === 'OPEN') {
    label.textContent = '● MARKET OPEN';
    label.style.color = 'var(--green)';
  } else if (status === 'PRE-OPEN') {
    label.textContent = '● PRE-OPEN SESSION';
    label.style.color = 'var(--yellow)';
  } else {
    label.textContent = '○ MARKET CLOSED';
    label.style.color = 'var(--text-muted)';
  }

  // Countdown
  const ct = getCountdownInfo(npt, status);
  document.getElementById('countdown-label').textContent = ct.label;
  document.getElementById('countdown-value').textContent = formatSecs(ct.secs);

  // The live feed is polled independently of the display clock.
  if (prevStatus !== 'OPEN' && status === 'OPEN') {
    showNotification('NEPSE Market is now OPEN', 'Trading session has started (11:00 AM NPT)');
  }
  if (prevStatus === 'OPEN' && status !== 'OPEN') {
    showNotification('NEPSE Market is now CLOSED', 'Trading session ended (3:00 PM NPT)');
  }
}

// ════════════════════════════════════════════════════════════════════════════
// LIVE DATA FETCHING
// ════════════════════════════════════════════════════════════════════════════
async function fetchLiveData() {
  if (State.liveFetchInProgress) return;
  State.liveFetchInProgress = true;
  try {
    try {
      const res = await fetch('/api/market-status');
      const data = await res.json();
      if (data.success && data.data.live) {
        const live = data.data.live;
        if (live.nepseIndex !== undefined) {
          updateNepseIndex(live.nepseIndex, live.change || 0);
        } else if (Array.isArray(live) && live[0]) {
          updateNepseIndex(live[0].currentValue || live[0].index, live[0].change || 0);
        }
      }
    } catch (e) {
      // Keep the latest displayed index when the upstream feed is unreachable.
    }

    try {
      const res = await fetch('/api/stocks');
      const data = await res.json();
      if (data.success && data.data && ['live', 'stale'].includes(data.source)) {
        mergeWithLiveData(data.data);
        State.lastLiveUpdate = data.updatedAt || State.lastLiveUpdate;
        State.stocks.forEach(stock => {
          stock.change = stock.ltp - stock.prevClose;
          stock.changePct = stock.prevClose ? stock.change / stock.prevClose * 100 : 0;
        });
        renderNepseIndex();
        updateTableRows();
        renderTopMovers();
        renderSectorHeatmap();
        checkPriceAlerts();
        setDataSourceBadge(data.source === 'live');
      } else {
        setDataSourceBadge(false);
      }
    } catch (e) {
      setDataSourceBadge(false);
    }
  } finally {
    State.liveFetchInProgress = false;
  }
}

function setDataSourceBadge(isLive) {
  const badge = document.getElementById('data-source-badge');
  const text  = document.getElementById('data-source-text');
  if (isLive) {
    State.liveDataActive = true;
    const updated = State.lastLiveUpdate ? new Date(State.lastLiveUpdate).toLocaleTimeString() : 'just now';
    text.textContent = `Live NEPSE · updated ${updated}`;
    badge.querySelector('.pulse-dot').style.background = 'var(--green)';
  } else {
    State.liveDataActive = false;
    text.textContent = State.lastLiveUpdate ? 'Live feed unavailable · showing last received prices' : 'Live feed unavailable · showing reference prices';
    badge.querySelector('.pulse-dot').style.background = 'var(--yellow)';
  }
}

function mergeWithLiveData(liveData) {
  // Attempt to match live data symbols to our stock list
  if (!Array.isArray(liveData)) return;
  liveData.forEach(item => {
    const sym = item.symbol || item.stockSymbol || item.Script;
    if (!sym) return;
    const stock = State.stocks.find(s => s.symbol === sym.toUpperCase());
    if (stock) {
      const ltp = Number(item.lastTradedPrice ?? item.ltp);
      if (Number.isFinite(ltp) && ltp > 0) {
        // BUG FIX: keep the real previous close (LiveMarketData.previousClose).
        // The old code did stock.prevClose = stock.ltp, which made every
        // live stock's change% compare the price against itself.
        const previousClose = Number(item.previousClose);
        const high = Number(item.highPrice ?? item.high);
        const low = Number(item.lowPrice ?? item.low);
        const volume = Number(item.totalTradeQuantity ?? item.volume);
        if (Number.isFinite(previousClose) && previousClose > 0) stock.prevClose = previousClose;
        stock.ltp = ltp;
        if (Number.isFinite(high) && high > 0) stock.high = high;
        if (Number.isFinite(low) && low > 0) stock.low = low;
        if (Number.isFinite(volume) && volume >= 0) stock.volume = volume;
      }
    }
  });
}

function updateNepseIndex(value, change) {
  value = Number(value);
  change = Number(change);
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(change)) return;
  const pct = value > 0 ? (change / (value - change) * 100) : 0;
  State.nepseIndex = { value, change, pct };
  renderNepseIndex();
}

// ════════════════════════════════════════════════════════════════════════════
// NEPSE INDEX RENDER
// ════════════════════════════════════════════════════════════════════════════
function renderNepseIndex() {
  const { value, change, pct } = State.nepseIndex;
  const el = document.getElementById('nepse-value');
  const chEl = document.getElementById('nepse-change');
  const pctEl = document.getElementById('nepse-pct');

  const isUp = change >= 0;
  el.textContent = value.toFixed(2);
  el.style.color = 'var(--text)';

  chEl.textContent = (isUp ? '+' : '') + change.toFixed(2);
  chEl.style.color = isUp ? 'var(--green)' : 'var(--red)';

  pctEl.textContent = `(${isUp ? '+' : ''}${pct.toFixed(2)}%)`;
  pctEl.style.color = isUp ? 'var(--green)' : 'var(--red)';

  // Market stats from stock data
  const advancers = State.stocks.filter(s => s.ltp > s.prevClose).length;
  const decliners = State.stocks.filter(s => s.ltp < s.prevClose).length;
  const unchanged = State.stocks.length - advancers - decliners;
  const totalTurnover = State.stocks.reduce((a, s) => a + s.ltp * s.volume, 0);
  const totalVolume   = State.stocks.reduce((a, s) => a + s.volume, 0);

  document.getElementById('stat-turnover').textContent = formatCurrency(totalTurnover);
  document.getElementById('stat-volume').textContent   = formatNumber(totalVolume);
  document.getElementById('stat-adv').textContent      = advancers;
  document.getElementById('stat-dec').textContent      = decliners;
  document.getElementById('stat-unc').textContent      = unchanged;

  // Breadth bar
  const total = State.stocks.length;
  const advPct = (advancers / total * 100).toFixed(1);
  const decPct = (decliners / total * 100).toFixed(1);
  document.getElementById('breadth-adv').style.width = advPct + '%';
  document.getElementById('breadth-dec').style.width = decPct + '%';
  document.getElementById('bl-adv').textContent = `${advancers} Adv`;
  document.getElementById('bl-dec').textContent = `${decliners} Dec`;
}

// ════════════════════════════════════════════════════════════════════════════
function updateTableRows() {
  State.stocks.forEach(stock => {
    const row = document.getElementById(`row-${stock.symbol}`);
    if (!row) return;
    const ltp = row.querySelector('.td-ltp');
    const chg = row.querySelector('.td-change');
    if (ltp) {
      const prev = parseFloat(ltp.textContent);
      ltp.textContent = stock.ltp.toFixed(2);
      if (stock.ltp > prev) { ltp.classList.remove('tick-down'); ltp.classList.add('tick-up'); }
      else if (stock.ltp < prev) { ltp.classList.remove('tick-up'); ltp.classList.add('tick-down'); }
      setTimeout(() => { ltp.classList.remove('tick-up','tick-down'); }, 600);
    }
    if (chg) {
      const change = stock.ltp - stock.prevClose;
      const pct = (change / stock.prevClose * 100).toFixed(2);
      chg.textContent = `${change >= 0 ? '+' : ''}${change.toFixed(2)} (${pct}%)`;
      chg.className = `td-change ${change >= 0 ? 'green' : 'red'}`;
    }
  });
}

// ════════════════════════════════════════════════════════════════════════════
// CHARTS
// ════════════════════════════════════════════════════════════════════════════
function initNepseChart() {
  const ctx = document.getElementById('nepseChart').getContext('2d');
  const data = getChartData(State.chartRange);

  const gradient = ctx.createLinearGradient(0, 0, 0, 260);
  gradient.addColorStop(0, 'rgba(244,185,66,0.15)');
  gradient.addColorStop(1, 'rgba(244,185,66,0)');

  State.nepseChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: data.map(d => d.date),
      datasets: [{
        label: 'NEPSE Index',
        data: data.map(d => d.value),
        borderColor: '#F4B942',
        backgroundColor: gradient,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointHoverBackgroundColor: '#F4B942',
        tension: 0.3,
        fill: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0D1626',
          borderColor: 'rgba(244,185,66,0.3)',
          borderWidth: 1,
          titleColor: '#7A8BA4',
          bodyColor: '#E2EAF4',
          callbacks: {
            label: ctx => `NEPSE: ${ctx.raw.toFixed(2)}`
          }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: {
            color: '#4A5D74',
            maxTicksLimit: 8,
            font: { size: 10, family: 'JetBrains Mono' }
          }
        },
        y: {
          position: 'right',
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: {
            color: '#4A5D74',
            font: { size: 10, family: 'JetBrains Mono' }
          }
        }
      }
    }
  });
}

function getChartData(days) {
  const hist = State.indexHistory;
  return hist.slice(-days);
}

function setChartRange(days, btn) {
  State.chartRange = days;
  document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  const data = getChartData(days);
  State.nepseChart.data.labels = data.map(d => d.date);
  State.nepseChart.data.datasets[0].data = data.map(d => d.value);
  State.nepseChart.update('active');
}

function initModalChart(prices, symbol) {
  const ctx = document.getElementById('modalChart').getContext('2d');
  if (State.modalChart) State.modalChart.destroy();

  const last30 = prices.slice(-30);
  const isUp = last30[last30.length - 1] >= last30[0];
  const color = isUp ? '#22C55E' : '#EF4444';

  const gradient = ctx.createLinearGradient(0, 0, 0, 200);
  gradient.addColorStop(0, isUp ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');

  State.modalChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: last30.map((_, i) => `D-${last30.length - 1 - i}`),
      datasets: [{
        data: last30,
        borderColor: color,
        backgroundColor: gradient,
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.3,
        fill: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { display: false },
        y: {
          position: 'right',
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: { color: '#4A5D74', font: { size: 10 } }
        }
      }
    }
  });
}

// ════════════════════════════════════════════════════════════════════════════
// SECTOR HEATMAP
// ════════════════════════════════════════════════════════════════════════════
function renderSectorHeatmap() {
  const sectorData = {};
  SECTOR_LIST.forEach(s => { sectorData[s] = { total: 0, count: 0 }; });

  State.stocks.forEach(stock => {
    const sec = stock.sector;
    if (!sectorData[sec]) sectorData[sec] = { total: 0, count: 0 };
    const change = (stock.ltp - stock.prevClose) / stock.prevClose * 100;
    sectorData[sec].total += change;
    sectorData[sec].count++;
  });

  const html = SECTOR_LIST.map(sec => {
    const d = sectorData[sec];
    if (!d || d.count === 0) return '';
    const avg = d.total / d.count;
    const pct = avg.toFixed(2);
    const isUp = avg >= 0;
    const barWidth = Math.min(100, Math.abs(avg) * 15);
    const color = isUp ? 'var(--green)' : 'var(--red)';
    const shortName = sec.replace(' Bank','').replace(' Insurance','').replace('Commercial ','').replace('Non-Life ','NL ').replace('Life ','Life ');
    return `
      <div class="sector-item" onclick="filterBySector('${sec}')">
        <span class="sector-name">${shortName}</span>
        <div class="sector-bar-bg">
          <div class="sector-bar-fill" style="width:${barWidth}%;background:${color}"></div>
        </div>
        <span class="sector-pct ${isUp ? 'green' : 'red'}">${isUp ? '+' : ''}${pct}%</span>
      </div>`;
  }).join('');

  document.getElementById('sector-heatmap').innerHTML = html;
}

// ════════════════════════════════════════════════════════════════════════════
// TOP GAINERS / LOSERS
// ════════════════════════════════════════════════════════════════════════════
function renderTopMovers() {
  const sorted = [...State.stocks].map(s => ({
    ...s,
    changePct: (s.ltp - s.prevClose) / s.prevClose * 100,
    change: s.ltp - s.prevClose
  })).sort((a, b) => b.changePct - a.changePct);

  const gainers = sorted.filter(s => s.changePct > 0).slice(0, 6);
  const losers  = sorted.filter(s => s.changePct < 0).reverse().slice(0, 6);

  const moverHTML = (stocks, isGainer) => stocks.map(s => `
    <div class="mover-item" onclick="openStockModal('${s.symbol}')">
      <div>
        <div class="mover-sym">${s.symbol}</div>
        <div class="mover-name">${s.name.length > 28 ? s.name.slice(0,28)+'…' : s.name}</div>
      </div>
      <div class="mover-price">
        <div class="mover-ltp ${isGainer ? 'green' : 'red'}">Rs.${s.ltp.toFixed(2)}</div>
        <div class="mover-pct ${isGainer ? 'green' : 'red'}">${s.changePct >= 0 ? '+' : ''}${s.changePct.toFixed(2)}%</div>
      </div>
    </div>`).join('');

  document.getElementById('top-gainers-list').innerHTML = gainers.length ? moverHTML(gainers, true) : '<div class="empty-state">No gainers today</div>';
  document.getElementById('top-losers-list').innerHTML  = losers.length ? moverHTML(losers, false) : '<div class="empty-state">No losers today</div>';
}

// ════════════════════════════════════════════════════════════════════════════
// STOCK TABLE
// ════════════════════════════════════════════════════════════════════════════
let tableData = [];
function renderStockTable() {
  tableData = State.stocks.map(s => {
    const change = s.ltp - s.prevClose;
    const pct = (change / s.prevClose * 100);
    const analysis = State.analyses ? State.analyses.find(a => a.stock.symbol === s.symbol) : null;
    const signal = analysis ? analysis.result.signal : '…';
    return { ...s, change, pct, signal };
  });
  applyTableFilters();
}

function applyTableFilters() {
  const sectorVal = document.getElementById('sector-filter')?.value || 'all';
  const sortVal   = document.getElementById('sort-filter')?.value  || 'change_pct_desc';

  let filtered = [...tableData];
  if (sectorVal !== 'all') filtered = filtered.filter(s => s.sector === sectorVal);

  // BUG FIX: removed dead-code sort destructure (sortKey/sortDir were
  // computed but never used — the comparator below reads sortVal directly).
  filtered.sort((a, b) => {
    let av, bv;
    if (sortVal.startsWith('change')) { av = a.pct; bv = b.pct; }
    else if (sortVal.startsWith('ltp'))   { av = a.ltp; bv = b.ltp; }
    else if (sortVal.startsWith('volume')){ av = a.volume; bv = b.volume; }
    else { av = a.pct; bv = b.pct; }
    return sortVal.endsWith('asc') ? av - bv : bv - av;
  });

  const tbody = document.getElementById('stock-table-body');
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-state" style="padding:2.5rem 1rem">No stocks match the selected sector.</td></tr>';
    return;
  }
  tbody.innerHTML = filtered.map(s => {
    const isUp = s.change >= 0;
    const sigClass = s.signal === 'BUY' ? 'buy' : s.signal === 'SELL' ? 'sell' : 'hold';
    const turnover = s.ltp * s.volume;
    return `
      <tr id="row-${s.symbol}" onclick="openStockModal('${s.symbol}')">
        <td class="td-symbol">${s.symbol}</td>
        <td class="td-company">${s.name}</td>
        <td class="td-sector">${s.sector}</td>
        <td class="td-ltp">${s.ltp.toFixed(2)}</td>
        <td class="td-change ${isUp ? 'green' : 'red'}">${isUp ? '+' : ''}${s.change.toFixed(2)} (${s.pct.toFixed(2)}%)</td>
        <td class="td-volume">${formatNumber(s.volume)}</td>
        <td class="td-turnover">${formatCurrency(turnover)}</td>
        <td><span class="signal-tag ${sigClass}">${s.signal}</span></td>
        <td><button class="action-btn" onclick="event.stopPropagation();openStockModal('${s.symbol}')">Analyze</button></td>
      </tr>`;
  }).join('');
}

function filterTable() { applyTableFilters(); }
function filterBySector(sec) {
  switchTab('stocks');
  const sel = document.getElementById('sector-filter');
  if (sel) sel.value = sec;
  applyTableFilters();
}

// ════════════════════════════════════════════════════════════════════════════
// AI PREDICTIONS TAB
// ════════════════════════════════════════════════════════════════════════════
function renderPredictionsGrid() {
  if (!State.analyses) return;
  const grid = document.getElementById('predictions-grid');

  // BUG FIX: removed the unused `cards` block — it built ~40 lines of card
  // HTML that was immediately discarded; the sorted render below is the one
  // actually used.
  // Sort BUY first, then HOLD, then SELL
  const buyCards  = State.analyses.filter(a => a.result.signal === 'BUY')
    .sort((a,b) => b.result.confidence - a.result.confidence);
  const holdCards = State.analyses.filter(a => a.result.signal === 'HOLD');
  const sellCards = State.analyses.filter(a => a.result.signal === 'SELL')
    .sort((a,b) => b.result.confidence - a.result.confidence);

  const sortedAnalyses = [...buyCards, ...holdCards, ...sellCards];

  grid.innerHTML = sortedAnalyses.map(({ stock, result }) => {
    const sigClass = result.signal === 'BUY' ? 'buy' : result.signal === 'SELL' ? 'sell' : 'hold';
    const cardClass = result.signal === 'BUY' ? 'buy-card' : result.signal === 'SELL' ? 'sell-card' : 'hold-card';
    const indChips = result.signals.slice(0, 4).map(s => `
      <span class="ind-chip ${s.bias}">${s.ind}: ${s.value}</span>`).join('');

    return `
      <div class="pred-card ${cardClass}" onclick="openStockModal('${stock.symbol}')">
        <div class="pred-header">
          <div class="pred-sym-block">
            <div class="pred-symbol">${stock.symbol}</div>
            <div class="pred-company">${stock.name.length > 32 ? stock.name.slice(0,32)+'…' : stock.name}</div>
          </div>
          <div class="pred-signal-block">
            <span class="signal-tag ${sigClass}">${result.signal}</span>
            <div class="pred-confidence">${result.confidence}% confidence</div>
          </div>
        </div>
        <div class="pred-prices">
          <div class="pred-price-item">
            <div class="pred-price-label">Current (LTP)</div>
            <div class="pred-price-value">Rs.${stock.ltp.toFixed(0)}</div>
          </div>
          <div class="pred-price-item">
            <div class="pred-price-label">4D Low Est.</div>
            <div class="pred-price-value" style="color:${result.signal==='BUY'?'var(--green)':'var(--red)'}">Rs.${result.targetLow.toFixed(0)}</div>
          </div>
          <div class="pred-price-item">
            <div class="pred-price-label">4D High Est.</div>
            <div class="pred-price-value" style="color:${result.signal==='SELL'?'var(--red)':'var(--green)'}">Rs.${result.targetHigh.toFixed(0)}</div>
          </div>
        </div>
        <div class="pred-indicators">${indChips}</div>
        <div class="pred-reasoning">${result.reasoning}</div>
      </div>`;
  }).join('');
}

// ════════════════════════════════════════════════════════════════════════════
// MARKET AI ANALYSIS
// ════════════════════════════════════════════════════════════════════════════
function runMarketAI() {
  const btn = document.getElementById('ai-refresh-btn');
  if (btn) { btn.textContent = '↻ Analyzing…'; btn.style.opacity = '0.6'; }

  setTimeout(() => {
    const ma = TechnicalAnalysis.analyzeMarket(State.stocks, State.indexHistory);
    State.marketAnalysis = ma;

    const sigColor = ma.marketSignal === 'BULLISH' ? 'green' :
                     ma.marketSignal === 'BEARISH' ? 'red' : 'gold';
    const sigEmoji = ma.marketSignal === 'BULLISH' ? '🟢' :
                     ma.marketSignal === 'BEARISH' ? '🔴' : '🟡';

    const topBuyHTML = ma.topBuys.map(a => `
      <div class="ai-stock-row">
        <span class="signal-tag buy" style="flex-shrink:0">BUY</span>
        <span style="font-family:var(--font-mono);color:var(--gold);font-weight:700">${a.stock.symbol}</span>
        <span style="font-size:0.78rem;color:var(--text-muted);flex:1">${a.stock.name.slice(0,30)}</span>
        <span style="font-family:var(--font-mono);font-size:0.8rem;color:var(--green)">${a.result.confidence}% conf</span>
        <span style="font-family:var(--font-mono);font-size:0.78rem;color:var(--text-muted)">Target: Rs.${a.result.targetHigh}</span>
      </div>`).join('');

    const topSellHTML = ma.topSells.map(a => `
      <div class="ai-stock-row">
        <span class="signal-tag sell" style="flex-shrink:0">SELL</span>
        <span style="font-family:var(--font-mono);color:var(--gold);font-weight:700">${a.stock.symbol}</span>
        <span style="font-size:0.78rem;color:var(--text-muted);flex:1">${a.stock.name.slice(0,30)}</span>
        <span style="font-family:var(--font-mono);font-size:0.8rem;color:var(--red)">${a.result.confidence}% conf</span>
      </div>`).join('');

    const output = `
      <div class="ai-market-grid">
        <div class="ai-market-card ${ma.marketSignal.toLowerCase()}">
          <div class="amc-label">Market Outlook</div>
          <div class="amc-value ${sigColor}">${sigEmoji} ${ma.marketSignal}</div>
          <div class="amc-sub">Next 3–4 trading days</div>
        </div>
        <div class="ai-market-card">
          <div class="amc-label">Bullish Stocks</div>
          <div class="amc-value green">${ma.buyCount} / ${State.stocks.length}</div>
          <div class="amc-sub">${ma.bullPct}% showing buy signals</div>
        </div>
        <div class="ai-market-card">
          <div class="amc-label">Bearish Stocks</div>
          <div class="amc-value red">${ma.sellCount} / ${State.stocks.length}</div>
          <div class="amc-sub">${ma.bearPct}% showing sell signals</div>
        </div>
      </div>
      <div class="ai-reasoning">
        Market breadth shows <strong>${ma.bullPct}%</strong> bullish vs <strong>${ma.bearPct}%</strong> bearish signals
        across the top 50 NEPSE stocks. Index momentum is <strong>${ma.indexMomentum}</strong>.
        ${ma.marketSignal === 'BULLISH'
          ? 'The overall technical setup favors <strong>upward movement</strong> in the near term. Consider accumulating positions in high-confidence BUY stocks.'
          : ma.marketSignal === 'BEARISH'
          ? 'The overall setup shows <strong>selling pressure</strong>. Consider reducing exposure and setting stop-losses. Wait for reversal confirmation.'
          : 'Mixed signals — <strong>wait for clearer direction</strong>. Focus on stock-specific opportunities rather than broad market bets.'}
      </div>
      <div class="ai-stocks-outlook">
        <div style="font-size:0.78rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;margin:1rem 0 0.5rem">
          🟢 Top BUY Picks (Next 3–4 Days)
        </div>
        ${topBuyHTML || '<div class="empty-state" style="padding:0.5rem">No strong buy signals</div>'}
        ${ma.topSells.length ? `
        <div style="font-size:0.78rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;margin:1rem 0 0.5rem">
          🔴 Stocks to Avoid / Consider Selling
        </div>
        ${topSellHTML}` : ''}
      </div>`;

    document.getElementById('ai-market-output').innerHTML = output;
    if (btn) { btn.textContent = '↻ Analyze'; btn.style.opacity = '1'; }
  }, 800);
}

// ════════════════════════════════════════════════════════════════════════════
// STOCK MODAL
// ════════════════════════════════════════════════════════════════════════════
function openStockModal(symbol) {
  const stock = State.stocks.find(s => s.symbol === symbol);
  if (!stock) return;
  State.currentModalStock = stock;

  const change = stock.ltp - stock.prevClose;
  const pct = (change / stock.prevClose * 100);
  const isUp = change >= 0;

  document.getElementById('modal-symbol').textContent  = stock.symbol;
  document.getElementById('modal-company').textContent = stock.name;
  document.getElementById('modal-ltp').textContent     = `Rs.${stock.ltp.toFixed(2)}`;
  document.getElementById('modal-ltp').style.color     = isUp ? 'var(--green)' : 'var(--red)';
  document.getElementById('modal-change').textContent  = `${isUp ? '+' : ''}${change.toFixed(2)} (${pct.toFixed(2)}%)`;
  document.getElementById('modal-change').style.color  = isUp ? 'var(--green)' : 'var(--red)';

  // Generate/get price history
  const { prices, volumes } = TechnicalAnalysis.generatePriceHistory(stock, 60);

  // Run analysis
  const result = TechnicalAnalysis.analyzeStock(stock, prices, volumes);

  // Chart
  setTimeout(() => initModalChart(prices, symbol), 50);

  // Indicators panel
  const inds = [
    { label: 'RSI (14)', value: result.rsi?.toFixed(1) || '--', signal: result.rsi < 30 ? 'Oversold ↗' : result.rsi > 70 ? 'Overbought ↘' : 'Neutral', bias: result.rsi < 30 ? 'bullish' : result.rsi > 70 ? 'bearish' : 'neutral' },
    { label: 'MACD', value: result.macd?.macd?.toFixed(2) || '--', signal: result.macd?.crossover === 'bullish' ? 'Bull Cross ↗' : result.macd?.crossover === 'bearish' ? 'Bear Cross ↘' : result.macd?.histogram > 0 ? 'Positive' : 'Negative', bias: result.macd?.histogram > 0 ? 'bullish' : 'bearish' },
    { label: 'EMA 9', value: result.ema9?.toFixed(2) || '--', signal: result.ema9 > result.ema21 ? 'Above EMA 21 ↗' : 'Below EMA 21 ↘', bias: result.ema9 > result.ema21 ? 'bullish' : 'bearish' },
    { label: 'EMA 21', value: result.ema21?.toFixed(2) || '--', signal: stock.ltp > result.ema21 ? 'Price above' : 'Price below', bias: stock.ltp > result.ema21 ? 'bullish' : 'bearish' },
    { label: 'EMA 50', value: result.ema50?.toFixed(2) || '--', signal: stock.ltp > result.ema50 ? 'Uptrend' : 'Downtrend', bias: stock.ltp > result.ema50 ? 'bullish' : 'bearish' },
    { label: 'BB %B', value: result.bollingerBands ? result.bollingerBands.pctB + '%' : '--', signal: result.bollingerBands?.pctB < 20 ? 'Near Lower Band' : result.bollingerBands?.pctB > 80 ? 'Near Upper Band' : 'Mid-band', bias: result.bollingerBands?.pctB < 30 ? 'bullish' : result.bollingerBands?.pctB > 70 ? 'bearish' : 'neutral' },
    { label: 'Support', value: `Rs.${result.support}`, signal: `Floor level`, bias: 'neutral' },
    { label: 'Resistance', value: `Rs.${result.resistance}`, signal: `Ceiling level`, bias: 'neutral' },
  ];

  document.getElementById('modal-indicators').innerHTML = inds.map(ind => `
    <div class="ind-block">
      <div class="ind-block-label">${ind.label}</div>
      <div class="ind-block-value ${ind.bias === 'bullish' ? 'green' : ind.bias === 'bearish' ? 'red' : ''}">${ind.value}</div>
      <div class="ind-block-signal ${ind.bias === 'bullish' ? 'green' : ind.bias === 'bearish' ? 'red' : 'muted'}">${ind.signal}</div>
    </div>`).join('');

  // AI card
  const sigClass = result.signal === 'BUY' ? 'buy' : result.signal === 'SELL' ? 'sell' : 'hold';
  document.getElementById('modal-ai-card').innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.75rem">
      <div style="display:flex;align-items:center;gap:0.6rem">
        <span class="ai-chip">AI</span>
        <span style="font-weight:600">3–4 Day Prediction</span>
      </div>
      <div style="display:flex;align-items:center;gap:0.75rem">
        <span class="signal-tag ${sigClass}">${result.signal}</span>
        <span style="font-size:0.78rem;color:var(--text-muted)">${result.confidence}% confidence</span>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;margin-bottom:0.75rem">
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:0.65rem;text-align:center">
        <div style="font-size:0.6rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.06em">4-Day Low Est.</div>
        <div style="font-family:var(--font-mono);font-size:1rem;font-weight:700;color:var(--red);margin-top:0.2rem">Rs.${result.targetLow.toFixed(0)}</div>
      </div>
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:0.65rem;text-align:center">
        <div style="font-size:0.6rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.06em">4-Day High Est.</div>
        <div style="font-family:var(--font-mono);font-size:1rem;font-weight:700;color:var(--green);margin-top:0.2rem">Rs.${result.targetHigh.toFixed(0)}</div>
      </div>
    </div>
    <div style="font-size:0.8rem;color:var(--text-muted);line-height:1.7">${result.reasoning}</div>`;

  document.getElementById('modal-overlay').classList.add('show');
}

function closeStockModal() {
  document.getElementById('modal-overlay').classList.remove('show');
}
function closeModal(e) {
  if (e.target === document.getElementById('modal-overlay')) closeStockModal();
}

// ════════════════════════════════════════════════════════════════════════════
// SEARCH
// ════════════════════════════════════════════════════════════════════════════
function searchStock(query) {
  const resultsEl = document.getElementById('search-results');
  if (!query || query.length < 1) { resultsEl.classList.remove('show'); return; }
  const q = query.toUpperCase();
  const matches = State.stocks.filter(s => s.symbol.includes(q) || s.name.toUpperCase().includes(q)).slice(0, 8);
  if (!matches.length) { resultsEl.classList.remove('show'); return; }
  resultsEl.innerHTML = matches.map(s => {
    const change = s.ltp - s.prevClose;
    const pct = (change / s.prevClose * 100).toFixed(2);
    const isUp = change >= 0;
    return `
      <div class="search-result-item" onclick="openStockModal('${s.symbol}');document.getElementById('search-results').classList.remove('show');document.getElementById('stock-search').value=''">
        <div>
          <div class="search-result-sym">${s.symbol}</div>
          <div class="search-result-name">${s.name.slice(0,30)}</div>
        </div>
        <span class="${isUp ? 'green' : 'red'}" style="font-family:var(--font-mono);font-size:0.78rem">${isUp?'+':''}${pct}%</span>
      </div>`;
  }).join('');
  resultsEl.classList.add('show');
}

document.addEventListener('click', e => {
  if (!e.target.closest('.search-box')) {
    document.getElementById('search-results').classList.remove('show');
  }
});

// ════════════════════════════════════════════════════════════════════════════
// ALERTS
// ════════════════════════════════════════════════════════════════════════════
function addAlert() {
  const sym   = document.getElementById('alert-symbol').value.trim().toUpperCase();
  const type  = document.getElementById('alert-type').value;
  const price = parseFloat(document.getElementById('alert-price').value);

  if (!sym || !Number.isFinite(price) || price <= 0 || !['above', 'below'].includes(type)) {
    alert('Please fill in all fields.'); return;
  }
  const stock = State.stocks.find(s => s.symbol === sym);
  if (!stock) { alert(`Symbol "${sym}" not found in our database.`); return; }

  if (State.alerts.length >= 100) { alert('You can save up to 100 alerts.'); return; }
  State.alerts.push({ id: Date.now(), symbol: sym, type, price, created: new Date().toISOString() });
  saveAlerts();
  renderAlerts();
  document.getElementById('alert-symbol').value = '';
  document.getElementById('alert-price').value = '';
}

function deleteAlert(id) {
  State.alerts = State.alerts.filter(a => a.id !== id);
  saveAlerts();
  renderAlerts();
}

/** Persist the current alert list and report browser storage failures. */
function saveAlerts() {
  try {
    localStorage.setItem('nepse_alerts', JSON.stringify(State.alerts));
  } catch (e) {
    console.warn('Unable to save alerts in this browser.', e);
    alert('Your browser could not save alerts. Check storage settings and try again.');
  }
}

function renderAlerts() {
  const list = document.getElementById('alerts-list');
  if (!State.alerts.length) {
    list.innerHTML = '<div class="empty-state">No alerts set. Add your first alert above.</div>';
    return;
  }
  list.innerHTML = State.alerts.map(a => {
    const stock = State.stocks.find(s => s.symbol === a.symbol);
    const ltp = stock ? stock.ltp : '--';
    return `
      <div class="alert-item">
        <div>
          <div class="alert-sym">${a.symbol}</div>
          <div class="alert-desc">Alert when price goes <strong>${a.type}</strong> Rs.${a.price} &nbsp;|&nbsp; Current: Rs.${typeof ltp === 'number' ? ltp.toFixed(2) : ltp}</div>
        </div>
        <button class="alert-delete" onclick="deleteAlert(${a.id})">🗑</button>
      </div>`;
  }).join('');
}

function checkPriceAlerts() {
  State.alerts.forEach(alert => {
    const stock = State.stocks.find(s => s.symbol === alert.symbol);
    if (!stock) return;
    const triggered = alert.type === 'above'
      ? stock.ltp >= alert.price
      : stock.ltp <= alert.price;
    if (triggered && !alert.fired) {
      alert.fired = true;
      showNotification(
        `⚡ Price Alert: ${alert.symbol}`,
        `${alert.symbol} is now Rs.${stock.ltp.toFixed(2)} — ${alert.type === 'above' ? 'above' : 'below'} your target of Rs.${alert.price}`
      );
    }
  });
}

function requestNotifyPermission() {
  if ('Notification' in window) {
    Notification.requestPermission().then(p => {
      alert(`Notification permission: ${p}`);
    });
  } else {
    alert('Your browser does not support notifications.');
  }
}

function showNotification(title, body) {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, { body, icon: '' });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// TAB NAVIGATION
// ════════════════════════════════════════════════════════════════════════════
function switchTab(tab) {
  State.activeTab = tab;
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`tab-${tab}`).classList.add('active');
  document.getElementById(`nav-${tab}`).classList.add('active');
}

// ════════════════════════════════════════════════════════════════════════════
// UTILITIES
// ════════════════════════════════════════════════════════════════════════════
function formatNumber(n) {
  if (n >= 1e7) return (n / 1e7).toFixed(2) + 'Cr';
  if (n >= 1e5) return (n / 1e5).toFixed(2) + 'L';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toString();
}

function formatCurrency(n) {
  if (n >= 1e9) return 'Rs.' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e7) return 'Rs.' + (n / 1e7).toFixed(2) + 'Cr';
  if (n >= 1e5) return 'Rs.' + (n / 1e5).toFixed(2) + 'L';
  return 'Rs.' + n.toFixed(0);
}

// ════════════════════════════════════════════════════════════════════════════
// INITIALIZE
// ════════════════════════════════════════════════════════════════════════════
async function init() {
  // Set initial NEPSE index from history
  const lastEntry = State.indexHistory[State.indexHistory.length - 1];
  const prevEntry = State.indexHistory[State.indexHistory.length - 2];
  if (lastEntry && prevEntry) {
    const change = lastEntry.value - prevEntry.value;
    const pct = (change / prevEntry.value) * 100;
    State.nepseIndex = { value: lastEntry.value, change, pct };
  }

  // Compute stock changes based on seed data
  State.stocks.forEach(stock => {
    stock.change = stock.ltp - stock.prevClose;
    stock.changePct = (stock.change / stock.prevClose) * 100;
  });

  renderNepseIndex();
  renderSectorHeatmap();
  renderTopMovers();

  // Run AI analysis on all stocks
  State.analyses = State.stocks.map(stock => ({
    stock,
    result: TechnicalAnalysis.analyzeStock(stock)
  }));

  renderStockTable();
  renderPredictionsGrid();
  renderAlerts();
  initNepseChart();

  // Start clock
  tickClock();
  setInterval(tickClock, 1000);

  // Fetch live data
  await fetchLiveData();

  // Poll the exchange-backed API every five seconds. The server shares each
  // upstream result across clients for the same five-second cache window.
  setInterval(async () => {
    await fetchLiveData();
    // Re-run AI every 5 minutes
    if (Date.now() % 300000 < 65000) {
      State.analyses = State.stocks.map(stock => ({
        stock,
        result: TechnicalAnalysis.analyzeStock(stock)
      }));
      renderStockTable();
      renderPredictionsGrid();
    }
  }, 5000);

  // Hide loading overlay
  setTimeout(() => {
    document.getElementById('loading-overlay').classList.add('hidden');
  }, 1200);
}

// Start when DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
