const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { MirrorStore } = require('./store');

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dlsmirror-test-'));
  return new MirrorStore({ dataDir: dir });
}

test('MirrorStore: createBusiness returns distinct businessId and mirrorId', () => {
  const store = tempStore();
  const a = store.createBusiness();
  const b = store.createBusiness();
  assert.ok(a.businessId.startsWith('biz_'));
  assert.ok(a.mirrorId.startsWith('mirror_'));
  assert.notEqual(a.businessId, b.businessId, 'two businesses must never collide');
});

test('MirrorStore: save then get returns the same state (real disk round-trip)', () => {
  const store = tempStore();
  const { businessId } = store.createBusiness();
  const fakeState = { evidence: [{ id: 'ev_1', statement: 'sales are healthy' }], signals: [] };
  store.save(businessId, fakeState);
  const record = store.get(businessId);
  assert.deepEqual(record.state, fakeState);
});

test('MirrorStore: state survives a fresh MirrorStore instance pointed at the same directory (simulates a server restart)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dlsmirror-test-'));
  const storeA = new MirrorStore({ dataDir: dir });
  const { businessId } = storeA.createBusiness();
  storeA.save(businessId, { evidence: ['persisted across restart'] });

  const storeB = new MirrorStore({ dataDir: dir }); // fresh instance, same disk location
  const record = storeB.get(businessId);
  assert.deepEqual(record.state, { evidence: ['persisted across restart'] });
});

test('MirrorStore: get() on an unknown businessId returns null, never throws', () => {
  const store = tempStore();
  assert.equal(store.get('biz_does_not_exist'), null);
});

test('MirrorStore: save() on an unknown businessId returns null (no silent creation)', () => {
  const store = tempStore();
  assert.equal(store.save('biz_does_not_exist', { x: 1 }), null);
});

test('MirrorStore: businessId is sanitized against path traversal', () => {
  const store = tempStore();
  const malicious = '../../etc/passwd';
  assert.equal(store.get(malicious), null);
  assert.equal(store.save(malicious, { x: 1 }), null);
});
