export const LOW_STOCK = 25;
export const bad = (message, status = 400) => Object.assign(new Error(message), { status });

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
    } else if (s.type === 'boolean') v = v === true || v === 'true';
    else {
      v = String(v).trim();
      if (s.enum && !s.enum.includes(v)) throw bad(`Invalid ${name}`);
    }
    out[key] = v;
  }
  return out;
}

const now = () => new Date().toISOString();
const isToday = (iso) => new Date(iso).toDateString() === new Date().toDateString();
const nextId = (rows, prefix, start) => `${prefix}-${Math.max(start, ...rows.map((r) => Number(String(r.id).replace(/\D/g, '')) || 0)) + 1}`;
const sumBy = (rows, fn) => rows.reduce((a, r) => a + fn(r), 0);

async function bookSale(db, order, sign) {
  if (order.status === 'Cancelled') return;
  const meta = await db.getMeta();
  meta.mix[order.type === 'Retail' ? 'retail' : 'wholesale'] += sign * order.amount;
  if (isToday(order.createdAt)) meta.series[meta.series.length - 1] += sign * order.amount;
  await db.setMeta(meta);
}

async function moveStock(db, product, delta, movement) {
  const stock = Math.round(((Number(product.stock) || 0) + delta) * 1000) / 1000;
  await db.update('products', product.id, { stock });
  return db.create('inventory', { productId: product.id, productName: product.name, sku: product.sku, balance: stock, createdAt: now(), ...movement });
}

async function receivePurchase(db, po) {
  const product = await db.get('products', po.productId);
  if (product) await moveStock(db, product, po.quantity, { type: 'Stock in', quantity: po.quantity, note: po.notes || `Received against ${po.id}` });
}

async function withTotals(db, rows, field) {
  const orders = await db.list('orders');
  return rows.map((r) => {
    const mine = orders.filter((o) => o.customer.toLowerCase() === r.name.toLowerCase() && o.status !== 'Cancelled');
    return { ...r, orders: mine.length, totalSpent: sumBy(mine, (o) => o.amount) };
  });
}

const PREFIX = { 'Bhajani Chakli': 'BHA', Chivda: 'CHI', Namkeen: 'NAM', Farsan: 'FAR', Sweets: 'SWE', Papad: 'PAP' };

function extractItemWeightKg(item) {
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

function getOrderItems(order) {
  if (Array.isArray(order?.items) && order.items.length > 0) return order.items;
  if (Array.isArray(order?.cart) && order.cart.length > 0) return order.cart;
  return [];
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
    async prepare(db, d) {
      const deliveredAt = d.status === 'Delivered' ? (d.deliveredAt || now()) : (d.deliveredAt || null);
      return { ...d, id: d.id || nextId(await db.list('orders'), 'TMF', 1000), deliveredAt, createdAt: now() };
    },
    async afterCreate(db, row) {
      await bookSale(db, row, 1);
      const items = getOrderItems(row);
      const st = row.status || row.orderStatus;
      if (st !== 'Cancelled' && items.length > 0) {
        for (const item of items) {
          const productId = item.productId || item.id;
          if (!productId) continue;
          const product = await db.get('products', productId);
          if (product) {
            const weightKg = extractItemWeightKg(item);
            const variantTag = item.weightVariant || item.packSize || item.weight || '';
            const custName = typeof row.customer === 'object' && row.customer ? (row.customer.name || row.customer.fullName || 'Customer') : (row.customer || 'Customer');
            await moveStock(db, product, -weightKg, {
              type: 'Stock out',
              quantity: weightKg,
              note: `Order ${row.id} - ${custName} (${item.productName || item.name || product.name}${variantTag ? ` · ${variantTag}` : ''})`
            });
          }
        }
      }
    },
    async beforeUpdate(db, existing, patch) {
      if (patch.status === 'Delivered' && !existing.deliveredAt && !patch.deliveredAt) {
        return { ...patch, deliveredAt: now() };
      }
      if (patch.status && patch.status !== 'Delivered' && existing.deliveredAt && !patch.deliveredAt) {
        return { ...patch, deliveredAt: null };
      }
      return patch;
    },
    async afterUpdate(db, before, after) {
      await bookSale(db, before, -1);
      await bookSale(db, after, 1);
      const afterItems = getOrderItems(after);
      const beforeItems = getOrderItems(before);
      const items = afterItems.length ? afterItems : beforeItems;
      if (!items.length) return;

      const beforeSt = before.status || before.orderStatus;
      const afterSt = after.status || after.orderStatus;

      if (beforeSt !== 'Cancelled' && afterSt === 'Cancelled') {
        for (const item of items) {
          const productId = item.productId || item.id;
          if (!productId) continue;
          const product = await db.get('products', productId);
          if (product) {
            const weightKg = extractItemWeightKg(item);
            const variantTag = item.weightVariant || item.packSize || item.weight || '';
            await moveStock(db, product, weightKg, {
              type: 'Stock in',
              quantity: weightKg,
              note: `Order ${after.id} Cancelled - Restocked (${item.productName || item.name || product.name}${variantTag ? ` · ${variantTag}` : ''})`
            });
          }
        }
      } else if (beforeSt === 'Cancelled' && afterSt !== 'Cancelled') {
        for (const item of items) {
          const productId = item.productId || item.id;
          if (!productId) continue;
          const product = await db.get('products', productId);
          if (product) {
            const weightKg = extractItemWeightKg(item);
            const variantTag = item.weightVariant || item.packSize || item.weight || '';
            await moveStock(db, product, -weightKg, {
              type: 'Stock out',
              quantity: weightKg,
              note: `Order ${after.id} Reinstated - Stock deducted (${item.productName || item.name || product.name}${variantTag ? ` · ${variantTag}` : ''})`
            });
          }
        }
      } else if (beforeSt !== 'Cancelled' && afterSt !== 'Cancelled' && after.items !== undefined) {
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
        for (const pid of allPids) {
          const bW = beforeWeights.get(pid) || 0;
          const aW = afterWeights.get(pid) || 0;
          const diff = Math.round((bW - aW) * 1000) / 1000;
          if (diff !== 0) {
            const product = await db.get('products', pid);
            if (product) {
              const type = diff > 0 ? 'Stock in' : 'Stock out';
              const absDiff = Math.abs(diff);
              await moveStock(db, product, diff, {
                type,
                quantity: absDiff,
                note: `Order ${after.id} Quantity Adjusted - Stock ${diff > 0 ? 'restored' : 'deducted'} (${absDiff} kg)`
              });
            }
          }
        }
      }
    },
    async afterDelete(db, row) {
      await bookSale(db, row, -1);
      const items = getOrderItems(row);
      const st = row.status || row.orderStatus;
      if (st !== 'Cancelled' && items.length > 0) {
        for (const item of items) {
          const productId = item.productId || item.id;
          if (!productId) continue;
          const product = await db.get('products', productId);
          if (product) {
            const weightKg = extractItemWeightKg(item);
            const variantTag = item.weightVariant || item.packSize || item.weight || '';
            await moveStock(db, product, weightKg, {
              type: 'Stock in',
              quantity: weightKg,
              note: `Order ${row.id} Deleted - Restocked (${item.productName || item.name || product.name}${variantTag ? ` · ${variantTag}` : ''})`
            });
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
    },
    async prepare(db, d) {
      const rows = await db.list('products');
      const prefix = PREFIX[d.category] || d.category.slice(0, 3).toUpperCase();
      const n = rows.filter((r) => r.category === d.category).length + 1;
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
        sku: `TMF-${prefix}-${String(n).padStart(3, '0')}`,
        createdAt: now()
      };
    },
  },

  inventory: {
    entity: 'Inventory',
    immutable: true,
    label: (r) => `${r.type} ${r.quantity} x ${r.productName}`,
    schema: {
      productId: { required: true, label: 'Product' },
      type: { required: true, enum: ['Stock in', 'Stock out', 'Adjustment'], label: 'Type' },
      quantity: { type: 'number', required: true, label: 'Quantity' },
      note: { label: 'Note' },
    },
    async prepare(db, d) {
      const product = await db.get('products', d.productId);
      if (!product) throw bad('Product not found');
      if (d.quantity === 0) throw bad('Quantity cannot be 0');
      if (d.type !== 'Adjustment' && d.quantity < 0) throw bad('Quantity must be greater than 0');
      const delta = d.type === 'Stock out' ? -d.quantity : d.quantity;
      if (d.type === 'Stock out' && product.stock + delta < 0) throw bad(`Only ${product.stock} units of ${product.name} in stock`);
      await db.update('products', product.id, { stock: Math.round((product.stock + delta) * 1000) / 1000 });
      return { ...d, productName: product.name, sku: product.sku, balance: Math.round((product.stock + delta) * 1000) / 1000, createdAt: now() };
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
    async prepare(db, d) {
      const product = await db.get('products', d.productId);
      if (!product) throw bad('Product not found');
      return { ...d, id: nextId(await db.list('purchases'), 'PO', 3020), productName: product.name, amount: d.quantity * d.unitCost, createdAt: now() };
    },
    async afterCreate(db, row) {
      if (row.productId && row.unitCost != null) {
        await db.update('products', row.productId, { costPrice: row.unitCost });
      }
      if (row.status === 'Received') await receivePurchase(db, row);
    },
    async beforeUpdate(db, existing, patch) {
      if (existing.status === 'Received') throw bad('Received purchases are locked');
      const next = { ...patch };
      if (patch.productId) {
        const product = await db.get('products', patch.productId);
        if (!product) throw bad('Product not found');
        next.productName = product.name;
      }
      next.amount = (patch.quantity ?? existing.quantity) * (patch.unitCost ?? existing.unitCost);
      return next;
    },
    async afterUpdate(db, before, after) {
      if (after.productId && after.unitCost != null) {
        await db.update('products', after.productId, { costPrice: after.unitCost });
      }
      if (before.status !== 'Received' && after.status === 'Received') await receivePurchase(db, after);
    },
  },

  suppliers: {
    entity: 'Supplier',
    label: (r) => r.name,
    schema: {
      name: { required: true, label: 'Name' }, contact: { label: 'Contact' }, phone: { label: 'Phone' }, email: { label: 'Email' },
      city: { label: 'City' }, supplies: { label: 'Supplies' }, status: { enum: ['Active', 'Inactive'], default: 'Active', label: 'Status' },
    },
    async enrich(db, rows) {
      const purchases = await db.list('purchases');
      return rows.map((r) => {
        const mine = purchases.filter((p) => p.supplier === r.name && p.status !== 'Cancelled');
        return { ...r, purchases: mine.length, totalPurchased: sumBy(mine, (p) => p.amount) };
      });
    },
  },

  customers: {
    entity: 'Customer',
    label: (r) => r.name,
    schema: { name: { required: true, label: 'Name' }, phone: { label: 'Phone' }, email: { label: 'Email' }, city: { label: 'City' } },
    enrich: (db, rows) => withTotals(db, rows),
  },

  wholesalers: {
    entity: 'Wholesaler',
    label: (r) => r.name,
    schema: {
      name: { required: true, label: 'Business name' }, contact: { label: 'Contact' }, phone: { label: 'Phone' }, city: { label: 'City' }, gstin: { label: 'GSTIN' },
      creditLimit: { type: 'number', min: 0, default: 0, label: 'Credit limit' }, outstanding: { type: 'number', min: 0, default: 0, label: 'Outstanding' },
      status: { enum: ['Active', 'On hold'], default: 'Active', label: 'Status' },
    },
    enrich: (db, rows) => withTotals(db, rows),
  },

  'audit-logs': { readOnly: true, schema: {} },
};
resources.storefrontOrders = resources.orders;
