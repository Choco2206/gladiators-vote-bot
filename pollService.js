const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");

const { load, save } = require("./store");

let eligibleCache = [];

// =========================
// HELPERS
// =========================

function formatUsers(ids) {
  if (!ids || ids.length === 0) return "—";
  return ids.map(id => `• <@${id}>`).join("\n");
}

function getDayLabel(dayKey) {
  return {
    friday: "Freitag",
    saturday: "Samstag"
  }[dayKey] || dayKey;
}

function getEventTitle() {
  return "💣 BOMBER CUP 💣";
}

function getNextDateForDay(dayKey) {
  const map = { friday: 5, saturday: 6 };
  const now = new Date();
  const result = new Date(now);

  let diff = map[dayKey] - now.getDay();
  if (diff <= 0) diff += 7;

  result.setDate(now.getDate() + diff);
  return result;
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function buildTimes(dayKey, cfg) {
  const targetDate = getNextDateForDay(dayKey);

  const [eventHour, eventMinute] = cfg.eventTime.split(":").map(Number);

  const eventDate = new Date(targetDate);
  eventDate.setHours(eventHour, eventMinute, 0, 0);

  const closeDate = new Date(targetDate);
  closeDate.setHours(cfg.closeHour, cfg.closeMinute, 0, 0);

  const eventText =
    `${pad(eventDate.getDate())}.${pad(eventDate.getMonth() + 1)}.${eventDate.getFullYear()}, ` +
    `${pad(eventHour)}:${pad(eventMinute)} Uhr`;

  const closeText =
    `${pad(closeDate.getDate())}.${pad(closeDate.getMonth() + 1)}.${closeDate.getFullYear()}, ` +
    `${pad(cfg.closeHour)}:${pad(cfg.closeMinute)} Uhr`;

  return {
    eventText,
    closeText,
    closeISO: closeDate.toISOString()
  };
}

function buildVoteButtons(disabled = false) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("vote_yes")
        .setLabel("Zusage")
        .setEmoji("💣")
        .setStyle(ButtonStyle.Success)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId("vote_no")
        .setLabel("Absage")
        .setEmoji("❌")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(disabled)
    )
  ];
}

function buildPollEmbed(dayKey, poll) {
  const yes = Object.entries(poll.votes)
    .filter(([, value]) => value === "yes")
    .map(([userId]) => userId);

  const no = Object.entries(poll.votes)
    .filter(([, value]) => value === "no")
    .map(([userId]) => userId);

  return new EmbedBuilder()
    .setTitle(getEventTitle())
    .setColor(0xff3c00)
    .setDescription(
      `🛡️ **${getDayLabel(dayKey)}**\n\n` +
      `📅 **Event:** ${poll.eventTime}\n` +
      `⏳ **Abstimmung bis:** ${poll.closeTime}`
    )
    .addFields(
      {
        name: "💣 Zusage",
        value: formatUsers(yes),
        inline: false
      },
      {
        name: "❌ Absage",
        value: formatUsers(no),
        inline: false
      }
    )
    .setFooter({ text: "Gladiators Vote" })
    .setTimestamp();
}

// =========================
// MEMBERS
// =========================

async function refreshEligibleUsers(client, config) {
  try {
    const guild = await client.guilds.fetch(config.guildId);

    await guild.members.fetch({ force: true });

    const memberMap = new Map();

    for (const roleId of config.trackedRoleIds) {
      const role = guild.roles.cache.get(roleId);
      if (!role) continue;

      for (const member of role.members.values()) {
        if (!member.user.bot) {
          memberMap.set(member.id, member);
        }
      }
    }

    eligibleCache = [...memberMap.keys()];
    console.log(`Eligible Members geladen: ${eligibleCache.length}`);
  } catch (err) {
    console.error("Fehler beim Laden der Rollenmitglieder:", err);
  }
}

// =========================
// POLLS
// =========================

function getActivePolls() {
  return load().filter(poll => !poll.closed);
}

async function createPoll(client, config, dayKey, cfg) {
  const guild = await client.guilds.fetch(config.guildId);
  const channel = await guild.channels.fetch(cfg.channelId);

  if (!channel) {
    console.error(`Kanal nicht gefunden für ${dayKey}`);
    return;
  }

  const times = buildTimes(dayKey, cfg);

  const poll = {
    id: `${dayKey}_${Date.now()}`,
    dayKey,
    channelId: cfg.channelId,
    votes: {},
    eligible: [...eligibleCache],
    closed: false,
    closeAt: times.closeISO,
    eventTime: times.eventText,
    closeTime: times.closeText,
    createdAt: new Date().toISOString()
  };

  const pollMessage = await channel.send({
    embeds: [buildPollEmbed(dayKey, poll)],
    components: buildVoteButtons(false)
  });

  const statusMessage = await channel.send({
    content:
      poll.eligible.length > 0
        ? `🏆 **Noch nicht abgestimmt:**\n${formatUsers(poll.eligible)}`
        : "✅ **Alle abgestimmt**"
  });

  poll.msgId = pollMessage.id;
  poll.statusId = statusMessage.id;

  const polls = load();
  polls.push(poll);
  save(polls);

  console.log(`Poll erstellt: ${dayKey} -> ${cfg.channelId}`);
}

async function createAllPolls(client, config) {
  const activePolls = getActivePolls();

  if (activePolls.length > 0) {
    console.log("Es gibt bereits aktive Polls. Kein neuer Post.");
    return;
  }

  await refreshEligibleUsers(client, config);

  for (const [dayKey, cfg] of Object.entries(config.days)) {
    await createPoll(client, config, dayKey, cfg);
  }
}

async function updatePollMessage(client, config, poll) {
  try {
    const guild = await client.guilds.fetch(config.guildId);
    const channel = await guild.channels.fetch(poll.channelId);
    if (!channel) return;

    const pollMessage = await channel.messages.fetch(poll.msgId).catch(() => null);
    const statusMessage = await channel.messages.fetch(poll.statusId).catch(() => null);

    if (pollMessage) {
      await pollMessage.edit({
        embeds: [buildPollEmbed(poll.dayKey, poll)],
        components: buildVoteButtons(poll.closed)
      });
    }

    const remaining = poll.eligible.filter(userId => !poll.votes[userId]);

    if (statusMessage) {
      if (remaining.length === 0) {
        await statusMessage.edit({
          content: poll.closed
            ? "🔒 **Umfrage beendet. Alle haben abgestimmt.**"
            : "✅ **Alle abgestimmt**"
        });
      } else if (poll.closed) {
        await statusMessage.edit({
          content:
            `🔒 **Umfrage beendet.**\n\n` +
            `Nicht abgestimmt:\n${formatUsers(remaining)}`
        });
      } else {
        await statusMessage.edit({
          content: `🏆 **Noch nicht abgestimmt:**\n${formatUsers(remaining)}`
        });
      }
    }
  } catch (err) {
    console.error("Fehler beim Aktualisieren einer Poll:", err);
  }
}

async function closeDuePolls(client, config) {
  const polls = load();
  const now = new Date();
  let changed = false;

  for (const poll of polls) {
    if (!poll.closed && now >= new Date(poll.closeAt)) {
      poll.closed = true;
      changed = true;
      await updatePollMessage(client, config, poll);
      console.log(`Poll geschlossen: ${poll.dayKey}`);
    }
  }

  if (changed) {
    save(polls);
  }
}

async function handleVote(interaction, client, config) {
  const polls = load();
  const poll = polls.find(p => p.msgId === interaction.message.id);

  if (!poll) return;
  if (poll.closed) return;
  if (!poll.eligible.includes(interaction.user.id)) return;

  await interaction.deferUpdate();

  poll.votes[interaction.user.id] =
    interaction.customId === "vote_yes" ? "yes" : "no";

  save(polls);
  await updatePollMessage(client, config, poll);
}

async function deleteActivePollsAndResend(client, config) {
  const polls = load();
  const activePolls = polls.filter(poll => !poll.closed);

  for (const poll of activePolls) {
    try {
      const guild = await client.guilds.fetch(config.guildId);
      const channel = await guild.channels.fetch(poll.channelId);
      if (!channel) continue;

      const pollMessage = await channel.messages.fetch(poll.msgId).catch(() => null);
      const statusMessage = await channel.messages.fetch(poll.statusId).catch(() => null);

      if (pollMessage) await pollMessage.delete().catch(() => null);
      if (statusMessage) await statusMessage.delete().catch(() => null);
    } catch (err) {
      console.error("Fehler beim Löschen aktiver Polls:", err);
    }
  }

  const remaining = polls.filter(poll => poll.closed);
  save(remaining);

  await createAllPolls(client, config);
}

async function deleteOldPollMessages(client, config) {
  const polls = load();

  for (const poll of polls) {
    try {
      const guild = await client.guilds.fetch(config.guildId);
      const channel = await guild.channels.fetch(poll.channelId);
      if (!channel) continue;

      const pollMessage = await channel.messages.fetch(poll.msgId).catch(() => null);
      const statusMessage = await channel.messages.fetch(poll.statusId).catch(() => null);

      if (pollMessage) await pollMessage.delete().catch(() => null);
      if (statusMessage) await statusMessage.delete().catch(() => null);
    } catch (err) {
      console.error("Fehler beim Löschen alter Poll-Nachrichten:", err);
    }
  }

  console.log("Alte Poll-Nachrichten gelöscht.");
}

function clearAllPollData() {
  save([]);
  console.log("Alle Poll-Daten wurden geleert.");
}

async function showActivePolls(interaction) {
  const polls = load().filter(p => !p.closed);

  if (polls.length === 0) {
    return interaction.reply({
      content: "Keine aktiven Polls.",
      ephemeral: true
    });
  }

  const text = polls
    .map(p => `• ${p.dayKey.toUpperCase()} | Stimmen: ${Object.keys(p.votes).length}/${p.eligible.length}`)
    .join("\n");

  return interaction.reply({
    content: `📊 **Aktive Polls:**\n${text}`,
    ephemeral: true
  });
}

async function syncPolls(client, config) {
  const polls = load().filter(p => !p.closed);

  for (const poll of polls) {
    await updatePollMessage(client, config, poll);
  }
}

async function sendReminder(interaction) {
  const polls = load().filter(p => !p.closed);

  if (polls.length === 0) {
    return interaction.reply({
      content: "Keine aktiven Polls.",
      ephemeral: true
    });
  }

  let message = "⚠️ **Noch nicht abgestimmt:**\n\n";

  for (const poll of polls) {
    const remaining = poll.eligible.filter(id => !poll.votes[id]);

    if (remaining.length > 0) {
      message += `**${poll.dayKey.toUpperCase()}**\n`;
      message += remaining.map(id => `<@${id}>`).join(" ") + "\n\n";
    }
  }

  return interaction.reply({
    content: message,
    allowedMentions: { parse: ["users"] }
  });
}

module.exports = {
  createAllPolls,
  closeDuePolls,
  handleVote,
  deleteActivePollsAndResend,
  deleteOldPollMessages,
  clearAllPollData,
  showActivePolls,
  syncPolls,
  sendReminder
};