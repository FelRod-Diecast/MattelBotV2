const crypto = require('crypto');
const { fetchCatalog, fetchCollections, fetchCollectionProducts, fetchProductJson, fetchProductPage } = require('./catalog');
const { collectionIsRelevant, buildDiscovery } = require('./discovery');
const { parseUpcomingEvidence, classify } = require('./classifier');
const { loadProducts, saveProducts, loadSnapshot, saveSnapshot, loadEvents, saveEvents, loadState, saveState, nextEventId, bootstrapLegacy } = require('./storage');
const { notify } = require('./notifier');

const TRANSITION_EVENTS = ['RESTOCK', 'SOLD_OUT', 'BUYABLE', 'UNBUYABLE', 'PRICE_CHANGE', 'NEW_PRODUCT', 'HIDDEN_DISCOVERY', 'UPCOMING_DISCOVERY'];

function selectRoundRobin(entries, limit, cursor) {
  if (!entries.length || limit <= 0) return { selected: new Set(), nextCursor: 0 };
  const start = cursor % entries.length;
  const count = Math.min(limit, entries.length);
  const selected = new Set();
  for (let i = 0; i < count; i++) selected.add(entries[(start + i) % entries.length][0]);
  return { selected, nextCursor: (start + count) % entries.length };
}

class MattelScanner {
  constructor({ channel, logger = console }) {
    this.channel = channel;
    this.logger = logger;
    this.running = false;
    this.lastCollectionRefresh = 0;
    this.collectionProductCache = [];
    this.jsonVerificationCursor = 0;
    this.pageVerificationCursor = 0;
  }
  async refreshCollectionSurface(nowMs) {
    if (nowMs - this.lastCollectionRefresh < 15 * 60 * 1000 && this.collectionProductCache.length) return;
    let collections;
    try { collections = await fetchCollections(); }
    catch (error) { this.logger.warn(`[DISCOVERY] Collection surface unavailable: ${error.message}`); return; }
    const relevant = collections.filter(collectionIsRelevant).slice(0, 12);
    const combined = [];
    for (const collection of relevant) {
      try { combined.push(...await fetchCollectionProducts(collection.handle, 1)); }
      catch (error) { this.logger.warn(`[DISCOVERY] Collection failed: ${collection.handle}: ${error.message}`); }
    }
    this.collectionProductCache = combined;
    this.lastCollectionRefresh = nowMs;
    this.logger.log(`[DISCOVERY] Relevant collections: ${relevant.length}; collection products: ${combined.length}`);
  }
  async scan() {
    if (this.running) return { skipped: true };
    this.running = true;
    const started = Date.now();
    const bootstrapped = bootstrapLegacy();
    const state = loadState();
    const previousSnapshot = loadSnapshot();
    const previousProducts = loadProducts();
    const events = loadEvents();
    try {
      await this.refreshCollectionSurface(started);
      const catalog = await fetchCatalog();
      const discovery = buildDiscovery(catalog, this.collectionProductCache, new Date(started).toISOString());
      const entries = Object.entries(discovery);
      const current = {};
      const emitted = [];
      let jsonChecks = 0;
      let pageChecks = 0;

      const jsonCandidates = entries.filter(([id, product]) => {
        const previous = previousProducts[id] || previousSnapshot.products[id] || null;
        return !previous || previous.catalogAvailable === undefined || previous.catalogAvailable !== product.catalogAvailable || previous.upcoming === true || Number(previous.hiddenScore || 0) >= 70;
      });
      const jsonSelection = selectRoundRobin(jsonCandidates, 80, this.jsonVerificationCursor);
      this.jsonVerificationCursor = jsonSelection.nextCursor;

      const priorityPageCandidates = entries.filter(([id]) => {
        const previous = previousProducts[id] || previousSnapshot.products[id] || null;
        return !previous || previous.upcoming === true || Number(previous.hiddenScore || 0) >= 70;
      });
      const regularPageCandidates = entries.filter(([id, product]) => {
        const previous = previousProducts[id] || previousSnapshot.products[id] || null;
        return product.catalogAvailable === false && previous?.upcoming !== true && Number(previous?.hiddenScore || 0) < 70;
      });
      const pageSelected = new Set(priorityPageCandidates.slice(0, 60).map(([id]) => id));
      const remainingPageBudget = Math.max(0, 60 - pageSelected.size);
      if (remainingPageBudget > 0 && regularPageCandidates.length) {
        const regularSelection = selectRoundRobin(regularPageCandidates, remainingPageBudget, this.pageVerificationCursor);
        for (const id of regularSelection.selected) pageSelected.add(id);
        this.pageVerificationCursor = regularSelection.nextCursor;
      }

      for (const [id, product] of entries) {
        const previous = previousProducts[id] || previousSnapshot.products[id] || null;
        const shouldVerifyJson = jsonSelection.selected.has(id) && Boolean(product.handle);
        const shouldVerifyPage = pageSelected.has(id) && Boolean(product.handle);
        let jsonVerified = false;
        let pageInfo = { upcoming: false, launchDate: null, soldOutEvidence: false, buyableEvidence: false, verified: false, evidence: [] };

        if (shouldVerifyJson) {
          try {
            const data = await fetchProductJson(product.handle);
            const live = data?.product || data;
            const variants = Array.isArray(live?.variants) ? live.variants : [];
            const availableVariants = variants.filter(v => v?.available === true && v?.id);
            product.available = live?.available === true || availableVariants.length > 0;
            product.availableVariantIds = availableVariants.map(v => String(v.id));
            product.variantIds = variants.filter(v => v?.id).map(v => String(v.id));
            product.variantCount = variants.length;
            product.price = availableVariants[0]?.price ?? variants[0]?.price ?? live?.price ?? product.price;
            jsonChecks++;
            jsonVerified = true;
          } catch (error) {
            this.logger.warn(`[VERIFY-JSON] ${product.handle}: ${error.message}`);
          }
        }

        if (shouldVerifyPage) {
          try {
            pageInfo = parseUpcomingEvidence(await fetchProductPage(product.handle), started);
            pageChecks++;
          } catch (error) {
            this.logger.warn(`[VERIFY-PAGE] ${product.handle}: ${error.message}`);
          }
        }

        const result = classify(product, previous, pageInfo);
        Object.assign(product, {
          status: result.status, upcoming: result.upcoming, launchDate: result.launchDate,
          hiddenScore: result.hiddenScore, hiddenEvidence: result.hiddenEvidence,
          catalogAvailable: product.catalogAvailable,
          pageEvidence: pageInfo.verified ? pageInfo.evidence : (previous?.pageEvidence || []),
          lastVerifiedAt: jsonVerified || pageInfo.verified ? new Date().toISOString() : (previous?.lastVerifiedAt || null),
          firstSeenAt: previous?.firstSeenAt || product.firstObservedAt,
          firstSeenAvailableAt: previous?.firstSeenAvailableAt || (product.available ? product.firstObservedAt : null),
          firstSeenUpcomingAt: previous?.firstSeenUpcomingAt || (product.upcoming ? product.firstObservedAt : null),
          firstSeenHiddenAt: previous?.firstSeenHiddenAt || (result.hiddenScore >= 70 ? product.firstObservedAt : null)
        });
        current[id] = product;

        for (const eventType of result.events) {
          if (bootstrapped && TRANSITION_EVENTS.includes(eventType)) continue;
          const duplicate = events.some(e => e.productId === id && e.type === eventType && Date.now() - Date.parse(e.detectedAt || 0) < 10 * 60 * 1000);
          if (duplicate) continue;
          const event = { id: nextEventId(state), type: eventType, productId: id, handle: product.handle, title: product.title, detectedAt: new Date().toISOString(), status: product.status, launchDate: product.launchDate, price: product.price, source: 'Mattel Creations', evidence: { hiddenScore: product.hiddenScore, hiddenEvidence: product.hiddenEvidence, pageEvidence: product.pageEvidence } };
          events.push(event); emitted.push(event);
        }
      }

      const catalogHash = crypto.createHash('sha256').update(JSON.stringify(Object.keys(current).sort())).digest('hex');
      saveProducts(current); saveSnapshot({ scannedAt: new Date(started).toISOString(), products: current }); saveEvents(events);
      state.lastSuccessfulScanAt = new Date(started).toISOString(); state.lastCatalogHash = catalogHash; state.consecutiveFailures = 0; saveState(state);
      for (const event of emitted) {
        if (['NEW_PRODUCT', 'HIDDEN_DISCOVERY', 'UPCOMING_DISCOVERY', 'RESTOCK', 'BUYABLE'].includes(event.type)) await notify(this.channel, event.type, current[event.productId]);
      }
      this.logger.log(`[SCAN] Complete: ${Object.keys(current).length} Hot Wheels products; JSON checks ${jsonChecks}; page checks ${pageChecks}; ${emitted.length} events`);
      return { scanned: Object.keys(current).length, jsonChecks, pageChecks, events: emitted };
    } catch (error) {
      state.consecutiveFailures = Number(state.consecutiveFailures || 0) + 1;
      saveState(state);
      this.logger.error('[SCAN] Failed:', error);
      throw error;
    } finally {
      this.running = false;
    }
  }
}
module.exports = { MattelScanner };
