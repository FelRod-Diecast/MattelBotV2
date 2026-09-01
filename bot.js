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
 
savedProducts[product.id] = {
title: product.title,
handle: product.handle,
available: inStock,
price: price,
detectedAt: new Date().toISOString(),
lastSeen: new Date().toISOString(),
watchlistAlertSent: false,
hiddenAlertSent: false
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
        console.log(
  "IMAGE:",
  product.images?.[0]?.src || "NO IMAGE"
);


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
  embeds: [embed]
});
savedProducts[product.id].hiddenAlertSent = true;


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
lastSeen: new Date().toISOString()
};
 alerts.unshift(
  `🆕 ${product.title}`
);

alerts.splice(10);

saveAlerts(alerts);
        
const matchedKeyword =
  WATCHLIST.find(keyword =>
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
``

await channel.send({
  embeds: [embed]
});
alerts.unshift(
  `🔥 ${product.title}`
);

alerts.splice(10);

saveAlerts(alerts);
st
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
``
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
    "!status\n" +
"!stats\n" +
"!debug\n" +
"!summary\n" +
"!latest\n" +
"!health\n" +
"!counts\n" +
"!product keyword\n" +
"!alerts\n" +
"!testnew\n" +
"!help\n" +
"!scan\n" +
"!upcoming"
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

      let reply =
        "🚀 Upcoming / Not Available Yet\n\n";

      products.slice(0, 5).forEach(product => {
        const price =
          product.variants?.[0]?.price || "Unknown";

        reply +=
          `📦 ${product.title}\n` +
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
