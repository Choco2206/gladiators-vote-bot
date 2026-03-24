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

function ensurePollFile() {
  const dir = path.dirname(POLLS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(POLLS_FILE)) fs.writeFileSync(POLLS_FILE, "[]", "utf8");
}

function loadPolls() {
  ensurePollFile();
  try {
    return JSON.parse(fs.readFileSync(POLLS_FILE, "utf8"));
  } catch {
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
  if (!ids.length) return "—";
  return ids.map(id => `<@${id}>`).join(" ");
}

function getDayName(key) {
  return {
    friday: "Freitag",
    saturday: "Samstag",
    sunday: "Sonntag"
  }[key];
}

function getEventTitle(dayKey) {
  if (dayKey === "sunday") return "🏆 T-CUP 🏆";
  return "💣 BOMBER CUP 💣";
}

function buildEmbed(dayKey, dayConfig, poll) {
  const yes = Object.entries(poll.votes)
    .filter(([, v]) => v === "yes")
    .map(([id]) => id);

  const no = Object.entries(poll.votes)
    .filter(([, v]) => v === "no")
    .map(([id]) => id);

  return new EmbedBuilder()
    .setTitle(getEventTitle(dayKey))
    .setColor(0xff3c00)
    .setDescription(
      `🛡️ **${getDayName(dayKey)} • ${dayConfig.eventTime} Uhr**\n\n` +
      `Seid ihr bereit für den Kampf?`
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
    .setFooter({ text: "Gladiators Vote" });
}

function buildButtons(disabled = false) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("yes")
        .setLabel("Zusage")
        .setEmoji("💣")
        .setStyle(ButtonStyle.Success)
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId("no")
        .setLabel("Absage")
        .setEmoji("❌")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(disabled)
    )
  ];
}

async function getPlayers(guild) {
  await guild.members.fetch();

  const users = new Map();

  for (const roleId of config.pingRoleIds) {
    const role = guild.roles.cache.get(roleId);
    if (!role) continue;

    role.members.forEach(m => {
      if (!m.user.bot) users.set(m.id, m);
    });
  }

  return [...users.keys()];
}

function getNextDate(dayKey) {
  const now = new Date();
  const map = { friday: 5, saturday: 6, sunday: 0 };

  let diff = map[dayKey] - now.getDay();
  if (diff <= 0) diff += 7;

  const d = new Date(now);
  d.setDate(now.getDate() + diff);
  return d;
}

function getCloseTime(dayKey, cfg) {
  const d = getNextDate(dayKey);
  d.setHours(cfg.closeHour, cfg.closeMinute, 0, 0);
  return d.toISOString();
}

async function createPoll(dayKey, cfg) {
  const guild = await client.guilds.fetch(config.guildId);
  const channel = await guild.channels.fetch(cfg.channelId);

  const players = await getPlayers(guild);

  const poll = {
    id: `${dayKey}_${Date.now()}`,
    dayKey,
    channelId: cfg.channelId,
    votes: {},
    eligible: players,
    closed: false,
    closeAt: getCloseTime(dayKey, cfg),
    createdAt: new Date().toISOString()
  };

  const msg = await channel.send({
    content: rolePing(),
    embeds: [buildEmbed(dayKey, cfg, poll)],
    components: buildButtons()
  });

  const status = await channel.send(
    players.length
      ? `⏳ **Noch nicht abgestimmt:**\n${formatUsers(players)}`
      : "✅ Alle abgestimmt"
  );

  poll.msgId = msg.id;
  poll.statusId = status.id;

  const polls = loadPolls();
  polls.push(poll);
  savePolls(polls);
}

async function createAllPolls() {
  for (const [key, cfg] of Object.entries(config.days)) {
    await createPoll(key, cfg);
  }
}

async function updatePoll(poll) {
  const guild = await client.guilds.fetch(config.guildId);
  const channel = await guild.channels.fetch(poll.channelId);
  const msg = await channel.messages.fetch(poll.msgId);
  const status = await channel.messages.fetch(poll.statusId);
  const cfg = config.days[poll.dayKey];

  await msg.edit({
    content: rolePing(),
    embeds: [buildEmbed(poll.dayKey, cfg, poll)],
    components: buildButtons(poll.closed)
  });

  const remaining = poll.eligible.filter(id => !poll.votes[id]);

  if (!remaining.length) {
    await status.edit("✅ Alle abgestimmt");
  } else if (poll.closed) {
    await status.edit(`🔒 Umfrage beendet\n${formatUsers(remaining)}`);
  } else {
    await status.edit(`⏳ Noch nicht abgestimmt:\n${formatUsers(remaining)}`);
  }
}

async function closePolls() {
  const polls = loadPolls();
  const now = new Date();

  for (const poll of polls) {
    if (!poll.closed && now >= new Date(poll.closeAt)) {
      poll.closed = true;
      await updatePoll(poll);
    }
  }

  savePolls(polls);
}

function getLastWeekWindow() {
  const now = new Date();
  const d = new Date(now);

  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1;

  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);

  const last = new Date(d);
  last.setDate(d.getDate() - 7);

  return { start: last, end: d };
}

function isLastWeek(poll) {
  const { start, end } = getLastWeekWindow();
  const created = new Date(poll.createdAt);
  return created >= start && created < end;
}

async function postWeeklyTracking() {
  const guild = await client.guilds.fetch(config.guildId);
  const channel = await guild.channels.fetch(config.trackingChannelId);

  const users = await getPlayers(guild);
  const polls = loadPolls().filter(isLastWeek);

  const stats = new Map();

  users.forEach(id => stats.set(id, { userId: id, yes: 0, no: 0 }));

  for (const poll of polls) {
    for (const id of poll.eligible) {
      const vote = poll.votes[id];
      if (vote === "yes") stats.get(id).yes++;
      else stats.get(id).no++;
    }
  }

  const sorted = [...stats.values()].sort((a, b) => b.yes - a.yes);

  const text = sorted
    .map((u, i) => {
      const ratio = `${u.yes}/3`;
      return `**${i + 1}.** <@${u.userId}> • 💣 ${u.yes} • ❌ ${u.no} • **${ratio}**`;
    })
    .join("\n");

  const embed = new EmbedBuilder()
    .setTitle("🏛️ Weekly Gladiator Ranking")
    .setColor(0xff3c00)
    .setDescription(text || "Keine Daten vorhanden")
    .setFooter({ text: "Nicht abgestimmt = Absage" });

  await channel.send({ embeds: [embed] });
}

async function mondayJob() {
  await postWeeklyTracking();
  await createAllPolls();
}

client.on("interactionCreate", async i => {
  if (!i.isButton()) return;

  const polls = loadPolls();
  const poll = polls.find(p => p.msgId === i.message.id);

  if (!poll) return;
  if (poll.closed) return i.reply({ content: "Beendet", ephemeral: true });
  if (!poll.eligible.includes(i.user.id))
    return i.reply({ content: "Keine Berechtigung", ephemeral: true });

  poll.votes[i.user.id] = i.customId === "yes" ? "yes" : "no";

  savePolls(polls);
  await updatePoll(poll);

  await i.reply({ content: "Gespeichert 💣", ephemeral: true });
});

client.once("ready", async () => {
  console.log("Bot online");

  cron.schedule("0 7 * * 1", mondayJob, {
    timezone: config.timezone
  });

  cron.schedule("* * * * *", closePolls);

  if (config.postImmediatelyOnStartup) {
    await createAllPolls();
  }
});

client.login(process.env.TOKEN);