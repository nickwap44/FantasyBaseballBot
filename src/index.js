import { Client, Events, GatewayIntentBits } from "discord.js";
import { ensureBootstrapGuildConfig } from "./bootstrapConfig.js";
import { handleCommand } from "./commands.js";
import { config } from "./config.js";
import { initializeDatabase, isDatabaseConfigured } from "./database.js";
import { startFantasyLoop } from "./fantasyService.js";
import { startReminderLoop } from "./reminderService.js";

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

let reminderInterval;
let fantasyInterval;

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  if (isDatabaseConfigured()) {
    await initializeDatabase();
    console.log("Database initialized.");
  }
  const bootstrapConfig = await ensureBootstrapGuildConfig();
  if (bootstrapConfig?.channelId) {
    console.log(`Bootstrap config ready for channel ${bootstrapConfig.channelId}`);
  }
  reminderInterval = startReminderLoop(readyClient, config.checkIntervalMs);
  fantasyInterval = startFantasyLoop(readyClient, config.checkIntervalMs);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) {
    return;
  }

  try {
    await handleCommand(interaction);
  } catch (error) {
    console.error("Command handling failed:", error);

    const payload = {
      content: "Something went wrong while handling that command.",
      ephemeral: true
    };

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload);
      return;
    }

    await interaction.reply(payload);
  }
});

client.on(Events.Error, (error) => {
  console.error("Discord client error:", error);
});

process.on("SIGINT", () => {
  if (reminderInterval) {
    clearInterval(reminderInterval);
  }
  if (fantasyInterval) {
    clearInterval(fantasyInterval);
  }

  client.destroy();
  process.exit(0);
});

client.login(config.discordToken).catch((error) => {
  console.error("Discord login failed:", error);
  process.exitCode = 1;
});
