const { EmbedBuilder } = require("discord.js");
const { load } = require("./store");

function pad(n) {
  return String(n).padStart(2, "0");
}

function formatDate(date) {
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
}

function getWeekRangeText(polls) {
  if (!polls || polls.length === 0) {
    return "unbekannter Zeitraum";
  }

  const dates = polls
    .map(poll => {
      if (!poll.eventTime) return null;

      const match = poll.eventTime.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
      if (!match) return null;

      const [, day, month, year] = match;
      return new Date(Number(year), Number(month) - 1, Number(day));
    })
    .filter(Boolean)
    .sort((a, b) => a - b);

  if (dates.length === 0) {
    return "unbekannter Zeitraum";
  }

  const first = dates[0];
  const last = dates[dates.length - 1];

  return `${formatDate(first)} bis ${formatDate(last)}`;
}

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
      const embed = new EmbedBuilder()
        .setTitle("🏛️ Weekly Gladiator Ranking")
        .setColor(0xff3c00)
        .setDescription("Keine Daten für diese Woche vorhanden.")
        .setTimestamp();

      await channel.send({ embeds: [embed] });
      return;
    }

    const stats = new Map();

    for (const poll of polls) {
      for (const userId of poll.eligible || []) {
        if (!stats.has(userId)) {
          stats.set(userId, { userId, yes: 0 });
        }

        if (poll.votes?.[userId] === "yes") {
          stats.get(userId).yes += 1;
        }
      }
    }

    const totalPolls = polls.length;
    const weekRange = getWeekRangeText(polls);

    const sorted = [...stats.values()].sort((a, b) => {
      return b.yes - a.yes;
    });

    const description = sorted
      .map((entry, index) => {
        return `**${index + 1}.** <@${entry.userId}> • ${entry.yes}/${totalPolls} zugesagt`;
      })
      .join("\n");

    const embed = new EmbedBuilder()
      .setTitle("🏛️ Weekly Gladiator Ranking")
      .setColor(0xff3c00)
      .setDescription(
        `⚔️ **Kampfbereitschaft vom ${weekRange}** ⚔️\n\n` +
        `${description}`
      )
      .setFooter({ text: "Nicht abgestimmt = Absage" })
      .setTimestamp();

    await channel.send({ embeds: [embed] });

    console.log("Tracking gepostet.");
  } catch (err) {
    console.error("Fehler beim Tracking:", err);
  }
}

module.exports = {
  postTracking
};