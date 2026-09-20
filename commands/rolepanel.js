const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  MessageFlags,
} = require('discord.js');
const {
  ROLE_BUTTON_PREFIX,
  MAX_BUTTONS_PER_MESSAGE,
  buildRoleCustomId,
  buildMyRolesOpenCustomId,
  isReservedRow,
  pageHasRoomForRole,
  rowsFromMessage,
  setPageMeta,
  getChannel,
  fetchOwnMessage,
  loadChain,
  chunk,
} = require('../lib/panel');

const ROLES_PER_PAGE = 20; // 4 rows x 5, since 1 row on every page is reserved for Check My Roles

const STYLE_CHOICES = {
  Primary: ButtonStyle.Primary,
  Secondary: ButtonStyle.Secondary,
  Success: ButtonStyle.Success,
  Danger: ButtonStyle.Danger,
};

function buildCheckRolesRow(rootMessageId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(buildMyRolesOpenCustomId(rootMessageId))
      .setLabel('Check My Roles')
      .setEmoji('🔍')
      .setStyle(ButtonStyle.Primary)
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rolepanel')
    .setDescription('Manage self-assignable role button panels')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('create')
        .setDescription('Post a new empty role panel message')
        .addStringOption((opt) =>
          opt.setName('title').setDescription('Panel title').setRequired(true)
        )
        .addStringOption((opt) =>
          opt.setName('description').setDescription('Panel description').setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('add-role')
        .setDescription('Add a role button to an existing panel (auto-creates extra pages once full)')
        .addStringOption((opt) =>
          opt.setName('message_id').setDescription("ID of the panel's first message").setRequired(true)
        )
        .addRoleOption((opt) =>
          opt.setName('role').setDescription('Role to toggle with this button').setRequired(true)
        )
        .addStringOption((opt) =>
          opt.setName('label').setDescription('Button label (defaults to role name)').setRequired(false)
        )
        .addStringOption((opt) =>
          opt.setName('emoji').setDescription('Emoji to show on the button').setRequired(false)
        )
        .addStringOption((opt) =>
          opt
            .setName('style')
            .setDescription('Button color (default Secondary)')
            .setRequired(false)
            .addChoices(...Object.keys(STYLE_CHOICES).map((name) => ({ name, value: name })))
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove-role')
        .setDescription('Remove a role button from a panel (searches every page)')
        .addStringOption((opt) =>
          opt.setName('message_id').setDescription("ID of the panel's first message").setRequired(true)
        )
        .addRoleOption((opt) =>
          opt.setName('role').setDescription('Role button to remove').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('edit')
        .setDescription("Edit a panel's title/description (applies to every page)")
        .addStringOption((opt) =>
          opt.setName('message_id').setDescription("ID of the panel's first message").setRequired(true)
        )
        .addStringOption((opt) =>
          opt.setName('title').setDescription('New title').setRequired(false)
        )
        .addStringOption((opt) =>
          opt.setName('description').setDescription('New description').setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('move-role')
        .setDescription("Reorder a role's button within the panel")
        .addStringOption((opt) =>
          opt.setName('message_id').setDescription("ID of the panel's first message").setRequired(true)
        )
        .addRoleOption((opt) =>
          opt.setName('role').setDescription('Role button to move').setRequired(true)
        )
        .addIntegerOption((opt) =>
          opt
            .setName('position')
            .setDescription('New position, counting from 1 (1 = first button on the panel)')
            .setRequired(true)
            .setMinValue(1)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('edit-role')
        .setDescription("Change a role button's label, emoji, or color without moving or recreating it")
        .addStringOption((opt) =>
          opt.setName('message_id').setDescription("ID of the panel's first message").setRequired(true)
        )
        .addRoleOption((opt) =>
          opt.setName('role').setDescription('Role button to edit').setRequired(true)
        )
        .addStringOption((opt) =>
          opt.setName('label').setDescription('New button label').setRequired(false)
        )
        .addStringOption((opt) =>
          opt.setName('emoji').setDescription('New emoji for the button').setRequired(false)
        )
        .addStringOption((opt) =>
          opt
            .setName('style')
            .setDescription('New button color')
            .setRequired(false)
            .addChoices(...Object.keys(STYLE_CHOICES).map((name) => ({ name, value: name })))
        )
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    const botMember = interaction.guild.members.me;
    const isOwner = interaction.guild.ownerId === interaction.member.id;
    if (!isOwner && interaction.member.roles.highest.position <= botMember.roles.highest.position) {
      await interaction.reply({
        content: `Your highest role needs to be above my highest role (**${botMember.roles.highest.name}**) to manage role panels.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'create') {
      const title = interaction.options.getString('title', true);
      const description =
        interaction.options.getString('description') ?? 'Click a button below to toggle a role.';

      const embed = new EmbedBuilder().setTitle(title).setDescription(description).setColor(0x5865f2);
      setPageMeta(embed, 1, null);

      const channel = await getChannel(interaction);
      const message = await channel.send({ embeds: [embed] });
      await message.edit({ components: [buildCheckRolesRow(message.id)] });

      await interaction.reply({
        content: `Panel created. Message ID: \`${message.id}\`\nUse \`/rolepanel add-role message_id:${message.id}\` to attach role buttons — keep using this same message ID even after the panel grows past one message, I'll manage extra pages automatically.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'add-role') {
      const messageId = interaction.options.getString('message_id', true);
      const role = interaction.options.getRole('role', true);
      const label = interaction.options.getString('label') ?? role.name;
      const emoji = interaction.options.getString('emoji') ?? undefined;
      const styleName = interaction.options.getString('style') ?? 'Secondary';
      const style = STYLE_CHOICES[styleName] ?? ButtonStyle.Secondary;

      if (role.id === interaction.guild.id) {
        await interaction.reply({ content: "You can't use @everyone as a toggleable role.", flags: MessageFlags.Ephemeral });
        return;
      }
      if (role.managed) {
        await interaction.reply({
          content: 'That role is managed by an integration (e.g. a bot) and cannot be assigned manually.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const botMember = interaction.guild.members.me;
      if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
        await interaction.reply({ content: "I need the **Manage Roles** permission to do that.", flags: MessageFlags.Ephemeral });
        return;
      }
      if (role.position >= botMember.roles.highest.position) {
        await interaction.reply({
          content: `My highest role needs to be above **${role.name}** in the server's role list for me to assign it.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const { message: rootMessage, error } = await fetchOwnMessage(interaction, messageId);
      if (error) {
        await interaction.reply({ content: error, flags: MessageFlags.Ephemeral });
        return;
      }

      const channel = await getChannel(interaction);
      const chain = await loadChain(channel, rootMessage);
      const customId = buildRoleCustomId(role.id);

      const alreadyExists = chain.some((p) =>
        rowsFromMessage(p.message).some((row) => row.components.some((c) => c.data.custom_id === customId))
      );
      if (alreadyExists) {
        await interaction.reply({ content: `**${role.name}** already has a button on that panel.`, flags: MessageFlags.Ephemeral });
        return;
      }

      const button = new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style);
      if (emoji) button.setEmoji(emoji);

      const target = chain.find((p) => pageHasRoomForRole(p.message));

      if (target) {
        const rows = rowsFromMessage(target.message);
        let targetRow = rows.find((row) => !isReservedRow(row) && row.components.length < 5);
        if (!targetRow) {
          targetRow = new ActionRowBuilder();
          rows.push(targetRow);
        }
        targetRow.addComponents(button);

        await target.message.edit({ components: rows });
        await interaction.reply({
          content: `Added a button for **${role.name}** to the panel (page ${target.page}).`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Every existing page is full: chain a brand new page after the current tail.
      const tail = chain[chain.length - 1];
      const rootMessageId = chain[0].message.id;
      const newEmbed = EmbedBuilder.from(chain[0].message.embeds[0]);
      setPageMeta(newEmbed, tail.page + 1, null);

      const roleRow = new ActionRowBuilder().addComponents(button);
      const newMessage = await channel.send({
        embeds: [newEmbed],
        components: [roleRow, buildCheckRolesRow(rootMessageId)],
      });

      const tailEmbed = EmbedBuilder.from(tail.message.embeds[0]);
      setPageMeta(tailEmbed, tail.page, newMessage.id);
      await tail.message.edit({ embeds: [tailEmbed] });

      await interaction.reply({
        content: `That panel was full, so I started page ${tail.page + 1} (message ID \`${newMessage.id}\`) and added **${role.name}** there. Keep using \`message_id:${messageId}\` for future add-role/remove-role commands.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'remove-role') {
      const messageId = interaction.options.getString('message_id', true);
      const role = interaction.options.getRole('role', true);
      const customId = buildRoleCustomId(role.id);

      const { message: rootMessage, error } = await fetchOwnMessage(interaction, messageId);
      if (error) {
        await interaction.reply({ content: error, flags: MessageFlags.Ephemeral });
        return;
      }

      const channel = await getChannel(interaction);
      const chain = await loadChain(channel, rootMessage);

      const found = chain.find((p) =>
        rowsFromMessage(p.message).some((row) => row.components.some((c) => c.data.custom_id === customId))
      );
      if (!found) {
        await interaction.reply({ content: `**${role.name}** doesn't have a button on that panel.`, flags: MessageFlags.Ephemeral });
        return;
      }

      const rows = rowsFromMessage(found.message)
        .map((row) => {
          row.components = row.components.filter((c) => c.data.custom_id !== customId);
          return row;
        })
        .filter((row) => row.components.length > 0);

      await found.message.edit({ components: rows });
      await interaction.reply({ content: `Removed the button for **${role.name}** (page ${found.page}).`, flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'edit') {
      const messageId = interaction.options.getString('message_id', true);
      const title = interaction.options.getString('title');
      const description = interaction.options.getString('description');

      if (title === null && description === null) {
        await interaction.reply({ content: 'Provide a new title and/or description to update.', flags: MessageFlags.Ephemeral });
        return;
      }

      const { message: rootMessage, error } = await fetchOwnMessage(interaction, messageId);
      if (error) {
        await interaction.reply({ content: error, flags: MessageFlags.Ephemeral });
        return;
      }

      const channel = await getChannel(interaction);
      const chain = await loadChain(channel, rootMessage);

      for (const p of chain) {
        const embed = EmbedBuilder.from(p.message.embeds[0]);
        if (title !== null) embed.setTitle(title);
        if (description !== null) embed.setDescription(description);
        await p.message.edit({ embeds: [embed] });
      }

      await interaction.reply({
        content: `Updated the ${title !== null && description !== null ? 'title and description' : title !== null ? 'title' : 'description'} across ${chain.length} page${chain.length === 1 ? '' : 's'}.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'move-role') {
      const messageId = interaction.options.getString('message_id', true);
      const role = interaction.options.getRole('role', true);
      const position = interaction.options.getInteger('position', true);
      const customId = buildRoleCustomId(role.id);

      const { message: rootMessage, error } = await fetchOwnMessage(interaction, messageId);
      if (error) {
        await interaction.reply({ content: error, flags: MessageFlags.Ephemeral });
        return;
      }

      const channel = await getChannel(interaction);
      const chain = await loadChain(channel, rootMessage);

      const allButtons = [];
      for (const p of chain) {
        for (const row of rowsFromMessage(p.message)) {
          if (isReservedRow(row)) continue;
          for (const c of row.components) {
            allButtons.push({ customId: c.data.custom_id, label: c.data.label, style: c.data.style, emoji: c.data.emoji });
          }
        }
      }

      const currentIndex = allButtons.findIndex((b) => b.customId === customId);
      if (currentIndex === -1) {
        await interaction.reply({ content: `**${role.name}** doesn't have a button on that panel.`, flags: MessageFlags.Ephemeral });
        return;
      }

      const [moved] = allButtons.splice(currentIndex, 1);
      const targetIndex = Math.max(0, Math.min(position - 1, allButtons.length));
      allButtons.splice(targetIndex, 0, moved);

      const pages = chunk(allButtons, ROLES_PER_PAGE);
      if (pages.length > chain.length) {
        await interaction.reply({
          content: "This panel's pages look inconsistent, so I can't safely reorder without risking dropping a button. Try removing and re-adding the role instead.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const rootMessageId = chain[0].message.id;
      for (let i = 0; i < chain.length; i++) {
        const pageButtons = pages[i] ?? [];
        const rows = chunk(pageButtons, 5).map((group) =>
          new ActionRowBuilder().addComponents(
            group.map((b) => {
              const button = new ButtonBuilder().setCustomId(b.customId).setLabel(b.label ?? 'Role').setStyle(b.style);
              if (b.emoji) button.setEmoji(b.emoji);
              return button;
            })
          )
        );
        rows.push(buildCheckRolesRow(rootMessageId));
        await chain[i].message.edit({ components: rows });
      }

      await interaction.reply({
        content: `Moved **${role.name}**'s button to position ${targetIndex + 1} of ${allButtons.length}.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'edit-role') {
      const messageId = interaction.options.getString('message_id', true);
      const role = interaction.options.getRole('role', true);
      const label = interaction.options.getString('label');
      const emoji = interaction.options.getString('emoji');
      const styleName = interaction.options.getString('style');

      if (label === null && emoji === null && styleName === null) {
        await interaction.reply({ content: 'Provide a new label, emoji, and/or style to update.', flags: MessageFlags.Ephemeral });
        return;
      }

      const customId = buildRoleCustomId(role.id);

      const { message: rootMessage, error } = await fetchOwnMessage(interaction, messageId);
      if (error) {
        await interaction.reply({ content: error, flags: MessageFlags.Ephemeral });
        return;
      }

      const channel = await getChannel(interaction);
      const chain = await loadChain(channel, rootMessage);

      let found = null;
      let updatedRows = null;
      for (const p of chain) {
        const rows = rowsFromMessage(p.message);
        const matched = rows.some((row) => row.components.some((c) => c.data.custom_id === customId));
        if (!matched) continue;

        for (const row of rows) {
          for (const c of row.components) {
            if (c.data.custom_id !== customId) continue;
            if (label !== null) c.setLabel(label);
            if (emoji !== null) c.setEmoji(emoji);
            if (styleName !== null) c.setStyle(STYLE_CHOICES[styleName]);
          }
        }
        found = p;
        updatedRows = rows;
        break;
      }

      if (!found) {
        await interaction.reply({ content: `**${role.name}** doesn't have a button on that panel.`, flags: MessageFlags.Ephemeral });
        return;
      }

      await found.message.edit({ components: updatedRows });
      await interaction.reply({ content: `Updated **${role.name}**'s button (page ${found.page}).`, flags: MessageFlags.Ephemeral });
      return;
    }
  },
};
