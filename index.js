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

function load() {
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, "[]");
  return JSON.parse(fs.readFileSync(FILE));
}

function save(d) {
  fs.writeFileSync(FILE, JSON.stringify(d, null, 2));
}

function isAdmin(interaction) {
  return interaction.member.roles.cache.has(config.adminRoleId);
}

function rolePing() {
  return config.pingRoleIds.map(id => `<@&${id}>`).join(" ");
}

function format(ids) {
  return ids.length ? ids.map(id => `<@${id}>`).join(" ") : "—";
}

function eventTitle(day) {
  return day === "sunday" ? "🏆 T-CUP 🏆" : "💣 BOMBER CUP 💣";
}

function getDate(day) {
  const map = { friday: 5, saturday: 6, sunday: 0 };
  const now = new Date();

  let diff = map[day] - now.getDay();
  if (diff <= 0) diff += 7;

  const d = new Date(now);
  d.setDate(now.getDate() + diff);
  return d;
}

function buildTimes(day, cfg) {
  const event = getDate(day);
  const [h, m] = cfg.eventTime.split(":");

  event.setHours(h, m, 0, 0);

  const close = new Date(event);
  close.setHours(cfg.closeHour, cfg.closeMinute, 0, 0);

  return {
    event: event.toLocaleString("de-DE"),
    close: close.toLocaleString("de-DE"),
    closeISO: close.toISOString()
  };
}

function embed(day, cfg, poll) {
  const yes = Object.entries(poll.votes).filter(v => v[1] === "yes").map(v => v[0]);
  const no = Object.entries(poll.votes).filter(v => v[1] === "no").map(v => v[0]);

  return new EmbedBuilder()
    .setTitle(eventTitle(day))
    .setColor(0xff3c00)
    .setDescription(
      `📅 Event: **${poll.eventTime}**\n` +
      `⏳ Abstimmung bis: **${poll.closeTime}**`
    )
    .addFields(
      { name: "💣 Zusage", value: format(yes) },
      { name: "❌ Absage", value: format(no) }
    );
}

function buttons(disabled = false) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("yes").setLabel("Zusage").setEmoji("💣").setStyle(3).setDisabled(disabled),
      new ButtonBuilder().setCustomId("no").setLabel("Absage").setEmoji("❌").setStyle(4).setDisabled(disabled)
    )
  ];
}

async function loadMembers() {
  const guild = await client.guilds.fetch(config.guildId);

  const set = new Set();

  for (const id of config.pingRoleIds) {
    const role = guild.roles.cache.get(id);
    if (!role) continue;

    role.members.forEach(m => {
      if (!m.user.bot) set.add(m.id);
    });
  }

  eligibleCache = [...set];
  console.log("Members geladen:", eligibleCache.length);
}

async function createPoll(day, cfg) {
  const guild = await client.guilds.fetch(config.guildId);
  const channel = await guild.channels.fetch(cfg.channelId);

  const t = buildTimes(day, cfg);

  const poll = {
    day,
    channelId: cfg.channelId,
    votes: {},
    eligible: eligibleCache,
    closed: false,
    eventTime: t.event,
    closeTime: t.close,
    closeAt: t.closeISO
  };

  const msg = await channel.send({
    content: rolePing(),
    embeds: [embed(day, cfg, poll)],
    components: buttons()
  });

  const status = await channel.send(
    eligibleCache.length
      ? `⏳ Noch nicht abgestimmt:\n${format(eligibleCache)}`
      : "Alle abgestimmt"
  );

  poll.msgId = msg.id;
  poll.statusId = status.id;

  const data = load();
  data.push(poll);
  save(data);
}

async function createAll() {
  const data = load();

  if (data.some(p => !p.closed)) {
    console.log("Aktive Polls vorhanden → skip");
    return;
  }

  await loadMembers();

  for (const [d, cfg] of Object.entries(config.days)) {
    await createPoll(d, cfg);
  }
}

async function update(poll) {
  const guild = await client.guilds.fetch(config.guildId);
  const ch = await guild.channels.fetch(poll.channelId);

  const msg = await ch.messages.fetch(poll.msgId);
  const status = await ch.messages.fetch(poll.statusId);

  const cfg = config.days[poll.day];

  await msg.edit({
    embeds: [embed(poll.day, cfg, poll)],
    components: buttons(poll.closed)
  });

  const remaining = poll.eligible.filter(id => !poll.votes[id]);

  if (!remaining.length) await status.edit("✅ Alle abgestimmt");
  else if (poll.closed) await status.edit("🔒 Umfrage beendet");
  else await status.edit(`⏳ Noch nicht abgestimmt:\n${format(remaining)}`);
}

async function closePolls() {
  const data = load();
  const now = new Date();

  for (const p of data) {
    if (!p.closed && now >= new Date(p.closeAt)) {
      p.closed = true;
      await update(p);
    }
  }

  save(data);
}

async function adminPanel() {
  const guild = await client.guilds.fetch(config.guildId);
  const ch = await guild.channels.fetch(config.adminPanelChannelId);

  await ch.send({
    embeds: [
      new EmbedBuilder()
        .setTitle("🛠️ Admin Panel")
        .setDescription("Steuere den Bot")
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("send").setLabel("Polls senden").setStyle(1),
        new ButtonBuilder().setCustomId("reset").setLabel("Reset Polls").setStyle(4)
      )
    ]
  });
}

client.on("interactionCreate", async i => {
  if (!i.isButton()) return;

  if (!isAdmin(i) && ["send", "reset"].includes(i.customId))
    return i.reply({ content: "Kein Admin", ephemeral: true });

  if (i.customId === "yes" || i.customId === "no") {
    await i.deferReply({ ephemeral: true });

    const data = load();
    const poll = data.find(p => p.msgId === i.message.id);

    if (!poll) return;

    poll.votes[i.user.id] = i.customId === "yes" ? "yes" : "no";

    save(data);
    await update(poll);

    return i.editReply("Gespeichert 💣");
  }

  if (i.customId === "send") {
    await createAll();
    return i.reply({ content: "Polls gesendet", ephemeral: true });
  }

  if (i.customId === "reset") {
    save([]);
    await createAll();
    return i.reply({ content: "Reset + neue Polls", ephemeral: true });
  }
});

client.once("clientReady", async () => {
  console.log("BOT ONLINE");

  await loadMembers();
  await adminPanel();

  cron.schedule("0 7 * * 1", createAll, {
    timezone: config.timezone
  });

  cron.schedule("* * * * *", closePolls);
});

client.login(process.env.TOKEN);