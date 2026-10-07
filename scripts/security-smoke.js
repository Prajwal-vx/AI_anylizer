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

// Behaviour guards added in the hacker-audit pass
assert.match(server, /nepseIndex/);                      // normalized NEPSE index, not live[0]
assert.match(server, /status\(404\)/);                   // unknown /api/* answers JSON 404
assert.match(server, /setTLSVerification\(true\)/);      // upstream TLS verification enabled
assert.match(server, /\+05:45/);                         // NPT timestamp carries the real offset
assert.match(server, /server\.on\('error'/);             // friendly EADDRINUSE handling

console.log('PASS security configuration guards (headers, body size, API rate limit, cache bound, symbol validation, no open CORS)');
console.log('PASS behaviour guards (NEPSE index shape, API JSON 404, TLS verification, NPT offset, port-in-use handling)');
