require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");
const fs = require("fs");
const cron = require("node-cron");

const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

const DATA_FILE = "./scanData.json";
const STATS_FILE = "./stats.json";
const ALERTS_FILE = "./alerts.json";
const WATCHLIST_FILE = "./watchlist.json";
const CHANNEL_ID = process.env.CHANNEL_ID;

const BLOCKED_HANDLES = new Set([
  "red-line-club-exclusive-2025-hot-wheels-super-treasure-hunt-set-jcp51"
]);

const DEFAULT_WATCHLIST = [
  "silverado",
  "tahoe",
  "c10",
  "4runner",
  "blazer",
  "mustang",
  "ferrari",
  "porsche",
  "boulevard"
];

const EXCLUDED_TERMS = [
  "shirt",
  "t-shirt",
  "hoodie",
  "sweatshirt",
  "jacket",
  "sweater",
  "ugly sweater",
  "crewneck",
  "pullover",
  "glass",
  "mug",
  "pin",
  "poster",
  "sticker",
  "hat",
  "dad hat",
  "snapback",
  "beanie",
  "bag",
  "backpack",
  "wallet",
  "lanyard",
  "patch",
  "tumbler",
  "jersey",
  "figure",
  "mechanic",
  "pants",
  "shoe",
  "shoes",
  "sock",
  "socks"
];

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

let scanInProgress = false;
let scannerStarted = false;

// =========================
// JSON STORAGE
// =========================

function readJson(file, fallback) {
  try {
    return JSON.parse(
      fs.readFileSync(file, "utf8")
    );
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(
    file,
    JSON.stringify(data, null, 2)
  );
}

function loadProducts() {
  return readJson(DATA_FILE, {});
}

function saveProducts(data) {
  writeJson(DATA_FILE, data);
}

function loadStats() {
  return readJson(STATS_FILE, {
    newProductsToday: 0,
    restocksToday: 0,
    soldOutToday: 0,
    priceChangesToday: 0,
    lastScanAt: null
  });
}

function saveStats(stats) {
  writeJson(STATS_FILE, stats);
}

function loadAlerts() {
  return readJson(ALERTS_FILE, []);
}

function saveAlerts(alerts) {
  writeJson(
    ALERTS_FILE,
    alerts.slice(0, 25)
  );
}

function loadWatchlist() {
  return readJson(
    WATCHLIST_FILE,
    DEFAULT_WATCHLIST
  );
}

function saveWatchlist(list) {
  writeJson(
    WATCHLIST_FILE,
    list
  );
}

// =========================
// HOT WHEELS FILTER
// =========================

function isHotWheelsProduct(product) {
  const title =
    String(product?.title || "")
      .toLowerCase()
      .trim();

  if (!title) {
    return false;
  }

  if (
    EXCLUDED_TERMS.some(term =>
      title.includes(term)
    )
  ) {
    return false;
  }

  return (
    title.includes("hot wheels") ||
    title.includes("rlc") ||
    title.includes("red line club") ||
    title.includes("elite 64")
  );
}

// =========================
// PRODUCT HELPERS
// =========================

function productUrl(handle) {
  return `https://creations.mattel.com/products/${handle}`;
}

function getPrice(product) {
  const variant =
    product?.variants?.find(v => v.available) ||
    product?.variants?.[0];

  return variant?.price || null;
}

function getAvailable(product) {
  return Boolean(
    product?.variants?.some(v => v.available)
  );
}

function getVariantId(product) {
  const variant =
    product?.variants?.find(v => v.available) ||
    product?.variants?.[0];

  return variant?.id || null;
}

function getImage(product) {
  return product?.images?.[0]?.src || null;
}

function getCatalogCreatedAt(product) {
  return (
    product?.created_at ||
    product?.createdAt ||
    null
  );
}

function getPublishedAt(product) {
  return (
    product?.published_at ||
    product?.publishedAt ||
    null
  );
}

// =========================
// LAUNCH DETECTION
// =========================

function getLaunchInfoFromHtml(html) {
  const match = String(html || "").match(
    /Launches\s+([A-Za-z]+\s+\d{1,2},\s+\d{4}\s+\d{1,2}:\d{2}\s*(?:am|pm)\s*PT)/i
  );

  if (!match) {
    return {
      upcoming: false,
      launchDate: null
    };
  }

  const parsed =
    new Date(match[1]);

  if (
    Number.isNaN(
      parsed.getTime()
    )
  ) {
    return {
      upcoming: false,
      launchDate: match[1]
    };
  }

  return {
    upcoming:
      parsed.getTime() > Date.now(),

    launchDate:
      match[1]
  };
}

// =========================
// PRODUCT PAGE VERIFICATION
// =========================

async function fetchProductPageInfo(
  handle,
  shouldCheckLaunch
) {
  const url =
    productUrl(handle);

  try {
    const response =
      await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154 Safari/537.36"
        }
      });

    if (!response.ok) {
      return {
        productPageFetched: false,
        explicitlySoldOut: false,
        upcoming: false,
        launchDate: null
      };
    }

    const html =
      await response.text();

    const lower =
      html.toLowerCase();

    const explicitlySoldOut =
      lower.includes("sold out") ||
      lower.includes("out of stock") ||
      lower.includes("unavailable");

    const launchInfo =
      shouldCheckLaunch
        ? getLaunchInfoFromHtml(html)
        : {
            upcoming: false,
            launchDate: null
          };

    return {
      productPageFetched: true,
      explicitlySoldOut,
      upcoming:
        launchInfo.upcoming,
      launchDate:
        launchInfo.launchDate
    };

  } catch (error) {

    console.error(
      `⚠️ Product page check failed: ${handle}`,
      error.message
    );

    return {
      productPageFetched: false,
      explicitlySoldOut: false,
      upcoming: false,
      launchDate: null
    };
  }
}

// =========================
// MATTEL CATALOG
// =========================

async function getMattelProducts() {

  const allProducts = [];
  const seenIds = new Set();

  let page = 1;

  while (true) {

    const response =
      await fetch(
        `https://creations.mattel.com/products.json?limit=250&page=${page}`
      );

    const text =
      await response.text();

    if (
      text.startsWith("<!DOCTYPE") ||
      text.startsWith("<html")
    ) {
      break;
    }

    let data;

    try {
      data =
        JSON.parse(text);
    } catch {
      break;
    }

    if (
      !Array.isArray(
        data.products
      ) ||
      data.products.length === 0
    ) {
      break;
    }

    for (
      const product of data.products
    ) {

      const id =
        String(product.id);

      if (
        seenIds.has(id)
      ) {
        continue;
      }

      seenIds.add(id);
      allProducts.push(product);
    }

    console.log(
      `📄 Loaded page ${page} (${data.products.length} products)`
    );

    page++;
  }

  console.log(
    `📦 Mattel catalog collected: ${allProducts.length} unique products`
  );

  return allProducts;
}

// =========================
// DISCORD EMBEDS
// =========================

function makeEmbed(
  title,
  color,
  product,
  fields
) {

  const embed =
    new EmbedBuilder()
      .setColor(color)
      .setTitle(title)
      .setURL(product.url)
      .addFields(fields)
      .setFooter({
        text: "MattelBotV2"
      });

  if (product.image) {
    embed.setThumbnail(
      product.image
    );
  }

  return embed;
}

function cartRow(
  variantId
) {

  if (!variantId) {
    return null;
  }

  return new ActionRowBuilder()
    .addComponents(

      new ButtonBuilder()
        .setLabel("🛒 QTY 2")
        .setStyle(ButtonStyle.Link)
        .setURL(
          `https://creations.mattel.com/cart/${variantId}:2`
        ),

      new ButtonBuilder()
        .setLabel("🛒 QTY 10")
        .setStyle(ButtonStyle.Link)
        .setURL(
          `https://creations.mattel.com/cart/${variantId}:10`
        ),

      new ButtonBuilder()
        .setLabel("🛒 QTY 20")
        .setStyle(ButtonStyle.Link)
        .setURL(
          `https://creations.mattel.com/cart/${variantId}:20`
        ),

      new ButtonBuilder()
        .setLabel("🛒 QTY 50")
        .setStyle(ButtonStyle.Link)
        .setURL(
          `https://creations.mattel.com/cart/${variantId}:50`
        )
    );
}

async function sendToChannel(
  channel,
  embed,
  row = null
) {

  const payload = {
    embeds: [embed]
  };

  if (row) {
    payload.components = [row];
  }

  await channel.send(
    payload
  );
}

function addAlert(
  alerts,
  text
) {

  alerts.unshift(text);

  saveAlerts(
    alerts
  );
}

// =========================
// PRODUCT RECORD
// =========================

function ensureRecord(
  existing,
  product,
  now
) {

  const price =
    getPrice(product);

  const available =
    getAvailable(product);

  const createdAt =
    getCatalogCreatedAt(product);

  const publishedAt =
    getPublishedAt(product);

  if (existing) {

    existing.title =
      product.title;

    existing.handle =
      product.handle;

    existing.price =
      price;

    existing.available =
      available;

    existing.lastSeen =
      now;

    existing.catalogCreatedAt =
      createdAt ||
      existing.catalogCreatedAt ||
      null;

    existing.publishedAt =
      publishedAt ||
      existing.publishedAt ||
      null;

    existing.url =
      productUrl(
        product.handle
      );

    existing.variantId =
      getVariantId(product);

    existing.image =
      getImage(product);

    existing.upcoming =
      product.upcoming ||
      false;

    existing.launchDate =
      product.launchDate ||
      null;

    existing.productPageFetched =
      product.productPageFetched ||
      false;

    existing.explicitlySoldOut =
      product.explicitlySoldOut ||
      false;

    existing.wasHidden =
      existing.wasHidden === true;

    existing.hiddenAlertSent =
      existing.hiddenAlertSent === true;

    existing.upcomingAlertSent =
      existing.upcomingAlertSent === true;

    existing.stats =
      existing.stats || {
        restockEvents: 0,
        soldOutEvents: 0,
        restockTimestamps: []
      };

    existing.stats.restockTimestamps =
      existing.stats.restockTimestamps ||
      [];

    return existing;
  }

  return {

    title:
      product.title,

    handle:
      product.handle,

    available,

    price,

    previousPrice:
      null,

    detectedAt:
      now,

    firstSeen:
      now,

    lastSeen:
      now,

    catalogCreatedAt:
      createdAt,

    publishedAt,

    url:
      productUrl(
        product.handle
      ),

    variantId:
      getVariantId(product),

    image:
      getImage(product),

    upcoming:
      product.upcoming ||
      false,

    launchDate:
      product.launchDate ||
      null,

    productPageFetched:
      product.productPageFetched ||
      false,

    explicitlySoldOut:
      product.explicitlySoldOut ||
      false,

    wasHidden:
      false,

    hiddenAlertSent:
      false,

    upcomingAlertSent:
      false,

    predictionAlertSent:
      false,

    etaAlertSent:
      false,

    stats: {
      restockEvents: 0,
      soldOutEvents: 0,
      restockTimestamps: []
    }
  };
}

// =========================
// REAL NEW PRODUCT TEST
// =========================

function isActuallyNewProduct(
  product,
  previous,
  lastScanAt
) {

  if (previous) {
    return false;
  }

  const createdAt =
    getCatalogCreatedAt(
      product
    );

  if (!createdAt) {
    return false;
  }

  if (!lastScanAt) {
    return false;
  }

  const created =
    Date.parse(
      createdAt
    );

  const lastScan =
    Date.parse(
      lastScanAt
    );

  if (
    Number.isNaN(created) ||
    Number.isNaN(lastScan)
  ) {
    return false;
  }

  return (
    created >
    lastScan
  );
}

// =========================
// MAIN SCANNER
// =========================

async function scanForNewProducts() {

  if (scanInProgress) {

    console.log(
      "⏭️ Scan skipped because another scan is already running."
    );

    return;
  }

  scanInProgress =
    true;

  const scanStartedAt =
    new Date().toISOString();

  try {

    console.log(
      "🔎 Starting Mattel product scan..."
    );

    if (!CHANNEL_ID) {

      console.log(
        "⚠️ CHANNEL_ID not configured"
      );

      return;
    }

    const channel =
      await client.channels.fetch(
        CHANNEL_ID
      );

    const catalog =
      await getMattelProducts();

    const candidates =
      catalog.filter(product =>
        !BLOCKED_HANDLES.has(
          product.handle
        ) &&
        isHotWheelsProduct(
          product
        )
      );

    const savedProducts =
      loadProducts();

    const stats =
      loadStats();

    const alerts =
      loadAlerts();

    const watchlist =
      loadWatchlist();

    const previousLastScanAt =
      stats.lastScanAt;

    const now =
      scanStartedAt;

    console.log(
      `🎯 Hot Wheels candidates: ${candidates.length}`
    );

    const processed = [];

    for (
      const raw of candidates
    ) {

      const existing =
        savedProducts[
          String(raw.id)
        ];

      const available =
        getAvailable(raw);

      const titleLower =
        String(
          raw.title || ""
        ).toLowerCase();

      const shouldCheckLaunch =
        titleLower.includes("rlc") ||
        titleLower.includes("red line club") ||
        titleLower.includes("elite 64") ||
        titleLower.includes("transformers");

      let pageInfo = {
        productPageFetched: false,
        explicitlySoldOut: false,
        upcoming: false,
        launchDate: null
      };

      if (
        !available ||
        shouldCheckLaunch
      ) {

        pageInfo =
          await fetchProductPageInfo(
            raw.handle,
            shouldCheckLaunch
          );
      }

      const product = {

        id:
          raw.id,

        title:
          raw.title,

        handle:
          raw.handle,

        available,

        price:
          getPrice(raw),

        variantId:
          getVariantId(raw),

        image:
          getImage(raw),

        url:
          productUrl(
            raw.handle
          ),

        catalogCreatedAt:
          getCatalogCreatedAt(
            raw
          ),

        publishedAt:
          getPublishedAt(
            raw
          ),

        ...pageInfo
      };

      const wasActuallyNew =
        isActuallyNewProduct(
          raw,
          existing,
          previousLastScanAt
        );

      const record =
        ensureRecord(
          existing,
          product,
          now
        );

      // =========================
      // NEW PRODUCT
      // =========================

      if (!existing) {

        if (wasActuallyNew) {

          stats.newProductsToday++;

          addAlert(
            alerts,
            `🆕 ${product.title}`
          );

          if (
            product.upcoming
          ) {

            await sendToChannel(
              channel,

              makeEmbed(
                "🚀 UPCOMING LAUNCH",
                0xffa500,
                product,
                [
                  {
                    name: "📦 Product",
                    value:
                      product.title
                  },
                  {
                    name: "🚀 Launch Date",
                    value:
                      product.launchDate ||
                      "Mattel Launch Scheduled",
                    inline: true
                  },
                  {
                    name: "💲 Price",
                    value:
                      `$${product.price || "Unknown"}`,
                    inline: true
                  }
                ]
              )
            );

            record.upcomingAlertSent =
              true;

          } else if (
            product.available
          ) {

            await sendToChannel(
              channel,

              makeEmbed(
                "🆕 NEW HOT WHEELS PRODUCT",
                0x3498db,
                product,
                [
                  {
                    name: "📦 Product",
                    value:
                      product.title
                  },
                  {
                    name: "💲 Price",
                    value:
                      `$${product.price || "Unknown"}`,
                    inline: true
                  },
                  {
                    name: "✅ Status",
                    value:
                      "IN STOCK",
                    inline: true
                  }
                ]
              ),

              cartRow(
                product.variantId
              )
            );

          } else if (
            product.productPageFetched &&
            !product.explicitlySoldOut &&
            !product.launchDate
          ) {

            record.wasHidden =
              true;

            record.hiddenAlertSent =
              true;

            await sendToChannel(
              channel,

              makeEmbed(
                "🚨 POSSIBLE HIDDEN PRODUCT DETECTED",
                0xffcc00,
                product,
                [
                  {
                    name: "📦 Product",
                    value:
                      product.title
                  },
                  {
                    name: "👀 Status",
                    value:
                      "NOT AVAILABLE YET",
                    inline: true
                  },
                  {
                    name: "💲 Price",
                    value:
                      `$${product.price || "Unknown"}`,
                    inline: true
                  },
                  {
                    name: "📅 Mattel Created",
                    value:
                      product.catalogCreatedAt ||
                      "Unknown"
                  }
                ]
              )
            );
          }

        } else {

          console.log(
            `ℹ️ Baseline/previously missed product added without alert: ${product.title}`
          );
        }

      } else {

        // =========================
        // RESTOCK
        // =========================

        if (
          existing.available === false &&
          product.available === true
        ) {

          record.stats.restockEvents++;

          record.stats.restockTimestamps.push(
            Date.now()
          );

          record.wasHidden =
            false;

          record.hiddenAlertSent =
            false;

          record.predictionAlertSent =
            false;

          record.etaAlertSent =
            false;

          stats.restocksToday++;

          addAlert(
            alerts,
            `🔥 ${product.title}`
          );

          await sendToChannel(
            channel,

            makeEmbed(
              existing.wasHidden
                ? "🚨 HIDDEN PRODUCT IS NOW LIVE"
                : "🔥 BACK IN STOCK",

              0x0099ff,

              product,

              [
                {
                  name: "📦 Product",
                  value:
                    product.title
                },
                {
                  name: "💲 Price",
                  value:
                    `$${product.price || "Unknown"}`,
                  inline: true
                },
                {
                  name: "📈 Lifetime Restocks",
                  value:
                    String(
                      record.stats.restockEvents
                    ),
                  inline: true
                }
              ]
            ),

            cartRow(
              product.variantId
            )
          );
        }

        // =========================
        // SOLD OUT
        // =========================

        if (
          existing.available === true &&
          product.available === false
        ) {

          record.stats.soldOutEvents++;

          stats.soldOutToday++;

          addAlert(
            alerts,
            `❌ ${product.title}`
          );

          await sendToChannel(
            channel,

            makeEmbed(
              "❌ SOLD OUT",
              0xff0000,
              product,
              [
                {
                  name: "📦 Product",
                  value:
                    product.title
                },
                {
                  name: "❌ Status",
                  value:
                    "SOLD OUT",
                  inline: true
                }
              ]
            )
          );
        }

        // =========================
        // PRICE CHANGE
        // =========================

        if (
          existing.price &&
          product.price &&
          existing.price !==
            product.price
        ) {

          stats.priceChangesToday++;

          addAlert(
            alerts,
            `💲 ${product.title}`
          );

          await sendToChannel(
            channel,

            makeEmbed(
              "💲 PRICE CHANGE DETECTED",
              0x9932cc,
              product,
              [
                {
                  name: "📦 Product",
                  value:
                    product.title
                },
                {
                  name: "⬇️ Old Price",
                  value:
                    `$${existing.price}`,
                  inline: true
                },
                {
                  name: "⬆️ New Price",
                  value:
                    `$${product.price}`,
                  inline: true
                }
              ]
            )
          );
        }

        // =========================
        // HIDDEN OPPORTUNITY
        // =========================

        if (
          product.available === false &&
          product.productPageFetched &&
          !product.explicitlySoldOut &&
          !product.launchDate
        ) {

          record.wasHidden =
            true;

          if (
            !record.hiddenAlertSent &&
            previousLastScanAt
          ) {

            record.hiddenAlertSent =
              true;

            await sendToChannel(
              channel,

              makeEmbed(
                "🚨 POSSIBLE HIDDEN PRODUCT",
                0xffcc00,
                product,
                [
                  {
                    name: "📦 Product",
                    value:
                      product.title
                  },
                  {
                    name: "👀 Status",
                    value:
                      "NOT AVAILABLE YET",
                    inline: true
                  },
                  {
                    name: "💲 Price",
                    value:
                      `$${product.price || "Unknown"}`,
                    inline: true
                  }
                ]
              )
            );
          }
        }
      }

      // =========================
      // WATCHLIST
      // =========================

      const watchMatch =
        watchlist.find(keyword =>
          product.title
            .toLowerCase()
            .includes(
              String(keyword)
                .toLowerCase()
            )
        );

      if (
        watchMatch &&
        product.available &&
        (
          !existing ||
          existing.available === false
        )
      ) {

        await sendToChannel(
          channel,

          makeEmbed(
            "🚨 WATCHLIST MATCH",
            0xff0000,
            product,
            [
              {
                name: "📦 Product",
                value:
                  product.title
              },
              {
                name: "🎯 Watchlist Keyword",
                value:
                  watchMatch,
                inline: true
              },
              {
                name: "💲 Price",
                value:
                  `$${product.price || "Unknown"}`,
                inline: true
              }
            ]
          ),

          cartRow(
            product.variantId
          )
        );
      }

      savedProducts[
        String(raw.id)
      ] = record;

      processed.push(
        String(raw.id)
      );
    }

    stats.lastScanAt =
      scanStartedAt;

    saveProducts(
      savedProducts
    );

    saveStats(
      stats
    );

    saveAlerts(
      alerts
    );

    console.log(
      `⏰ Scan Complete - ${processed.length} products checked`
    );

  } catch (error) {

    console.error(
      "❌ Scan Failed"
    );

    console.error(
      error
    );

  } finally {

    scanInProgress =
      false;
  }
}

// =========================
// SCANNER SCHEDULE
// =========================

function startScanner() {

  if (scannerStarted) {
    return;
  }

  scannerStarted =
    true;

  console.log(
    "✅ Scanner Started - every 5 minutes"
  );

  setInterval(() => {

    scanForNewProducts()
      .catch(error =>
        console.error(
          "❌ Scheduled scan error",
          error
        )
      );

  }, 5 * 60 * 1000);
}

// =========================
// DAILY SUMMARY
// =========================

function startDailySummary() {

  cron.schedule(
    "0 8 * * *",

    async () => {

      try {

        const channel =
          await client.channels.fetch(
            CHANNEL_ID
          );

        const stats =
          loadStats();

        const products =
          loadProducts();

        await channel.send(
          "📊 **MattelBot Daily Summary**\n\n" +
          `📦 Tracking: ${Object.keys(products).length}\n` +
          `🆕 New Products: ${stats.newProductsToday}\n` +
          `🔥 Restocks: ${stats.restocksToday}\n` +
          `❌ Sold Out: ${stats.soldOutToday}\n` +
          `💲 Price Changes: ${stats.priceChangesToday}`
        );

        stats.newProductsToday =
          0;

        stats.restocksToday =
          0;

        stats.soldOutToday =
          0;

        stats.priceChangesToday =
          0;

        saveStats(
          stats
        );

      } catch (error) {

        console.error(
          "❌ Daily summary failed",
          error
        );
      }
    },

    {
      timezone:
        "America/Chicago"
    }
  );
}

// =========================
// DISCORD COMMANDS
// =========================

client.on(
  "messageCreate",
  async message => {

    if (
      message.author.bot
    ) {
      return;
    }

    try {

      const content =
        message.content.trim();

      const lower =
        content.toLowerCase();

      // =========================
      // PING
      // =========================

      if (
        content === "!ping"
      ) {
        return message.reply(
          "🏓 Pong!"
        );
      }

      // =========================
      // STATUS
      // =========================

      if (
        content === "!status"
      ) {

        return message.reply(
          `✅ Online\n📦 Tracking ${Object.keys(loadProducts()).length} products`
        );
      }

      // =========================
      // STATS
      // =========================

      if (
        content === "!stats"
      ) {

        const s =
          loadStats();

        return message.reply(
          "📊 Mattel Stats\n\n" +
          `🆕 New Products: ${s.newProductsToday}\n` +
          `🔥 Restocks: ${s.restocksToday}\n` +
          `❌ Sold Out: ${s.soldOutToday}\n` +
          `💲 Price Changes: ${s.priceChangesToday}`
        );
      }

      // =========================
      // COUNTS
      // =========================

      if (
        content === "!counts"
      ) {

        const products =
          Object.values(
            loadProducts()
          );

        return message.reply(
          "📦 Mattel Inventory Counts\n\n" +
          `📦 Total Tracked: ${products.length}\n` +
          `✅ In Stock: ${products.filter(p => p.available === true).length}\n` +
          `❌ Sold Out: ${products.filter(p => p.available === false).length}`
        );
      }

      // =========================
      // DEBUG
      // =========================

      if (
        content === "!debug"
      ) {

        const products =
          loadProducts();

        const s =
          loadStats();

        return message.reply(
          "🛠️ MattelBot Debug\n\n" +
          `📦 Tracked Products: ${Object.keys(products).length}\n` +
          `🆕 New Today: ${s.newProductsToday}\n` +
          `🔥 Restocks Today: ${s.restocksToday}\n` +
          `❌ Sold Out Today: ${s.soldOutToday}\n` +
          `💲 Price Changes Today: ${s.priceChangesToday}\n` +
          `⏰ Last Scan: ${s.lastScanAt || "Not recorded"}`
        );
      }

      // =========================
      // HEALTH
      // =========================

      if (
        content === "!health"
      ) {

        const products =
          Object.values(
            loadProducts()
          );

        const s =
          loadStats();

        return message.reply(
          "🤖 MattelBot Health\n\n" +
          "✅ Online\n" +
          `📦 Tracking: ${products.length}\n` +
          `🆕 New Today: ${s.newProductsToday}\n` +
          `🔥 Restocks Today: ${s.restocksToday}\n` +
          `❌ Sold Out Today: ${s.soldOutToday}\n` +
          `⏰ Last Scan: ${s.lastScanAt || "Not recorded"}`
        );
      }

      // =========================
      // ALERTS
      // =========================

      if (
        content === "!alerts"
      ) {

        const alerts =
          loadAlerts();

        return message.reply(
          alerts.length
            ? alerts
                .slice(0, 10)
                .join("\n")
            : "No alerts recorded yet."
        );
      }

      // =========================
      // WATCHLIST
      // =========================

      if (
        content === "!watchlist"
      ) {

        const list =
          loadWatchlist();

        return message.reply(
          list.length
            ? `⭐ Watchlist\n\n${list.join("\n")}`
            : "Watchlist empty."
        );
      }

      if (
        content.startsWith(
          "!watch "
        )
      ) {

        const keyword =
          content
            .slice(7)
            .trim()
            .toLowerCase();

        if (!keyword) {
          return message.reply(
            "Usage: !watch keyword"
          );
        }

        const list =
          loadWatchlist();

        if (
          !list.includes(
            keyword
          )
        ) {
          list.push(
            keyword
          );
        }

        saveWatchlist(
          list
        );

        return message.reply(
          `⭐ Added to watchlist: ${keyword}`
        );
      }

      if (
        content.startsWith(
          "!unwatch "
        )
      ) {

        const keyword =
          content
            .slice(9)
            .trim()
            .toLowerCase();

        const list =
          loadWatchlist()
            .filter(
              x =>
                x.toLowerCase() !==
                keyword
            );

        saveWatchlist(
          list
        );

        return message.reply(
          `⭐ Removed from watchlist: ${keyword}`
        );
      }

      // =========================
      // HIDDEN
      // =========================

      if (
        content === "!hidden"
      ) {

        const hidden =
          Object.values(
            loadProducts()
          )
          .filter(
            p =>
              p.wasHidden === true
          );

        if (
          !hidden.length
        ) {

          return message.reply(
            "✅ No hidden products tracked."
          );
        }

        return message.reply(
          "🚨 Hidden Products\n\n" +
          hidden
            .slice(0, 25)
            .map(
              p =>
                `📦 ${p.title}`
            )
            .join("\n") +
          `\n\n📊 Total Hidden: ${hidden.length}`
        );
      }

      // =========================
      // UPCOMING
      // =========================

      if (
        content === "!upcoming"
      ) {

        const upcoming =
          Object.values(
            loadProducts()
          )
          .filter(
            p =>
              p.upcoming === true &&
              p.launchDate
          )
          .sort(
            (a, b) =>
              new Date(
                a.launchDate
              ) -
              new Date(
                b.launchDate
              )
          )
          .slice(0, 15);

        if (
          !upcoming.length
        ) {

          return message.reply(
            "✅ No upcoming launches tracked."
          );
        }

        return message.reply(
          "🚀 Upcoming Launches\n\n" +
          upcoming
            .map(
              p =>
                `📦 ${p.title}\n📅 ${p.launchDate}`
            )
            .join("\n\n")
        );
      }

      // =========================
      // LATEST
      // =========================

      if (
        content === "!latest"
      ) {

        const latest =
          Object.values(
            loadProducts()
          )
          .sort(
            (a, b) => {

              const ad =
                Date.parse(
                  a.catalogCreatedAt ||
                  a.firstSeen ||
                  a.detectedAt ||
                  0
                );

              const bd =
                Date.parse(
                  b.catalogCreatedAt ||
                  b.firstSeen ||
                  b.detectedAt ||
                  0
                );

              return bd - ad;
            }
          )
          .slice(0, 10);

        if (
          !latest.length
        ) {

          return message.reply(
            "❌ No products found."
          );
        }

        return message.reply(
          "📦 Latest Catalog Products\n\n" +

          latest
            .map(
              (p, i) =>
                `${i + 1}. ${p.title}\n` +
                `📅 ${p.catalogCreatedAt || "Catalog date unavailable"}\n` +
                `🔗 ${p.url}`
            )
            .join("\n\n")
        );
      }

      // =========================
      // MOST ACTIVE
      // =========================

      if (
        content === "!hot"
      ) {

        const ranked =
          Object.values(
            loadProducts()
          )
          .filter(
            p => p.stats
          )
          .map(
            p => ({
              title:
                p.title,

              score:
                (p.stats.restockEvents || 0) +
                (p.stats.soldOutEvents || 0)
            })
          )
          .sort(
            (a, b) =>
              b.score - a.score
          )
          .slice(0, 10);

        if (
          !ranked.length
        ) {

          return message.reply(
            "❌ No activity data yet."
          );
        }

        return message.reply(
          "🏆 Most Active Products\n\n" +

          ranked
            .map(
              (p, i) =>
                `${i + 1}. ${p.title}\n` +
                `📊 Activity Score: ${p.score}`
            )
            .join("\n\n")
        );
      }

      // =========================
      // PRODUCT SEARCH
      // =========================

      if (
        content.startsWith(
          "!product "
        )
      ) {

        const keyword =
          lower
            .slice(9)
            .trim();

        const match =
          Object.values(
            loadProducts()
          )
          .find(
            p =>
              p.title
                .toLowerCase()
                .includes(keyword) ||
              p.handle
                .toLowerCase()
                .includes(keyword)
          );

        if (!match) {

          return message.reply(
            "❌ Product not found in tracked data."
          );
        }

        return message.reply(
          `📦 ${match.title}\n` +
          `📊 Status: ${match.available ? "IN STOCK" : "SOLD OUT / UNAVAILABLE"}\n` +
          `💲 Price: $${match.price || "Unknown"}\n` +
          `📅 Mattel Created: ${match.catalogCreatedAt || "Unknown"}\n` +
          `🔗 ${match.url}`
        );
      }

      // =========================
      // SUMMARY
      // =========================

      if (
        content === "!summary"
      ) {

        const products =
          Object.values(
            loadProducts()
          );

        const hidden =
          products.filter(
            p =>
              p.wasHidden === true
          );

        const upcoming =
          products.filter(
            p =>
              p.upcoming === true
          );

        return message.reply(
          "📊 Mattel Opportunity Summary\n\n" +
          `📦 Tracking: ${products.length}\n` +
          `🚀 Future Opportunities: ${upcoming.length}\n` +
          `🚨 Hidden Opportunities: ${hidden.length}`
        );
      }

      // =========================
      // MANUAL SCAN
      // =========================

      if (
        content === "!scan"
      ) {

        await scanForNewProducts();

        return message.reply(
          "🔎 Manual scan completed."
        );
      }

      // =========================
      // TEST
      // =========================

      if (
        content === "!testnew"
      ) {

        return message.reply(
          "✅ Test command received. No real product alert was generated."
        );
      }

      // =========================
      // HELP
      // =========================

      if (
        content === "!help"
      ) {

        return message.reply(
          "🤖 Mattel Scanner Commands\n\n" +

          "📦 Core\n" +
          "!ping\n" +
          "!status\n" +
          "!health\n" +
          "!stats\n" +
          "!counts\n" +
          "!debug\n\n" +

          "🔍 Products\n" +
          "!product keyword\n" +
          "!latest\n" +
          "!hidden\n" +
          "!upcoming\n" +
          "!summary\n" +
          "!scan\n\n" +

          "⭐ Watchlist\n" +
          "!watch keyword\n" +
          "!unwatch keyword\n" +
          "!watchlist\n\n" +

          "📈 Activity\n" +
          "!hot\n\n" +

          "📢 Alerts\n" +
          "!alerts"
        );
      }

    } catch (error) {

      console.error(
        "❌ Command error",
        error
      );

      await message
        .reply(
          "❌ Command failed. Check Railway logs."
        )
        .catch(
          () => {}
        );
    }
  }
);

// =========================
// BOT READY
// =========================

client.once(
  "ready",
  async () => {

    console.log(
      `✅ Logged in as ${client.user.tag}`
    );

    startDailySummary();

    await scanForNewProducts();

    startScanner();
  }
);

// =========================
// LOGIN
// =========================

if (
  !process.env.DISCORD_TOKEN
) {

  console.error(
    "❌ DISCORD_TOKEN is not configured."
  );

  process.exit(1);
}

client.login(
  process.env.DISCORD_TOKEN
);
