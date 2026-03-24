require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require("discord.js");
const cron = require("node-cron");
const fs = require("fs");
const path = require("path");
const config = require("./config.json");

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

const FILE = path.join(__dirname, "data", "polls.json");

let eligibleCache = [];

function ensureDataFile() {
  const dir = path.dirname(FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(FILE)) {
    fs.writeFileSync(FILE, "[]", "utf8");
  }
}

function load() {
  ensureDataFile();
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch (err) {
    console.error("Fehler beim Laden der polls.json:", err);
    return [];
  }
}

function save(data) {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), "utf8");
}

function isAdmin(interaction) {
  return interaction.user.id === config.adminUserId;
}

function formatUsers(ids) {
  if (!ids || ids.length === 0) return "—";
  return ids.map(id => `<@${id}>`).join(" ");
}

function getDayLabel(dayKey) {
  return {
    friday: "Freitag",
    saturday: "Samstag",
    sunday: "Sonntag"
  }[dayKey] || dayKey;
}

function getEventTitle(dayKey) {
  return dayKey === "sunday" ? "🏆 T-CUP 🏆" : "💣 BOMBER CUP 💣";
}

function getNextDateForDay(dayKey) {
  const map = { friday: 5, saturday: 6, sunday: 0 };
  const now = new Date();
  const result = new Date(now);

  let diff = map[dayKey] - now.getDay();
  if (diff <= 0) diff += 7;

  result.setDate(now.getDate() + diff);
  return result;
}

function buildTimes(dayKey, cfg) {
  const eventDate = getNextDateForDay(dayKey);
  const [eventHour, eventMinute] = cfg.eventTime.split(":").map(Number);

  eventDate.setHours(eventHour, eventMinute, 0, 0);

  const closeDate = new Date(eventDate);
  closeDate.setHours(cfg.closeHour, cfg.closeMinute, 0, 0);

  return {
    eventText: eventDate.toLocaleString("de-DE", {
      timeZone: config.timezone
    }),
    closeText: closeDate.toLocaleString("de-DE", {
      timeZone: config.timezone
    }),
    closeISO: closeDate.toISOString()
  };
}

function buildPollEmbed(dayKey, cfg, poll) {
  const yes = Object.entries(poll.votes)
    .filter(([, value]) => value === "yes")
    .map(([userId]) => userId);

  const no = Object.entries(poll.votes)
    .filter(([, value]) => value === "no")
    .map(([userId]) => userId);

  return new EmbedBuilder()
    .setTitle(getEventTitle(dayKey))
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

function buildAdminPanelEmbed() {
  return new EmbedBuilder()
    .setTitle("🛠️ Gladiators Vote Admin Panel")
    .setColor(0x992d22)
    .setDescription(
      `Hier kannst du Polls und Tracking manuell steuern.\n\n` +
      `• Polls jetzt senden\n` +
      `• Aktive Polls löschen & neu senden\n` +
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
        .setLabel("Aktive Polls löschen & neu senden")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId("admin_post_tracking_now")
        .setLabel("Tracking jetzt senden")
        .setStyle(ButtonStyle.Success)
    )
  ];
}

async function refreshEligibleUsers() {
  try {
    const guild = await client.guilds.fetch(config.guildId);

    // Einmal vollständig laden, damit role.members wirklich alle enthält
    await guild.members.fetch();

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

async function ensureAdminPanel() {
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

function getActivePolls() {
  return load().filter(poll => !poll.closed);
}

async function createPoll(dayKey, cfg) {
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
    embeds: [buildPollEmbed(dayKey, cfg, poll)],
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

async function createAllPolls() {
  const activePolls = getActivePolls();
  if (activePolls.length > 0) {
    console.log("Es gibt bereits aktive Polls. Kein neuer Post.");
    return;
  }

  await refreshEligibleUsers();

  for (const [dayKey, cfg] of Object.entries(config.days)) {
    await createPoll(dayKey, cfg);
  }
}

async function updatePollMessage(poll) {
  try {
    const guild = await client.guilds.fetch(config.guildId);
    const channel = await guild.channels.fetch(poll.channelId);
    if (!channel) return;

    const pollMessage = await channel.messages.fetch(poll.msgId);
    const statusMessage = await channel.messages.fetch(poll.statusId);
    const cfg = config.days[poll.dayKey];

    await pollMessage.edit({
      embeds: [buildPollEmbed(poll.dayKey, cfg, poll)],
      components: buildVoteButtons(poll.closed)
    });

    const remaining = poll.eligible.filter(userId => !poll.votes[userId]);

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
  } catch (err) {
    console.error("Fehler beim Aktualisieren einer Poll:", err);
  }
}

async function closeDuePolls() {
  const polls = load();
  const now = new Date();
  let changed = false;

  for (const poll of polls) {
    if (!poll.closed && now >= new Date(poll.closeAt)) {
      poll.closed = true;
      changed = true;
      await updatePollMessage(poll);
      console.log(`Poll geschlossen: ${poll.dayKey}`);
    }
  }

  if (changed) {
    save(polls);
  }
}

function getLastWeekWindow() {
  const now = new Date();
  const currentDay = now.getDay();
  const daysSinceMonday = currentDay === 0 ? 6 : currentDay - 1;

  const thisMonday = new Date(now);
  thisMonday.setDate(now.getDate() - daysSinceMonday);
  thisMonday.setHours(0, 0, 0, 0);

  const lastMonday = new Date(thisMonday);
  lastMonday.setDate(thisMonday.getDate() - 7);

  return { start: lastMonday, end: thisMonday };
}

function isPollFromLastWeek(poll) {
  const createdAt = new Date(poll.createdAt);
  const { start, end } = getLastWeekWindow();
  return createdAt >= start && createdAt < end;
}

async function postWeeklyTracking() {
  try {
    const guild = await client.guilds.fetch(config.guildId);
    const channel = await guild.channels.fetch(config.trackingChannelId);
    if (!channel) {
      console.error("Tracking-Kanal nicht gefunden.");
      return;
    }

    await refreshEligibleUsers();

    const polls = load().filter(isPollFromLastWeek);

    const stats = new Map();
    for (const userId of eligibleCache) {
      stats.set(userId, { userId, yes: 0, no: 0 });
    }

    for (const poll of polls) {
      for (const userId of poll.eligible) {
        if (!stats.has(userId)) {
          stats.set(userId, { userId, yes: 0, no: 0 });
        }

        const vote = poll.votes[userId];
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

    let description = "";
    if (polls.length === 0) {
      description = "Für die vergangene Woche wurden keine Poll-Daten gefunden.";
    } else {
      description = sorted
        .map((entry, index) => {
          const ratio = `${entry.yes}/3`;
          return `**${index + 1}.** <@${entry.userId}> • 💣 ${entry.yes} • ❌ ${entry.no} • **${ratio}**`;
        })
        .join("\n");
    }

    const embed = new EmbedBuilder()
      .setTitle("🏛️ Weekly Gladiator Ranking")
      .setColor(0xff3c00)
      .setDescription(
        `⚔️ **Kampfbereitschaft der letzten Woche** ⚔️\n\n${description}`
      )
      .setFooter({ text: "Nicht abgestimmt = Absage" })
      .setTimestamp();

    await channel.send({ embeds: [embed] });
    console.log("Tracking gepostet.");
  } catch (err) {
    console.error("Fehler beim Weekly Tracking:", err);
  }
}

async function deleteActivePollsAndResend() {
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

  await createAllPolls();
}

async function runMondayJob() {
  console.log("Montags-Job gestartet...");
  await postWeeklyTracking();
  await createAllPolls();
}

client.on("interactionCreate", async interaction => {
  try {
    if (!interaction.isButton()) return;

    if (["vote_yes", "vote_no"].includes(interaction.customId)) {
      const polls = load();
      const poll = polls.find(p => p.msgId === interaction.message.id);

      if (!poll) {
        return interaction.reply({
          content: "Diese Umfrage wurde nicht gefunden.",
          ephemeral: true
        });
      }

      if (poll.closed) {
        return interaction.reply({
          content: "Diese Umfrage ist bereits beendet.",
          ephemeral: true
        });
      }

      if (!poll.eligible.includes(interaction.user.id)) {
        return interaction.reply({
          content: "Du bist für diese Umfrage nicht freigeschaltet.",
          ephemeral: true
        });
      }

      await interaction.deferReply({ ephemeral: true });

      poll.votes[interaction.user.id] =
        interaction.customId === "vote_yes" ? "yes" : "no";

      save(polls);
      await updatePollMessage(poll);

      await interaction.editReply({
        content:
          interaction.customId === "vote_yes"
            ? "Deine Zusage wurde gespeichert 💣"
            : "Deine Absage wurde gespeichert ❌"
      });

      return;
    }

    if (
      [
        "admin_send_polls_now",
        "admin_reset_and_resend",
        "admin_post_tracking_now"
      ].includes(interaction.customId)
    ) {
      if (!isAdmin(interaction)) {
        return interaction.reply({
          content: "Nur der Admin kann das Admin Panel nutzen.",
          ephemeral: true
        });
      }

      await interaction.deferReply({ ephemeral: true });

      if (interaction.customId === "admin_send_polls_now") {
        await createAllPolls();
        return interaction.editReply("Polls wurden geprüft und ggf. gesendet.");
      }

      if (interaction.customId === "admin_reset_and_resend") {
        await deleteActivePollsAndResend();
        return interaction.editReply("Aktive Polls wurden gelöscht und neu gesendet.");
      }

      if (interaction.customId === "admin_post_tracking_now") {
        await postWeeklyTracking();
        return interaction.editReply("Tracking wurde gepostet.");
      }
    }
  } catch (err) {
    console.error("Fehler bei interactionCreate:", err);

    if (!interaction.replied && !interaction.deferred) {
      try {
        await interaction.reply({
          content: "Es ist ein Fehler aufgetreten.",
          ephemeral: true
        });
      } catch (_) {}
    } else if (interaction.deferred && !interaction.replied) {
      try {
        await interaction.editReply("Es ist ein Fehler aufgetreten.");
      } catch (_) {}
    }
  }
});

client.once("clientReady", async () => {
  console.log(`Bot online als ${client.user.tag}`);

  await refreshEligibleUsers();
  await ensureAdminPanel();

  cron.schedule(
    "0 7 * * 1",
    async () => {
      await runMondayJob();
    },
    {
      timezone: config.timezone
    }
  );

  cron.schedule(
    "* * * * *",
    async () => {
      await closeDuePolls();
    },
    {
      timezone: config.timezone
    }
  );
});

client.on("error", err => {
  console.error("Client Error:", err);
});

process.on("unhandledRejection", err => {
  console.error("Unhandled Rejection:", err);
});

process.on("uncaughtException", err => {
  console.error("Uncaught Exception:", err);
});

client.login(process.env.TOKEN);