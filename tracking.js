const { EmbedBuilder } = require("discord.js");
const { load } = require("./store");

async function postTracking(client, config) {
  try {
    const guild = await client.guilds.fetch(config.guildId);
    const channel = await guild.channels.fetch(config.trackingChannelId);

    if (!channel) {
      console.error("Tracking-Kanal nicht gefunden.");
      return;
    }

    const polls = load();

    if (polls.length === 0) {
      const emptyEmbed = new EmbedBuilder()
        .setTitle("🏛️ Weekly Gladiator Ranking")
        .setColor(0xff3c00)
        .setDescription("Für die vergangene Woche wurden keine Poll-Daten gefunden.")
        .setFooter({ text: "Nicht abgestimmt = Absage" })
        .setTimestamp();

      await channel.send({ embeds: [emptyEmbed] });
      return;
    }

    const stats = new Map();

    for (const poll of polls) {
      for (const userId of poll.eligible || []) {
        if (!stats.has(userId)) {
          stats.set(userId, { userId, yes: 0, no: 0 });
        }

        const vote = poll.votes?.[userId];

        if (vote === "yes") {
          stats.get(userId).yes += 1;
        } else {
          stats.get(userId).no += 1;
        }
      }
    }

    const sorted = [...stats.values()].sort((a, b) => {
      if (b.yes !== a.yes) return b.yes - a.yes;
      if (a.no !== b.no) return a.no - b.no;
      return a.userId.localeCompare(b.userId);
    });

    const totalPolls = polls.length || 1;

    const description = sorted
      .map((entry, index) => {
        const ratio = `${entry.yes}/${totalPolls}`;
        return `**${index + 1}.** <@${entry.userId}> • 💣 ${entry.yes} • ❌ ${entry.no} • **${ratio}**`;
      })
      .join("\n");

    const embed = new EmbedBuilder()
      .setTitle("🏛️ Weekly Gladiator Ranking")
      .setColor(0xff3c00)
      .setDescription(
        `⚔️ **Kampfbereitschaft der letzten Woche** ⚔️\n\n${description || "Keine Daten gefunden."}`
      )
      .setFooter({ text: "Nicht abgestimmt = Absage" })
      .setTimestamp();

    await channel.send({ embeds: [embed] });
    console.log("Tracking gepostet.");
  } catch (err) {
    console.error("Fehler beim Weekly Tracking:", err);
  }
}

module.exports = {
  postTracking
};