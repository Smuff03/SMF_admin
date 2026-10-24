/**
 * adminProducts -> storefront copies (`products`, `productPricing`).
 * Keep storefrontDocs identical to smfoods-shop/functions/src/logic.js.
 * No wholesale data ever lands in `products` (it is publicly readable).
 */
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const str = (v) => (typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');

/** Plain https image URLs, primary first. Admin stores `imageUrl` and `images: [{ path, url }]`. */
export function imageUrls(p) {
    const out = [];
    const add = (v) => {
        const u = typeof v === 'string' ? v.trim() : typeof v?.url === 'string' ? v.url.trim() : '';
        if (/^https:\/\//i.test(u) && !out.includes(u)) out.push(u);
    };
    add(p.imageUrl);
    if (Array.isArray(p.images)) p.images.forEach(add);
    return out;
}

export function storefrontDocs(p, existingPricing, now) {
    const priced = num(p.retailPrice) && p.retailPrice > 0;
    const imgs = imageUrls(p);
    const hasImageKeys = 'imageUrl' in p || 'images' in p;
    const optional = (...keys) => { for (const k of keys) { const v = str(p[k]); if (v) return v; } return undefined; };
    const product = {
        name: str(p.name) || 'Unnamed product',
        category: str(p.category) || 'Uncategorised',
        sku: str(p.sku),
        mrp: num(p.mrp) && p.mrp > 0 ? p.mrp : priced ? p.retailPrice : 0,
        retailPrice: priced ? p.retailPrice : 0,
        stockQty: Math.max(0, Math.round((Number(p.stock) || 0) * 100) / 100),
        active: p.active === true,
        adminProductId: p.id, createdAt: p.createdAt || now, updatedAt: now,
        description: optional('description', 'desc'),
        packSize: optional('packSize', 'pack', 'size'),
        ...(hasImageKeys ? { imageUrl: imgs[0] || '', images: imgs } : {}),
    };
    const pricing = num(p.wholesalePrice)
        ? { wholesalePrice: p.wholesalePrice, moq: Number.isInteger(existingPricing?.moq) && existingPricing.moq >= 1 ? existingPricing.moq : 1, updatedAt: now }
        : null;
    return { product, pricing };
}