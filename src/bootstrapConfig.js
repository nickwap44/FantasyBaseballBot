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
    customMessage: existing?.customMessage || null
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
    existing.customMessage !== nextConfig.customMessage;

  if (changed) {
    await saveGuildConfig(guildId, nextConfig);
  }

  return nextConfig;
}
