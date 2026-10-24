import test from 'node:test';
import assert from 'node:assert/strict';
import { Fail, perform } from '../src/logic.js';

/** In-memory store mimicking the adapter in index.js: reads see pre-op state, writes apply on commit. */
function store() {
  const data = {};
  let n = 0;
  const col = (r) => (data[r] ||= {});
  const run = async (req, actor = 'admin@test') => {
    const writes = [];
    const tx = {
      get: async (r, id) => (col(r)[id] ? structuredClone(col(r)[id]) : null),
      set: (r, id, doc) => writes.push(() => { col(r)[id] = structuredClone(doc); }),
      update: (r, id, patch) => writes.push(() => { col(r)[id] = { ...col(r)[id], ...structuredClone(patch) }; }),
      delete: (r, id) => writes.push(() => { delete col(r)[id]; }),
      newId: () => `auto${++n}`,
    };
    const out = await perform({ tx, actor, now: '2026-10-10T10:00:00.000Z' }, req);
    writes.forEach((w) => w());
    return out;
  };
  return { data, run, col };
}
const product = (over = {}) => ({ resource: 'products', action: 'create', data: { name: 'Poha Chivda', category: 'Chivda', stock: 30, ...over } });

test('order ids are sequential and each write is audited with the actor', async () => {
  const s = store();
  const a = await s.run({ resource: 'orders', action: 'create', data: { customer: 'Rohan', type: 'Retail', amount: '500' } });
  const b = await s.run({ resource: 'orders', action: 'create', data: { customer: 'Maya', type: 'Wholesale', amount: 900 } });
  assert.deepEqual([a.id, b.id], ['TMF-1001', 'TMF-1002']);
  assert.equal(s.data.adminOrders, undefined); // logical names only; path mapping lives in index.js
  assert.equal(s.col('orders')['TMF-1001'].status, 'Pending');
  const logs = Object.values(s.col('audit-logs'));
  assert.equal(logs.length, 2);
  assert.equal(logs[0].user, 'admin@test');
  assert.equal(logs[0].detail, 'TMF-1001 for Rohan');
});

test('validation rejects bad input and writes nothing', async () => {
  const s = store();
  await assert.rejects(s.run({ resource: 'orders', action: 'create', data: { customer: '', type: 'Retail', amount: 1 } }), /Customer is required/);
  await assert.rejects(s.run({ resource: 'orders', action: 'create', data: { customer: 'x', type: 'Bogus', amount: 1 } }), /Invalid Type/);
  await assert.rejects(s.run({ resource: 'orders', action: 'create', data: { customer: 'x', type: 'Retail', amount: -5 } }), /at least 0/);
  await assert.rejects(s.run({ resource: 'orders', action: 'create', data: { customer: 'x', type: 'Retail', amount: 'abc' } }), /must be a number/);
  await assert.rejects(s.run({ resource: 'nope', action: 'create', data: {} }), Fail);
  await assert.rejects(s.run({ resource: 'audit-logs', action: 'create', data: {} }), /Unknown resource/);
  assert.equal(Object.keys(s.data).length, 0);
});

test('product SKUs count per category prefix', async () => {
  const s = store();
  await s.run(product());
  await s.run(product({ name: 'Makai Chivda' }));
  await s.run(product({ name: 'Ratlami Sev', category: 'Namkeen' }));
  const skus = Object.values(s.col('products')).map((p) => p.sku).sort();
  assert.deepEqual(skus, ['TMF-CHI-001', 'TMF-CHI-002', 'TMF-NAM-001']);
  const p = Object.values(s.col('products'))[0];
  assert.equal(p.mrp, null);
});

test('inventory moves stock, records balance and rejects overdrawing', async () => {
  const s = store();
  const { id } = await s.run(product());
  await s.run({ resource: 'inventory', action: 'create', data: { productId: id, type: 'Stock in', quantity: 10 } });
  assert.equal(s.col('products')[id].stock, 40);
  await s.run({ resource: 'inventory', action: 'create', data: { productId: id, type: 'Stock out', quantity: 15 } });
  assert.equal(s.col('products')[id].stock, 25);
  await s.run({ resource: 'inventory', action: 'create', data: { productId: id, type: 'Adjustment', quantity: -5 } });
  assert.equal(s.col('products')[id].stock, 20);
  await assert.rejects(s.run({ resource: 'inventory', action: 'create', data: { productId: id, type: 'Stock out', quantity: 21 } }), /Only 20 units/);
  await assert.rejects(s.run({ resource: 'inventory', action: 'create', data: { productId: id, type: 'Stock in', quantity: -1 } }), /greater than 0/);
  await assert.rejects(s.run({ resource: 'inventory', action: 'create', data: { productId: id, type: 'Stock in', quantity: 0 } }), /cannot be 0/);
  await assert.rejects(s.run({ resource: 'inventory', action: 'create', data: { productId: 'ghost', type: 'Stock in', quantity: 1 } }), /Product not found/);
  assert.equal(s.col('products')[id].stock, 20);
  const bal = Object.values(s.col('inventory')).map((m) => m.balance).sort((a, b) => b - a);
  assert.deepEqual(bal, [40, 25, 20]);
  await assert.rejects(s.run({ resource: 'inventory', action: 'update', id: Object.keys(s.col('inventory'))[0], data: {} }), /cannot be edited/);
  await assert.rejects(s.run({ resource: 'inventory', action: 'delete', id: Object.keys(s.col('inventory'))[0] }), /cannot be deleted/);
});

test('receiving a purchase adds stock once and locks the purchase', async () => {
  const s = store();
  const { id: pid } = await s.run(product());
  const { id: po } = await s.run({ resource: 'purchases', action: 'create', data: { supplier: 'Shivam', productId: pid, quantity: 100, unitCost: 38 } });
  assert.equal(po, 'PO-3021');
  assert.equal(s.col('purchases')[po].amount, 3800);
  assert.equal(s.col('products')[pid].stock, 30);

  await s.run({ resource: 'purchases', action: 'update', id: po, data: { quantity: 120 } });
  assert.equal(s.col('purchases')[po].amount, 4560);

  await s.run({ resource: 'purchases', action: 'update', id: po, data: { status: 'Received' } });
  assert.equal(s.col('products')[pid].stock, 150);
  const moves = Object.values(s.col('inventory'));
  assert.equal(moves.length, 1);
  assert.equal(moves[0].note, 'Received against PO-3021');

  await assert.rejects(s.run({ resource: 'purchases', action: 'update', id: po, data: { status: 'Cancelled' } }), /locked/);
  assert.equal(s.col('products')[pid].stock, 150);
});

test('a purchase created as Received adds stock immediately', async () => {
  const s = store();
  const { id: pid } = await s.run(product({ stock: 0 }));
  await s.run({ resource: 'purchases', action: 'create', data: { supplier: 'Om', productId: pid, quantity: 50, unitCost: 4, status: 'Received' } });
  assert.equal(s.col('products')[pid].stock, 50);
});

test('update and delete require an existing record; delete is audited', async () => {
  const s = store();
  await assert.rejects(s.run({ resource: 'customers', action: 'update', id: 'zzz', data: { name: 'A' } }), (e) => e.code === 'not-found');
  await assert.rejects(s.run({ resource: 'customers', action: 'delete', id: 'a/b' }), /valid record id/);
  const { id } = await s.run({ resource: 'customers', action: 'create', data: { name: 'Neha', city: 'Pune' } });
  await s.run({ resource: 'customers', action: 'update', id, data: { city: 'Mumbai' } });
  assert.equal(s.col('customers')[id].city, 'Mumbai');
  assert.equal(s.col('customers')[id].name, 'Neha');
  await s.run({ resource: 'customers', action: 'delete', id });
  assert.equal(s.col('customers')[id], undefined);
  assert.deepEqual(Object.values(s.col('audit-logs')).map((l) => l.action), ['Created', 'Updated', 'Deleted']);
});

test('order status can be changed and the id/createdAt cannot be overwritten', async () => {
  const s = store();
  const { id } = await s.run({ resource: 'orders', action: 'create', data: { customer: 'A', type: 'Retail', amount: 10 } });
  await s.run({ resource: 'orders', action: 'update', id, data: { status: 'Cancelled', id: 'HACK', createdAt: '1999' } });
  assert.equal(s.col('orders')[id].status, 'Cancelled');
  assert.equal(s.col('orders')[id].id, id);
  assert.equal(s.col('orders')[id].createdAt, '2026-10-10T10:00:00.000Z');
});

test('every new record gets a createdAt for newest-first ordering', async () => {
  const s = store();
  const { id } = await s.run({ resource: 'suppliers', action: 'create', data: { name: 'Om Packaging' } });
  assert.equal(s.col('suppliers')[id].createdAt, '2026-10-10T10:00:00.000Z');
  assert.equal(s.col('suppliers')[id].status, 'Active');
});

const URL1 = 'https://firebasestorage.googleapis.com/v0/b/smfoods-8eb21.firebasestorage.app/o/products%2Fa.jpg?alt=media&token=t';

test('product images are validated, and the first one becomes imageUrl', async () => {
  const s = store();
  const { id } = await s.run(product({ images: [{ url: URL1, path: 'products/a.jpg' }, { url: URL1, path: 'products/b.jpg' }] }));
  assert.equal(s.col('products')[id].images.length, 2);
  assert.equal(s.col('products')[id].imageUrl, URL1);
  await s.run({ resource: 'products', action: 'update', id, data: { images: [] } });
  assert.equal(s.col('products')[id].imageUrl, '');
  const none = await s.run(product({ name: 'No pic' }));
  assert.deepEqual(s.col('products')[none.id].images, []);
});

test('product images reject foreign urls, odd paths and too many files', async () => {
  const s = store();
  await assert.rejects(s.run(product({ images: [{ url: 'https://evil.example/x.jpg', path: 'products/a.jpg' }] })), Fail);
  await assert.rejects(s.run(product({ images: [{ url: URL1, path: '../secrets/a.jpg' }] })), Fail);
  await assert.rejects(s.run(product({ images: Array.from({ length: 7 }, (_, i) => ({ url: URL1, path: `products/${i}.jpg` })) })), Fail);
});

test('enterprise stock: purchase received increases kg, order items decrease kg, cancel/delete restores kg', async () => {
  const s = store();
  // 1. Product added with no initial stock (defaults to 0)
  const { id: p1 } = await s.run({ resource: 'products', action: 'create', data: { name: 'Chivda Special', category: 'Chivda' } });
  assert.equal(s.col('products')[p1].stock, 0);

  // 2. Purchase received in Kg (50 kg)
  await s.run({ resource: 'purchases', action: 'create', data: { supplier: 'Spice Vendor', productId: p1, quantity: 50, unitCost: 120, status: 'Received' } });
  assert.equal(s.col('products')[p1].stock, 50);

  // 3. Retail Order with line items (2 packs of 500 gm = 1 kg, and 1 pack of 200 gm = 0.2 kg)
  const { id: o1 } = await s.run({
    resource: 'orders', action: 'create', data: {
      customer: 'Suresh Kumar', type: 'Retail', amount: 450,
      items: [
        { productId: p1, productName: 'Chivda Special', weightVariant: '500 gm', weightInKg: 0.5, quantity: 2, totalWeightKg: 1.0, price: 150, amount: 300 },
        { productId: p1, productName: 'Chivda Special', weightVariant: '200 gm', weightInKg: 0.2, quantity: 1, totalWeightKg: 0.2, price: 150, amount: 150 },
      ]
    }
  });
  // 50 kg - (1.0 kg + 0.2 kg) = 48.8 kg
  assert.equal(s.col('products')[p1].stock, 48.8);
  const outMoves = Object.values(s.col('inventory')).filter((m) => m.type === 'Stock out');
  assert.equal(outMoves.length, 2);

  // 4. Cancel order -> Restores 1.2 kg back to 50 kg
  await s.run({ resource: 'orders', action: 'update', id: o1, data: { status: 'Cancelled' } });
  assert.equal(s.col('products')[p1].stock, 50);

  // 5. Reinstate order -> Re-deducts 1.2 kg back to 48.8 kg
  await s.run({ resource: 'orders', action: 'update', id: o1, data: { status: 'Processing' } });
  assert.equal(s.col('products')[p1].stock, 48.8);

  // 6. Delete order -> Restores 1.2 kg back to 50 kg
  await s.run({ resource: 'orders', action: 'delete', id: o1 });
  assert.equal(s.col('products')[p1].stock, 50);
});

