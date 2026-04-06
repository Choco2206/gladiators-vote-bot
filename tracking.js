const { load } = require("./store");
const { EmbedBuilder } = require("discord.js");

async function postTracking(client, config) {
  const guild = await client.guilds.fetch(config.guildId);
  const channel = await guild.channels.fetch(config.trackingChannelId);

  const polls = load();

  const stats = {};

  polls.forEach(p => {
    Object.entries(p.votes).forEach(([id, vote]) => {
      if (!stats[id]) stats[id] = { yes:0, no:0 };
      vote==="yes" ? stats[id].yes++ : stats[id].no++;
    });
  });

  const sorted = Object.entries(stats)
    .sort((a,b)=>b[1].yes-a[1].yes);

  const desc = sorted.map(([id,s],i)=>
    `**${i+1}.** <@${id}> • 💣 ${s.yes} • ❌ ${s.no}`
  ).join("\n");

  const embed = new EmbedBuilder()
    .setTitle("🏛️ Weekly Ranking")
    .setDescription(desc || "Keine Daten");

  await channel.send({ embeds:[embed] });
}

module.exports = { postTracking };