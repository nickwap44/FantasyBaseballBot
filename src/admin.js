import "dotenv/config";
import { Client, GatewayIntentBits } from "discord.js";
import { getGuildConfig, saveGuildConfig } from "./storage.js";

function normalizeChannelName(name) {
  return name.trim().toLowerCase();
}

async function main() {
  const action = process.argv[2];
  const guildId = process.env.DISCORD_GUILD_ID;
  const token = process.env.DISCORD_TOKEN;
  const defaultTimezone = process.env.DEFAULT_TIMEZONE || "America/Los_Angeles";

  if (!action) {
    throw new Error("Missing admin action.");
  }

  const client = new Client({
    intents: [GatewayIntentBits.Guilds]
  });

  await client.login(token);

  try {
    const guild = await client.guilds.fetch(guildId);

    if (action === "configure-reminders") {
      const requestedName = normalizeChannelName(process.argv[3] || "reminders");
      const channels = await guild.channels.fetch();
      const channel = channels.find(
        (entry) => entry && entry.isTextBased() && normalizeChannelName(entry.name) === requestedName
      );

      if (!channel) {
        throw new Error(`Could not find a text channel named "${requestedName}".`);
      }

      const guildConfig = (await getGuildConfig(guildId)) || {
        enabled: true,
        timezone: defaultTimezone,
        channelId: null,
        roleId: null,
        customMessage: null
      };

      guildConfig.channelId = channel.id;
      guildConfig.enabled = true;
      guildConfig.timezone = guildConfig.timezone || defaultTimezone;

      await saveGuildConfig(guildId, guildConfig);
      console.log(`Configured reminders channel: ${channel.name} (${channel.id})`);
      return;
    }

    if (action === "send-test-message") {
      const guildConfig = await getGuildConfig(guildId);
      if (!guildConfig?.channelId) {
        throw new Error("No configured reminder channel found.");
      }

      const channel = await client.channels.fetch(guildConfig.channelId);
      if (!channel?.isTextBased()) {
        throw new Error("Configured reminder channel is not available.");
      }

      await channel.send(
        "Test message from Fantasy Baseball Bot: reminders are configured and the bot is ready."
      );
      console.log(`Sent test message to channel ${guildConfig.channelId}`);
      return;
    }

    throw new Error(`Unknown admin action: ${action}`);
  } finally {
    client.destroy();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
