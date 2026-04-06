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
      `Hier kannst du Polls und Tracking manuell steuern.\n\n` +
      `• Polls jetzt senden\n` +
      `• Reset & Resend\n` +
      `• Tracking jetzt senden\n` +
      `• Aktive Polls anzeigen\n` +
      `• Polls synchronisieren\n` +
      `• Reminder posten`
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
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("admin_show_active_polls")
        .setLabel("Aktive Polls")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("admin_sync_polls")
        .setLabel("Polls syncen")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("admin_reminder")
        .setLabel("Reminder")
        .setStyle(ButtonStyle.Primary)
    )
  ];
}

async function ensureAdminPanel(client, config) {
  try {
    const guild = await client.guilds.fetch(config.guildId);
    const channel = await guild.channels.fetch(config.adminPanelChannelId);
    if (!channel) return;

    const recent = await channel.messages.fetch({ limit: 20 });

    const existing = recent.find(
      msg =>
        msg.author.id === client.user.id &&
        msg.embeds.length > 0 &&
        msg.embeds[0].title === "🛠️ Gladiators Vote Admin Panel"
    );

    if (existing) {
      await existing.edit({
        embeds: [buildAdminPanelEmbed()],
        components: buildAdminButtons()
      });
      return;
    }

    await channel.send({
      embeds: [buildAdminPanelEmbed()],
      components: buildAdminButtons()
    });
  } catch (err) {
    console.error("Fehler beim Admin Panel:", err);
  }
}

module.exports = {
  ensureAdminPanel
};