function parseFutureDate(value, nowMs) {
  if (!value) return null;
  const normalized = String(value).replace(/\s+PT\b/i, '');
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) && parsed > nowMs ? parsed : null;
}
function stripHtml(text) {
  return String(text || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ');
}
function parseUpcomingEvidence(html, nowMs = Date.now()) {
  const source = stripHtml(html).replace(/\s+/g, ' ');
  const evidence = [];
  let launchDate = null;
  const launch = source.match(/Launches\s+([A-Za-z]+\s+\d{1,2},\s+\d{4}(?:\s+\d{1,2}:\d{2}\s*(?:am|pm)\s*PT)?)/i);
  if (launch && parseFutureDate(launch[1], nowMs)) { launchDate = launch[1]; evidence.push({ type: 'launch-date', value: launch[1] }); }
  const ships = source.match(/Ships\s+(?:on\s+or\s+before|on)\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})/i);
  if (!launchDate && ships && parseFutureDate(ships[1], nowMs)) { launchDate = ships[1]; evidence.push({ type: 'ship-date', value: ships[1] }); }
  const comingSoon = /\bcoming\s+soon\b/i.test(source);
  const preorder = /\bpre[-\s]?order\b/i.test(source);
  if (comingSoon) evidence.push({ type: 'coming-soon' });
  if (preorder) evidence.push({ type: 'preorder' });
  const soldOut = /\b(?:sold\s*out|out\s*of\s*stock|unavailable)\b/i.test(source);
  const addToCart = /\b(?:add to bag|add to cart|buy now)\b/i.test(source);
  return { upcoming: Boolean(launchDate || comingSoon || (preorder && !soldOut)), launchDate, soldOutEvidence: soldOut, buyableEvidence: addToCart, evidence };
}
function classify(product, previous, pageInfo) {
  const wasAvailable = previous?.available === true;
  const available = product.available === true;
  const newlySeen = !previous;
  const collectionVisible = product.inRelevantCollection === true;
  const pageSoldOut = pageInfo?.soldOutEvidence === true;
  const pageBuyable = pageInfo?.buyableEvidence === true;
  const upcoming = pageInfo?.upcoming === true && !available;
  let hiddenScore = 0;
  const hiddenEvidence = [];
  if (newlySeen) { hiddenScore += 25; hiddenEvidence.push('new-to-scanner'); }
  if (!collectionVisible) { hiddenScore += 25; hiddenEvidence.push('not-in-relevant-collection'); }
  if (product.handle) { hiddenScore += 10; hiddenEvidence.push('direct-handle'); }
  if (product.image) { hiddenScore += 10; hiddenEvidence.push('image'); }
  if (product.price !== null && product.price !== undefined) { hiddenScore += 10; hiddenEvidence.push('price'); }
  if (product.variantCount > 0) { hiddenScore += 10; hiddenEvidence.push('variants'); }
  if (!pageSoldOut) { hiddenScore += 10; hiddenEvidence.push('not-explicitly-sold-out'); }
  if (pageSoldOut || upcoming || available) hiddenScore = 0;
  let status = 'UNKNOWN';
  if (available || pageBuyable) status = 'AVAILABLE';
  else if (upcoming) status = 'UPCOMING';
  else if (pageSoldOut) status = 'SOLD_OUT';
  const events = [];
  if (newlySeen && !upcoming && hiddenScore < 70) events.push('NEW_PRODUCT');
  if (!wasAvailable && available && previous) events.push('RESTOCK');
  if (wasAvailable && !available && previous) events.push('SOLD_OUT');
  if (!previous && upcoming) events.push('UPCOMING_DISCOVERY');
  if (previous && previous.upcoming !== true && upcoming) events.push('UPCOMING_DISCOVERY');
  if (!previous && hiddenScore >= 70) events.push('HIDDEN_DISCOVERY');
  if (previous && Number(previous.hiddenScore || 0) < 70 && hiddenScore >= 70) events.push('HIDDEN_DISCOVERY');
  if (previous && previous.price !== product.price && previous.price != null && product.price != null) events.push('PRICE_CHANGE');
  if (previous && !wasAvailable && available) events.push('BUYABLE');
  if (previous && wasAvailable && !available) events.push('UNBUYABLE');
  return { status, upcoming, launchDate: pageInfo?.launchDate || null, hiddenScore, hiddenEvidence, events };
}
module.exports = { parseUpcomingEvidence, classify };
