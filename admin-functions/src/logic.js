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

export const MUTABLE = ['orders', 'storefrontOrders', 'products', 'inventory', 'purchases', 'suppliers', 'customers', 'wholesalers', 'expenses'];
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
    if (s.type === 'items' || s.type === 'array') { out[key] = Array.isArray(v) ? v : []; continue; }
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
      else v = Math.round(v * 1000) / 1000;
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

async function moveStock(ctx, product, delta, movement, currentStock = null) {
  const baseStock = currentStock !== null ? currentStock : Number(product.stock) || 0;
  const stock = Math.round((baseStock + delta) * 1000) / 1000;
  ctx.tx.update('products', product.id, { stock });
  const id = ctx.tx.newId('inventory');
  ctx.tx.set('inventory', id, { id, productId: product.id, productName: product.name, sku: product.sku, balance: stock, createdAt: ctx.now, ...movement });
  return stock;
}

async function receivePurchase(ctx, po) {
  const product = await ctx.tx.get('products', po.productId);
  if (product) await moveStock(ctx, product, po.quantity, { type: 'Stock in', quantity: po.quantity, note: po.notes || `Received against ${po.id}` });
}

export function extractItemWeightKg(item) {
  if (Number(item?.totalWeightKg) > 0) return Number(item.totalWeightKg);
  if (Number(item?.kg) > 0) return Number(item.kg);
  let perUnitKg = Number(item?.weightInKg);
  if (!Number.isFinite(perUnitKg) || perUnitKg <= 0) {
    const s = String(item?.weightVariant || item?.packSize || item?.weight || '').toLowerCase().trim();
    if (s.includes('1/2') || s === '500 gm' || s === '500g') perUnitKg = 0.5;
    else if (s.includes('200')) perUnitKg = 0.2;
    else if (s.includes('250')) perUnitKg = 0.25;
    else if (s.includes('1 kg') || s === '1kg') perUnitKg = 1.0;
    else if (s.includes('2 kg') || s === '2kg') perUnitKg = 2.0;
    else if (s.includes('5 kg') || s === '5kg') perUnitKg = 5.0;
    else {
      const num = parseFloat(s);
      if (s.includes('gm') || s.includes('g')) perUnitKg = (num || 0) / 1000;
      else if (s.includes('kg')) perUnitKg = num || 0;
      else perUnitKg = 1;
    }
  }
  const qty = Number(item?.quantity ?? item?.qty) || 1;
  return Math.round((perUnitKg || 1) * qty * 1000) / 1000;
}

export function getOrderItems(order) {
  if (Array.isArray(order?.items) && order.items.length > 0) return order.items;
  if (Array.isArray(order?.cart) && order.cart.length > 0) return order.cart;
  return [];
}

/**
 * Stock is physically deducted from inventory ONLY when an order is Dispatched or Delivered.
 * Pending and Processing orders represent future deliveries and do NOT deduct stock yet.
 */
export function isDeductedStatus(status) {
  if (!status) return false;
  const s = String(status).toLowerCase().trim();
  return s === 'dispatched' || s === 'delivered';
}

export const resources = {
  orders: {
    entity: 'Order',
    label: (r) => `${r.id} for ${typeof r.customer === 'object' && r.customer ? (r.customer.name || r.customer.fullName || r.customer.email || 'Customer') : (r.customer || 'Customer')}`,
    schema: {
      customer: { required: true, label: 'Customer' },
      type: { required: true, enum: ['Retail', 'Wholesale'], label: 'Type' },
      amount: { type: 'number', required: true, min: 0, label: 'Amount' },
      status: { enum: ['Pending', 'Processing', 'Dispatched', 'Delivered', 'Cancelled'], default: 'Pending', label: 'Status' },
      orderStatus: { label: 'Order status' },
      note: { label: 'Note' },
      items: { type: 'items', default: [], label: 'Items' },
      phone: { label: 'Phone' },
      email: { label: 'Email' },
      address: { label: 'Address' },
      paymentStatus: { label: 'Payment status' },
      deliveryDate: { label: 'Delivery date' },
      deliveredAt: { label: 'Delivered at' },
      source: { label: 'Source' },
      portalOrderId: { label: 'Portal order ID' },
    },
    async prepare(ctx, d) {
      const id = d.id || `TMF-${await nextNumber(ctx.tx, 'orders', 1000)}`;
      const deliveredAt = d.status === 'Delivered' ? (d.deliveredAt || ctx.now) : (d.deliveredAt || null);
      return { ...d, id, deliveredAt, createdAt: ctx.now };
    },
    async afterCreate(ctx, order) {
      const items = getOrderItems(order);
      const st = order.status || order.orderStatus;
      // Only deduct physical stock if the order is already Dispatched or Delivered.
      // Received orders in Pending or Processing remain in stock until dispatched/delivered.
      if (isDeductedStatus(st) && items.length > 0) {
        const stockTracker = new Map();
        for (const item of items) {
          const productId = item.productId || item.id;
          if (!productId) continue;
          const product = await ctx.tx.get('products', productId);
          if (product) {
            const current = stockTracker.has(productId) ? stockTracker.get(productId) : (Number(product.stock) || 0);
            const weightKg = extractItemWeightKg(item);
            if (weightKg <= 0) continue;
            const variantTag = item.weightVariant || item.packSize || item.weight || '';
            const custName = typeof order.customer === 'object' && order.customer ? (order.customer.name || order.customer.fullName || 'Customer') : (order.customer || 'Customer');
            const newStock = await moveStock(ctx, product, -weightKg, {
              type: 'Stock out',
              quantity: weightKg,
              note: `Order ${order.id} (${st}) - ${custName} (${item.productName || item.name || product.name}${variantTag ? ` · ${variantTag}` : ''})${current <= 0 ? ' [deficit order]' : ''}`
            }, current);
            stockTracker.set(productId, newStock);
          }
        }
      }
    },
    async beforeUpdate(ctx, existing, patch) {
      if (patch.status === 'Delivered' && !existing.deliveredAt && !patch.deliveredAt) {
        return { ...patch, deliveredAt: ctx.now };
      }
      if (patch.status && patch.status !== 'Delivered' && existing.deliveredAt && !patch.deliveredAt) {
        return { ...patch, deliveredAt: null };
      }
      return patch;
    },
    async afterUpdate(ctx, before, after) {
      const afterItems = getOrderItems(after);
      const beforeItems = getOrderItems(before);
      const items = afterItems.length ? afterItems : beforeItems;
      if (!items.length) return;

      const beforeSt = before.status || before.orderStatus;
      const afterSt = after.status || after.orderStatus;

      const wasDeducted = isDeductedStatus(beforeSt);
      const isDeducted = isDeductedStatus(afterSt);

      // Transition A: moved from Pending/Processing/Cancelled -> Dispatched/Delivered (Deduct physical stock)
      if (!wasDeducted && isDeducted) {
        const stockTracker = new Map();
        for (const item of afterItems.length ? afterItems : items) {
          const productId = item.productId || item.id;
          if (!productId) continue;
          const product = await ctx.tx.get('products', productId);
          if (product) {
            const current = stockTracker.has(productId) ? stockTracker.get(productId) : Number(product.stock) || 0;
            const weightKg = extractItemWeightKg(item);
            if (weightKg <= 0) continue;
            const variantTag = item.weightVariant || item.packSize || item.weight || '';
            const custName = typeof after.customer === 'object' && after.customer ? (after.customer.name || after.customer.fullName || 'Customer') : (after.customer || 'Customer');
            const newStock = await moveStock(ctx, product, -weightKg, {
              type: 'Stock out',
              quantity: weightKg,
              note: `Order ${after.id} ${afterSt} - Stock deducted (${item.productName || item.name || product.name}${variantTag ? ` · ${variantTag}` : ''})`
            }, current);
            stockTracker.set(productId, newStock);
          }
        }
      }
      // Transition B: was Dispatched/Delivered -> changed back to Pending/Processing/Cancelled (Restore physical stock)
      else if (wasDeducted && !isDeducted) {
        const stockTracker = new Map();
        for (const item of beforeItems.length ? beforeItems : items) {
          const productId = item.productId || item.id;
          if (!productId) continue;
          const product = await ctx.tx.get('products', productId);
          if (product) {
            const current = stockTracker.has(productId) ? stockTracker.get(productId) : Number(product.stock) || 0;
            const weightKg = extractItemWeightKg(item);
            if (weightKg <= 0) continue;
            const variantTag = item.weightVariant || item.packSize || item.weight || '';
            const newStock = await moveStock(ctx, product, weightKg, {
              type: 'Stock in',
              quantity: weightKg,
              note: `Order ${after.id} moved to ${afterSt} - Restocked (${item.productName || item.name || product.name}${variantTag ? ` · ${variantTag}` : ''})`
            }, current);
            stockTracker.set(productId, newStock);
          }
        }
      }
      // Transition C: was Dispatched/Delivered and remains Dispatched/Delivered, but line items/quantities were edited
      else if (wasDeducted && isDeducted && after.items !== undefined) {
        const beforeWeights = new Map();
        for (const item of beforeItems) {
          const pid = item.productId || item.id;
          if (pid) beforeWeights.set(pid, (beforeWeights.get(pid) || 0) + extractItemWeightKg(item));
        }
        const afterWeights = new Map();
        for (const item of afterItems) {
          const pid = item.productId || item.id;
          if (pid) afterWeights.set(pid, (afterWeights.get(pid) || 0) + extractItemWeightKg(item));
        }
        const allPids = new Set([...beforeWeights.keys(), ...afterWeights.keys()]);
        const stockTracker = new Map();
        for (const pid of allPids) {
          const bW = beforeWeights.get(pid) || 0;
          const aW = afterWeights.get(pid) || 0;
          const diff = Math.round((bW - aW) * 1000) / 1000;
          if (diff !== 0) {
            const product = await ctx.tx.get('products', pid);
            if (product) {
              const current = stockTracker.has(pid) ? stockTracker.get(pid) : Number(product.stock) || 0;
              const type = diff > 0 ? 'Stock in' : 'Stock out';
              const absDiff = Math.abs(diff);
              const note = `Order ${after.id} Quantity Adjusted - Stock ${diff > 0 ? 'restored' : 'deducted'} (${absDiff} kg)`;
              const newStock = await moveStock(ctx, product, diff, {
                type,
                quantity: absDiff,
                note
              }, current);
              stockTracker.set(pid, newStock);
            }
          }
        }
      }
    },
    async afterDelete(ctx, existing) {
      const items = getOrderItems(existing);
      const st = existing.status || existing.orderStatus;
      // Only restore stock if this order was actually Dispatched or Delivered
      if (isDeductedStatus(st) && items.length > 0) {
        const stockTracker = new Map();
        for (const item of items) {
          const productId = item.productId || item.id;
          if (!productId) continue;
          const product = await ctx.tx.get('products', productId);
          if (product) {
            const current = stockTracker.has(productId) ? stockTracker.get(productId) : Number(product.stock) || 0;
            const weightKg = extractItemWeightKg(item);
            if (weightKg <= 0) continue;
            const variantTag = item.weightVariant || item.packSize || item.weight || '';
            const newStock = await moveStock(ctx, product, weightKg, {
              type: 'Stock in',
              quantity: weightKg,
              note: `Order ${existing.id} Deleted - Restocked (${item.productName || item.name || product.name}${variantTag ? ` · ${variantTag}` : ''})`
            }, current);
            stockTracker.set(productId, newStock);
          }
        }
      }
    },
  },

  products: {
    entity: 'Product',
    label: (r) => r.name,
    schema: {
      name: { required: true, label: 'Name' },
      category: { required: true, label: 'Category' },
      description: { label: 'Description' },
      packSize: { label: 'Quantity' },
      startingQuantity: { label: 'Starting quantity' },
      availableQuantities: { type: 'array', default: [], label: 'Available quantities' },
      variantPricing: { type: 'array', default: [], label: 'Variant pricing' },
      mrp: { type: 'number', nullable: true, min: 0, label: 'MRP' },
      retailPrice: { type: 'number', nullable: true, min: 0, label: 'Retail price' },
      wholesalePrice: { type: 'number', nullable: true, min: 0, label: 'Wholesale price' },
      costPrice: { type: 'number', nullable: true, min: 0, label: 'Cost price' },
      stock: { type: 'number', default: 0, label: 'Stock' },
      active: { type: 'boolean', default: true, label: 'State' },
      images: { type: 'images', default: [], label: 'Images' },
    },
    async prepare(ctx, d) {
      const prefix = PREFIX[d.category] || d.category.slice(0, 3).toUpperCase().replace(/[^A-Z0-9]/g, 'X');
      const n = await nextNumber(ctx.tx, `sku-${prefix}`, 0);
      const availableQuantities = Array.isArray(d.availableQuantities) && d.availableQuantities.length > 0
        ? d.availableQuantities
        : d.packSize ? String(d.packSize).split(',').map((s) => s.trim()).filter(Boolean) : ['200 gm', '500 gm', '1 kg'];
      const startingQuantity = d.startingQuantity || availableQuantities[0] || '200 gm';
      const packSize = d.packSize || availableQuantities.join(', ');
      const variantPricing = Array.isArray(d.variantPricing) ? d.variantPricing : [];
      const startVp = variantPricing.find((v) => v.weight === startingQuantity) || variantPricing[0];
      const mrp = d.mrp ?? (startVp?.mrp ? Number(startVp.mrp) : null);
      const retailPrice = d.retailPrice ?? (startVp?.retailPrice ? Number(startVp.retailPrice) : null);
      const wholesalePrice = d.wholesalePrice ?? (startVp?.wholesalePrice ? Number(startVp.wholesalePrice) : null);
      return {
        mrp, retailPrice, wholesalePrice, costPrice: null,
        ...d,
        startingQuantity,
        availableQuantities,
        variantPricing,
        packSize,
        stock: Number(d.stock) || 0,
        imageUrl: d.images?.[0]?.url || '',
        sku: `TMF-${prefix}-${String(n).padStart(3, '0')}`,
        createdAt: ctx.now
      };
    },
    // `imageUrl` mirrors the first (cover) image so lists and the storefront need not read the array.
    async beforeUpdate(ctx, existing, patch) {
      const out = { ...patch };
      if ('images' in patch) out.imageUrl = patch.images[0]?.url || '';
      if ('availableQuantities' in patch && !patch.packSize) {
        const aq = Array.isArray(patch.availableQuantities) ? patch.availableQuantities : [];
        if (aq.length > 0) out.packSize = aq.join(', ');
      }
      return out;
    },
  },

  inventory: {
    entity: 'Inventory',
    label: (r) => `${r.type} ${r.quantity} x ${r.productName}`,
    schema: {
      productId: { required: true, label: 'Product' },
      type: { required: true, enum: ['Stock in', 'Stock out', 'Adjustment', 'Used in Demo'], label: 'Type' },
      quantity: { type: 'number', required: true, label: 'Quantity' },
      note: { label: 'Note' },
    },
    async prepare(ctx, d) {
      const product = await ctx.tx.get('products', d.productId);
      if (!product) throw bad('Product not found');
      if (d.quantity === 0) throw bad('Quantity cannot be 0');
      if (d.type !== 'Adjustment' && d.quantity < 0) throw bad('Quantity must be greater than 0');
      const isOut = d.type === 'Stock out' || d.type === 'Used in Demo';
      const delta = isOut ? -d.quantity : d.quantity;
      if (d.type === 'Stock out' && product.stock + delta < 0) throw bad(`Only ${product.stock} units of ${product.name} in stock`);
      ctx.tx.update('products', product.id, { stock: product.stock + delta });
      return { ...d, productName: product.name, sku: product.sku, balance: product.stock + delta, createdAt: ctx.now };
    },
    async beforeUpdate(ctx, existing, patch) {
      const targetPid = patch.productId || existing.productId;
      const product = await ctx.tx.get('products', targetPid);
      if (!product) throw bad('Product not found');

      const isOldOut = existing.type === 'Stock out' || existing.type === 'Used in Demo';
      const oldDelta = isOldOut ? -Number(existing.quantity || 0) : Number(existing.quantity || 0);

      const newType = patch.type || existing.type;
      const newQty = patch.quantity !== undefined ? Number(patch.quantity) : Number(existing.quantity || 0);
      const isNewOut = newType === 'Stock out' || newType === 'Used in Demo';
      const newDelta = isNewOut ? -newQty : newQty;

      if (targetPid === existing.productId) {
        const diff = Math.round((newDelta - oldDelta) * 1000) / 1000;
        if (diff !== 0) {
          const newStock = Math.round((Number(product.stock || 0) + diff) * 1000) / 1000;
          ctx.tx.update('products', product.id, { stock: newStock });
          return {
            ...patch,
            productName: product.name,
            sku: product.sku,
            balance: newStock,
          };
        }
      } else {
        const oldProd = await ctx.tx.get('products', existing.productId);
        if (oldProd) {
          ctx.tx.update('products', oldProd.id, { stock: Math.round((Number(oldProd.stock || 0) - oldDelta) * 1000) / 1000 });
        }
        const newStock = Math.round((Number(product.stock || 0) + newDelta) * 1000) / 1000;
        ctx.tx.update('products', product.id, { stock: newStock });
        return {
          ...patch,
          productName: product.name,
          sku: product.sku,
          balance: newStock,
        };
      }
      return patch;
    },
    async afterDelete(ctx, existing) {
      const product = await ctx.tx.get('products', existing.productId);
      if (product) {
        const isOut = existing.type === 'Stock out' || existing.type === 'Used in Demo';
        const delta = isOut ? -Number(existing.quantity || 0) : Number(existing.quantity || 0);
        ctx.tx.update('products', product.id, { stock: Math.round((Number(product.stock || 0) - delta) * 1000) / 1000 });
      }
    },
  },

  purchases: {
    entity: 'Purchase',
    label: (r) => `${r.id} from ${r.supplier}`,
    schema: {
      supplier: { required: true, label: 'Supplier' },
      productId: { required: true, label: 'Product' },
      quantity: { type: 'number', required: true, min: 0.001, label: 'Quantity' },
      unitCost: { type: 'number', required: true, min: 0, label: 'Unit cost' },
      status: { enum: ['Ordered', 'Received', 'Cancelled'], default: 'Ordered', label: 'Status' },
      notes: { label: 'Notes' },
    },
    async prepare(ctx, d) {
      const product = await ctx.tx.get('products', d.productId);
      if (!product) throw bad('Product not found');
      return { ...d, id: `PO-${await nextNumber(ctx.tx, 'purchases', 3020)}`, productName: product.name, amount: d.quantity * d.unitCost, createdAt: ctx.now };
    },
    async afterCreate(ctx, row) {
      if (row.productId && row.unitCost != null) {
        ctx.tx.update('products', row.productId, { costPrice: row.unitCost });
      }
      if (row.status === 'Received') await receivePurchase(ctx, row);
    },
    async beforeUpdate(ctx, existing, patch) {
      const next = { ...patch };
      if (patch.productId) {
        const product = await ctx.tx.get('products', patch.productId);
        if (!product) throw bad('Product not found');
        next.productName = product.name;
      }
      const qty = patch.quantity !== undefined ? Number(patch.quantity) : Number(existing.quantity);
      const cost = patch.unitCost !== undefined ? Number(patch.unitCost) : Number(existing.unitCost);
      next.amount = Math.round(qty * cost * 100) / 100;
      return next;
    },
    async afterUpdate(ctx, before, after) {
      if (after.productId && after.unitCost != null) {
        ctx.tx.update('products', after.productId, { costPrice: after.unitCost });
      }

      // 1. Was Received, still Received -> adjust stock for any quantity or product changes
      if (before.status === 'Received' && after.status === 'Received') {
        const sameProduct = before.productId === after.productId;
        if (sameProduct) {
          const diff = Math.round((Number(after.quantity) - Number(before.quantity)) * 1000) / 1000;
          if (diff !== 0) {
            const product = await ctx.tx.get('products', after.productId);
            if (product) {
              const type = diff > 0 ? 'Stock in' : 'Stock out';
              await moveStock(ctx, product, diff, {
                type,
                quantity: Math.abs(diff),
                note: `PO #${after.id} Quantity edited (${diff > 0 ? '+' : ''}${diff} kg)`
              });
            }
          }
        } else {
          const oldProd = await ctx.tx.get('products', before.productId);
          if (oldProd) {
            await moveStock(ctx, oldProd, -Number(before.quantity), {
              type: 'Stock out',
              quantity: Number(before.quantity),
              note: `PO #${after.id} Product changed - Stock removed`
            });
          }
          const newProd = await ctx.tx.get('products', after.productId);
          if (newProd) {
            await moveStock(ctx, newProd, Number(after.quantity), {
              type: 'Stock in',
              quantity: Number(after.quantity),
              note: `PO #${after.id} Product changed - Stock added`
            });
          }
        }
      }
      // 2. Newly Received
      else if (before.status !== 'Received' && after.status === 'Received') {
        await receivePurchase(ctx, after);
      }
      // 3. Was Received, now un-received (Ordered or Cancelled)
      else if (before.status === 'Received' && after.status !== 'Received') {
        const product = await ctx.tx.get('products', before.productId);
        if (product) {
          await moveStock(ctx, product, -Number(before.quantity), {
            type: 'Stock out',
            quantity: Number(before.quantity),
            note: `PO #${after.id} changed to ${after.status} - Stock reversed`
          });
        }
      }
    },
    async afterDelete(ctx, existing) {
      if (existing.status === 'Received') {
        const product = await ctx.tx.get('products', existing.productId);
        if (product) {
          await moveStock(ctx, product, -Number(existing.quantity), {
            type: 'Stock out',
            quantity: Number(existing.quantity),
            note: `PO #${existing.id} Deleted - Stock removed`
          });
        }
      }
    },
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

  expenses: {
    entity: 'Expense',
    label: (r) => `${r.category}: ${r.description}`,
    schema: {
      description: { required: true, label: 'Description' },
      category: { required: true, enum: ['Offline Sale', 'Raw Material', 'Packaging', 'Transport', 'Salary', 'Utilities', 'Other'], label: 'Category' },
      amount: { type: 'number', required: true, min: 0, label: 'Amount' },
      date: { required: true, label: 'Date' },
      note: { label: 'Note' },
    },
    async prepare(ctx, d) { return { ...d, createdAt: ctx.now }; },
  },
};
resources.storefrontOrders = resources.orders;

function audit(ctx, action, def, row, extra = {}) {
  const id = ctx.tx.newId('audit-logs');
  ctx.tx.set('audit-logs', id, { id, user: ctx.actor, action, entity: def.entity, detail: def.label(row), createdAt: ctx.now, ...extra });
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
    const snapshot = {};
    for (const k of Object.keys(def.schema)) if (row[k] !== undefined) snapshot[k] = row[k];
    audit(ctx, 'Created', def, row, { snapshot });
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
    const changes = {};
    for (const k of Object.keys(patch)) if (k !== 'id' && k !== 'createdAt') changes[k] = { from: existing[k] ?? null, to: patch[k] ?? null };
    audit(ctx, 'Updated', def, after, { changes });
    return { id };
  }

  if (action === 'delete') {
    if (def.immutable) throw bad('This record cannot be deleted');
    tx.delete(resource, id);
    await def.afterDelete?.(ctx, existing);
    const snapshot = {};
    for (const k of Object.keys(def.schema)) if (existing[k] !== undefined) snapshot[k] = existing[k];
    audit(ctx, 'Deleted', def, existing, { snapshot });
    return { id };
  }

  throw bad('Unknown action');
}