require("dotenv").config();

const { Client, GatewayIntentBits } = require("discord.js");
const cron = require("node-cron");

const config = require("./config.json");
const { ensureAdminPanel } = require("./adminPanel");
const {
  createAllPolls,
  closeDuePolls,
  handleVote
} = require("./pollService");
const { postTracking } = require("./tracking");
const { load, save } = require("./store");

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

// =========================
// DELETE OLD POLLS
// =========================

async function deleteOldPollMessages() {
  const polls = load();

  for (const poll of polls) {
    try {
      const guild = await client.guilds.fetch(config.guildId);
      const channel = await guild.channels.fetch(poll.channelId);

      const pollMsg = await channel.messages.fetch(poll.msgId).catch(() => null);
      const statusMsg = await channel.messages.fetch(poll.statusId).catch(() => null);

      if (pollMsg) await pollMsg.delete().catch(() => null);
      if (statusMsg) await statusMsg.delete().catch(() => null);

    } catch (err) {
      console.error("Fehler beim Löschen:", err);
    }
  }

  console.log("Alte Poll-Nachrichten gelöscht");
}

// =========================
// MONDAY FLOW
// =========================

async function runMondayFlow() {
  console.log("Montags-Flow gestartet");

  // 1. Tracking posten
  await postTracking(client, config);

  // 2. 5 Minuten warten
  setTimeout(async () => {

    // 3. Alte Polls löschen (nur Discord, nicht JSON)
    await deleteOldPollMessages();

    // 4. nochmal 5 Minuten warten
    setTimeout(async () => {

      // 5. Alte Polls im Speicher entfernen (optional)
      save([]);

      // 6. Neue Polls erstellen
      await createAllPolls(client, config);

    }, 5 * 60 * 1000);

  }, 5 * 60 * 1000);
}

// =========================
// READY
// =========================

client.once("clientReady", async () => {
  console.log(`Bot online als ${client.user.tag}`);

  await ensureAdminPanel(client, config);

  // 🏛️ Montag 07:00
  cron.schedule(
    "0 7 * * 1",
    async () => {
      await runMondayFlow();
    },
    {
      timezone: config.timezone
    }
  );

  // 🔒 Polls schließen (jede Minute)
  cron.schedule(
    "* * * * *",
    async () => {
      await closeDuePolls(client, config);
    },
    {
      timezone: config.timezone
    }
  );
});

// =========================
// INTERACTIONS
// =========================

client.on("interactionCreate", async interaction => {
  if (!interaction.isButton()) return;

  if (["vote_yes", "vote_no"].includes(interaction.customId)) {
    return handleVote(interaction, client, config);
  }

  if (interaction.customId === "admin_send_polls_now") {
    await createAllPolls(client, config);
    return interaction.reply({ content: "Polls gesendet", ephemeral: true });
  }

  if (interaction.customId === "admin_post_tracking_now") {
    await postTracking(client, config);
    return interaction.reply({ content: "Tracking gesendet", ephemeral: true });
  }
});

// =========================
// ERRORS
// =========================

client.on("error", err => console.error("Client Error:", err));
process.on("unhandledRejection", err => console.error("Unhandled:", err));
process.on("uncaughtException", err => console.error("Uncaught:", err));

// =========================
// LOGIN
// =========================

client.login(process.env.TOKEN);