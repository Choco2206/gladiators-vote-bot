require("dotenv").config();

const { Client, GatewayIntentBits } = require("discord.js");
const cron = require("node-cron");

const config = require("./config.json");
const { ensureAdminPanel } = require("./adminPanel");
const { createAllPolls } = require("./pollService");
const { postTracking } = require("./tracking");

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

client.once("clientReady", async () => {
  console.log(`Bot online als ${client.user.tag}`);

  await ensureAdminPanel(client, config);

  cron.schedule("0 7 * * 1", async () => {
    await postTracking(client, config);
    await createAllPolls(client, config);
  }, { timezone: config.timezone });
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isButton()) return;

  if (interaction.customId === "admin_send_polls_now") {
    await createAllPolls(client, config);
    return interaction.reply({ content: "Polls gesendet", ephemeral: true });
  }

  if (interaction.customId === "admin_post_tracking_now") {
    await postTracking(client, config);
    return interaction.reply({ content: "Tracking gesendet", ephemeral: true });
  }
});

client.login(process.env.TOKEN);