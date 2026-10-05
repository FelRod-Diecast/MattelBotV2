const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
function cartUrl(variantId, qty) { return `https://creations.mattel.com/cart/${variantId}:${qty}`; }
function actionRow(product) {
  const variantId = product.availableVariantIds?.[0] || product.variantIds?.[0];
  const row = new ActionRowBuilder();
  if (product.status === 'AVAILABLE' && variantId) {
    for (const qty of [1, 2, 10]) row.addComponents(new ButtonBuilder().setLabel(`🛒 QTY ${qty}`).setStyle(ButtonStyle.Link).setURL(cartUrl(variantId, qty)));
  }
  row.addComponents(new ButtonBuilder().setLabel('🔗 PRODUCT').setStyle(ButtonStyle.Link).setURL(product.url));
  return row;
}
function embedFor(event, product) {
  const titles = { NEW_PRODUCT: '🆕 NEW HOT WHEELS PRODUCT', HIDDEN_DISCOVERY: '🚨 HIDDEN PRODUCT FOUND', UPCOMING_DISCOVERY: '🚀 UPCOMING PRODUCT FOUND', RESTOCK: '🔥 RESTOCK DETECTED', SOLD_OUT: '❌ SOLD OUT', PRICE_CHANGE: '💲 PRICE CHANGE', BUYABLE: '🛒 BUYABLE NOW' };
  const embed = new EmbedBuilder().setTitle(titles[event] || `Mattel Event: ${event}`).setDescription(product.title).setURL(product.url).addFields(
    { name: 'Status', value: product.status || 'UNKNOWN', inline: true },
    { name: 'Price', value: product.price == null ? 'Unknown' : `$${product.price}`, inline: true },
    { name: 'Detected', value: new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }), inline: true }
  );
  if (product.launchDate) embed.addFields({ name: 'Launch / Ship Date', value: product.launchDate, inline: false });
  if (event === 'HIDDEN_DISCOVERY') embed.addFields({ name: 'Discovery Score', value: `${product.hiddenScore}/100`, inline: true });
  if (product.image) embed.setThumbnail(product.image);
  return embed;
}
async function notify(channel, event, product) { await channel.send({ embeds: [embedFor(event, product)], components: [actionRow(product)] }); }
module.exports = { notify };
