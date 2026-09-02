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
const WATCHLIST_FILE =
  "./watchlist.json";
const ALERTS_FILE = "./alerts.json";

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
return JSON.parse(fs.readFileSync(STATS_FILE, "utf8"));
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
    return WATCHLIST;
  }
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
 
if (text.startsWith("<!DOCTYPE")) {
break;
}
 
const data = JSON.parse(text);
 
if (!data.products || data.products.length === 0) {
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
// Initial Product Load
// =========================

async function initializeProducts() {
  try {
    const data = await getMattelData();
  const products = data.products.filter(product => {
  const title = product.title.toLowerCase();

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
    !title.includes("mechanic shirt") &&
    !title.includes("jersey")
  );
});

    const savedProducts = loadProducts();

    const stats = loadStats();

    if (Object.keys(savedProducts).length === 0) {
      products.forEach(product => {
       const inStock =
  product.variants?.some(v => v.available);

const price =
  product.variants?.[0]?.price || "Unknown";

savedProducts[product.id] = {
  title: product.title,
  handle: product.handle,
  available: inStock,
  price: price,
  detectedAt: new Date().toISOString(),
  lastSeen: new Date().toISOString(),
  watchlistAlertSent: false,
  hiddenAlertSent: false,

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
    }
  } catch (error) {
    console.error(error);
  }
}

// =========================
// Scanner
// =========================

async function scanForNewProducts() {
  try {
    const data = await getMattelData();

    const products = data.products.filter(product => {
  const title = product.title.toLowerCase();

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
});

const savedProducts = loadProducts();
const stats = loadStats();
const alerts = loadAlerts();

    if (!CHANNEL_ID) {
      console.log("⚠️ CHANNEL_ID not configured");
      return;
    }

    const channel = await client.channels.fetch(CHANNEL_ID);

    for (const product of products) {
     
      const inStock =
product.variants?.some(v => v.available);
 
const existingProduct =
savedProducts[product.id];
      
 if (!savedProducts[product.id]) {
  const price =
product.variants?.[0]?.price || "Unknown";

 if (
  !inStock &&
  !savedProducts[product.id]?.hiddenAlertSent
) {

 const embed = new EmbedBuilder()
  .setColor(0xffcc00)
  .setTitle("🚨 POSSIBLE HIDDEN PRODUCT DETECTED")
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
      value: "NOT AVAILABLE YET",
      inline: true
    }
  )
.setURL(
  `https://creations.mattel.com/products/${product.handle}`
)
  .setThumbnail(
    product.images?.[0]?.src || null
  )
  .setFooter({
    text: "MattelBotV2"
  });

const row = new ActionRowBuilder()
  .addComponents(
    new ButtonBuilder()
      .setLabel("🛒 View Product")
      .setStyle(ButtonStyle.Link)
      .setURL(
        `https://creations.mattel.com/products/${product.handle}`
      )
  );

await channel.send({
  embeds: [embed],
  components: [row]
});
  
} else {

const embed = new EmbedBuilder()
  .setColor(0x00ff00)
  .setTitle("🚨 NEW HOT WHEELS DETECTED")
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
      name: "✅ Status",
      value: "IN STOCK",
      inline: true
    }
  )
 .setURL(
  `https://creations.mattel.com/products/${product.handle}`
)
  .setThumbnail(
    product.images?.[0]?.src || null
  )
  .setFooter({
    text: "MattelBotV2"
  });
await channel.send({
  embeds: [embed]
});

}

savedProducts[product.id] = {
  title: product.title,
  handle: product.handle,
  available: inStock,
  price: price,
  detectedAt: new Date().toISOString(),
  lastSeen: new Date().toISOString(),
  watchlistAlertSent: false,
  hiddenAlertSent: !inStock,

stats: {
  restockEvents: 0,
  soldOutEvents: 0,
  restockTimestamps: []
},

predictionAlertSent: false,
etaAlertSent: false
};
        
 alerts.unshift(
  `🆕 ${product.title}`
);

alerts.splice(10);

saveAlerts(alerts);
        
const matchedKeyword =
 loadWatchlist().find(keyword =>
    product.title
      .toLowerCase()
      .includes(keyword)
  );

if (matchedKeyword) {

  await channel.send(
    `🚨 WATCHLIST MATCH 🚨\n\n` +
    `📦 ${product.title}\n` +
    `🔑 Keyword: ${matchedKeyword}\n` +
    `🔗 https://creations.mattel.com/products/${product.handle}`
  );

}
        
stats.newProductsToday++;
console.log(
`🆕 New Product Found: ${product.title}`
);
}
else {
if (
existingProduct.available === false &&
inStock === true
) {
const embed = new EmbedBuilder()
  .setColor(0x0099ff)
  .setTitle("🔥 BACK IN STOCK")
  .addFields(
    {
      name: "📦 Product",
      value: product.title
    },
    {
      name: "✅ Status",
      value: "BACK IN STOCK",
      inline: true
    }
  )
.setURL(
  `https://creations.mattel.com/products/${product.handle}`
)
  .setThumbnail(
    product.images?.[0]?.src || null
  )
  .setFooter({
    text: "MattelBotV2"
  });
await channel.send({
  embeds: [embed]
});
alerts.unshift(
  `🔥 ${product.title}`
);

alerts.splice(10);

saveAlerts(alerts);
savedProducts[product.id]
  .stats
  .restockEvents++;

savedProducts[product.id]
  .stats
  .restockTimestamps
  .push(Date.now());
  savedProducts[product.id]
  .predictionAlertSent = false;

savedProducts[product.id]
  .etaAlertSent = false;
  
stats.restocksToday++;
 console.log(
`🔥 Restock Detected: ${product.title}`
);
}
 
if (
existingProduct.available === true &&
inStock === false
) {
 
const embed = new EmbedBuilder()
  .setColor(0xff0000)
  .setTitle("❌ SOLD OUT")
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
  `https://creations.mattel.com/products/${product.handle}`
)
  .setThumbnail(
    product.images?.[0]?.src || null
  )
  .setFooter({
    text: "MattelBotV2"
  });

await channel.send({
  embeds: [embed]
});
alerts.unshift(
  `❌ ${product.title}`
);

alerts.splice(10);

saveAlerts(alerts); 
savedProducts[product.id]
  .stats
  .soldOutEvents++;
  
stats.soldOutToday++;
console.log(
`❌ Sold Out: ${product.title}`
);
}
 
const currentPrice =
  product.variants?.[0]?.price || "Unknown";

if (
  existingProduct.price &&
  existingProduct.price !== currentPrice
) {

 const embed = new EmbedBuilder()
  .setColor(0x9932cc)
  .setTitle("💲 PRICE CHANGE DETECTED")
  .addFields(
    {
      name: "📦 Product",
      value: product.title
    },
    {
      name: "⬇️ Old Price",
      value: `$${existingProduct.price}`,
      inline: true
    },
    {
      name: "⬆️ New Price",
      value: `$${currentPrice}`,
      inline: true
    }
  )
 .setURL(
  `https://creations.mattel.com/products/${product.handle}`
)
  .setThumbnail(
    product.images?.[0]?.src || null
  )
  .setFooter({
    text: "MattelBotV2"
  });
alerts.unshift(
  `💲 ${product.title}`
);

alerts.splice(10);

saveAlerts(alerts);
await channel.send({
  embeds: [embed]
});

  console.log(
    `💲 Price Changed: ${product.title}`
  );

}

savedProducts[product.id].price =
  currentPrice;

savedProducts[product.id].available =
  inStock;

savedProducts[product.id].lastSeen =
  new Date().toISOString();
if (
  savedProducts[product.id]
    .predictionAlertSent === undefined
) {
  savedProducts[product.id]
    .predictionAlertSent = false;
}

if (
  savedProducts[product.id]
    .etaAlertSent === undefined
) {
  savedProducts[product.id]
    .etaAlertSent = false;
}  
}
}
 
saveProducts(savedProducts);

saveStats(stats);
 
console.log(
`⏰ Scan Complete - ${products.length} products checked`
);

  } catch (error) {
    console.error("❌ Scan Failed");
    console.error(error);
  }
}

function startScanner() {
  console.log("✅ Scanner Started");

  setInterval(async () => {
    await scanForNewProducts();
  }, 5 * 60 * 1000);
}
function startDailySummary() {

  cron.schedule(
    "0 8 * * *",
    async () => {

      try {

        const channel =
          await client.channels.fetch(CHANNEL_ID);

        const stats = loadStats();
        const savedProducts = loadProducts();

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

client.once("clientReady", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  await initializeProducts();
 
startScanner();
startDailySummary();
});

// =========================
// Commands
// =========================

client.on("messageCreate", async message => {
  if (message.author.bot) return;

  // Ping
  if (message.content === "!ping") {
    return message.reply("🏓 Pong!");
  }

  // Status
  if (message.content === "!status") {
    const savedProducts = loadProducts();

    return message.reply(
      `✅ Online\n📦 Tracking ${Object.keys(savedProducts).length} products`
    );
  }
// Stats
if (message.content === "!stats") {
  const stats = loadStats();

  return message.reply(
    "📊 MattelBot Daily Stats\n\n" +
    `🆕 New Products: ${stats.newProductsToday}\n` +
    `🔥 Restocks: ${stats.restocksToday}\n` +
    `❌ Sold Out: ${stats.soldOutToday}`
  );
}
  // Debug
if (message.content === "!debug") {

  const savedProducts = loadProducts();
  const stats = loadStats();

  return message.reply(
    "🛠️ MattelBot Debug\n\n" +
    `📦 Tracked Products: ${Object.keys(savedProducts).length}\n` +
    `🆕 New Products Today: ${stats.newProductsToday}\n` +
    `🔥 Restocks Today: ${stats.restocksToday}\n` +
    `❌ Sold Out Today: ${stats.soldOutToday}\n` +
    `📁 Data File: ${DATA_FILE}`
  );
}
// Test New Product Alert
if (message.content === "!testnew") {

  const embed = new EmbedBuilder()
    .setColor(0x00ff00)
    .setTitle("🚨 NEW HOT WHEELS DETECTED")
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
const stats = loadStats();

stats.newProductsToday++;

saveStats(stats);

console.log("TEST NEW PRODUCT COUNT");
  return message.reply({
    embeds: [embed]
  });

}
  
// Test Daily Summary
if (message.content === "!summary") {

  const stats = loadStats();
  const savedProducts = loadProducts();

  return message.reply(
    "📊 MattelBot Daily Summary\n\n" +
    `📦 Tracking: ${Object.keys(savedProducts).length}\n` +
    `🆕 New Products: ${stats.newProductsToday}\n` +
    `🔥 Restocks: ${stats.restocksToday}\n` +
    `❌ Sold Out: ${stats.soldOutToday}`
  );
}
  // Latest Products
if (message.content === "!latest") {

  const savedProducts = loadProducts();

  const latestProducts = Object.values(savedProducts)
    .sort(
      (a, b) =>
        new Date(b.detectedAt) -
        new Date(a.detectedAt)
    )
    .slice(0, 10);

  if (latestProducts.length === 0) {
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
        `🔗 https://creations.mattel.com/products/${product.handle}\n\n`;

    }
  );

  return message.reply(reply);

}
  // Alerts
if (message.content === "!alerts") {

  const alerts = loadAlerts();

  if (alerts.length === 0) {
    return message.reply(
      "📢 No alerts recorded yet."
    );
  }

  return message.reply(
    "📢 Recent Alerts\n\n" +
    alerts.join("\n")
  );

}
  // Counts
if (message.content === "!counts") {

  const savedProducts = loadProducts();

  const products =
    Object.values(savedProducts);

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
  // Product Search
if (message.content.startsWith("!product ")) {

  try {

    const keyword = message.content
      .replace("!product ", "")
      .toLowerCase();

    const data = await getMattelData();

    const matches = data.products.filter(
      product =>
        product.title
          .toLowerCase()
          .includes(keyword)
    );

    if (matches.length === 0) {
      return message.reply(
        "❌ Product not found."
      );
    }

const inStockProducts = matches.filter(
  product =>
    product.variants?.some(
      v => v.available
    )
);

if (inStockProducts.length === 0) {
  return message.reply(
    `❌ No in-stock products found for "${keyword}".`
  );
}

let reply =
  `🟢 In Stock Results for "${keyword}"\n\n`;

inStockProducts
  .slice(0, 5)
  .forEach((product, index) => {

    const price =
      product.variants?.[0]?.price ||
      "Unknown";

    reply +=
      `${index + 1}. ${product.title}\n` +
      `💲 $${price}\n` +
      `🔗 https://creations.mattel.com/products/${product.handle}\n\n`;

  });

return message.reply(reply);

 
  } catch (error) {

    console.error(error);

    return message.reply(
      "❌ Could not reach Mattel."
    );

  }

}
  if (message.content.startsWith("!predict ")) {

  const keyword = message.content
    .replace("!predict ", "")
    .toLowerCase();

  const products = loadProducts();

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
  match.stats.restockTimestamps.length < 2
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
if (message.content.startsWith("!launch ")) {

  try {

    const keyword = message.content
      .replace("!launch ", "")
      .toLowerCase();

    const products = loadProducts();

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
      `https://creations.mattel.com/products/${match.handle}`;

    const response =
      await fetch(url);

    const html =
      await response.text();

    const launchMatch =
      html.match(
        /Launches\s+[A-Za-z]+\s+\d{1,2},\s+\d{4}\s+\d{1,2}:\d{2}\s+[ap]m\s+PT/i
      );

    const shipMatch =
      html.match(
        /Ships on or before\s+[A-Za-z]+\s+\d{1,2},\s+\d{4}/i
      );

    let reply =
      `🚀 Launch Information\n\n${match.title}\n\n`;

    if (launchMatch) {

      reply +=
        `📅 ${launchMatch[0]}\n\n`;

    }

    if (shipMatch) {

      reply +=
        `🚚 ${shipMatch[0]}\n\n`;

    }

    reply +=
      `🔗 ${url}`;

    return message.reply(reply);

  } catch (error) {

    console.error(error);

    return message.reply(
      "❌ Could not retrieve launch data."
    );

  }

}
  if (message.content.startsWith("!watch ")) {

  const keyword = message.content
    .replace("!watch ", "")
    .toLowerCase()
    .trim();

  const watchlist = loadWatchlist();

  if (watchlist.includes(keyword)) {
    return message.reply(
      `⚠️ ${keyword} is already being watched.`
    );
  }

  watchlist.push(keyword);

  fs.writeFileSync(
    WATCHLIST_FILE,
    JSON.stringify(watchlist, null, 2)
  );

  return message.reply(
    `✅ Added "${keyword}" to watchlist.`
  );

}
if (message.content.startsWith("!unwatch ")) {

  const keyword = message.content
    .replace("!unwatch ", "")
    .toLowerCase()
    .trim();

  const watchlist = loadWatchlist();

  if (!watchlist.includes(keyword)) {
    return message.reply(
      `⚠️ ${keyword} is not in the watchlist.`
    );
  }

  const updated = watchlist.filter(
    item => item !== keyword
  );

  fs.writeFileSync(
    WATCHLIST_FILE,
    JSON.stringify(updated, null, 2)
  );

  return message.reply(
    `✅ Removed "${keyword}" from watchlist.`
  );

}
if (message.content === "!watchstats") {

  const watchlist = loadWatchlist();

  const products =
    Object.values(loadProducts());

  let reply =
    "⭐ Watchlist Stats\n\n";

  for (const keyword of watchlist) {

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

  return message.reply(reply);

}

if (message.content === "!watchstock") {

  const watchlist = loadWatchlist();

  const products =
    Object.values(loadProducts());

  let inStock = 0;
  let soldOut = 0;

  let reply =
    "⭐ Watchlist Stock Status\n\n";

  for (const keyword of watchlist) {

    const match =
      products.find(product =>
        product.title
          .toLowerCase()
          .includes(keyword)
      );

    if (!match) {
      continue;
    }

    if (match.available === true) {

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

  return message.reply(reply);

}
if (message.content === "!watchin") {

  const watchlist = loadWatchlist();

  const products =
    Object.values(loadProducts());

  let count = 0;

let reply =
  "⭐ Watchlist In Stock\n\n";

  for (const keyword of watchlist) {

    const match =
      products.find(product =>
        product.title
          .toLowerCase()
          .includes(keyword)
      );

    if (!match) continue;

    if (match.available !== true)
      continue;

   count++;

reply +=
  `✅ ${match.title}\n\n`;

  }

  reply +=
  `\n📊 Total In Stock: ${count}`;

return message.reply(reply);

}
if (message.content === "!watchout") {

  const watchlist = loadWatchlist();

  const products =
    Object.values(loadProducts());

  let count = 0;

  let reply =
    "⭐ Watchlist Sold Out\n\n";

  for (const keyword of watchlist) {

    const match =
      products.find(product =>
        product.title
          .toLowerCase()
          .includes(keyword)
      );

    if (!match) continue;

    if (match.available === true)
      continue;

    count++;

    reply +=
      `❌ ${match.title}\n\n`;

  }

  reply +=
    `\n📊 Total Sold Out: ${count}`;

  return message.reply(reply);

}

if (message.content === "!watchsummary") {

  const watchlist = loadWatchlist();

  const products =
    Object.values(loadProducts());

  let inStock = 0;
  let soldOut = 0;
  let restocks = 0;
  let soldOutEvents = 0;

  let reply =
    "⭐ Watchlist Summary\n\n";

  for (const keyword of watchlist) {

    const match =
      products.find(product =>
        product.title
          .toLowerCase()
          .includes(keyword)
      );

    if (!match) continue;

    if (match.available === true) {

      inStock++;

      reply +=
        `✅ ${match.title}\n`;

    } else {

      soldOut++;

      reply +=
        `❌ ${match.title}\n`;

    }

    restocks +=
      match.stats?.restockEvents || 0;

    soldOutEvents +=
      match.stats?.soldOutEvents || 0;

  }

  reply +=
    "\n📊 Summary\n" +
    `✅ In Stock: ${inStock}\n` +
    `❌ Sold Out: ${soldOut}\n` +
    `🔥 Restocks Seen: ${restocks}\n` +
    `🚫 Sold Out Events: ${soldOutEvents}`;

  return message.reply(reply);

}
 if (message.content === "!dashboard") {

  const watchlist = loadWatchlist();

  const products =
    Object.values(loadProducts());

  const stats = loadStats();

  let inStock = 0;
  let soldOut = 0;

  let topProduct = "None";
  let topScore = 0;

  for (const keyword of watchlist) {

    const match =
      products.find(product =>
        product.title
          .toLowerCase()
          .includes(keyword)
      );

    if (!match) continue;

    if (match.available === true) {
      inStock++;
    } else {
      soldOut++;
    }

    const score =
      (match.stats?.restockEvents || 0) +
      (match.stats?.soldOutEvents || 0);

    if (score > topScore) {
      topScore = score;
      topProduct = match.title;
    }

  }

  const alerts = loadAlerts();

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

  return message.reply(reply);

} 
if (message.content === "!watchlist") {

   const watchlist = loadWatchlist();

  return message.reply(
    "⭐ Watchlist\n\n" +
    watchlist.join("\n")
  );

}
  if (message.content === "!hot") {

  const products =
    Object.values(loadProducts());

  const ranked = products
    .filter(p => p.stats)
    .map(p => ({
      title: p.title,
      score:
        (p.stats.restockEvents || 0) +
        (p.stats.soldOutEvents || 0)
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  if (ranked.length === 0) {
    return message.reply(
      "❌ No activity data yet."
    );
  }

  let reply =
    "🏆 Most Active Products\n\n";

  ranked.forEach((item, index) => {

    reply +=
      `${index + 1}. ${item.title}\n` +
      `📊 Activity Score: ${item.score}\n\n`;

  });

  return message.reply(reply);

}
  // Health
if (message.content === "!health") {

  const savedProducts = loadProducts();
  const stats = loadStats();

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
  // Help
if (message.content === "!help") {
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
  "!upcoming\n\n" +

  "⭐ Watchlist\n" +
  "!watch keyword\n" +
  "!unwatch keyword\n" +
  "!watchlist\n" +
  "!watchstats\n" +
  "!watchstock\n" +
  "!watchin\n" +
  "!watchout\n\n" +

  "📈 Analytics\n" +
  "!hot\n" +
  "!predict keyword\n\n" +

  "📢 Alerts\n" +
  "!alerts\n"
);
}
  // Scan
  if (message.content === "!scan") {
    try {
      const data = await getMattelData();

    const products = data.products.filter(product => {
  const title = product.title.toLowerCase();

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
});

      let reply = "🚗 Latest Hot Wheels\n\n";

      products.slice(0, 5).forEach(product => {
        const price =
          product.variants?.[0]?.price || "Unknown";

        const inStock =
          product.variants?.some(v => v.available);

        reply +=
          `${inStock ? "✅ IN STOCK" : "❌ SOLD OUT"}\n` +
          `📦 ${product.title}\n` +
          `💲 $${price}\n` +
          `🔗 https://creations.mattel.com/products/${product.handle}\n\n`;
      });

    const embed = new EmbedBuilder()
  .setColor(0x0099ff)
  .setTitle(`🔍 Results for "${keyword}"`)
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

  // Upcoming
  if (message.content === "!upcoming") {
    try {
      const data = await getMattelData();

      const products = data.products.filter(product => {
        const available =
          product.variants?.some(v => v.available);

        return !available;
      });

     for (const product of products.slice(0, 5)) {

  const price =
    product.variants?.[0]?.price || "Unknown";
  const embed = new EmbedBuilder()
    .setColor(0xffcc00)
    .setTitle("🚀 UPCOMING PRODUCT")
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
  value: "NOT AVAILABLE YET",
  inline: true
},
    )
    .setThumbnail(
      product.images?.[0]?.src || null
    )
    .setFooter({
      text: "MattelBotV2"
    });

  const row = new ActionRowBuilder()
.addComponents(
new ButtonBuilder()
.setLabel("🛒 View Product")
.setStyle(ButtonStyle.Link)
.setURL(
`https://creations.mattel.com/products/${product.handle}`
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
});

// =========================
// Error Handling
// =========================

process.on("unhandledRejection", error => {
  console.error(error);
});

process.on("uncaughtException", error => {
  console.error(error);
});

// =========================
// Login
// =========================

client.login(process.env.DISCORD_TOKEN);
// Stable Backup
