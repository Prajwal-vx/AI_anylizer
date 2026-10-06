const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

assert.match(server, /app\.disable\('x-powered-by'\)/);
assert.match(server, /express\.json\(\{\s*limit:\s*'16kb'\s*\}\)/);
assert.match(server, /Content-Security-Policy/);
assert.match(server, /frame-ancestors 'none'/);
assert.match(server, /maxKeys:\s*1000/);
assert.match(server, /app\.use\('\/api',\s*\(req, res, next\)/);
assert.match(server, /API_REQUEST_LIMIT\s*=\s*120/);
assert.match(server, /status\(429\)/);
assert.match(server, /Retry-After/);
assert.match(server, /\^\[A-Z0-9\.\-\]\{1,12\}\$/);
assert.doesNotMatch(server, /app\.use\(cors\(/);

console.log('PASS security configuration guards (headers, body size, API rate limit, cache bound, symbol validation, no open CORS)');
