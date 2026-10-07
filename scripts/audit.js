/** Static cross-file audit: DOM ids, CSS classes, CSS vars, inline handlers. */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

const html = read('public/index.html');
const appJs = read('public/app.js');
const analysisJs = read('public/analysis.js');
const dataJs = read('public/data.js');
const css = read('public/style.css');

let failures = 0;
const check = (name, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (!cond && detail ? ' -> ' + detail : ''));
  if (!cond) failures++;
};

// 1) getElementById targets that are string literals must exist in HTML
const idsInHtml = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
const idRefs = new Set([...appJs.matchAll(/getElementById\(\s*'([^']+)'\s*\)/g)].map(m => m[1]));
const missingIds = [...idRefs].filter(id => !idsInHtml.has(id));
check('all literal getElementById targets exist in HTML', missingIds.length === 0, missingIds.join(', '));

// 2) inline handlers reference defined functions
const handlers = [...html.matchAll(/on(?:click|input|change)="([a-zA-Z_$][\w$]*)\(/g)].map(m => m[1]);
const defined = new Set([...(appJs + analysisJs).matchAll(/function\s+([a-zA-Z_$][\w$]*)/g)].map(m => m[1]));
const undefHandlers = [...new Set(handlers)].filter(h => !defined.has(h));
check('all inline handlers are defined functions', undefHandlers.length === 0, undefHandlers.join(', '));

// 3) CSS classes referenced in HTML/JS exist in stylesheet
const cssClasses = new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map(m => m[1]));
const isClassName = c => /^[a-zA-Z][\w-]*$/.test(c);
const used = new Set();
const collect = src => {
  for (const m of src.matchAll(/class="([^"]+)"/g)) {
    // Drop ${...} interpolations first: their contents (ternaries, quotes,
    // operators) are JS, not class names, and were reported as missing classes.
    m[1].replace(/\$\{[^}]*\}/g, ' ').split(/\s+/).forEach(c => { if (isClassName(c)) used.add(c); });
  }
};
collect(html); collect(appJs); collect(analysisJs); collect(dataJs);
for (const m of appJs.matchAll(/classList\.(?:add|remove|toggle)\(([^)]*)\)/g)) {
  m[1].split(',').forEach(p => {
    const t = p.trim().replace(/['"]/g, '');
    if (isClassName(t)) used.add(t);
  });
}
const missingClasses = [...used].filter(c => !cssClasses.has(c)).sort();
check('all referenced CSS classes are defined', missingClasses.length === 0, missingClasses.join(', '));

// 4) CSS custom properties: every var(--x) has a definition
const definedVars = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]));
const usedVars = new Set([...(css + html + appJs).matchAll(/var\((--[\w-]+)/g)].map(m => m[1]));
const missingVars = [...usedVars].filter(v => !definedVars.has(v)).sort();
check('all CSS custom properties are defined', missingVars.length === 0, missingVars.join(', '));

// 5) duplicate ids in HTML
const allIds = [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
const dupes = [...new Set(allIds.filter((v, i) => allIds.indexOf(v) !== i))];
check('no duplicate element ids', dupes.length === 0, dupes.join(', '));

// 6) template-literal ids used in JS (row-${...}, tab-${...}, nav-${...})
const dynIds = [...appJs.matchAll(/getElementById\(`([^`]+)`\)/g)].map(m => m[1]);
console.log('  INFO  dynamic id patterns: ' + dynIds.join(', '));

console.log(failures === 0 ? '\nAUDIT CLEAN' : `\n${failures} AUDIT FAILURE(S)`);
process.exit(failures ? 1 : 0);
