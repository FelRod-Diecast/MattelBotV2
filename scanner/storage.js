const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(process.cwd(), 'data');
const FILES = {
  products: path.join(DATA_DIR, 'products.json'),
  snapshot: path.join(DATA_DIR, 'snapshot.json'),
  events: path.join(DATA_DIR, 'events.json'),
  state: path.join(DATA_DIR, 'state.json')
};
function ensureDataDir() { fs.mkdirSync(DATA_DIR, { recursive: true }); }
function readJson(file, fallback) { ensureDataDir(); try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function writeJson(file, value) { ensureDataDir(); const temp = `${file}.tmp`; fs.writeFileSync(temp, JSON.stringify(value, null, 2)); fs.renameSync(temp, file); }
function loadProducts() { return readJson(FILES.products, {}); }
function saveProducts(value) { writeJson(FILES.products, value); }
function loadSnapshot() { return readJson(FILES.snapshot, { scannedAt: null, products: {} }); }
function saveSnapshot(value) { writeJson(FILES.snapshot, value); }
function loadEvents() { return readJson(FILES.events, []); }
function saveEvents(value) { writeJson(FILES.events, value.slice(-5000)); }
function loadState() { return readJson(FILES.state, { scannerVersion: 1, lastSuccessfulScanAt: null, lastCatalogHash: null, lastEventId: 0, consecutiveFailures: 0 }); }
function saveState(value) { writeJson(FILES.state, value); }
function bootstrapLegacy() {
  ensureDataDir();
  if (fs.existsSync(FILES.products)) return false;
  const legacyFile = path.join(process.cwd(), 'scanData.json');
  if (!fs.existsSync(legacyFile)) return false;
  const legacy = readJson(legacyFile, {});
  const products = {};
  for (const [id, item] of Object.entries(legacy)) {
    const firstSeen = item.firstSeen || item.detectedAt || new Date().toISOString();
    products[String(id)] = {
      id: String(id), title: item.title || 'Unknown Mattel Product', handle: item.handle || '',
      url: item.url || (item.handle ? `https://creations.mattel.com/products/${item.handle}` : ''), image: item.image || null,
      createdAt: item.catalogCreatedAt || null, publishedAt: item.publishedAt || null, available: item.available === true,
      availableVariantIds: item.available && item.variantId ? [String(item.variantId)] : [],
      variantIds: item.variantId ? [String(item.variantId)] : [], variantCount: item.variantId ? 1 : 0,
      price: item.price ?? null, source: 'legacy-scanData', firstObservedAt: firstSeen, firstSeenAt: firstSeen,
      firstSeenAvailableAt: item.available ? firstSeen : null, firstSeenUpcomingAt: item.upcoming ? firstSeen : null,
      firstSeenHiddenAt: item.wasHidden ? firstSeen : null, status: item.available ? 'AVAILABLE' : (item.upcoming ? 'UPCOMING' : 'UNKNOWN'),
      upcoming: item.upcoming === true, launchDate: item.launchDate || null, hiddenScore: item.wasHidden ? 70 : 0,
      hiddenEvidence: item.wasHidden ? ['legacy-hidden-state'] : [], pageEvidence: [], lastVerifiedAt: null
    };
  }
  saveProducts(products);
  saveSnapshot({ scannedAt: null, products });
  return true;
}
function nextEventId(state) { state.lastEventId = Number(state.lastEventId || 0) + 1; return state.lastEventId; }
module.exports = { DATA_DIR, FILES, loadProducts, saveProducts, loadSnapshot, saveSnapshot, loadEvents, saveEvents, loadState, saveState, nextEventId, bootstrapLegacy };
