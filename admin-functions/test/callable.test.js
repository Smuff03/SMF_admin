// Exercises the real adminMutate callable (index.js) against a fake Firestore.
// This verifies the auth gate, collection-path mapping, read-before-write queuing and error mapping.
// It does NOT replace testing against the Firestore emulator / a deployed project.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

const docs = new Map(); // "path/id" -> data
let autoId = 0;
const fakeDb = {
  settings() {},
  collection: (c) => ({ doc: (id = `gen${++autoId}`) => ({ path: `${c}/${id}`, id }) }),
  async runTransaction(fn) {
    const pending = [];
    const t = {
      get: async (ref) => ({ exists: docs.has(ref.path), data: () => structuredClone(docs.get(ref.path)) }),
      set: (ref, data, opts) => pending.push(() => docs.set(ref.path, opts?.merge ? { ...docs.get(ref.path), ...data } : data)),
      delete: (ref) => pending.push(() => docs.delete(ref.path)),
    };
    const out = await fn(t);
    pending.forEach((p) => p());
    return out;
  },
};
mock.module('firebase-admin/app', { namedExports: { initializeApp: () => ({}) } });
mock.module('firebase-admin/firestore', { namedExports: { getFirestore: () => fakeDb } });
const files = new Map(); // storage path -> { buf, options }
const fakeBucket = {
  name: 'smfoods-8eb21.firebasestorage.app',
  file: (path) => ({
    save: async (buf, options) => { files.set(path, { buf, options }); },
    delete: async () => { files.delete(path); },
  }),
};
mock.module('firebase-admin/storage', { namedExports: { getStorage: () => ({ bucket: () => fakeBucket }) } });

const { adminMutate, adminImage } = await import('../src/index.js');
const admin = { uid: 'u1', token: { role: 'admin', email: 'boss@tmfoods.in' } };
const call = (auth, data) => adminMutate.run({ auth, data, rawRequest: {} });

test('rejects anonymous and non-admin callers before touching data', async () => {
  await assert.rejects(call(null, { resource: 'orders', action: 'create', data: {} }), (e) => e.code === 'unauthenticated');
  await assert.rejects(call({ uid: 'c1', token: { role: 'wholesaler' } }, { resource: 'orders', action: 'create', data: {} }), (e) => e.code === 'permission-denied');
  await assert.rejects(call({ uid: 'c2', token: {} }, { resource: 'orders', action: 'create', data: {} }), (e) => e.code === 'permission-denied');
  assert.equal(docs.size, 0);
});

test('admin create writes to adminOrders (not the storefront orders collection) with audit + counter', async () => {
  const r = await call(admin, { resource: 'orders', action: 'create', data: { customer: 'Maya', type: 'Wholesale', amount: 1500 } });
  assert.equal(r.id, 'TMF-1001');
  assert.ok(docs.has('adminOrders/TMF-1001'));
  assert.ok(![...docs.keys()].some((k) => k.startsWith('orders/')));
  assert.equal(docs.get('meta/counters').orders, 1001);
  const audit = [...docs.entries()].find(([k]) => k.startsWith('audit-logs/'))[1];
  assert.equal(audit.user, 'boss@tmfoods.in');
});

test('stock flow end to end through the callable', async () => {
  const { id } = await call(admin, { resource: 'products', action: 'create', data: { name: 'Poha Chivda', category: 'Chivda', stock: 10 } });
  assert.ok(docs.has(`adminProducts/${id}`));
  await call(admin, { resource: 'inventory', action: 'create', data: { productId: id, type: 'Stock out', quantity: 4 } });
  assert.equal(docs.get(`adminProducts/${id}`).stock, 6);
  await assert.rejects(call(admin, { resource: 'inventory', action: 'create', data: { productId: id, type: 'Stock out', quantity: 7 } }), (e) => e.code === 'invalid-argument' && /Only 6 units/.test(e.message));
  assert.equal(docs.get(`adminProducts/${id}`).stock, 6);
});

test('validation and not-found errors map to HttpsError codes; unexpected errors are not leaked', async () => {
  await assert.rejects(call(admin, { resource: 'orders', action: 'create', data: { type: 'Retail', amount: 1 } }), (e) => e.code === 'invalid-argument' && /Customer is required/.test(e.message));
  await assert.rejects(call(admin, { resource: 'orders', action: 'update', id: 'TMF-9999', data: { status: 'Pending' } }), (e) => e.code === 'not-found');
  const orig = fakeDb.runTransaction;
  fakeDb.runTransaction = async () => { throw new Error('secret internal detail'); };
  await assert.rejects(call(admin, { resource: 'orders', action: 'create', data: {} }), (e) => e.code === 'internal' && !/secret/.test(e.message));
  fakeDb.runTransaction = orig;
});

const imageCall = (auth, data) => adminImage.run({ auth, data, rawRequest: {} });
const PNG = Buffer.from('iVBORw0KGgo=', 'base64').toString('base64');

test('adminImage: admin-only, stores under products/ and returns a token URL; delete only touches products/', async () => {
  await assert.rejects(imageCall(null, { action: 'upload', contentType: 'image/png', data: PNG }), (e) => e.code === 'unauthenticated');
  await assert.rejects(imageCall({ uid: 'c1', token: { role: 'wholesaler' } }, { action: 'upload', contentType: 'image/png', data: PNG }), (e) => e.code === 'permission-denied');
  await assert.rejects(imageCall(admin, { action: 'upload', contentType: 'text/html', data: PNG }), (e) => e.code === 'invalid-argument');
  await assert.rejects(imageCall(admin, { action: 'upload', contentType: 'image/png', data: '' }), (e) => e.code === 'invalid-argument');

  const r = await imageCall(admin, { action: 'upload', contentType: 'image/png', data: PNG });
  assert.match(r.path, /^products\/[\w-]+\.png$/);
  assert.ok(r.url.startsWith('https://firebasestorage.googleapis.com/v0/b/smfoods-8eb21.firebasestorage.app/o/products%2F'));
  assert.ok(r.url.includes('alt=media&token='));
  assert.ok(files.has(r.path));

  files.set('other/keep.txt', {});
  await imageCall(admin, { action: 'delete', paths: [r.path, 'other/keep.txt', '../x'] });
  assert.ok(!files.has(r.path));
  assert.ok(files.has('other/keep.txt'));
});
