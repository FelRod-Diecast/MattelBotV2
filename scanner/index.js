const crypto = require('crypto');
const { fetchCatalog, fetchCollections, fetchCollectionProducts, fetchProductJson, fetchProductPage } = require('./catalog');
const { collectionIsRelevant, buildDiscovery } = require('./discovery');
const { parseUpcomingEvidence, classify } = require('./classifier');
const { loadProducts, saveProducts, loadSnapshot, saveSnapshot, loadEvents, saveEvents, loadState, saveState, nextEventId, bootstrapLegacy } = require('./storage');
const { notify } = require('./notifier');

class MattelScanner {
  constructor({ channel, logger = console }) { this.channel = channel; this.logger = logger; this.running = false; this.lastCollectionRefresh = 0; this.collectionProductCache = []; }
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
    bootstrapLegacy();
    const state = loadState();
    const previousSnapshot = loadSnapshot();
    const previousProducts = loadProducts();
    const events = loadEvents();
    try {
      await this.refreshCollectionSurface(started);
      const catalog = await fetchCatalog();
      const discovery = buildDiscovery(catalog, this.collectionProductCache, new Date(started).toISOString());
      const current = {};
      const emitted = [];
      let jsonChecks = 0;
      let pageChecks = 0;
      for (const [id, product] of Object.entries(discovery)) {
        const previous = previousProducts[id] || previousSnapshot.products[id] || null;
        const shouldVerify = !previous || previous.available !== product.available || previous.upcoming === true || Number(previous.hiddenScore || 0) >= 70;
        let pageInfo = { upcoming: false, launchDate: null, soldOutEvidence: false, buyableEvidence: false, evidence: [] };

        if (shouldVerify && product.handle && jsonChecks < 80) {
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
          } catch (error) {
            this.logger.warn(`[VERIFY-JSON] ${product.handle}: ${error.message}`);
          }
        }

        const needsPageEvidence = !product.available || previous?.upcoming === true || Number(previous?.hiddenScore || 0) >= 70 || !previous;
        if (needsPageEvidence && product.handle && pageChecks < 60) {
          try { pageInfo = parseUpcomingEvidence(await fetchProductPage(product.handle), started); pageChecks++; }
          catch (error) { this.logger.warn(`[VERIFY-PAGE] ${product.handle}: ${error.message}`); }
        }

        const result = classify(product, previous, pageInfo);
        Object.assign(product, {
          status: result.status, upcoming: result.upcoming, launchDate: result.launchDate,
          hiddenScore: result.hiddenScore, hiddenEvidence: result.hiddenEvidence,
          pageEvidence: pageInfo.evidence, lastVerifiedAt: new Date().toISOString(),
          firstSeenAt: previous?.firstSeenAt || product.firstObservedAt,
          firstSeenAvailableAt: previous?.firstSeenAvailableAt || (product.available ? product.firstObservedAt : null),
          firstSeenUpcomingAt: previous?.firstSeenUpcomingAt || (product.upcoming ? product.firstObservedAt : null),
          firstSeenHiddenAt: previous?.firstSeenHiddenAt || (result.hiddenScore >= 70 ? product.firstObservedAt : null)
        });
        current[id] = product;
        for (const eventType of result.events) {
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
        if (['NEW_PRODUCT','HIDDEN_DISCOVERY','UPCOMING_DISCOVERY','RESTOCK','BUYABLE'].includes(event.type)) await notify(this.channel, event.type, current[event.productId]);
      }
      this.logger.log(`[SCAN] Complete: ${Object.keys(current).length} Hot Wheels products; JSON checks ${jsonChecks}; page checks ${pageChecks}; ${emitted.length} events`);
      return { scanned: Object.keys(current).length, jsonChecks, pageChecks, events: emitted };
    } catch (error) {
      state.consecutiveFailures = Number(state.consecutiveFailures || 0) + 1; saveState(state); this.logger.error('[SCAN] Failed:', error); throw error;
    } finally { this.running = false; }
  }
}
module.exports = { MattelScanner };
