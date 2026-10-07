/**
 * Validation for the index.html screener-filter fix.
 * - Parses public/index.html with cheerio
 * - Loads public/data.js to get NEPSE_STOCKS / SECTOR_LIST
 * - Asserts: dropdown covers SECTOR_LIST + all data sectors, no dup values,
 *   selects have accessible names, filter simulation behaves correctly.
 */
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const vm = require('vm');

const root = path.join(__dirname, '..');
let failures = 0;

function check(name, cond, detail) {
  if (cond) { console.log('  PASS  ' + name); }
  else { failures++; console.log('  FAIL  ' + name + (detail ? ' -> ' + detail : '')); }
}

const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const $ = cheerio.load(html);

// Load data.js in a sandbox to access NEPSE_STOCKS / SECTOR_LIST
// (const declarations are script-scoped in a vm context, so export them explicitly)
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(
  fs.readFileSync(path.join(root, 'public', 'data.js'), 'utf8') +
  '\nthis.__exports = { NEPSE_STOCKS, SECTOR_LIST };',
  sandbox
);
const { NEPSE_STOCKS, SECTOR_LIST } = sandbox.__exports;

// ── BUG-FIX REGRESSION CHECKS ──────────────────────────────────────────────
// Guards: (1) data.js NEPSE-weekend fix, (2) analysis.js single-history fix
// 1) data.js weekend fix: no generated date may fall on Friday/Saturday
//    (NEPSE weekend), and Sundays must be present (trading day).
const isoDay = ds => new Date(ds + 'T00:00:00Z').getUTCDay();
const hist = (() => {
  const sb2 = {}; vm.createContext(sb2);
  vm.runInContext(
    fs.readFileSync(path.join(root, 'public', 'data.js'), 'utf8') +
    '\nthis.__h = generateNepseHistory(130);',
    sb2
  );
  return sb2.__h;
})();
const weekendDates = hist.filter(h => [5, 6].includes(isoDay(h.date))).map(h => h.date);
check('history: zero Friday/Saturday dates (NEPSE weekend fix)', weekendDates.length === 0, weekendDates.slice(0, 3).join(','));
check('history: contains Sunday trading dates', hist.some(h => isoDay(h.date) === 0));

// 2) analysis.js fix: price & volume series must come from the SAME
//    generated history (no double generatePriceHistory call).
{
  const sb3 = {}; vm.createContext(sb3);
  vm.runInContext(
    fs.readFileSync(path.join(root, 'public', 'analysis.js'), 'utf8') +
    '\nthis.__ta = TechnicalAnalysis;',
    sb3
  );
  const ta = sb3.__ta;
  const stock = NEPSE_STOCKS[0];
  const a = ta.analyzeStock(stock);
  check('analyzeStock: returns priceHistory + volumeHistory',
    Array.isArray(a.priceHistory) && a.priceHistory.length > 0 &&
    Array.isArray(a.volumeHistory) && a.volumeHistory.length === a.priceHistory.length);

  // Supplying a fixed series must be echoed back verbatim. The old test read
  // a.prices / a.volumes (always undefined) and compared undefined === undefined.
  const fixedPrices = Array.from({ length: 61 }, (_, i) => 100 + i);
  const fixedVolumes = Array.from({ length: 61 }, (_, i) => 1000 + i * 10);
  const b = ta.analyzeStock(stock, fixedPrices, fixedVolumes);
  check('analyzeStock: supplied price/volume history is used unchanged (consistency)',
    JSON.stringify(b.priceHistory) === JSON.stringify(fixedPrices) &&
    JSON.stringify(b.volumeHistory) === JSON.stringify(fixedVolumes));
  check('analyzeStock: returns a valid signal', ['BUY', 'SELL', 'HOLD'].includes(a.signal), String(a.signal));

  // buildReasoning used to compare a stringified percentage, so a flat stock
  // rendered "has gained 0.00%".
  const flat = ta.analyzeStock({ ...stock, ltp: stock.prevClose });
  check('flat stock: reasoning says unchanged, not "gained 0.00%"',
    /is unchanged today/.test(flat.reasoning) && !/gained <strong>0\.00%/.test(flat.reasoning),
    flat.reasoning.slice(0, 90));

  // charCodeAt(1) on a 1-char symbol is NaN, which used to poison the trend.
  const oneChar = ta.generatePriceHistory({ symbol: 'A', prevClose: 100, ltp: 105, volume: 1000 }, 30);
  check('generatePriceHistory: single-character symbol stays finite',
    oneChar.prices.length === 31 && oneChar.prices.every(Number.isFinite) && oneChar.volumes.every(Number.isFinite));
}

console.log('== Structure ==');
const sectorSel = $('#sector-filter');
const sortSel = $('#sort-filter');
check('#sector-filter exists', sectorSel.length === 1);
check('#sort-filter exists', sortSel.length === 1);
check('sector-filter has aria-label', (sectorSel.attr('aria-label') || '').length > 0);
check('sort-filter has aria-label', (sortSel.attr('aria-label') || '').length > 0);
check('both call filterTable()', sectorSel.attr('onchange') === 'filterTable()' && sortSel.attr('onchange') === 'filterTable()');

const sectorVals = sectorSel.find('option').map((_, o) => $(o).attr('value')).get();
const hasDup = new Set(sectorVals).size !== sectorVals.length;
check('no duplicate option values', !hasDup, sectorVals.join(','));
check('first option is "all"', sectorVals[0] === 'all');
check('"Others" catch-all stays last', sectorVals[sectorVals.length - 1] === 'Others');

console.log('== Coverage ==');
// Every canonical sector must be selectable (heatmap filterBySector relies on it)
const missingFromSel = SECTOR_LIST.filter(s => !sectorVals.includes(s));
check('dropdown covers every SECTOR_LIST entry', missingFromSel.length === 0, missingFromSel.join(','));

// Every sector used by any stock must be selectable
const dataSectors = [...new Set(NEPSE_STOCKS.map(s => s.sector))];
const missingDataSectors = dataSectors.filter(s => !sectorVals.includes(s));
check('dropdown covers every stock sector', missingDataSectors.length === 0, missingDataSectors.join(','));

// Standard NEPSE sectors that were missing before the fix
['Microfinance', 'Mutual Fund', 'Hotel & Tourism', 'Trading'].forEach(s =>
  check(`new NEPSE sector option present: ${s}`, sectorVals.includes(s)));

console.log('== Filter simulation (mirrors app.js applyTableFilters) ==');
function simulate(sectorVal) {
  let filtered = NEPSE_STOCKS.filter(s => sectorVal === 'all' || s.sector === sectorVal);
  return filtered;
}
// 'all' -> full list
check('all => all stocks', simulate('all').length === NEPSE_STOCKS.length);
// every seed sector returns rows and only that sector's rows
dataSectors.forEach(sec => {
  const rows = simulate(sec);
  check(`filter "${sec}" -> ${rows.length} rows, homogeneous`, rows.length > 0 && rows.every(r => r.sector === sec));
});
// sectors with no seed stocks -> empty-state must trigger
// (BUG FIX: 'Microfinance' was stale here — seed data now contains one
// Microfinance stock, already covered by the dynamic loop above)
['Mutual Fund', 'Hotel & Tourism', 'Trading'].forEach(sec => {
  check(`filter "${sec}" -> 0 rows (empty-state path)`, simulate(sec).length === 0);
});

console.log('== HTML validity spot-checks ==');
check('option entity escaped (Hotel &amp; Tourism)', /value="Hotel &amp; Tourism"/.test(html));
check('no raw unescaped & in sector options', !/value="[^"]*&[^a][^m][^p]"/.test(html.replace(/&amp;/g, '')));
check('select/select pairing intact', $('select').length === 3 && $('select').filter((_, e) => !$(e).find('option').length).length === 0);

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
