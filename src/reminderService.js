import { getEspnDailyLockGame } from "./mlbSchedule.js";
import { getGuildConfigs, markReminderSent, wasReminderSent } from "./storage.js";
import { formatDateTime } from "./time.js";

const REMINDER_LEAD_MS = 60 * 60 * 1000;

function buildReminderMessage(guildConfig, game) {
  const mention = guildConfig.roleId ? `<@&${guildConfig.roleId}> ` : "";
  const prefix = guildConfig.customMessage
    ? `${guildConfig.customMessage}\n`
    : "Set your lineups now.\n";

  return [
    `${mention}${prefix}`,
    "ESPN daily lock window starts in one hour.",
    "Add/drops lock at the first scheduled MLB game of the day, and lineup slots begin locking then or at each player's scheduled game time depending on your ESPN lineup setting.",
    `First scheduled game: **${game.awayTeam} at ${game.homeTeam}**`,
    `Game time: **${formatDateTime(game.startTime, guildConfig.timezone)}**`
  ].join("\n");
}

export async function checkForReminders(client, logger = console) {
  const guildConfigs = await getGuildConfigs();
  const now = new Date();

  for (const [guildId, guildConfig] of Object.entries(guildConfigs)) {
    if (!guildConfig.enabled || !guildConfig.channelId) {
      continue;
    }

    try {
      const game = await getEspnDailyLockGame(now, guildConfig.timezone);
      if (!game) {
        continue;
      }

      const reminderTime = game.startTime.getTime() - REMINDER_LEAD_MS;
      const withinWindow =
        now.getTime() >= reminderTime &&
        now.getTime() < reminderTime + 10 * 60 * 1000;
      const gameKey = `${game.id}:${guildConfig.timezone}`;

      if (!withinWindow || (await wasReminderSent(guildId, gameKey))) {
        continue;
      }

      const channel = await client.channels.fetch(guildConfig.channelId);
      if (!channel?.isTextBased()) {
        logger.warn(`Skipping guild ${guildId}: configured channel is unavailable.`);
        continue;
      }

      await channel.send(buildReminderMessage(guildConfig, game));
      await markReminderSent(guildId, gameKey);
    } catch (error) {
      logger.error(`Reminder check failed for guild ${guildId}:`, error);
    }
  }
}

export function startReminderLoop(client, intervalMs) {
  checkForReminders(client).catch((error) => {
    console.error("Initial reminder check failed:", error);
  });

  return setInterval(() => {
    checkForReminders(client).catch((error) => {
      console.error("Scheduled reminder check failed:", error);
    });
  }, intervalMs);
}
