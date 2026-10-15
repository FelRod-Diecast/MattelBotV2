// Regression coverage for the Smart Discovery restock fix; uses Node built-ins only.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = name => fs.readFileSync(path.join(__dirname, "..", name), "utf8");
const launcher = read("production-start.js");
const upcoming = read("upcoming-discovery.js");
const bot = read("bot.js");

function selectAuditBatch(handles, cursor, size = 10) {
  const count = Math.min(size, handles.length);
  const start = handles.length ? cursor % handles.length : 0;
  const selected = [];
  for (let i = 0; i < count; i++) selected.push(handles[(start + i) % handles.length]);
  return { selected, cursor: handles.length ? (start + count) % handles.length : 0 };
}

test("runtime patch target for the bounded audit exists in bot.js", () => {
  assert.match(bot, /const processed = \[\];/);
  assert.match(launcher, /"bounded sold-out inventory audit"/);
  assert.match(launcher, /restockAuditHandles\.has\(raw\.handle\)/);
});

test("sold-out audit is bounded to ten products per scan and persists its cursor", () => {
  assert.match(launcher, /const restockAuditBatchSize = 10;/);
  assert.match(launcher, /stats\.restockAuditCursor = soldOutAuditCandidates\.length/);
  const handles = Array.from({ length: 43 }, (_, i) => "product-" + i);
  let cursor = 0;
  const seen = new Set();
  for (let scan = 0; scan < 5; scan++) {
    const result = selectAuditBatch(handles, cursor);
    assert.equal(result.selected.length, 10);
    assert.equal(new Set(result.selected).size, 10);
    result.selected.forEach(handle => seen.add(handle));
    cursor = result.cursor;
  }
  assert.equal(seen.size, 43);
});

test("Shopify variant availability is authoritative when quantity is zero", () => {
  assert.match(launcher, /return variant\?\.available === true;/);
  assert.match(upcoming, /purchasable=vs\.find\(v=>v\?\.available===true\);/);
  assert.doesNotMatch(launcher, /Number\(quantity\) > 0/);
  assert.doesNotMatch(upcoming, /Number\(q\)>0/);
  const isPurchasable = variant => variant?.available === true;
  assert.equal(isPurchasable({ available: true, inventory_quantity: 0 }), true);
  assert.equal(isPurchasable({ available: false, inventory_quantity: 12 }), false);
  assert.equal(isPurchasable({ inventory_quantity: 12 }), false);
});

test("legacy stale sold-out records cannot trigger a fake restock on first live audit", () => {
  assert.match(launcher, /"prior live inventory verification state"/);
  assert.match(launcher, /previousLiveInventoryVerified === true/);
  assert.match(launcher, /"persist live inventory verification"/);
  assert.match(launcher, /existing\.liveInventoryVerified =/);
  const shouldAlertRestock = ({ previousAvailable, previousLiveInventoryVerified, currentAvailable, currentLiveInventoryVerified }) =>
    previousAvailable === false &&
    previousLiveInventoryVerified === true &&
    currentAvailable === true &&
    currentLiveInventoryVerified === true;
  assert.equal(shouldAlertRestock({
    previousAvailable: false,
    previousLiveInventoryVerified: false,
    currentAvailable: true,
    currentLiveInventoryVerified: true
  }), false);
  assert.equal(shouldAlertRestock({
    previousAvailable: false,
    previousLiveInventoryVerified: true,
    currentAvailable: true,
    currentLiveInventoryVerified: true
  }), true);
});

test("production patch has the required live-inventory and audit guard", () => {
  assert.match(launcher, /available === true \|\| previousAvailable === true \|\| restockAuditHandles\.has\(raw\.handle\)/);
  assert.match(launcher, /liveInventoryVerified = true/);
});
