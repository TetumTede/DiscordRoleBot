require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const {
  Client,
  Collection,
  GatewayIntentBits,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { ROLE_BUTTON_PREFIX, MY_ROLES_PREFIX, MY_ROLES_OPEN_PREFIX } = require('./lib/panel');
const { buildPersonalPanel } = require('./commands/myroles');

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.commands = new Collection();
const commandsDir = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsDir).filter((f) => f.endsWith('.js'))) {
  const command = require(path.join(commandsDir, file));
  client.commands.set(command.data.name, command);
}

client.once('clientReady', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('interactionCreate', async (interaction) => {
  if (interaction.isChatInputCommand()) {
    const command = client.commands.get(interaction.commandName);
    if (!command) return;
    try {
      await command.execute(interaction);
    } catch (err) {
      console.error(err);
      const payload = { content: 'Something went wrong running that command.', flags: MessageFlags.Ephemeral };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(payload).catch(() => {});
      } else {
        await interaction.reply(payload).catch(() => {});
      }
    }
    return;
  }

  if (interaction.isButton() && interaction.customId.startsWith(MY_ROLES_OPEN_PREFIX)) {
    const messageId = interaction.customId.slice(MY_ROLES_OPEN_PREFIX.length);
    const { payload, error } = await buildPersonalPanel(interaction, messageId);
    if (error) {
      await interaction.reply({ content: error, flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }
    await interaction.reply(payload).catch(() => {});
    return;
  }

  if (interaction.isButton() && interaction.customId.startsWith(MY_ROLES_PREFIX)) {
    const roleId = interaction.customId.slice(MY_ROLES_PREFIX.length);

    try {
      const role = await interaction.guild.roles.fetch(roleId);
      if (!role) {
        await interaction.reply({ content: 'That role no longer exists.', flags: MessageFlags.Ephemeral });
        return;
      }

      const member = interaction.member;
      const hadRole = member.roles.cache.has(roleId);
      // add()/remove() return an updated clone rather than mutating the cached member,
      // so re-read role membership from the returned member, not the original.
      const updatedMember = hadRole ? await member.roles.remove(roleId) : await member.roles.add(roleId);

      const rows = interaction.message.components.map((row) =>
        new ActionRowBuilder().addComponents(
          row.components.map((c) => {
            const hasRole = updatedMember.roles.cache.has(c.customId.slice(MY_ROLES_PREFIX.length));
            const button = new ButtonBuilder()
              .setCustomId(c.customId)
              .setLabel(c.label ?? 'Role')
              .setStyle(hasRole ? ButtonStyle.Success : ButtonStyle.Secondary);
            if (c.emoji) button.setEmoji(c.emoji);
            return button;
          })
        )
      );

      await interaction.update({ components: rows });
    } catch (err) {
      console.error(err);
      await interaction.reply({
        content: "I couldn't update your roles. I may be missing permissions, or my role may be positioned below the target role.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
    }
    return;
  }

  if (interaction.isButton() && interaction.customId.startsWith(ROLE_BUTTON_PREFIX)) {
    const roleId = interaction.customId.slice(ROLE_BUTTON_PREFIX.length);

    try {
      const role = await interaction.guild.roles.fetch(roleId);
      if (!role) {
        await interaction.reply({ content: 'That role no longer exists.', flags: MessageFlags.Ephemeral });
        return;
      }

      const member = interaction.member;
      const hasRole = member.roles.cache.has(roleId);

      if (hasRole) {
        await member.roles.remove(roleId);
        await interaction.reply({ content: `Removed the **${role.name}** role.`, flags: MessageFlags.Ephemeral });
      } else {
        await member.roles.add(roleId);
        await interaction.reply({ content: `Gave you the **${role.name}** role.`, flags: MessageFlags.Ephemeral });
      }
    } catch (err) {
      console.error(err);
      await interaction.reply({
        content: "I couldn't update your roles. I may be missing permissions, or my role may be positioned below the target role.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
