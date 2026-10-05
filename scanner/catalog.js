const BASE = 'https://creations.mattel.com';
const USER_AGENT = 'MattelBotV2/ScannerEngine';
const TIMEOUT_MS = 15000;

async function fetchJson(url) {
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.text();
}

async function fetchCatalog() {
  const products = [];
  const seen = new Set();
  for (let page = 1; page <= 20; page++) {
    const data = await fetchJson(`${BASE}/products.json?limit=250&page=${page}`);
    const batch = Array.isArray(data.products) ? data.products : [];
    if (!batch.length) break;
    for (const product of batch) {
      const id = String(product?.id || '');
      if (id && !seen.has(id)) { seen.add(id); products.push(product); }
    }
    if (batch.length < 250) break;
  }
  return products;
}

async function fetchCollections() {
  const data = await fetchJson(`${BASE}/collections.json?limit=250`);
  return Array.isArray(data.collections) ? data.collections : [];
}

async function fetchCollectionProducts(handle, maxPages = 1) {
  const products = [];
  const seen = new Set();
  for (let page = 1; page <= maxPages; page++) {
    const data = await fetchJson(`${BASE}/collections/${encodeURIComponent(handle)}/products.json?limit=250&page=${page}`);
    const batch = Array.isArray(data.products) ? data.products : [];
    if (!batch.length) break;
    for (const product of batch) {
      const id = String(product?.id || '');
      if (id && !seen.has(id)) { seen.add(id); products.push(product); }
    }
    if (batch.length < 250) break;
  }
  return products;
}

async function fetchProductPage(handle) { return fetchText(`${BASE}/products/${encodeURIComponent(handle)}`); }

module.exports = { BASE, fetchCatalog, fetchCollections, fetchCollectionProducts, fetchProductPage };
