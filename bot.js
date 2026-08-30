require("dotenv").config();

const { Client, GatewayIntentBits } = require("discord.js");
const fs = require("fs");

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
 
const data = await response.json();
 
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

    const products = data.products.filter(product =>
      product.title.toLowerCase().includes("hot wheels")
    );

    const savedProducts = loadProducts();

    if (Object.keys(savedProducts).length === 0) {
      products.forEach(product => {
       const inStock =
product.variants?.some(v => v.available);
 
savedProducts[product.id] = {
title: product.title,
handle: product.handle,
available: inStock,
detectedAt: new Date().toISOString(),
lastSeen: new Date().toISOString()
};
      });

      saveProducts(savedProducts);

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

    const products = data.products.filter(product =>
      product.title.toLowerCase().includes("hot wheels")
    );

    const savedProducts = loadProducts();

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

                await channel.send(
          "🚨 **NEW HOT WHEELS DETECTED** 🚨\n\n" +
          `📦 ${product.title}\n` +
          `💲 $${price}\n` +
          `${inStock ? "✅ IN STOCK" : "❌ SOLD OUT"}\n` +
          `🔗 https://creations.mattel.com/products/${product.handle}`
        );

     savedProducts[product.id] = {
title: product.title,
handle: product.handle,
available: inStock,
detectedAt: new Date().toISOString(),
lastSeen: new Date().toISOString()
};
 
console.log(
`🆕 New Product Found: ${product.title}`
);
}
else {
 
if (
existingProduct.available === false &&
inStock === true
) {
 
await channel.send(
`🔥 BACK IN STOCK 🔥\n\n` +
`📦 ${product.title}\n` +
`🔗 https://creations.mattel.com/products/${product.handle}`
);
 
console.log(
`🔥 Restock Detected: ${product.title}`
);
}
 
if (
existingProduct.available === true &&
inStock === false
) {
 
await channel.send(
`❌ SOLD OUT ❌\n\n` +
`📦 ${product.title}\n` +
`🔗 https://creations.mattel.com/products/${product.handle}`
);
 
console.log(
`❌ Sold Out: ${product.title}`
);
}
 
savedProducts[product.id].available = inStock;
savedProducts[product.id].lastSeen =
new Date().toISOString();
}
}
 
saveProducts(savedProducts);
 
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
  }, 15 * 60 * 1000);
}

// =========================
// Bot Ready
// =========================

client.once("clientReady", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  await initializeProducts();

  startScanner();
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

  // Help
  if (message.content === "!help") {
    return message.reply(
      "🤖 Mattel Scanner Commands\n\n" +
      "!ping\n" +
      "!status\n" +
      "!help\n" +
      "!scan\n" +
      "!upcoming"
    );
  }

  // Scan
  if (message.content === "!scan") {
    try {
      const data = await getMattelData();

      const products = data.products.filter(product =>
        product.title.toLowerCase().includes("hot wheels")
      );

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

      return message.reply(reply);

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
