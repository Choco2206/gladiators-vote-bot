const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");

function buildAdminPanelEmbed() {
  return new EmbedBuilder()
    .setTitle("🛠️ Gladiators Vote Admin Panel")
    .setColor(0x992d22)
    .setDescription(
      `• Polls jetzt senden\n` +
      `• Reset & Resend\n` +
      `• Tracking jetzt senden`
    )
    .setFooter({ text: "Nur für Admin" })
    .setTimestamp();
}

function buildAdminButtons() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("admin_send_polls_now")
        .setLabel("Polls jetzt senden")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("admin_reset_and_resend")
        .setLabel("Reset & Resend")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId("admin_post_tracking_now")
        .setLabel("Tracking jetzt senden")
        .setStyle(ButtonStyle.Success)
    )
  ];
}

async function ensureAdminPanel(client, config) {
  const guild = await client.guilds.fetch(config.guildId);
  const channel = await guild.channels.fetch(config.adminPanelChannelId);

  const recent = await channel.messages.fetch({ limit: 20 });

  const existing = recent.find(
    m =>
      m.author.id === client.user.id &&
      m.embeds[0]?.title === "🛠️ Gladiators Vote Admin Panel"
  );

  if (existing) {
    await existing.edit({
      embeds: [buildAdminPanelEmbed()],
      components: buildAdminButtons()
    });
  } else {
    await channel.send({
      embeds: [buildAdminPanelEmbed()],
      components: buildAdminButtons()
    });
  }
}

module.exports = { ensureAdminPanel, buildAdminButtons };