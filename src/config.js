import dotenv from "dotenv";

dotenv.config();

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function getOptionalNumber(name, fallback) {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  discordToken: getRequiredEnv("DISCORD_TOKEN"),
  discordClientId: getRequiredEnv("DISCORD_CLIENT_ID"),
  discordGuildId: getRequiredEnv("DISCORD_GUILD_ID"),
  defaultTimezone: process.env.DEFAULT_TIMEZONE || "America/Los_Angeles",
  defaultReminderChannelId: process.env.DEFAULT_REMINDER_CHANNEL_ID || null,
  checkIntervalMs: getOptionalNumber("CHECK_INTERVAL_MS", 60_000)
};
