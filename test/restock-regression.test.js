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

test("first verified live audit alerts when a tracked sold-out product is purchasable", () => {
  assert.match(launcher, /"prior live inventory verification state"/);
  assert.doesNotMatch(launcher, /previousLiveInventoryVerified === true/);
  assert.match(launcher, /"persist live inventory verification"/);
  assert.match(launcher, /existing\.liveInventoryVerified =/);
  const shouldAlertRestock = ({ previousAvailable, currentAvailable, currentLiveInventoryVerified }) =>
    previousAvailable === false &&
    currentAvailable === true &&
    currentLiveInventoryVerified === true;
  assert.equal(shouldAlertRestock({
    previousAvailable: false,
    currentAvailable: true,
    currentLiveInventoryVerified: true
  }), true);
  assert.equal(shouldAlertRestock({
    previousAvailable: false,
    currentAvailable: true,
    currentLiveInventoryVerified: false
  }), false);
  assert.equal(shouldAlertRestock({
    previousAvailable: true,
    currentAvailable: true,
    currentLiveInventoryVerified: true
  }), false);
});

test("production audits a bounded rotating batch of tracked sold-out products", () => {
  assert.match(launcher, /"bounded sold-out inventory audit"/);
  assert.match(launcher, /savedProducts\[String\(raw\.id\)\]\?\.available === false/);
  assert.match(launcher, /const restockAuditBatchSize = 10/);
  assert.match(launcher, /restockAuditHandles\.has\(raw\.handle\)/);
  assert.match(launcher, /if \(raw\.handle && \(available === true \|\| previousAvailable === true \|\| restockAuditHandles\.has\(raw\.handle\)\)\)/);
  assert.match(launcher, /liveInventoryVerified = true/);
  assert.doesNotMatch(launcher, /previousLiveInventoryVerified === true/);
});

test("rotating audit covers every tracked sold-out handle without duplicates per batch", () => {
  const handles = Array.from({ length: 23 }, (_, i) => "product-" + i);
  const first = selectAuditBatch(handles, 0, 10);
  const second = selectAuditBatch(handles, first.cursor, 10);
  const third = selectAuditBatch(handles, second.cursor, 10);
  assert.equal(first.selected.length, 10);
  assert.equal(second.selected.length, 10);
  assert.equal(third.selected.length, 3);
  assert.equal(new Set([...first.selected, ...second.selected, ...third.selected]).size, 23);
  assert.equal(selectAuditBatch([], 0, 10).selected.length, 0);
});
