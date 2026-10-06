const HOT_WHEELS_COLLECTION_TERMS = ['hot-wheels', 'hot_wheels', 'red-line', 'redline', 'elite-64', 'elite64', 'premium', 'formula-1', 'cars-vehicles'];
const EXCLUDED_TERMS = ['shirt','t-shirt','hoodie','sweatshirt','jacket','sweater','ugly sweater','crewneck','pullover','glass','mug','pin','poster','sticker','hat','dad hat','snapback','beanie','bag','backpack','wallet','lanyard','patch','tumbler','jersey','figure','mechanic','pants','shoe','shoes','sock','socks'];
const BLOCKED_HANDLES = new Set(['red-line-club-exclusive-2025-hot-wheels-super-treasure-hunt-set-jcp51']);

function titleOf(product) { return String(product?.title || '').trim(); }
function isHotWheelsProduct(product) {
  const title = titleOf(product).toLowerCase();
  if (!title || EXCLUDED_TERMS.some(term => title.includes(term))) return false;
  return title.includes('hot wheels') || title.includes('rlc') || title.includes('red line club') || title.includes('elite 64');
}
function collectionIsRelevant(collection) {
  const haystack = `${collection?.handle || ''} ${collection?.title || ''}`.toLowerCase();
  return HOT_WHEELS_COLLECTION_TERMS.some(term => haystack.includes(term));
}
function variantState(product) {
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  const available = variants.filter(v => v?.available === true && v?.id);
  return {
    available: product?.available === true || available.length > 0,
    availableVariantIds: available.map(v => String(v.id)),
    variantIds: variants.filter(v => v?.id).map(v => String(v.id)),
    price: available[0]?.price ?? variants[0]?.price ?? product?.price ?? null,
    variantCount: variants.length
  };
}
function normalizeProduct(product, source, seenAt) {
  const variants = variantState(product);
  return {
    id: String(product.id), title: titleOf(product), handle: String(product.handle || ''),
    url: `https://creations.mattel.com/products/${product.handle}`,
    image: product?.images?.[0]?.src || product?.featured_image || product?.image || null,
    createdAt: product?.created_at || product?.createdAt || null,
    publishedAt: product?.published_at || product?.publishedAt || null,
    // Keep the catalog signal separate from the live product verification signal.
    // Mattel's catalog availability can disagree with /products/{handle}.json.
    catalogAvailable: variants.available,
    available: variants.available, availableVariantIds: variants.availableVariantIds,
    variantIds: variants.variantIds, variantCount: variants.variantCount, price: variants.price,
    source, firstObservedAt: seenAt
  };
}
function buildDiscovery(catalog, collectionProducts, seenAt) {
  const byId = new Map();
  const collectionIds = new Set(collectionProducts.map(item => String(item.id)));
  for (const product of catalog) {
    if (!product?.id || BLOCKED_HANDLES.has(product.handle) || !isHotWheelsProduct(product)) continue;
    const normalized = normalizeProduct(product, 'catalog', seenAt);
    normalized.inRelevantCollection = collectionIds.has(normalized.id);
    byId.set(normalized.id, normalized);
  }
  return Object.fromEntries(byId);
}
module.exports = { isHotWheelsProduct, collectionIsRelevant, normalizeProduct, buildDiscovery, BLOCKED_HANDLES };
