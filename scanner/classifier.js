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
  // A sold-out page is never an upcoming/buyable opportunity, even if its copy still says "coming soon".
  const upcoming = Boolean(!soldOut && (launchDate || comingSoon || (preorder && !addToCart)));
  return { upcoming, launchDate, soldOutEvidence: soldOut, buyableEvidence: addToCart, verified: true, evidence };
}
function classify(product, previous, pageInfo) {
  const wasAvailable = previous?.available === true;
  const available = product.available === true;
  const newlySeen = !previous;
  const collectionVisible = product.inRelevantCollection === true;
  const pageSoldOut = pageInfo?.soldOutEvidence === true;
  const pageBuyable = pageInfo?.buyableEvidence === true;
  const pageVerified = pageInfo?.verified === true;
  const upcoming = pageInfo?.upcoming === true && !available && !pageBuyable;
  let hiddenScore = 0;
  const hiddenEvidence = [];
  if (newlySeen) { hiddenScore += 25; hiddenEvidence.push('new-to-scanner'); }
  if (!collectionVisible) { hiddenScore += 25; hiddenEvidence.push('not-in-relevant-collection'); }
  if (product.handle) { hiddenScore += 10; hiddenEvidence.push('direct-handle'); }
  if (product.image) { hiddenScore += 10; hiddenEvidence.push('image'); }
  if (product.price !== null && product.price !== undefined) { hiddenScore += 10; hiddenEvidence.push('price'); }
  if (product.variantCount > 0) { hiddenScore += 10; hiddenEvidence.push('variants'); }
  if (!pageSoldOut) { hiddenScore += 10; hiddenEvidence.push('not-explicitly-sold-out'); }
  // Never call something hidden on catalog evidence alone. A page verification is required
  // before the 70-point hidden threshold can be reached; this prevents the first 60-page
  // verification cap from turning ordinary catalog products into hidden alerts.
  if (!pageVerified) hiddenScore = Math.min(hiddenScore, 60);
  if (pageSoldOut || upcoming || available || pageBuyable) hiddenScore = 0;
  let status = 'UNKNOWN';
  if (available || pageBuyable) status = 'AVAILABLE';
  else if (upcoming) status = 'UPCOMING';
  else if (pageSoldOut) status = 'SOLD_OUT';
  const events = [];
  const restock = !wasAvailable && available && Boolean(previous);
  const soldOut = wasAvailable && !available && Boolean(previous);
  if (newlySeen && !pageSoldOut && !upcoming && !pageBuyable && hiddenScore < 70) events.push('NEW_PRODUCT');
  if (restock) events.push('RESTOCK');
  if (soldOut) events.push('SOLD_OUT');
  if (!previous && upcoming) events.push('UPCOMING_DISCOVERY');
  if (previous && previous.upcoming !== true && upcoming) events.push('UPCOMING_DISCOVERY');
  if (!previous && hiddenScore >= 70) events.push('HIDDEN_DISCOVERY');
  if (previous && Number(previous.hiddenScore || 0) < 70 && hiddenScore >= 70) events.push('HIDDEN_DISCOVERY');
  if (previous && previous.price !== product.price && previous.price != null && product.price != null) events.push('PRICE_CHANGE');
  if (previous && !restock && !wasAvailable && available) events.push('BUYABLE');
  if (previous && !soldOut && wasAvailable && !available) events.push('UNBUYABLE');
  return { status, upcoming, launchDate: pageInfo?.launchDate || null, hiddenScore, hiddenEvidence, events };
}
module.exports = { parseUpcomingEvidence, classify };
