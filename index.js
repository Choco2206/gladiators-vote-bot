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

const POLLS_FILE = path.join(__dirname, "data", "polls.json");

let eligibleMembersCache = [];
let eligibleMemberIdsCache = [];
let adminPanelMessageId = null;

function ensurePollFile() {
  const dir = path.dirname(POLLS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(POLLS_FILE)) {
    fs.writeFileSync(POLLS_FILE, "[]", "utf8");
  }
}

function loadPolls() {
  ensurePollFile();
  try {
    return JSON.parse(fs.readFileSync(POLLS_FILE, "utf8"));
  } catch (err) {
    console.error("Fehler beim Laden von polls.json:", err);
    return [];
  }
}

function savePolls(data) {
  fs.writeFileSync(POLLS_FILE, JSON.stringify(data, null, 2), "utf8");
}

function rolePing() {
  return config.pingRoleIds.map(id => `<@&${id}>`).join(" ");
}

function formatUsers(ids) {
  if (!ids || ids.length === 0) return "—";
  return ids.map(id => `<@${id}>`).join(" ");
}

function getDayName(key) {
  return {
    friday: "Freitag",
    saturday: "Samstag",
    sunday: "Sonntag"
  }[key] || key;
}

function getEventTitle(dayKey) {
  if (dayKey === "sunday") return "🏆 T-CUP 🏆";
  return "💣 BOMBER CUP 💣";
}

function getTargetDateForDay(dayKey) {
  const map = { friday: 5, saturday: 6, sunday: 0 };
  const now = new Date();
  const target = new Date(now);

  let diff = map[dayKey] - now.getDay();
  if (diff <= 0) diff += 7;

  target.setDate(now.getDate() + diff);
  return target;
}

function buildPollTimes(dayKey, dayConfig) {
  const eventDate = getTargetDateForDay(dayKey);
  const [eventHour, eventMinute] = dayConfig.eventTime.split(":").map(Number);
  eventDate.setHours(eventHour, eventMinute, 0, 0);

  const closeDate = new Date(eventDate);
  closeDate.setHours(dayConfig.closeHour, dayConfig.closeMinute, 0, 0);

  return {
    eventDate,
    closeDate,
    eventText: eventDate.toLocaleString("de-DE", {
      timeZone: config.timezone
    }),
    closeText: closeDate.toLocaleString("de-DE", {
      timeZone: config.timezone
    }),
    closeISO: closeDate.toISOString()
  };
}

function buildPollEmbed(dayKey, dayConfig, poll) {
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
      `🛡️ **${getDayName(dayKey)}**\n\n` +
      `📅 **Event startet:** ${poll.eventTime}\n` +
      `⏳ **Abstimmung offen bis:** ${poll.closeTime}`
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
      `**Buttons:**\n` +
      `• Polls jetzt senden\n` +
      `• Aktive Polls löschen & neu senden\n` +
      `• Tracking jetzt senden\n` +
      `• Panel neu posten`
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
        .setStyle(ButtonStyle.Danger)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("admin_post_tracking_now")
        .setLabel("Tracking jetzt senden")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId("admin_repost_panel")
        .setLabel("Panel neu posten")
        .setStyle(ButtonStyle.Secondary)
    )
  ];
}

async function refreshEligibleMembers(guild) {
  try {
    const memberMap = new Map();

    for (const roleId of config.pingRoleIds) {
      const role = await guild.roles.fetch(roleId).catch(() => null);
      if (!role) continue;

      const fullRole = guild.roles.cache.get(roleId);
      if (!fullRole) continue;

      for (const member of fullRole.members.values()) {
        if (!member.user.bot) {
          memberMap.set(member.id, member);
        }
      }
    }

    eligibleMembersCache = [...memberMap.values()];
    eligibleMemberIdsCache = eligibleMembersCache.map(member => member.id);

    console.log(`Eligible Members geladen: ${eligibleMemberIdsCache.length}`);
  } catch (err) {
    console.error("Fehler beim Laden der Rollenmitglieder:", err);
  }
}

async function ensureAdminPanel() {
  try {
    const guild = await client.guilds.fetch(config.guildId);
    const channel = await guild.channels.fetch(config.adminPanelChannelId);
    if (!channel) return;

    if (adminPanelMessageId) {
      try {
        const existing = await channel.messages.fetch(adminPanelMessageId);
        if (existing) {
          await existing.edit({
            embeds: [buildAdminPanelEmbed()],
            components: buildAdminButtons()
          });
          return;
        }
      } catch (_) {}
    }

    const recentMessages = await channel.messages.fetch({ limit: 20 });
    const existingPanel = recentMessages.find(
      msg =>
        msg.author.id === client.user.id &&
        msg.embeds.length &&
        msg.embeds[0].title === "🛠️ Gladiators Vote Admin Panel"
    );

    if (existingPanel) {
      adminPanelMessageId = existingPanel.id;
      await existingPanel.edit({
        embeds: [buildAdminPanelEmbed()],
        components: buildAdminButtons()
      });
      return;
    }

    const msg = await channel.send({
      embeds: [buildAdminPanelEmbed()],
      components: buildAdminButtons()
    });

    adminPanelMessageId = msg.id;
  } catch (err) {
    console.error("Fehler beim Erstellen/Aktualisieren des Admin Panels:", err);
  }
}

function getActivePolls() {
  return loadPolls().filter(poll => !poll.closed);
}

async function createPoll(dayKey, dayConfig) {
  const guild = await client.guilds.fetch(config.guildId);
  const channel = await guild.channels.fetch(dayConfig.channelId);

  if (!channel) {
    console.error(`Kanal nicht gefunden für ${dayKey}`);
    return;
  }

  const times = buildPollTimes(dayKey, dayConfig);

  const poll = {
    id: `${dayKey}_${Date.now()}`,
    dayKey,
    channelId: dayConfig.channelId,
    votes: {},
    eligible: [...eligibleMemberIdsCache],
    closed: false,
    closeAt: times.closeISO,
    eventTime: times.eventText,
    closeTime: times.closeText,
    createdAt: new Date().toISOString()
  };

  const pollMessage = await channel.send({
    content: rolePing(),
    embeds: [buildPollEmbed(dayKey, dayConfig, poll)],
    components: buildVoteButtons(false)
  });

  const statusMessage = await channel.send({
    content:
      poll.eligible.length > 0
        ? `⏳ **Noch nicht abgestimmt:**\n${formatUsers(poll.eligible)}`
        : "✅ **Alle abgestimmt**"
  });

  poll.msgId = pollMessage.id;
  poll.statusId = statusMessage.id;

  const polls = loadPolls();
  polls.push(poll);
  savePolls(polls);

  console.log(`Poll erstellt: ${dayKey} -> ${dayConfig.channelId}`);
}

async function createAllPolls() {
  const activePolls = getActivePolls();
  if (activePolls.length > 0) {
    console.log("Es gibt bereits aktive Polls. Kein neuer automatischer Post.");
    return;
  }

  const guild = await client.guilds.fetch(config.guildId);
  await refreshEligibleMembers(guild);

  for (const [dayKey, dayConfig] of Object.entries(config.days)) {
    await createPoll(dayKey, dayConfig);
  }
}

async function updatePollMessage(poll) {
  try {
    const guild = await client.guilds.fetch(config.guildId);
    const channel = await guild.channels.fetch(poll.channelId);
    if (!channel) return;

    const pollMessage = await channel.messages.fetch(poll.msgId);
    const statusMessage = await channel.messages.fetch(poll.statusId);
    const dayConfig = config.days[poll.dayKey];

    await pollMessage.edit({
      content: rolePing(),
      embeds: [buildPollEmbed(poll.dayKey, dayConfig, poll)],
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
        content: `⏳ **Noch nicht abgestimmt:**\n${formatUsers(remaining)}`
      });
    }
  } catch (err) {
    console.error("Fehler beim Aktualisieren einer Poll:", err);
  }
}

async function closeDuePolls() {
  const polls = loadPolls();
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
    savePolls(polls);
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

    await refreshEligibleMembers(guild);

    const polls = loadPolls().filter(isPollFromLastWeek);

    const stats = new Map();
    for (const userId of eligibleMemberIdsCache) {
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
  const polls = loadPolls();
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
  savePolls(remaining);

  await createAllPolls();
}

async function runMondayJob() {
  console.log("Montags-Job gestartet...");
  await postWeeklyTracking();
  await createAllPolls();
}

function isAdmin(interaction) {
  return interaction.user.id === config.adminUserId;
}

client.on("interactionCreate", async interaction => {
  try {
    if (interaction.isButton()) {
      if (["vote_yes", "vote_no"].includes(interaction.customId)) {
        const polls = loadPolls();
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

        savePolls(polls);
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
          "admin_post_tracking_now",
          "admin_repost_panel"
        ].includes(interaction.customId)
      ) {
        if (!isAdmin(interaction)) {
          return interaction.reply({
            content: "Nur der Admin kann dieses Panel nutzen.",
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

        if (interaction.customId === "admin_repost_panel") {
          adminPanelMessageId = null;
          await ensureAdminPanel();
          return interaction.editReply("Admin Panel wurde neu gepostet/aktualisiert.");
        }
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

  const guild = await client.guilds.fetch(config.guildId);
  await refreshEligibleMembers(guild);
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