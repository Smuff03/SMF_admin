/**
 * Business rules for every admin write. Ported from the old Express backend (resources.js) with
 * one change: totals (sales, mix, customer spend) are no longer stored; the UI derives them from
 * real orders, so there is nothing to keep in sync.
 *
 * `perform` is storage-agnostic. It receives `tx` with:
 *   get(resource, id) -> doc | null          set(resource, id, doc)
 *   update(resource, id, patch) (merge)      delete(resource, id)        newId(resource)
 * Reads must happen before writes are applied; index.js queues writes and commits them at the end
 * of a Firestore transaction.
 */
export class Fail extends Error {
  constructor(message, code = 'invalid-argument') { super(message); this.code = code; }
}
const bad = (m) => new Fail(m);

export const MUTABLE = ['orders', 'products', 'inventory', 'purchases', 'suppliers', 'customers', 'wholesalers'];
const MAX_TEXT = 2000;

export const MAX_IMAGES = 6;
const IMAGE_URL = 'https://firebasestorage.googleapis.com/';
const IMAGE_PATH = /^products\/[\w.-]{1,120}$/;

/** Product images are uploaded by the browser to Storage; the doc only keeps [{ url, path }] and we vet them here. */
function cleanImages(v, name) {
  if (v === undefined || v === null || v === '') return [];
  if (!Array.isArray(v)) throw bad(`${name} is invalid`);
  if (v.length > MAX_IMAGES) throw bad(`A product can have at most ${MAX_IMAGES} images`);
  return v.map((i) => {
    const url = typeof i?.url === 'string' ? i.url.trim() : '';
    const path = typeof i?.path === 'string' ? i.path.trim() : '';
    if (!url.startsWith(IMAGE_URL) || url.length > 1500 || !IMAGE_PATH.test(path)) throw bad(`${name} is invalid`);
    return { url, path };
  });
}

export function clean(schema, body = {}, partial = false) {
  const out = {};
  for (const [key, s] of Object.entries(schema)) {
    const name = s.label || key;
    let v = body[key];
    if (v === undefined) {
      if (!partial) {
        if (s.required) throw bad(`${name} is required`);
        if ('default' in s) out[key] = s.default;
      }
      continue;
    }
    if (s.type === 'images') { out[key] = cleanImages(v, name); continue; }
    if (v === '' || v === null) {
      if (s.required) throw bad(`${name} is required`);
      out[key] = s.nullable ? null : s.type === 'number' ? s.default ?? 0 : '';
      continue;
    }
    if (s.type === 'number') {
      v = Number(v);
      if (!Number.isFinite(v)) throw bad(`${name} must be a number`);
      if (s.min !== undefined && v < s.min) throw bad(`${name} must be at least ${s.min}`);
      if (s.int) v = Math.round(v);
    } else if (s.type === 'boolean') {
      v = v === true || v === 'true';
    } else {
      if (typeof v === 'object') throw bad(`${name} is invalid`);
      v = String(v).trim();
      if (v.length > MAX_TEXT) throw bad(`${name} is too long`);
      if (s.enum && !s.enum.includes(v)) throw bad(`Invalid ${name}`);
    }
    out[key] = v;
  }
  return out;
}

const PREFIX = { 'Bhajani Chakli': 'BHA', Chivda: 'CHI', Namkeen: 'NAM', Farsan: 'FAR', Sweets: 'SWE', Papad: 'PAP' };

/** Sequential numbers live in meta/counters, e.g. { orders: 1048 }. Seed it to continue an existing sequence. */
async function nextNumber(tx, key, start) {
  const counters = (await tx.get('meta', 'counters')) || {};
  const n = Math.max(start, Number(counters[key]) || 0) + 1;
  tx.update('meta', 'counters', { [key]: n });
  return n;
}

async function moveStock(ctx, product, delta, movement) {
  const stock = product.stock + delta;
  if (stock < 0) throw bad(`Only ${product.stock} units of ${product.name} in stock`);
  ctx.tx.update('products', product.id, { stock });
  const id = ctx.tx.newId('inventory');
  ctx.tx.set('inventory', id, { id, productId: product.id, productName: product.name, sku: product.sku, balance: stock, createdAt: ctx.now, ...movement });
}

async function receivePurchase(ctx, po) {
  const product = await ctx.tx.get('products', po.productId);
  if (product) await moveStock(ctx, product, po.quantity, { type: 'Stock in', quantity: po.quantity, note: `Received against ${po.id}` });
}

export const resources = {
  orders: {
    entity: 'Order',
    label: (r) => `${r.id} for ${r.customer}`,
    schema: {
      customer: { required: true, label: 'Customer' },
      type: { required: true, enum: ['Retail', 'Wholesale'], label: 'Type' },
      amount: { type: 'number', required: true, min: 0, label: 'Amount' },
      status: { enum: ['Pending', 'Processing', 'Dispatched', 'Delivered', 'Cancelled'], default: 'Pending', label: 'Status' },
      note: { label: 'Note' },
    },
    async prepare(ctx, d) { return { ...d, id: `TMF-${await nextNumber(ctx.tx, 'orders', 1000)}`, createdAt: ctx.now }; },
  },

  products: {
    entity: 'Product',
    label: (r) => r.name,
    schema: {
      name: { required: true, label: 'Name' },
      category: { required: true, label: 'Category' },
      mrp: { type: 'number', nullable: true, min: 0, label: 'MRP' },
      retailPrice: { type: 'number', nullable: true, min: 0, label: 'Retail price' },
      wholesalePrice: { type: 'number', nullable: true, min: 0, label: 'Wholesale price' },
      stock: { type: 'number', int: true, min: 0, default: 0, label: 'Stock' },
      active: { type: 'boolean', default: true, label: 'State' },
      images: { type: 'images', default: [], label: 'Images' },
    },
    async prepare(ctx, d) {
      const prefix = PREFIX[d.category] || d.category.slice(0, 3).toUpperCase().replace(/[^A-Z0-9]/g, 'X');
      const n = await nextNumber(ctx.tx, `sku-${prefix}`, 0);
      return { mrp: null, retailPrice: null, wholesalePrice: null, ...d, imageUrl: d.images?.[0]?.url || '', sku: `TMF-${prefix}-${String(n).padStart(3, '0')}`, createdAt: ctx.now };
    },
    // `imageUrl` mirrors the first (cover) image so lists and the storefront need not read the array.
    async beforeUpdate(ctx, existing, patch) { return 'images' in patch ? { ...patch, imageUrl: patch.images[0]?.url || '' } : patch; },
  },

  inventory: {
    entity: 'Inventory',
    immutable: true,
    label: (r) => `${r.type} ${r.quantity} x ${r.productName}`,
    schema: {
      productId: { required: true, label: 'Product' },
      type: { required: true, enum: ['Stock in', 'Stock out', 'Adjustment'], label: 'Type' },
      quantity: { type: 'number', int: true, required: true, label: 'Quantity' },
      note: { label: 'Note' },
    },
    async prepare(ctx, d) {
      const product = await ctx.tx.get('products', d.productId);
      if (!product) throw bad('Product not found');
      if (d.quantity === 0) throw bad('Quantity cannot be 0');
      if (d.type !== 'Adjustment' && d.quantity < 0) throw bad('Quantity must be greater than 0');
      const delta = d.type === 'Stock out' ? -d.quantity : d.quantity;
      if (product.stock + delta < 0) throw bad(`Only ${product.stock} units of ${product.name} in stock`);
      ctx.tx.update('products', product.id, { stock: product.stock + delta });
      return { ...d, productName: product.name, sku: product.sku, balance: product.stock + delta, createdAt: ctx.now };
    },
  },

  purchases: {
    entity: 'Purchase',
    label: (r) => `${r.id} from ${r.supplier}`,
    schema: {
      supplier: { required: true, label: 'Supplier' },
      productId: { required: true, label: 'Product' },
      quantity: { type: 'number', int: true, required: true, min: 1, label: 'Quantity' },
      unitCost: { type: 'number', required: true, min: 0, label: 'Unit cost' },
      status: { enum: ['Ordered', 'Received', 'Cancelled'], default: 'Ordered', label: 'Status' },
      notes: { label: 'Notes' },
    },
    async prepare(ctx, d) {
      const product = await ctx.tx.get('products', d.productId);
      if (!product) throw bad('Product not found');
      return { ...d, id: `PO-${await nextNumber(ctx.tx, 'purchases', 3020)}`, productName: product.name, amount: d.quantity * d.unitCost, createdAt: ctx.now };
    },
    async afterCreate(ctx, row) { if (row.status === 'Received') await receivePurchase(ctx, row); },
    async beforeUpdate(ctx, existing, patch) {
      if (existing.status === 'Received') throw bad('Received purchases are locked');
      const next = { ...patch };
      if (patch.productId) {
        const product = await ctx.tx.get('products', patch.productId);
        if (!product) throw bad('Product not found');
        next.productName = product.name;
      }
      next.amount = (patch.quantity ?? existing.quantity) * (patch.unitCost ?? existing.unitCost);
      return next;
    },
    async afterUpdate(ctx, before, after) { if (before.status !== 'Received' && after.status === 'Received') await receivePurchase(ctx, after); },
  },

  suppliers: {
    entity: 'Supplier',
    label: (r) => r.name,
    schema: {
      name: { required: true, label: 'Name' }, contact: { label: 'Contact' }, phone: { label: 'Phone' }, email: { label: 'Email' },
      city: { label: 'City' }, supplies: { label: 'Supplies' }, status: { enum: ['Active', 'Inactive'], default: 'Active', label: 'Status' },
    },
  },

  customers: {
    entity: 'Customer',
    label: (r) => r.name,
    schema: { name: { required: true, label: 'Name' }, phone: { label: 'Phone' }, email: { label: 'Email' }, city: { label: 'City' } },
  },

  wholesalers: {
    entity: 'Wholesaler',
    label: (r) => r.name,
    schema: {
      name: { required: true, label: 'Business name' }, contact: { label: 'Contact' }, phone: { label: 'Phone' }, city: { label: 'City' }, gstin: { label: 'GSTIN' },
      creditLimit: { type: 'number', min: 0, default: 0, label: 'Credit limit' }, outstanding: { type: 'number', min: 0, default: 0, label: 'Outstanding' },
      status: { enum: ['Active', 'On hold'], default: 'Active', label: 'Status' },
    },
  },
};

function audit(ctx, action, def, row) {
  const id = ctx.tx.newId('audit-logs');
  ctx.tx.set('audit-logs', id, { id, user: ctx.actor, action, entity: def.entity, detail: def.label(row), createdAt: ctx.now });
}

/** Run one create / update / delete. Returns { id }. Throws Fail on invalid input. */
export async function perform(ctx, { resource, action, id, data }) {
  if (!MUTABLE.includes(resource)) throw bad('Unknown resource');
  const def = resources[resource];
  const { tx } = ctx;

  if (action === 'create') {
    let doc = clean(def.schema, data, false);
    doc = (await def.prepare?.(ctx, doc)) ?? doc;
    const rowId = doc.id || tx.newId(resource);
    const row = { createdAt: ctx.now, ...doc, id: rowId };
    tx.set(resource, rowId, row);
    await def.afterCreate?.(ctx, row);
    audit(ctx, 'Created', def, row);
    return { id: rowId };
  }

  if (typeof id !== 'string' || !id || id.includes('/')) throw bad('A valid record id is required');
  const existing = await tx.get(resource, id);
  if (!existing) throw new Fail('Record not found', 'not-found');

  if (action === 'update') {
    if (def.immutable) throw bad('This record cannot be edited');
    let patch = clean(def.schema, data, true);
    patch = (await def.beforeUpdate?.(ctx, existing, patch)) ?? patch;
    tx.update(resource, id, patch);
    const after = { ...existing, ...patch, id };
    await def.afterUpdate?.(ctx, existing, after);
    audit(ctx, 'Updated', def, after);
    return { id };
  }

  if (action === 'delete') {
    if (def.immutable) throw bad('This record cannot be deleted');
    tx.delete(resource, id);
    audit(ctx, 'Deleted', def, existing);
    return { id };
  }

  throw bad('Unknown action');
}
