const BASE = 'https://creations.mattel.com';
const USER_AGENT = 'MattelBotV2/ScannerEngine';
const TIMEOUT_MS = 15000;
const RETRIES = 3;

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function request(url, accept) {
  let lastError;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: accept },
        signal: AbortSignal.timeout(TIMEOUT_MS)
      });
      if (response.ok) return response;
      if (response.status !== 429 && response.status < 500) {
        throw new Error(`HTTP ${response.status} for ${url}`);
      }
      const retryAfter = Number(response.headers.get('retry-after'));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 30000)
        : Math.min(5000 * (attempt + 1), 30000);
      lastError = new Error(`HTTP ${response.status} for ${url}`);
      if (attempt < RETRIES) await sleep(waitMs);
    } catch (error) {
      lastError = error;
      if (attempt < RETRIES) await sleep(Math.min(5000 * (attempt + 1), 30000));
    }
  }
  throw lastError;
}

async function fetchJson(url) {
  const response = await request(url, 'application/json');
  return response.json();
}

async function fetchText(url) {
  const response = await request(url, 'text/html,application/xhtml+xml');
  return response.text();
}

async function fetchCatalog() {
  const products = []; const seen = new Set();
  for (let page = 1; page <= 20; page++) {
    try {
      const data = await fetchJson(`${BASE}/products.json?limit=250&page=${page}`);
      const batch = Array.isArray(data.products) ? data.products : [];
      if (!batch.length) break;
      for (const product of batch) {
        const id = String(product?.id || '');
        if (id && !seen.has(id)) { seen.add(id); products.push(product); }
      }
      if (batch.length < 250) break;
    } catch (error) {
      if (products.length) {
        console.warn(`[CATALOG] Page ${page} failed; using ${products.length} products collected so far: ${error.message}`);
        break;
      }
      throw error;
    }
  }
  return products;
}

async function fetchCollections() {
  const data = await fetchJson(`${BASE}/collections.json?limit=250`);
  return Array.isArray(data.collections) ? data.collections : [];
}

async function fetchCollectionProducts(handle, maxPages = 1) {
  const products = []; const seen = new Set();
  for (let page = 1; page <= maxPages; page++) {
    try {
      const data = await fetchJson(`${BASE}/collections/${encodeURIComponent(handle)}/products.json?limit=250&page=${page}`);
      const batch = Array.isArray(data.products) ? data.products : [];
      if (!batch.length) break;
      for (const product of batch) {
        const id = String(product?.id || '');
        if (id && !seen.has(id)) { seen.add(id); products.push(product); }
      }
      if (batch.length < 250) break;
    } catch (error) {
      throw error;
    }
  }
  return products;
}

async function fetchProductJson(handle) { return fetchJson(`${BASE}/products/${encodeURIComponent(handle)}.json`); }
async function fetchProductPage(handle) { return fetchText(`${BASE}/products/${encodeURIComponent(handle)}`); }

module.exports = { BASE, fetchCatalog, fetchCollections, fetchCollectionProducts, fetchProductJson, fetchProductPage };