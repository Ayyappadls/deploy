const test = require('node:test');
const assert = require('node:assert/strict');
const { createRateLimiter } = require('./rateLimiter');

test('rateLimiter: allows up to max requests within the window', () => {
  const limit = createRateLimiter({ windowMs: 60000, max: 3 });
  assert.equal(limit('ip1').limited, false);
  assert.equal(limit('ip1').limited, false);
  assert.equal(limit('ip1').limited, false);
});

test('rateLimiter: blocks the request after max is exceeded', () => {
  const limit = createRateLimiter({ windowMs: 60000, max: 2 });
  limit('ip2'); limit('ip2');
  const third = limit('ip2');
  assert.equal(third.limited, true);
  assert.ok(third.retryAfterMs > 0);
});

test('rateLimiter: different IPs are tracked independently', () => {
  const limit = createRateLimiter({ windowMs: 60000, max: 1 });
  assert.equal(limit('ipA').limited, false);
  assert.equal(limit('ipB').limited, false, 'a different IP must not be penalized by ipA\'s usage');
  assert.equal(limit('ipA').limited, true);
});

test('rateLimiter: window resets after windowMs elapses', async () => {
  const limit = createRateLimiter({ windowMs: 50, max: 1 });
  assert.equal(limit('ip3').limited, false);
  assert.equal(limit('ip3').limited, true);
  await new Promise((r) => setTimeout(r, 70));
  assert.equal(limit('ip3').limited, false, 'a new window should allow requests again');
});
