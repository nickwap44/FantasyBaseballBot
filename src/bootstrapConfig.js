import { config as appConfig } from "./config.js";
import { getGuildConfig, saveGuildConfig } from "./storage.js";

export async function ensureBootstrapGuildConfig() {
  const guildId = appConfig.discordGuildId;
  const existing = await getGuildConfig(guildId);

  const nextConfig = {
    enabled: existing?.enabled ?? true,
    timezone: existing?.timezone || appConfig.defaultTimezone,
    channelId: existing?.channelId || appConfig.defaultReminderChannelId,
    roleId: existing?.roleId || null,
    customMessage: existing?.customMessage || null,
    transactionsChannelId:
      existing?.transactionsChannelId || appConfig.transactionsChannelId,
    powerRankingsChannelId:
      existing?.powerRankingsChannelId || appConfig.powerRankingsChannelId,
    socialChannelId: existing?.socialChannelId || appConfig.socialChannelId,
    reporterChannelId: existing?.reporterChannelId || null,
    podcastChannelId: existing?.podcastChannelId || appConfig.podcastChannelId,
    podcastManualContext: existing?.podcastManualContext || "",
    podcastHostNames: {
      lead: existing?.podcastHostNames?.lead || "Mason",
      hotTake: existing?.podcastHostNames?.hotTake || "Rico",
      analyst: existing?.podcastHostNames?.analyst || "Elena"
    },
    espnDiscordLinks: existing?.espnDiscordLinks || {}
  };

  if (!nextConfig.channelId) {
    return null;
  }

  const changed =
    !existing ||
    existing.enabled !== nextConfig.enabled ||
    existing.timezone !== nextConfig.timezone ||
    existing.channelId !== nextConfig.channelId ||
    existing.roleId !== nextConfig.roleId ||
    existing.customMessage !== nextConfig.customMessage ||
    existing.transactionsChannelId !== nextConfig.transactionsChannelId ||
    existing.powerRankingsChannelId !== nextConfig.powerRankingsChannelId ||
    existing.socialChannelId !== nextConfig.socialChannelId ||
    existing.reporterChannelId !== nextConfig.reporterChannelId ||
    existing.podcastChannelId !== nextConfig.podcastChannelId ||
    existing.podcastManualContext !== nextConfig.podcastManualContext ||
    existing.podcastHostNames?.lead !== nextConfig.podcastHostNames.lead ||
    existing.podcastHostNames?.hotTake !== nextConfig.podcastHostNames.hotTake ||
    existing.podcastHostNames?.analyst !== nextConfig.podcastHostNames.analyst ||
    JSON.stringify(existing.espnDiscordLinks || {}) !== JSON.stringify(nextConfig.espnDiscordLinks);

  if (changed) {
    await saveGuildConfig(guildId, nextConfig);
  }

  return nextConfig;
}
