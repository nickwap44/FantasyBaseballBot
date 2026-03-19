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
  transactionsChannelId: process.env.DISCORD_TRANSACTIONS_CHANNEL_ID || null,
  powerRankingsChannelId: process.env.DISCORD_POWER_RANKINGS_CHANNEL_ID || null,
  socialChannelId: process.env.DISCORD_SOCIAL_CHANNEL_ID || null,
  podcastChannelId: process.env.DISCORD_PODCAST_CHANNEL_ID || null,
  checkIntervalMs: getOptionalNumber("CHECK_INTERVAL_MS", 60_000)
  ,
  espnLeagueId: process.env.ESPN_LEAGUE_ID || null,
  espnSeason: getOptionalNumber("ESPN_SEASON", new Date().getFullYear()),
  espnSport: process.env.ESPN_SPORT || "baseball",
  espnSwid: process.env.ESPN_SWID || null,
  espnS2: process.env.ESPN_S2 || null,
  openAiApiKey: process.env.OPENAI_API_KEY || null
};
