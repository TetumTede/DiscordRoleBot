const { ActionRowBuilder, ButtonBuilder } = require('discord.js');

const ROLE_BUTTON_PREFIX = 'roletoggle:';
const MY_ROLES_PREFIX = 'myroletoggle:';
const MY_ROLES_OPEN_PREFIX = 'myroles-open:';
const MAX_BUTTONS_PER_MESSAGE = 25; // Discord limit: 5 rows x 5 buttons

function buildRoleCustomId(roleId) {
  return `${ROLE_BUTTON_PREFIX}${roleId}`;
}

function buildMyRolesOpenCustomId(rootMessageId) {
  return `${MY_ROLES_OPEN_PREFIX}${rootMessageId}`;
}

function countButtons(rows) {
  return rows.reduce((sum, row) => sum + row.components.length, 0);
}

function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) chunks.push(array.slice(i, i + size));
  return chunks;
}

function isReservedRow(row) {
  return row.components.some((c) => c.data.custom_id.startsWith(MY_ROLES_OPEN_PREFIX));
}

// A page has room for another role button if some non-reserved row isn't full yet,
// or there's still an empty row slot (Discord allows at most 5 rows per message).
function pageHasRoomForRole(message) {
  const rows = rowsFromMessage(message);
  if (rows.some((row) => !isReservedRow(row) && row.components.length < 5)) return true;
  return rows.length < 5;
}

function rowsFromMessage(message) {
  // Rebuild ActionRowBuilders (with live ButtonBuilders) from an existing message's components.
  return message.components.map((row) =>
    new ActionRowBuilder().addComponents(
      row.components.map((c) => {
        const button = new ButtonBuilder().setCustomId(c.customId).setLabel(c.label ?? 'Role').setStyle(c.style);
        if (c.emoji) button.setEmoji(c.emoji);
        return button;
      })
    )
  );
}

// Panels can outgrow Discord's 25-buttons-per-message limit. When that happens we chain
// a new message after the full one and link them via the embed footer, e.g. "Page 1 • next:123456".
// This lets a panel span unlimited messages while admins keep referring to just the first one.
function getPageMeta(message) {
  const footer = message.embeds[0]?.footer?.text ?? '';
  const match = footer.match(/^Page (\d+)(?: • next:(\d+))?$/);
  if (!match) return { page: 1, next: null };
  return { page: parseInt(match[1], 10), next: match[2] ?? null };
}

function setPageMeta(embed, page, next) {
  return embed.setFooter({ text: `Page ${page}${next ? ` • next:${next}` : ''}` });
}

async function getChannel(interaction) {
  return interaction.channel ?? (await interaction.client.channels.fetch(interaction.channelId));
}

async function fetchOwnMessage(interaction, messageId) {
  const channel = await getChannel(interaction);
  let message;
  try {
    // force: true bypasses discord.js's message cache. Message#edit() only patches a private
    // clone and never updates the cached entry, so a cached read here would silently return a
    // stale, pre-edit snapshot of the panel and cause edits to clobber each other's buttons.
    message = await channel.messages.fetch({ message: messageId, force: true });
  } catch {
    return { error: `Could not find a message with ID \`${messageId}\` in this channel.` };
  }
  if (message.author.id !== interaction.client.user.id) {
    return { error: "That message was not posted by this bot, so I can't attach role buttons to it." };
  }
  return { message };
}

// Follows the "next" footer links starting at the root panel message, returning every page in order.
async function loadChain(channel, rootMessage) {
  const chain = [];
  let current = rootMessage;
  while (current) {
    const meta = getPageMeta(current);
    chain.push({ message: current, page: meta.page, next: meta.next });
    if (!meta.next) break;
    try {
      current = await channel.messages.fetch({ message: meta.next, force: true });
    } catch {
      break; // linked message was deleted; treat this as the end of the chain
    }
  }
  return chain;
}

module.exports = {
  ROLE_BUTTON_PREFIX,
  MY_ROLES_PREFIX,
  MY_ROLES_OPEN_PREFIX,
  MAX_BUTTONS_PER_MESSAGE,
  buildRoleCustomId,
  buildMyRolesOpenCustomId,
  countButtons,
  chunk,
  isReservedRow,
  pageHasRoomForRole,
  rowsFromMessage,
  getPageMeta,
  setPageMeta,
  getChannel,
  fetchOwnMessage,
  loadChain,
};
