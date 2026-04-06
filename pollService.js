const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");

const { load, save } = require("./store");

let eligibleCache = [];

// =====================
// HELPERS
// =====================

function formatUsers(ids) {
  if (!ids?.length) return "—";
  return ids.map(id => `• <@${id}>`).join("\n");
}

function getDayLabel(dayKey) {
  return {
    friday: "Freitag",
    saturday: "Samstag"
  }[dayKey];
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

// =====================
// TIMES
// =====================

function buildTimes(dayKey, cfg) {
  const date = getNextDateForDay(dayKey);

  const [h, m] = cfg.eventTime.split(":").map(Number);

  const event = new Date(date);
  event.setHours(h, m, 0, 0);

  const close = new Date(date);
  close.setHours(cfg.closeHour, cfg.closeMinute, 0, 0);

  return {
    eventText: `${pad(event.getDate())}.${pad(event.getMonth()+1)}.${event.getFullYear()}, ${pad(h)}:${pad(m)} Uhr`,
    closeText: `${pad(close.getDate())}.${pad(close.getMonth()+1)}.${close.getFullYear()}, ${pad(cfg.closeHour)}:${pad(cfg.closeMinute)} Uhr`,
    closeISO: close.toISOString()
  };
}

// =====================
// EMBED
// =====================

function buildEmbed(dayKey, poll) {
  const yes = Object.entries(poll.votes).filter(([,v]) => v==="yes").map(([id])=>id);
  const no = Object.entries(poll.votes).filter(([,v]) => v==="no").map(([id])=>id);

  return new EmbedBuilder()
    .setTitle("💣 BOMBER CUP 💣")
    .setColor(0xff3c00)
    .setDescription(
      `🛡️ **${getDayLabel(dayKey)}**\n\n` +
      `📅 ${poll.eventTime}\n` +
      `⏳ ${poll.closeTime}`
    )
    .addFields(
      { name: "💣 Zusage", value: formatUsers(yes) },
      { name: "❌ Absage", value: formatUsers(no) }
    );
}

// =====================
// CORE
// =====================

async function refreshEligibleUsers(client, config) {
  const guild = await client.guilds.fetch(config.guildId);
  await guild.members.fetch({ force: true });

  const map = new Map();

  for (const roleId of config.trackedRoleIds) {
    const role = guild.roles.cache.get(roleId);
    if (!role) continue;

    for (const m of role.members.values()) {
      if (!m.user.bot) map.set(m.id, m);
    }
  }

  eligibleCache = [...map.keys()];
}

function getActivePolls() {
  return load().filter(p => !p.closed);
}

// =====================
// CREATE POLL
// =====================

async function createAllPolls(client, config) {
  const active = getActivePolls();
  if (active.length > 0) return;

  await refreshEligibleUsers(client, config);

  for (const [dayKey, cfg] of Object.entries(config.days)) {
    const guild = await client.guilds.fetch(config.guildId);
    const channel = await guild.channels.fetch(cfg.channelId);

    const times = buildTimes(dayKey, cfg);

    const poll = {
      id: Date.now(),
      dayKey,
      votes: {},
      eligible: [...eligibleCache],
      closed: false,
      closeAt: times.closeISO,
      eventTime: times.eventText,
      closeTime: times.closeText
    };

    const pollMsg = await channel.send({
      embeds: [buildEmbed(dayKey, poll)],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("vote_yes").setLabel("Zusage").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId("vote_no").setLabel("Absage").setStyle(ButtonStyle.Danger)
        )
      ]
    });

    const statusMsg = await channel.send({
      content: `🏆 Noch nicht abgestimmt:\n${formatUsers(poll.eligible)}`
    });

    poll.msgId = pollMsg.id;
    poll.statusId = statusMsg.id;

    const all = load();
    all.push(poll);
    save(all);
  }
}

// =====================
// UPDATE POLL
// =====================

async function updatePoll(client, config, poll) {
  const guild = await client.guilds.fetch(config.guildId);
  const channel = await guild.channels.fetch(poll.channelId);

  const pollMsg = await channel.messages.fetch(poll.msgId).catch(()=>null);
  const statusMsg = await channel.messages.fetch(poll.statusId).catch(()=>null);

  const remaining = poll.eligible.filter(id => !poll.votes[id]);

  if (pollMsg) {
    await pollMsg.edit({
      embeds: [buildEmbed(poll.dayKey, poll)],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("vote_yes").setLabel("Zusage").setStyle(ButtonStyle.Success).setDisabled(poll.closed),
          new ButtonBuilder().setCustomId("vote_no").setLabel("Absage").setStyle(ButtonStyle.Danger).setDisabled(poll.closed)
        )
      ]
    });
  }

  if (statusMsg) {
    if (remaining.length === 0) {
      await statusMsg.edit({
        content: poll.closed
          ? "🔒 Umfrage beendet. Alle haben abgestimmt."
          : "✅ Alle abgestimmt"
      });
    } else {
      await statusMsg.edit({
        content: poll.closed
          ? `🔒 Umfrage beendet.\n\nNicht abgestimmt:\n${formatUsers(remaining)}`
          : `🏆 Noch nicht abgestimmt:\n${formatUsers(remaining)}`
      });
    }
  }
}

// =====================
// CLOSE POLLS
// =====================

async function closeDuePolls(client, config) {
  const polls = load();
  const now = new Date();

  let changed = false;

  for (const poll of polls) {
    if (!poll.closed && now >= new Date(poll.closeAt)) {
      poll.closed = true;
      changed = true;
      await updatePoll(client, config, poll);
    }
  }

  if (changed) save(polls);
}

// =====================
// HANDLE VOTE
// =====================

async function handleVote(interaction, client, config) {
  const polls = load();
  const poll = polls.find(p => p.msgId === interaction.message.id);

  if (!poll || poll.closed) return;

  if (!poll.eligible.includes(interaction.user.id)) return;

  await interaction.deferUpdate();

  poll.votes[interaction.user.id] =
    interaction.customId === "vote_yes" ? "yes" : "no";

  save(polls);
  await updatePoll(client, config, poll);
}

module.exports = {
  createAllPolls,
  closeDuePolls,
  handleVote
};