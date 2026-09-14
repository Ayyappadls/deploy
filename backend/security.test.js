const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const frontendSrc = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

test('security: frontend never references api.anthropic.com', () => {
  assert.ok(!frontendSrc.includes('api.anthropic.com'));
});

test('security: frontend never references ANTHROPIC_API_KEY or a plausible key string', () => {
  assert.ok(!frontendSrc.includes('ANTHROPIC_API_KEY'));
  assert.ok(!/sk-ant-[a-zA-Z0-9]/.test(frontendSrc));
});

test('security: frontend\'s only network calls are to its own backend (/api/reason, /api/mirror)', () => {
  const fetchCalls = [...frontendSrc.matchAll(/fetch\(\s*['"`]([^'"`]+)/g)].map((m) => m[1]);
  assert.ok(fetchCalls.length > 0, 'expected at least one fetch call in the frontend');
  fetchCalls.forEach((url) => {
    assert.ok(url.startsWith('/api/reason') || url.startsWith('/api/mirror'), `unexpected network target: ${url}`);
  });
});

test('security: only server.js reads process.env.ANTHROPIC_API_KEY directly (comments mentioning the name elsewhere are fine)', () => {
  const backendDir = __dirname;
  const offenders = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'data' || entry.name === 'test') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith('.js') || entry.name.endsWith('.test.js')) continue;
      const content = fs.readFileSync(full, 'utf8');
      if (content.includes('process.env.ANTHROPIC_API_KEY') && entry.name !== 'server.js') {
        offenders.push(full);
      }
    }
  }
  walk(backendDir);
  assert.deepEqual(offenders, [], `only server.js should read process.env.ANTHROPIC_API_KEY directly; also found in: ${offenders.join(', ')}`);
});
