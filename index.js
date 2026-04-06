require("dotenv").config();

const { Client, GatewayIntentBits } = require("discord.js");
const cron = require("node-cron");

const config = require("./config.json");
const { ensureAdminPanel } = require("./adminPanel");
const {
  createAllPolls,
  closeDuePolls,
  handleVote,
  deleteActivePollsAndResend,
  deleteOldPollMessages,
  clearAllPollData,
  showActivePolls,
  syncPolls,
  sendReminder
} = require("./pollService");
const { postTracking } = require("./tracking");

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

function isAdmin(interaction) {
  return interaction.user.id === config.adminUserId;
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runMondayFlow() {
  try {
    console.log("Montags-Flow gestartet...");

    // 1. Tracking posten
    await postTracking(client, config);

    // 2. 5 Minuten warten
    await wait(5 * 60 * 1000);

    // 3. Alte Poll-Nachrichten löschen
    await deleteOldPollMessages(client, config);

    // 4. 5 Minuten warten
    await wait(5 * 60 * 1000);

    // 5. Poll-Daten leeren
    clearAllPollData();

    // 6. Neue Polls erstellen
    await createAllPolls(client, config);

    console.log("Montags-Flow abgeschlossen.");
  } catch (err) {
    console.error("Fehler im Montags-Flow:", err);
  }
}

client.on("interactionCreate", async interaction => {
  try {
    if (!interaction.isButton()) return;

    if (["vote_yes", "vote_no"].includes(interaction.customId)) {
      return handleVote(interaction, client, config);
    }

    if (
      [
        "admin_send_polls_now",
        "admin_reset_and_resend",
        "admin_post_tracking_now",
        "admin_show_active_polls",
        "admin_sync_polls",
        "admin_reminder"
      ].includes(interaction.customId)
    ) {
      if (!isAdmin(interaction)) {
        return interaction.reply({
          content: "Nur der Admin kann das Admin Panel nutzen.",
          ephemeral: true
        });
      }

      if (interaction.customId === "admin_send_polls_now") {
        await createAllPolls(client, config);
        return interaction.reply({
          content: "Polls wurden geprüft und ggf. gesendet.",
          ephemeral: true
        });
      }

      if (interaction.customId === "admin_reset_and_resend") {
        await deleteActivePollsAndResend(client, config);
        return interaction.reply({
          content: "Aktive Polls wurden gelöscht und neu gesendet.",
          ephemeral: true
        });
      }

      if (interaction.customId === "admin_post_tracking_now") {
        await postTracking(client, config);
        return interaction.reply({
          content: "Tracking wurde gepostet.",
          ephemeral: true
        });
      }

      if (interaction.customId === "admin_show_active_polls") {
        return showActivePolls(interaction);
      }

      if (interaction.customId === "admin_sync_polls") {
        await syncPolls(client, config);
        return interaction.reply({
          content: "Polls wurden synchronisiert.",
          ephemeral: true
        });
      }

      if (interaction.customId === "admin_reminder") {
        return sendReminder(interaction);
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
    }
  }
});

client.once("clientReady", async () => {
  console.log(`Bot online als ${client.user.tag}`);

  await ensureAdminPanel(client, config);

  if (config.postImmediatelyOnStartup) {
    await createAllPolls(client, config);
  }

  // Montag 07:00 Uhr
  cron.schedule(
    "0 7 * * 1",
    async () => {
      await runMondayFlow();
    },
    {
      timezone: config.timezone
    }
  );

  // Jede Minute prüfen, ob Polls geschlossen werden müssen
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