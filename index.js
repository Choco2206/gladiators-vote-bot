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
  sendReminder,
  sendAutomaticReminders,
  addMemberToOpenPolls
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

function memberHasTrackedRole(member) {
  return config.trackedRoleIds.some(roleId => member.roles.cache.has(roleId));
}

async function runMondayFlow() {
  try {
    console.log("Montags-Flow gestartet...");

    await postTracking(client, config);

    await wait(2 * 60 * 1000);

    await deleteOldPollMessages(client, config);

    clearAllPollData();

    await wait(30 * 1000);

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
        return sendReminder(interaction, client, config);
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

// =========================
// AUTO: NEW MEMBER JOINS SERVER
// =========================

client.on("guildMemberAdd", async member => {
  try {
    if (member.guild.id !== config.guildId) return;
    if (member.user.bot) return;

    if (memberHasTrackedRole(member)) {
      await addMemberToOpenPolls(member, client, config);
    }
  } catch (err) {
    console.error("Fehler bei guildMemberAdd:", err);
  }
});

// =========================
// AUTO: MEMBER GETS TRACKED ROLE LATER
// =========================

client.on("guildMemberUpdate", async (oldMember, newMember) => {
  try {
    if (newMember.guild.id !== config.guildId) return;
    if (newMember.user.bot) return;

    const hadTrackedRole = config.trackedRoleIds.some(roleId =>
      oldMember.roles.cache.has(roleId)
    );

    const hasTrackedRole = config.trackedRoleIds.some(roleId =>
      newMember.roles.cache.has(roleId)
    );

    if (!hadTrackedRole && hasTrackedRole) {
      await addMemberToOpenPolls(newMember, client, config);
    }
  } catch (err) {
    console.error("Fehler bei guildMemberUpdate:", err);
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

  // Jede Minute prüfen, ob ein automatischer Reminder fällig ist
  cron.schedule(
    "* * * * *",
    async () => {
      await sendAutomaticReminders(client, config);
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