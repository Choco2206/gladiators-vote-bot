require("dotenv").config();

const { Client, GatewayIntentBits } = require("discord.js");
const cron = require("node-cron");

const config = require("./config.json");

const {
  createAllPolls,
  closeDuePolls,
  handleVote,
  syncPolls,
  sendAutomaticReminders
} = require("./pollService");

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

// =========================
// INTERACTIONS
// =========================

client.on("interactionCreate", async interaction => {
  if (!interaction.isButton()) return;

  if (["vote_yes", "vote_no"].includes(interaction.customId)) {
    return handleVote(interaction, client, config);
  }

  if (interaction.customId === "admin_sync_polls") {
    await syncPolls(client, config);
    return interaction.reply({ content: "Polls synchronisiert", ephemeral: true });
  }
});

// =========================
// READY
// =========================

client.once("clientReady", async () => {
  console.log(`Bot online als ${client.user.tag}`);

  await createAllPolls(client, config);

  cron.schedule("* * * * *", async () => {
    await closeDuePolls(client, config);
  }, { timezone: config.timezone });

  cron.schedule("* * * * *", async () => {
    await sendAutomaticReminders(client, config);
  }, { timezone: config.timezone });
});

// =========================
// LOGIN
// =========================

client.login(process.env.TOKEN);