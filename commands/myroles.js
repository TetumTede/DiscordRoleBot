const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const {
  ROLE_BUTTON_PREFIX,
  MY_ROLES_PREFIX,
  MAX_BUTTONS_PER_MESSAGE,
  getChannel,
  fetchOwnMessage,
  loadChain,
  rowsFromMessage,
} = require('../lib/panel');

// Builds the ephemeral, per-viewer "your roles" reply: green buttons for roles the
// member already has, grey for ones they don't. Used by both /myroles and the
// "Check My Roles" button seeded onto every panel page.
async function buildPersonalPanel(interaction, messageId) {
  const { message: rootMessage, error } = await fetchOwnMessage(interaction, messageId);
  if (error) return { error };

  const channel = await getChannel(interaction);
  const chain = await loadChain(channel, rootMessage);

  const roleButtons = [];
  for (const page of chain) {
    for (const row of rowsFromMessage(page.message)) {
      for (const button of row.components) {
        const customId = button.data.custom_id;
        if (customId.startsWith(ROLE_BUTTON_PREFIX)) {
          roleButtons.push({
            roleId: customId.slice(ROLE_BUTTON_PREFIX.length),
            label: button.data.label,
            emoji: button.data.emoji,
          });
        }
      }
    }
  }

  if (roleButtons.length === 0) {
    return { error: "That panel doesn't have any role buttons yet." };
  }

  const shown = roleButtons.slice(0, MAX_BUTTONS_PER_MESSAGE);
  const member = interaction.member;

  const rows = [];
  for (let i = 0; i < shown.length; i += 5) {
    const row = new ActionRowBuilder();
    for (const rb of shown.slice(i, i + 5)) {
      const hasRole = member.roles.cache.has(rb.roleId);
      const button = new ButtonBuilder()
        .setCustomId(`${MY_ROLES_PREFIX}${rb.roleId}`)
        .setLabel(rb.label ?? 'Role')
        .setStyle(hasRole ? ButtonStyle.Success : ButtonStyle.Secondary);
      if (rb.emoji) button.setEmoji(rb.emoji);
      row.addComponents(button);
    }
    rows.push(row);
  }

  const truncated = roleButtons.length > shown.length;
  return {
    payload: {
      content:
        `**Your roles from this panel** — green means you have it, grey means you don't. Click to toggle.` +
        (truncated ? `\n(Showing the first ${MAX_BUTTONS_PER_MESSAGE} of ${roleButtons.length} roles.)` : ''),
      components: rows,
      flags: MessageFlags.Ephemeral,
    },
  };
}

module.exports = {
  MY_ROLES_PREFIX,
  buildPersonalPanel,

  data: new SlashCommandBuilder()
    .setName('myroles')
    .setDescription("See which roles from a role panel you already have, and toggle them here")
    .setDMPermission(false)
    .addStringOption((opt) =>
      opt.setName('message_id').setDescription("The panel's message ID (from /rolepanel create)").setRequired(true)
    ),

  async execute(interaction) {
    const messageId = interaction.options.getString('message_id', true);
    const { payload, error } = await buildPersonalPanel(interaction, messageId);
    if (error) {
      await interaction.reply({ content: error, flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.reply(payload);
  },
};
