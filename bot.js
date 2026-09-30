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

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const DATA_FILE = "./scanData.json";
const CHANNEL_ID = process.env.CHANNEL_ID;
const STATS_FILE = "./stats.json";

const WATCHLIST = [
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

const WATCHLIST_FILE = "./watchlist.json";
const ALERTS_FILE = "./alerts.json";

// Prevent overlapping scans.
let scanInProgress = false;

// =========================
// Product Filtering
// =========================

function isHotWheelsProduct(product) {
  const title = String(product?.title || "").toLowerCase();

  return (
    title.includes("hot wheels") &&
    !title.includes("shirt") &&
    !title.includes("t-shirt") &&
    !title.includes("hat") &&
    !title.includes("dad hat") &&
    !title.includes("snapback") &&
    !title.includes("tumbler") &&
    !title.includes("sweatshirt") &&
    !title.includes("raglan") &&
    !title.includes("figure") &&
    !title.includes("mechanic") &&
    !title.includes("jersey")
  );
}

function getPrice(product) {
  return product?.variants?.[0]?.price || "Unknown";
}

function isInStock(product) {
  return product?.variants?.some(v => v?.available === true) === true;
}

function getProductUrl(handle) {
  return `https://creations.mattel.com/products/${handle}`;
}

// =========================
// Product Storage
// =========================

function loadProducts() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveProducts(data) {
  fs.writeFileSync(
    DATA_FILE,
    JSON.stringify(data, null, 2)
  );
}

function loadStats() {
  try {
    return JSON.parse(
      fs.readFileSync(STATS_FILE, "utf8")
    );
  } catch {
    return {
      newProductsToday: 0,
      restocksToday: 0,
      soldOutToday: 0
    };
  }
}

function saveStats(stats) {
  fs.writeFileSync(
    STATS_FILE,
    JSON.stringify(stats, null, 2)
  );
}

function loadAlerts() {
  try {
    return JSON.parse(
      fs.readFileSync(ALERTS_FILE, "utf8")
    );
  } catch {
    return [];
  }
}

function saveAlerts(alerts) {
  fs.writeFileSync(
    ALERTS_FILE,
    JSON.stringify(alerts, null, 2)
  );
}

function loadWatchlist() {
  try {
    return JSON.parse(
      fs.readFileSync(
        WATCHLIST_FILE,
        "utf8"
      )
    );
  } catch {
    return [...WATCHLIST];
  }
}

function addAlert(alertText) {
  const alerts = loadAlerts();

  alerts.unshift(alertText);
  alerts.splice(10);

  saveAlerts(alerts);
}

// =========================
// Mattel API
// =========================

async function getMattelData() {
  const allProducts = [];
  let page = 1;

  while (true) {
    const response = await fetch(
      `https://creations.mattel.com/products.json?page=${page}`
    );

    const text = await response.text();

    if (
      text.startsWith("<!DOCTYPE") ||
      text.startsWith("<html")
    ) {
      break;
    }

    let data;

    try {
      data = JSON.parse(text);
    } catch {
      break;
    }

    if (
      !data.products ||
      data.products.length === 0
    ) {
      break;
    }

    allProducts.push(...data.products);

    console.log(`📄 Loaded page ${page}`);

    page++;
  }

  return {
    products: allProducts
  };
}

// =========================
// Product Page Verification
// =========================

async function getProductPageInfo(handle) {
  const productUrl = getProductUrl(handle);

  let html = "";
  let productPageFetched = false;

  try {
    const response = await fetch(productUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154 Safari/537.36"
      }
    });

    if (response.ok) {
      html = await response.text();
      productPageFetched = true;
    }
  } catch (error) {
    console.error(
      `⚠️ Product page check failed: ${handle}`,
      error.message
    );
  }

  const pageTextLower =
    html.toLowerCase();

  const explicitlySoldOut =
    pageTextLower.includes("sold out") ||
    pageTextLower.includes("out of stock") ||
    pageTextLower.includes("unavailable");

  return {
    productPageFetched,
    explicitlySoldOut
  };
}

// =========================
// Initial Product Load
// =========================

async function initializeProducts() {
  try {
    const data = await getMattelData();

    const products =
      data.products.filter(isHotWheelsProduct);

    const savedProducts =
      loadProducts();

    const stats =
      loadStats();

    if (
      Object.keys(savedProducts).length === 0
    ) {
      products.forEach(product => {
        const inStock =
          isInStock(product);

        const price =
          getPrice(product);

        savedProducts[product.id] = {
          title: product.title,
          handle: product.handle,
          available: inStock,
          price: price,
          detectedAt:
            new Date().toISOString(),
          lastSeen:
            new Date().toISOString(),
          watchlistAlertSent: false,
          hiddenAlertSent: false,
          wasHidden: false,

          stats: {
            restockEvents: 0,
            soldOutEvents: 0,
            restockTimestamps: []
          },

          predictionAlertSent: false,
          etaAlertSent: false
        };
      });

      saveProducts(savedProducts);
      saveStats(stats);

      console.log(
        `✅ Initialized ${products.length} products`
      );
    } else {
      console.log(
        `📦 Existing product database found: ${Object.keys(savedProducts).length} products`
      );
    }
  } catch (error) {
    console.error(
      "❌ Product initialization failed"
    );
    console.error(error);
  }
}

// =========================
// Scanner
// =========================

async function scanForNewProducts() {
  if (scanInProgress) {
    console.log(
      "⏳ Scan already in progress - skipping overlapping scan"
    );
    return;
  }

  scanInProgress = true;

  try {
    console.log(
      "🔎 Starting Mattel product scan..."
    );

    const data =
      await getMattelData();

    const products =
      data.products.filter(isHotWheelsProduct);

    const savedProducts =
      loadProducts();

    const stats =
      loadStats();

    if (!CHANNEL_ID) {
      console.log(
        "⚠️ CHANNEL_ID not configured"
      );
      return;
    }

    const channel =
      await client.channels.fetch(CHANNEL_ID);

    if (!channel) {
      console.log(
        "❌ Discord channel could not be found"
      );
      return;
    }

    const watchlist =
      loadWatchlist();

    for (const product of products) {
      try {
        const productId =
          String(product.id);

        const existingProduct =
          savedProducts[productId];

        const inStock =
          isInStock(product);

        const price =
          getPrice(product);

        // ==========================================
        // New Product
        // ==========================================

        if (!existingProduct) {
          const pageInfo =
            await getProductPageInfo(
              product.handle
            );

          product.productPageFetched =
            pageInfo.productPageFetched;

          product.explicitlySoldOut =
            pageInfo.explicitlySoldOut;

          /*
           * IMPORTANT:
           *
           * A new product that is unavailable from
           * the API is NOT automatically considered
           * hidden.
           *
           * It becomes a hidden opportunity only when:
           *
           * 1. API says unavailable
           * 2. Product page was successfully fetched
           * 3. Product page does NOT explicitly say
           *    sold out / out of stock / unavailable
           */

          const isHiddenOpportunity =
            inStock === false &&
            pageInfo.productPageFetched === true &&
            pageInfo.explicitlySoldOut === false;

          if (isHiddenOpportunity) {
            const embed =
              new EmbedBuilder()
                .setColor(0xffcc00)
                .setTitle(
                  "🚨 POSSIBLE HIDDEN PRODUCT DETECTED"
                )
                .addFields(
                  {
                    name: "📦 Product",
                    value: product.title
                  },
                  {
                    name: "💲 Price",
                    value: `$${price}`,
                    inline: true
                  },
                  {
                    name: "👀 Status",
                    value:
                      "NOT AVAILABLE YET",
                    inline: true
                  },
                  {
                    name: "⏰ First Seen",
                    value:
                      new Date().toLocaleString(),
                    inline: true
                  }
                )
                .setURL(
                  getProductUrl(
                    product.handle
                  )
                )
                .setThumbnail(
                  product.images?.[0]?.src ||
                  null
                )
                .setFooter({
                  text: "MattelBotV2"
                });

            const row =
              new ActionRowBuilder()
                .addComponents(
                  new ButtonBuilder()
                    .setLabel(
                      "🛒 View Product"
                    )
                    .setStyle(
                      ButtonStyle.Link
                    )
                    .setURL(
                      getProductUrl(
                        product.handle
                      )
                    )
                );

            await channel.send({
              embeds: [embed],
              components: [row]
            });

            console.log(
              `🚨 Hidden Opportunity: ${product.title}`
            );
          } else {
            /*
             * New product is either:
             * - currently in stock
             * - explicitly sold out
             * - unavailable for another reason
             *
             * Do not falsely label it as a hidden
             * opportunity.
             */

            const embed =
              new EmbedBuilder()
                .setColor(
                  inStock
                    ? 0x00ff00
                    : 0x808080
                )
                .setTitle(
                  inStock
                    ? "🚨 NEW HOT WHEELS DETECTED"
                    : "📦 NEW HOT WHEELS PRODUCT"
                )
                .addFields(
                  {
                    name: "📦 Product",
                    value: product.title
                  },
                  {
                    name: "💲 Price",
                    value: `$${price}`,
                    inline: true
                  },
                  {
                    name: "👀 Status",
                    value: inStock
                      ? "IN STOCK"
                      : pageInfo.explicitlySoldOut
                        ? "SOLD OUT"
                        : "NOT AVAILABLE",
                    inline: true
                  }
                )
                .setURL(
                  getProductUrl(
                    product.handle
                  )
                )
                .setThumbnail(
                  product.images?.[0]?.src ||
                  null
                )
                .setFooter({
                  text: "MattelBotV2"
                });

            await channel.send({
              embeds: [embed]
            });
          }

          savedProducts[productId] = {
            title: product.title,
            handle: product.handle,
            available: inStock,
            price: price,
            detectedAt:
              new Date().toISOString(),
            lastSeen:
              new Date().toISOString(),
            watchlistAlertSent: false,
            hiddenAlertSent:
              isHiddenOpportunity,
            wasHidden:
              isHiddenOpportunity,

            stats: {
              restockEvents: 0,
              soldOutEvents: 0,
              restockTimestamps: []
            },

            predictionAlertSent: false,
            etaAlertSent: false
          };

          addAlert(
            `🆕 ${product.title}`
          );

          const matchedKeyword =
            watchlist.find(keyword =>
              product.title
                .toLowerCase()
                .includes(
                  keyword.toLowerCase()
                )
            );

          if (
            matchedKeyword &&
            inStock === true
          ) {
            await channel.send(
              `🚨 WATCHLIST MATCH 🚨\n\n` +
              `📦 ${product.title}\n` +
              `🔑 Keyword: ${matchedKeyword}\n` +
              `✅ IN STOCK\n` +
              `🔗 ${getProductUrl(product.handle)}`
            );
          }

          stats.newProductsToday++;

          console.log(
            `🆕 New Product Found: ${product.title}`
          );

          continue;
        }

        // ==========================================
        // Existing Product
        // ==========================================

        if (!existingProduct.stats) {
          existingProduct.stats = {
            restockEvents: 0,
            soldOutEvents: 0,
            restockTimestamps: []
          };
        }

        if (
          !Array.isArray(
            existingProduct.stats
              .restockTimestamps
          )
        ) {
          existingProduct.stats
            .restockTimestamps = [];
        }

        if (
          existingProduct
            .predictionAlertSent ===
          undefined
        ) {
          existingProduct
            .predictionAlertSent = false;
        }

        if (
          existingProduct
            .etaAlertSent ===
          undefined
        ) {
          existingProduct
            .etaAlertSent = false;
        }

        // ==========================================
        // Restock Detection
        // ==========================================

        if (
          existingProduct.available === false &&
          inStock === true
        ) {
          const wasHidden =
            existingProduct.wasHidden === true;

          const embed =
            new EmbedBuilder()
              .setColor(0x0099ff)
              .setTitle(
                wasHidden
                  ? "🚨 HIDDEN PRODUCT IS NOW LIVE"
                  : "🔥 BACK IN STOCK"
              )
              .addFields(
                {
                  name: "📦 Product",
                  value: product.title
                },
                {
                  name: "✅ Status",
                  value: "BACK IN STOCK",
                  inline: true
                },
                {
                  name: "📈 Lifetime Restocks",
                  value: String(
                    (existingProduct
                      .stats
                      .restockEvents ||
                      0) + 1
                  ),
                  inline: true
                },
                {
                  name: "⏰ First Seen",
                  value:
                    new Date(
                      existingProduct
                        .detectedAt
                    ).toLocaleDateString(),
                  inline: true
                }
              )
              .setURL(
                getProductUrl(
                  product.handle
                )
              )
              .setThumbnail(
                product.images?.[0]?.src ||
                null
              )
              .setFooter({
                text: "MattelBotV2"
              });

          await channel.send({
            embeds: [embed]
          });

          const matchedKeyword =
            watchlist.find(keyword =>
              product.title
                .toLowerCase()
                .includes(
                  keyword.toLowerCase()
                )
            );

          if (matchedKeyword) {
            await channel.send(
              "🚨 WATCHLIST RESTOCK 🚨\n\n" +
              `📦 ${product.title}\n` +
              `🔑 Keyword: ${matchedKeyword}\n` +
              `✅ Back In Stock\n` +
              `🔗 ${getProductUrl(product.handle)}`
            );
          }

          addAlert(
            `🔥 ${product.title}`
          );

          existingProduct
            .stats
            .restockEvents++;

          const totalRestocks =
            existingProduct
              .stats
              .restockEvents;

          if (
            totalRestocks === 3 ||
            totalRestocks === 5 ||
            totalRestocks === 10
          ) {
            await channel.send(
              "🔥 HOT PRODUCT ALERT 🔥\n\n" +
              `📦 ${product.title}\n` +
              `📈 Restocks Seen: ${totalRestocks}\n` +
              "🚀 High Activity Product\n" +
              `🔗 ${getProductUrl(product.handle)}`
            );
          }

          existingProduct
            .stats
            .restockTimestamps
            .push(Date.now());

          existingProduct
            .predictionAlertSent = false;

          existingProduct
            .etaAlertSent = false;

          /*
           * Once a hidden product becomes live,
           * it is no longer hidden.
           */
          existingProduct.wasHidden = false;
          existingProduct.hiddenAlertSent = true;

          stats.restocksToday++;

          console.log(
            `🔥 Restock Detected: ${product.title}`
          );
        }

        // ==========================================
        // Sold Out Detection
        // ==========================================

        if (
          existingProduct.available === true &&
          inStock === false
        ) {
          const pageInfo =
            await getProductPageInfo(
              product.handle
            );

          const embed =
            new EmbedBuilder()
              .setColor(0xff0000)
              .setTitle(
                "❌ SOLD OUT"
              )
              .addFields(
                {
                  name: "📦 Product",
                  value: product.title
                },
                {
                  name: "❌ Status",
                  value: "SOLD OUT",
                  inline: true
                }
              )
              .setURL(
                getProductUrl(
                  product.handle
                )
              )
              .setThumbnail(
                product.images?.[0]?.src ||
                null
              )
              .setFooter({
                text: "MattelBotV2"
              });

          await channel.send({
            embeds: [embed]
          });

          addAlert(
            `❌ ${product.title}`
          );

          existingProduct
            .stats
            .soldOutEvents++;

          stats.soldOutToday++;

          console.log(
            `❌ Sold Out: ${product.title}`
          );

          /*
           * If the page is successfully checked and
           * does NOT explicitly say sold out, retain
           * the hidden/opportunity state.
           *
           * This protects against a temporary API
           * inventory mismatch.
           */
          if (
            pageInfo.productPageFetched === true &&
            pageInfo.explicitlySoldOut === false
          ) {
            existingProduct.wasHidden = true;
            existingProduct.hiddenAlertSent = true;

            console.log(
              `🕵️ Product may be hidden/unreleased: ${product.title}`
            );
          } else {
            existingProduct.wasHidden = false;
          }
        }

        // ==========================================
        // Price Change
        // ==========================================

        const currentPrice =
          getPrice(product);

        if (
          existingProduct.price &&
          existingProduct.price !==
            currentPrice
        ) {
          const embed =
            new EmbedBuilder()
              .setColor(0x9932cc)
              .setTitle(
                "💲 PRICE CHANGE DETECTED"
              )
              .addFields(
                {
                  name: "📦 Product",
                  value: product.title
                },
                {
                  name: "⬇️ Old Price",
                  value:
                    `$${existingProduct.price}`,
                  inline: true
                },
                {
                  name: "⬆️ New Price",
                  value:
                    `$${currentPrice}`,
                  inline: true
                }
              )
              .setURL(
                getProductUrl(
                  product.handle
                )
              )
              .setThumbnail(
                product.images?.[0]?.src ||
                null
              )
              .setFooter({
                text: "MattelBotV2"
              });

          addAlert(
            `💲 ${product.title}`
          );

          await channel.send({
            embeds: [embed]
          });

          console.log(
            `💲 Price Changed: ${product.title}`
          );
        }

        // ==========================================
        // Save Current State
        // ==========================================

        existingProduct.title =
          product.title;

        existingProduct.handle =
          product.handle;

        existingProduct.price =
          currentPrice;

        existingProduct.available =
          inStock;

        existingProduct.lastSeen =
          new Date().toISOString();
      } catch (productError) {
        console.error(
          `⚠️ Product processing failed: ${product.title}`,
          productError.message
        );
      }
    }

    saveProducts(savedProducts);
    saveStats(stats);

    console.log(
      `⏰ Scan Complete - ${products.length} products checked`
    );
  } catch (error) {
    console.error(
      "❌ Scan Failed"
    );
    console.error(error);
  } finally {
    scanInProgress = false;
  }
}

// =========================
// Scanner Timer
// =========================

function startScanner() {
  console.log(
    "✅ Scanner Started - every 5 minutes"
  );

  setInterval(async () => {
    await scanForNewProducts();
  }, 5 * 60 * 1000);
}

// =========================
// Daily Summary
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

        const savedProducts =
          loadProducts();

        await channel.send(
          "📊 **MattelBot Daily Summary**\n\n" +
          `📦 Tracking: ${Object.keys(savedProducts).length}\n` +
          `🆕 New Products: ${stats.newProductsToday}\n` +
          `🔥 Restocks: ${stats.restocksToday}\n` +
          `❌ Sold Out: ${stats.soldOutToday}`
        );

        stats.newProductsToday = 0;
        stats.restocksToday = 0;
        stats.soldOutToday = 0;

        saveStats(stats);

        console.log(
          "📊 Daily summary sent and stats reset"
        );
      } catch (error) {
        console.error(
          "❌ Daily summary failed"
        );
        console.error(error);
      }
    },
    {
      timezone: "America/Chicago"
    }
  );
}

// =========================
// Bot Ready
// =========================

client.once(
  "clientReady",
  async () => {
    console.log(
      `✅ Logged in as ${client.user.tag}`
    );

    await initializeProducts();

    startScanner();
    startDailySummary();
  }
);

// =========================
// Commands
// =========================

client.on(
  "messageCreate",
  async message => {
    if (message.author.bot) return;

    // =========================
    // Ping
    // =========================

    if (
      message.content === "!ping"
    ) {
      return message.reply(
        "🏓 Pong!"
      );
    }

    // =========================
    // Status
    // =========================

    if (
      message.content === "!status"
    ) {
      const savedProducts =
        loadProducts();

      return message.reply(
        `✅ Online\n📦 Tracking ${Object.keys(savedProducts).length} products`
      );
    }

    // =========================
    // Stats
    // =========================

    if (
      message.content === "!stats"
    ) {
      const stats =
        loadStats();

      return message.reply(
        "📊 MattelBot Daily Stats\n\n" +
        `🆕 New Products: ${stats.newProductsToday}\n` +
        `🔥 Restocks: ${stats.restocksToday}\n` +
        `❌ Sold Out: ${stats.soldOutToday}`
      );
    }

    // =========================
    // Debug
    // =========================

    if (
      message.content === "!debug"
    ) {
      const savedProducts =
        loadProducts();

      const stats =
        loadStats();

      return message.reply(
        "🛠️ MattelBot Debug\n\n" +
        `📦 Tracked Products: ${Object.keys(savedProducts).length}\n` +
        `🆕 New Products Today: ${stats.newProductsToday}\n` +
        `🔥 Restocks Today: ${stats.restocksToday}\n` +
        `❌ Sold Out Today: ${stats.soldOutToday}\n` +
        `📁 Data File: ${DATA_FILE}`
      );
    }

    // =========================
    // Test New Product Alert
    // =========================

    if (
      message.content === "!testnew"
    ) {
      const embed =
        new EmbedBuilder()
          .setColor(0x00ff00)
          .setTitle(
            "🚨 NEW HOT WHEELS DETECTED"
          )
          .addFields(
            {
              name: "📦 Product",
              value: "RLC Test Skyline"
            },
            {
              name: "💲 Price",
              value: "$24.99",
              inline: true
            },
            {
              name: "✅ Status",
              value: "IN STOCK",
              inline: true
            }
          )
          .setURL(
            "https://creations.mattel.com"
          )
          .setFooter({
            text: "MattelBotV2"
          });

      const stats =
        loadStats();

      stats.newProductsToday++;

      saveStats(stats);

      console.log(
        "TEST NEW PRODUCT COUNT"
      );

      return message.reply({
        embeds: [embed]
      });
    }

    // =========================
    // Test Daily Summary
    // =========================

    if (
      message.content === "!summary"
    ) {
      const stats =
        loadStats();

      const savedProducts =
        loadProducts();

      return message.reply(
        "📊 MattelBot Daily Summary\n\n" +
        `📦 Tracking: ${Object.keys(savedProducts).length}\n` +
        `🆕 New Products: ${stats.newProductsToday}\n` +
        `🔥 Restocks: ${stats.restocksToday}\n` +
        `❌ Sold Out: ${stats.soldOutToday}`
      );
    }

    // =========================
    // Latest Products
    // =========================

    if (
      message.content === "!latest"
    ) {
      const savedProducts =
        loadProducts();

      const latestProducts =
        Object.values(savedProducts)
          .sort(
            (a, b) =>
              new Date(b.detectedAt) -
              new Date(a.detectedAt)
          )
          .slice(0, 10);

      if (
        latestProducts.length === 0
      ) {
        return message.reply(
          "❌ No products found."
        );
      }

      let reply =
        "📦 Latest 10 Products\n\n";

      latestProducts.forEach(
        (product, index) => {
          reply +=
            `#${index + 1}\n` +
            `📦 ${product.title}\n` +
            `💲 ${product.price || "Unknown"}\n` +
            `📅 ${new Date(product.detectedAt).toLocaleDateString()}\n` +
            `🔗 ${getProductUrl(product.handle)}\n\n`;
        }
      );

      return message.reply(
        reply
      );
    }

    // =========================
    // Alerts
    // =========================

    if (
      message.content === "!alerts"
    ) {
      const alerts =
        loadAlerts();

      if (
        alerts.length === 0
      ) {
        return message.reply(
          "📢 No alerts recorded yet."
        );
      }

      return message.reply(
        "📢 Recent Alerts\n\n" +
        alerts.join("\n")
      );
    }

    // =========================
    // Counts
    // =========================

    if (
      message.content === "!counts"
    ) {
      const products =
        Object.values(
          loadProducts()
        );

      const inStock =
        products.filter(
          p => p.available === true
        ).length;

      const soldOut =
        products.filter(
          p => p.available === false
        ).length;

      return message.reply(
        "📦 MattelBot Inventory Counts\n\n" +
        `📦 Total Tracked: ${products.length}\n` +
        `✅ In Stock: ${inStock}\n` +
        `❌ Sold Out: ${soldOut}`
      );
    }

    // =========================
    // Product Search
    // =========================

    if (
      message.content.startsWith(
        "!product "
      )
    ) {
      try {
        const keyword =
          message.content
            .replace(
              "!product ",
              ""
            )
            .toLowerCase();

        const data =
          await getMattelData();

        const matches =
          data.products.filter(
            product =>
              product.title
                .toLowerCase()
                .includes(keyword)
          );

        if (
          matches.length === 0
        ) {
          return message.reply(
            "❌ Product not found."
          );
        }

        const inStockProducts =
          matches.filter(
            product =>
              isInStock(product)
          );

        if (
          inStockProducts.length === 0
        ) {
          return message.reply(
            `❌ No in-stock products found for "${keyword}".`
          );
        }

        let reply =
          `🟢 In Stock Results for "${keyword}"\n\n`;

        inStockProducts
          .slice(0, 5)
          .forEach(
            (product, index) => {
              const price =
                getPrice(product);

              reply +=
                `${index + 1}. ${product.title}\n` +
                `💲 $${price}\n` +
                `🔗 ${getProductUrl(product.handle)}\n\n`;
            }
          );

        return message.reply(
          reply
        );
      } catch (error) {
        console.error(error);

        return message.reply(
          "❌ Could not reach Mattel."
        );
      }
    }

    // =========================
    // Predict
    // =========================

    if (
      message.content.startsWith(
        "!predict "
      )
    ) {
      const keyword =
        message.content
          .replace(
            "!predict ",
            ""
          )
          .toLowerCase();

      const products =
        loadProducts();

      const match =
        Object.values(products)
          .find(product =>
            product.title
              .toLowerCase()
              .includes(keyword)
          );

      if (!match) {
        return message.reply(
          "❌ Product not found."
        );
      }

      if (
        !match.stats ||
        !Array.isArray(
          match.stats
            .restockTimestamps
        ) ||
        match.stats
          .restockTimestamps.length < 2
      ) {
        return message.reply(
          "📦 " + match.title + "\n\n" +
          `🔥 Restocks Seen: ${match.stats?.restockEvents || 0}\n` +
          `❌ Sold Outs Seen: ${match.stats?.soldOutEvents || 0}\n\n` +
          "⏳ Still collecting history..."
        );
      }

      return message.reply(
        `📦 ${match.title}`
      );
    }

    // =========================
    // Launch
    // =========================

    if (
      message.content.startsWith(
        "!launch "
      )
    ) {
      try {
        const keyword =
          message.content
            .replace(
              "!launch ",
              ""
            )
            .toLowerCase();

        const products =
          loadProducts();

        const match =
          Object.values(products)
            .find(product =>
              product.title
                .toLowerCase()
                .includes(keyword)
            );

        if (!match) {
          return message.reply(
            "❌ Product not found."
          );
        }

        const url =
          getProductUrl(
            match.handle
          );

        const response =
          await fetch(url);

        const html =
          await response.text();

        const launchMatch =
          html.match(
            /Launches\s+[A-Za-z]+\s+\d{1,2},\s+\d{4}\s+\d{1,2}:\d{2}\s+[ap]m\s+PT/i
          );

        let reply =
          `🚀 Launch Information\n\n${match.title}\n\n`;

        if (launchMatch) {
          reply +=
            `📅 ${launchMatch[0]}\n\n`;
        }

        reply +=
          `🔗 ${url}`;

        return message.reply(
          reply
        );
      } catch (error) {
        console.error(error);

        return message.reply(
          "❌ Could not retrieve launch data."
        );
      }
    }

    // =========================
    // Watch
    // =========================

    if (
      message.content.startsWith(
        "!watch "
      )
    ) {
      const keyword =
        message.content
          .replace(
            "!watch ",
            ""
          )
          .toLowerCase()
          .trim();

      const watchlist =
        loadWatchlist();

      if (
        watchlist.includes(keyword)
      ) {
        return message.reply(
          `⚠️ ${keyword} is already being watched.`
        );
      }

      watchlist.push(keyword);

      fs.writeFileSync(
        WATCHLIST_FILE,
        JSON.stringify(
          watchlist,
          null,
          2
        )
      );

      return message.reply(
        `✅ Added "${keyword}" to watchlist.`
      );
    }

    // =========================
    // Unwatch
    // =========================

    if (
      message.content.startsWith(
        "!unwatch "
      )
    ) {
      const keyword =
        message.content
          .replace(
            "!unwatch ",
            ""
          )
          .toLowerCase()
          .trim();

      const watchlist =
        loadWatchlist();

      if (
        !watchlist.includes(keyword)
      ) {
        return message.reply(
          `⚠️ ${keyword} is not in the watchlist.`
        );
      }

      const updated =
        watchlist.filter(
          item => item !== keyword
        );

      fs.writeFileSync(
        WATCHLIST_FILE,
        JSON.stringify(
          updated,
          null,
          2
        )
      );

      return message.reply(
        `✅ Removed "${keyword}" from watchlist.`
      );
    }

    // =========================
    // Watch Stats
    // =========================

    if (
      message.content === "!watchstats"
    ) {
      const watchlist =
        loadWatchlist();

      const products =
        Object.values(
          loadProducts()
        );

      let reply =
        "⭐ Watchlist Stats\n\n";

      for (
        const keyword of watchlist
      ) {
        const match =
          products.find(product =>
            product.title
              .toLowerCase()
              .includes(keyword)
          );

        if (!match) continue;

        reply +=
          `📦 ${match.title}\n` +
          `🔥 Restocks: ${match.stats?.restockEvents || 0}\n` +
          `❌ Sold Outs: ${match.stats?.soldOutEvents || 0}\n\n`;
      }

      return message.reply(
        reply
      );
    }

    // =========================
    // Watch Stock
    // =========================

    if (
      message.content === "!watchstock"
    ) {
      const watchlist =
        loadWatchlist();

      const products =
        Object.values(
          loadProducts()
        );

      let inStock = 0;
      let soldOut = 0;

      let reply =
        "⭐ Watchlist Stock Status\n\n";

      for (
        const keyword of watchlist
      ) {
        const match =
          products.find(product =>
            product.title
              .toLowerCase()
              .includes(keyword)
          );

        if (!match) continue;

        if (
          match.available === true
        ) {
          inStock++;

          reply +=
            `✅ IN STOCK\n` +
            `${match.title}\n\n`;
        } else {
          soldOut++;

          reply +=
            `❌ SOLD OUT\n` +
            `${match.title}\n\n`;
        }
      }

      reply +=
        `📊 In Stock: ${inStock}\n` +
        `📊 Sold Out: ${soldOut}`;

      return message.reply(
        reply
      );
    }

    // =========================
    // Watch In
    // =========================

    if (
      message.content === "!watchin"
    ) {
      const watchlist =
        loadWatchlist();

      const products =
        Object.values(
          loadProducts()
        );

      let count = 0;

      let reply =
        "⭐ Watchlist In Stock\n\n";

      for (
        const keyword of watchlist
      ) {
        const match =
          products.find(product =>
            product.title
              .toLowerCase()
              .includes(keyword)
          );

        if (!match) continue;

        if (
          match.available !== true
        ) {
          continue;
        }

        count++;

        reply +=
          `✅ ${match.title}\n\n`;
      }

      reply +=
        `\n📊 Total In Stock: ${count}`;

      return message.reply(
        reply
      );
    }

    // =========================
    // Watch Out
    // =========================

    if (
      message.content === "!watchout"
    ) {
      const watchlist =
        loadWatchlist();

      const products =
        Object.values(
          loadProducts()
        );

      let count = 0;

      let reply =
        "⭐ Watchlist Sold Out\n\n";

      for (
        const keyword of watchlist
      ) {
        const match =
          products.find(product =>
            product.title
              .toLowerCase()
              .includes(keyword)
          );

        if (!match) continue;

        if (
          match.available === true
        ) {
          continue;
        }

        count++;

        reply +=
          `❌ ${match.title}\n\n`;
      }

      reply +=
        `\n📊 Total Sold Out: ${count}`;

      return message.reply(
        reply
      );
    }

    // =========================
    // Watch Summary
    // =========================

    if (
      message.content === "!watchsummary"
    ) {
      const watchlist =
        loadWatchlist();

      const products =
        Object.values(
          loadProducts()
        );

      let inStock = 0;
      let soldOut = 0;
      let restocks = 0;
      let soldOutEvents = 0;

      let reply =
        "⭐ Watchlist Summary\n\n";

      for (
        const keyword of watchlist
      ) {
        const match =
          products.find(product =>
            product.title
              .toLowerCase()
              .includes(keyword)
          );

        if (!match) continue;

        if (
          match.available === true
        ) {
          inStock++;

          reply +=
            `✅ ${match.title}\n`;
        } else {
          soldOut++;

          reply +=
            `❌ ${match.title}\n`;
        }

        restocks +=
          match.stats
            ?.restockEvents || 0;

        soldOutEvents +=
          match.stats
            ?.soldOutEvents || 0;
      }

      reply +=
        "\n📊 Summary\n" +
        `✅ In Stock: ${inStock}\n` +
        `❌ Sold Out: ${soldOut}\n` +
        `🔥 Restocks Seen: ${restocks}\n` +
        `🚫 Sold Out Events: ${soldOutEvents}`;

      return message.reply(
        reply
      );
    }

    // =========================
    // Dashboard
    // =========================

    if (
      message.content === "!dashboard"
    ) {
      const watchlist =
        loadWatchlist();

      const products =
        Object.values(
          loadProducts()
        );

      const stats =
        loadStats();

      let inStock = 0;
      let soldOut = 0;

      let topProduct = "None";
      let topScore = 0;

      for (
        const keyword of watchlist
      ) {
        const match =
          products.find(product =>
            product.title
              .toLowerCase()
              .includes(keyword)
          );

        if (!match) continue;

        if (
          match.available === true
        ) {
          inStock++;
        } else {
          soldOut++;
        }

        const score =
          (match.stats
            ?.restockEvents || 0) +
          (match.stats
            ?.soldOutEvents || 0);

        if (score > topScore) {
          topScore = score;
          topProduct =
            match.title;
        }
      }

      const alerts =
        loadAlerts();

      let reply =
        "📊 Mattel Dashboard\n\n" +

        "⭐ Watchlist\n" +
        `✅ In Stock: ${inStock}\n` +
        `❌ Sold Out: ${soldOut}\n\n` +

        "📈 Activity\n" +
        `🏆 Top Product: ${topProduct}\n` +
        `📊 Activity Score: ${topScore}\n\n` +

        "📢 Today\n" +
        `🆕 New Products: ${stats.newProductsToday}\n` +
        `🔥 Restocks: ${stats.restocksToday}\n` +
        `❌ Sold Outs: ${stats.soldOutToday}\n\n` +

        "🚨 Latest Alert\n" +
        `${alerts[0] || "No alerts yet"}`;

      return message.reply(
        reply
      );
    }

    // =========================
    // Hidden
    // =========================

    if (
      message.content === "!hidden"
    ) {
      const products =
        Object.values(
          loadProducts()
        );

      const hiddenProducts =
        products.filter(
          p =>
            p.wasHidden === true
        );

      if (
        hiddenProducts.length === 0
      ) {
        return message.reply(
          "✅ No hidden products tracked."
        );
      }

      let reply =
        "🚨 Hidden Products\n\n";

      hiddenProducts
        .slice(0, 25)
        .forEach(product => {
          reply +=
            `📦 ${product.title}\n` +
            `🔗 ${getProductUrl(product.handle)}\n\n`;
        });

      reply +=
        `📊 Total Hidden: ${hiddenProducts.length}`;

      return message.reply(
        reply
      );
    }

    // =========================
    // Watchlist
    // =========================

    if (
      message.content === "!watchlist"
    ) {
      const watchlist =
        loadWatchlist();

      return message.reply(
        "⭐ Watchlist\n\n" +
        watchlist.join("\n")
      );
    }

    // =========================
    // Hot
    // =========================

    if (
      message.content === "!hot"
    ) {
      const products =
        Object.values(
          loadProducts()
        );

      const ranked =
        products
          .filter(p => p.stats)
          .map(p => ({
            title: p.title,
            score:
              (p.stats
                .restockEvents || 0) +
              (p.stats
                .soldOutEvents || 0)
          }))
          .sort(
            (a, b) =>
              b.score - a.score
          )
          .slice(0, 10);

      if (
        ranked.length === 0
      ) {
        return message.reply(
          "❌ No activity data yet."
        );
      }

      let reply =
        "🏆 Most Active Products\n\n";

      ranked.forEach(
        (item, index) => {
          reply +=
            `${index + 1}. ${item.title}\n` +
            `📊 Activity Score: ${item.score}\n\n`;
        }
      );

      return message.reply(
        reply
      );
    }

    // =========================
    // Health
    // =========================

    if (
      message.content === "!health"
    ) {
      const savedProducts =
        loadProducts();

      const stats =
        loadStats();

      return message.reply(
        "🤖 MattelBot Health\n\n" +
        "✅ Online\n" +
        `📦 Tracking: ${Object.keys(savedProducts).length}\n` +
        `🆕 New Today: ${stats.newProductsToday}\n` +
        `🔥 Restocks Today: ${stats.restocksToday}\n` +
        `❌ Sold Out Today: ${stats.soldOutToday}\n` +
        `⏰ Checked: ${new Date().toLocaleString()}`
      );
    }

    // =========================
    // Help
    // =========================

    if (
      message.content === "!help"
    ) {
      return message.reply(
        "🤖 Mattel Scanner Commands\n\n" +

        "📦 Core\n" +
        "!status\n" +
        "!health\n" +
        "!stats\n" +
        "!counts\n" +
        "!debug\n\n" +

        "🔍 Products\n" +
        "!product keyword\n" +
        "!latest\n" +
        "!upcoming\n" +
        "!hidden\n\n" +

        "⭐ Watchlist\n" +
        "!watch keyword\n" +
        "!unwatch keyword\n" +
        "!watchlist\n" +
        "!watchstats\n" +
        "!watchstock\n" +
        "!watchin\n" +
        "!watchout\n" +
        "!watchsummary\n\n" +

        "📈 Analytics\n" +
        "!hot\n" +
        "!predict keyword\n" +
        "!launch keyword\n\n" +

        "📢 Alerts\n" +
        "!alerts\n\n" +

        "🔎 Scanner\n" +
        "!scan\n" +
        "!upcoming\n" +
        "!dashboard"
      );
    }

    // =========================
    // Manual Scan
    // =========================

    if (
      message.content === "!scan"
    ) {
      try {
        const data =
          await getMattelData();

        const products =
          data.products.filter(
            isHotWheelsProduct
          );

        let reply =
          "🚗 Latest Hot Wheels\n\n";

        products
          .slice(0, 5)
          .forEach(product => {
            const price =
              getPrice(product);

            const inStock =
              isInStock(product);

            reply +=
              `${inStock ? "✅ IN STOCK" : "❌ SOLD OUT"}\n` +
              `📦 ${product.title}\n` +
              `💲 $${price}\n` +
              `🔗 ${getProductUrl(product.handle)}\n\n`;
          });

        const embed =
          new EmbedBuilder()
            .setColor(0x0099ff)
            .setTitle(
              "🚗 Latest Hot Wheels"
            )
            .setDescription(reply)
            .setFooter({
              text: "MattelBotV2"
            });

        return message.reply({
          embeds: [embed]
        });
      } catch (error) {
        console.error(error);

        return message.reply(
          "❌ Could not reach Mattel."
        );
      }
    }

    // =========================
    // Upcoming
    // =========================

    if (
      message.content === "!upcoming"
    ) {
      try {
        const data =
          await getMattelData();

        const products =
          data.products.filter(
            product =>
              isHotWheelsProduct(
                product
              ) &&
              !isInStock(product)
          );

        for (
          const product of products.slice(
            0,
            5
          )
        ) {
          const price =
            getPrice(product);

          const embed =
            new EmbedBuilder()
              .setColor(0xffcc00)
              .setTitle(
                "🚀 UPCOMING PRODUCT"
              )
              .addFields(
                {
                  name: "📦 Product",
                  value: product.title
                },
                {
                  name: "💲 Price",
                  value: `$${price}`,
                  inline: true
                },
                {
                  name: "👀 Status",
                  value:
                    "NOT AVAILABLE YET",
                  inline: true
                }
              )
              .setThumbnail(
                product.images?.[0]?.src ||
                null
              )
              .setFooter({
                text: "MattelBotV2"
              });

          const row =
            new ActionRowBuilder()
              .addComponents(
                new ButtonBuilder()
                  .setLabel(
                    "🛒 View Product"
                  )
                  .setStyle(
                    ButtonStyle.Link
                  )
                  .setURL(
                    getProductUrl(
                      product.handle
                    )
                  )
              );

          await message.channel.send({
            embeds: [embed],
            components: [row]
          });
        }

        return;
      } catch (error) {
        console.error(error);

        return message.reply(
          "❌ Could not reach Mattel."
        );
      }
    }
  }
);

// =========================
// Error Handling
// =========================

process.on(
  "unhandledRejection",
  error => {
    console.error(
      "❌ Unhandled Rejection:",
      error
    );
  }
);

process.on(
  "uncaughtException",
  error => {
    console.error(
      "❌ Uncaught Exception:",
      error
    );
  }
);

// =========================
// Login
// =========================

client.login(
  process.env.DISCORD_TOKEN
);

// Stable Backup
