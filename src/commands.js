import {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  userMention
} from "discord.js";
import { config as appConfig } from "./config.js";
import { getDatabaseHealth } from "./database.js";
import { getGuildConfig, getInsiderTipState, getMailbagState, getReporterState, saveGuildConfig, saveInsiderTipState, saveMailbagState, saveReporterState } from "./storage.js";
import { getLeagueSnapshot } from "./espnApi.js";
import { handleFantasyTest } from "./fantasyService.js";

function getDefaultGuildConfig() {
  return {
    enabled: true,
    timezone: appConfig.defaultTimezone,
    channelId: null,
    roleId: null,
    customMessage: null,
    transactionsChannelId: appConfig.transactionsChannelId,
    powerRankingsChannelId: appConfig.powerRankingsChannelId,
    socialChannelId: appConfig.socialChannelId,
    reporterChannelId: null,
    podcastChannelId: appConfig.podcastChannelId,
    fantasyTrollEnabled: false,
    podcastManualContext: "",
    rivalries: [],
    podcastHostNames: {
      lead: "Mason",
      hotTake: "Rico",
      analyst: "Elena"
    },
    espnDiscordLinks: {},
    highlightSubscriptions: {}
  };
}

async function loadOrCreateGuildConfig(guildId) {
  return (await getGuildConfig(guildId)) || getDefaultGuildConfig();
}

export const commandDefinitions = [
  new SlashCommandBuilder()
    .setName("reminder-channel")
    .setDescription("Choose which channel gets lineup reminders.")
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription("The text channel for reminder messages.")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName("reminder-role")
    .setDescription("Choose which role to mention in lineup reminders.")
    .addRoleOption((option) =>
      option
        .setName("role")
        .setDescription("The role to mention. Omit to clear it.")
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName("reminder-toggle")
    .setDescription("Enable or disable lineup reminders for this server.")
    .addBooleanOption((option) =>
      option
        .setName("enabled")
        .setDescription("Turn reminders on or off.")
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName("reminder-timezone")
    .setDescription("Set the timezone used when formatting reminder times.")
    .addStringOption((option) =>
      option
        .setName("timezone")
        .setDescription("An IANA timezone like America/Los_Angeles.")
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName("reminder-message")
    .setDescription("Set a custom reminder message prefix.")
    .addStringOption((option) =>
      option
        .setName("text")
        .setDescription("Custom text. Omit to clear it.")
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName("reminder-status")
    .setDescription("Show the current lineup reminder configuration."),
  new SlashCommandBuilder()
    .setName("fantasy-channel")
    .setDescription("Set which channel is used for each fantasy feature.")
    .addStringOption((option) =>
      option
        .setName("feature")
        .setDescription("Which feature you want to configure.")
        .setRequired(true)
        .addChoices(
          { name: "transactions", value: "transactions" },
          { name: "power", value: "power" },
          { name: "social", value: "social" },
          { name: "reporter", value: "reporter" },
          { name: "podcast", value: "podcast" }
        )
    )
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription("The text channel for this feature.")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName("fantasy-status")
    .setDescription("Show the current ESPN and fantasy content channel setup."),
  new SlashCommandBuilder()
    .setName("bot-help")
    .setDescription("Show the full command dictionary for the fantasy bot."),
  new SlashCommandBuilder()
    .setName("participant-help")
    .setDescription("Show the easiest user-facing commands for league participation."),
  new SlashCommandBuilder()
    .setName("highlights-opt-in")
    .setDescription("Opt in or out of MLB highlight notifications for your active ESPN roster.")
    .addBooleanOption((option) =>
      option
        .setName("enabled")
        .setDescription("Turn highlight notifications on or off for yourself.")
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("highlights-status")
    .setDescription("Show your current MLB highlight notification setup."),
  new SlashCommandBuilder()
    .setName("troll-toggle")
    .setDescription("Enable or disable the Fantasy Troll in the social channel.")
    .addBooleanOption((option) =>
      option
        .setName("enabled")
        .setDescription("Turn the Fantasy Troll on or off.")
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName("podcast-context")
    .setDescription("Add or manage extra context the podcast hosts can reference.")
    .addStringOption((option) =>
      option
        .setName("action")
        .setDescription("How to update the saved podcast context.")
        .setRequired(true)
        .addChoices(
          { name: "add", value: "add" },
          { name: "replace", value: "replace" },
          { name: "show", value: "show" },
          { name: "clear", value: "clear" }
        )
    )
    .addStringOption((option) =>
      option
        .setName("text")
        .setDescription("Context to store for future podcast episodes.")
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName("podcast-host")
    .setDescription("Set or inspect the podcast host names.")
    .addStringOption((option) =>
      option
        .setName("action")
        .setDescription("What you want to do.")
        .setRequired(true)
        .addChoices(
          { name: "set", value: "set" },
          { name: "show", value: "show" },
          { name: "reset", value: "reset" }
        )
    )
    .addStringOption((option) =>
      option
        .setName("role")
        .setDescription("Which host role you want to rename.")
        .setRequired(false)
        .addChoices(
          { name: "lead", value: "lead" },
          { name: "hotTake", value: "hotTake" },
          { name: "analyst", value: "analyst" }
        )
    )
    .addStringOption((option) =>
      option
        .setName("name")
        .setDescription("The new host name.")
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName("espn-link")
    .setDescription("Link an ESPN manager or team to a Discord user.")
    .addStringOption((option) =>
      option
        .setName("action")
        .setDescription("What you want to do.")
        .setRequired(true)
        .addChoices(
          { name: "set", value: "set" },
          { name: "show", value: "show" },
          { name: "clear", value: "clear" },
          { name: "list-teams", value: "list-teams" }
        )
    )
    .addStringOption((option) =>
      option
        .setName("espn")
        .setDescription("ESPN team id, team name, or manager name.")
        .setRequired(false)
    )
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("The Discord user to link.")
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName("rivalry")
    .setDescription("Set or inspect manual rivalry pairings for the league.")
    .addStringOption((option) =>
      option
        .setName("action")
        .setDescription("What you want to do.")
        .setRequired(true)
        .addChoices(
          { name: "set", value: "set" },
          { name: "show", value: "show" },
          { name: "clear", value: "clear" }
        )
    )
    .addStringOption((option) =>
      option
        .setName("team_a")
        .setDescription("First ESPN team id, name, or manager.")
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName("team_b")
        .setDescription("Second ESPN team id, name, or manager.")
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName("reporter-ask")
    .setDescription("Open a request for comment for a linked manager.")
    .addStringOption((option) =>
      option
        .setName("espn")
        .setDescription("ESPN team id, team name, or manager name.")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("feature")
        .setDescription("Where this quote should be used.")
        .setRequired(true)
        .addChoices(
          { name: "social", value: "social" },
          { name: "podcast", value: "podcast" },
          { name: "both", value: "both" }
        )
    )
    .addStringOption((option) =>
      option
        .setName("question")
        .setDescription("The request for comment.")
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName("reporter-respond")
    .setDescription("Respond to an open request for comment.")
    .addStringOption((option) =>
      option
        .setName("response")
        .setDescription("Your response for the reporter.")
        .setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName("inquiry_id")
        .setDescription("The inquiry number.")
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName("reporter-status")
    .setDescription("Show recent reporter inquiries and responses."),
  new SlashCommandBuilder()
    .setName("mailbag-submit")
    .setDescription("Submit a question or take for the next fantasy podcast mailbag.")
    .addStringOption((option) =>
      option
        .setName("question")
        .setDescription("Your mailbag question or take.")
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("insider-tip")
    .setDescription("Submit or manage a leak for the league insider social feed.")
    .addStringOption((option) =>
      option
        .setName("action")
        .setDescription("What you want to do.")
        .setRequired(true)
        .addChoices(
          { name: "submit", value: "submit" },
          { name: "show", value: "show" },
          { name: "clear-used", value: "clear-used" },
          { name: "clear-all", value: "clear-all" }
        )
    )
    .addStringOption((option) =>
      option
        .setName("text")
        .setDescription("The tip, rumor, or leak for Backyard Sources.")
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName("mailbag-status")
    .setDescription("Show recent podcast mailbag questions.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName("mailbag-clear")
    .setDescription("Clear used or all podcast mailbag questions.")
    .addStringOption((option) =>
      option
        .setName("scope")
        .setDescription("Which questions to clear.")
        .setRequired(true)
        .addChoices(
          { name: "used", value: "used" },
          { name: "all", value: "all" }
        )
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName("fantasy-test")
    .setDescription("Run a live test against ESPN or generate a sample content post.")
    .addStringOption((option) =>
      option
        .setName("type")
        .setDescription("What to test.")
        .setRequired(true)
        .addChoices(
          { name: "espn", value: "espn" },
          { name: "transactions", value: "transactions" },
          { name: "transaction-grades", value: "transaction-grades" },
          { name: "power", value: "power" },
          { name: "social", value: "social" },
          { name: "podcast", value: "podcast" },
          { name: "demo-transactions", value: "demo-transactions" },
          { name: "demo-transaction-grades", value: "demo-transaction-grades" },
          { name: "demo-power", value: "demo-power" },
          { name: "demo-social", value: "demo-social" },
          { name: "demo-podcast", value: "demo-podcast" },
          { name: "demo-podcast-tts", value: "demo-podcast-tts" },
          { name: "demo-podcast-realtime", value: "demo-podcast-realtime" }
        )
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
];

function isValidTimezone(timezone) {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

function getCurrentHostNames(guildConfig) {
  return {
    lead: guildConfig.podcastHostNames?.lead || "Mason",
    hotTake: guildConfig.podcastHostNames?.hotTake || "Rico",
    analyst: guildConfig.podcastHostNames?.analyst || "Elena"
  };
}

function getCurrentEspnLinks(guildConfig) {
  return guildConfig.espnDiscordLinks || {};
}

function getCurrentHighlightSubscriptions(guildConfig) {
  return guildConfig.highlightSubscriptions || {};
}

function normalizeEspnLookup(value) {
  return value?.trim().toLowerCase() || "";
}

function findEspnTeam(snapshot, query) {
  const normalizedQuery = normalizeEspnLookup(query);
  if (!normalizedQuery) {
    return null;
  }

  return snapshot.teams.find((team) => {
    return [
      String(team.id),
      team.name,
      team.manager,
      team.abbrev
    ].some((candidate) => normalizeEspnLookup(candidate) === normalizedQuery);
  }) || null;
}

function getReporterStateForGuild(reporterState, guildId) {
  return reporterState[guildId] || {
    nextInquiryId: 1,
    inquiries: [],
    triggerKeys: {}
  };
}

function getMailbagStateForGuild(mailbagState, guildId) {
  return mailbagState[guildId] || {
    nextQuestionId: 1,
    questions: []
  };
}

function getInsiderTipStateForGuild(insiderTipState, guildId) {
  return insiderTipState[guildId] || {
    nextTipId: 1,
    tips: []
  };
}

function getBotHelpText() {
  return [
    "**Fantasy Bot Command Dictionary**",
    "",
    "`/participant-help`",
    "Shows the short list of user-facing commands regular league members can use.",
    "",
    "`/mailbag-submit question:...`",
    "Submit a question or take for the podcast mailbag.",
    "",
    "`/highlights-opt-in enabled:true|false` and `/highlights-status`",
    "Lets a linked manager opt into MLB highlight notifications for players on their active roster.",
    "",
    "`/insider-tip action:submit text:...`",
    "Submit a leak, rumor, or anonymous note for Backyard Sources to potentially use in a social post.",
    "",
    "`/reporter-respond response:...`",
    "Reply to an open reporter request for comment. Add `inquiry_id` only if you have multiple open requests.",
    "",
    "`/fantasy-status`",
    "Shows the current setup, channel assignments, link counts, and open tip/mailbag totals.",
    "",
    "`/fantasy-test type:...`",
    "Runs manual live tests like `espn`, `transactions`, `social`, `power`, or `podcast`.",
    "",
    "`/fantasy-channel feature:... channel:#...`",
    "Sets which channel each feature posts into.",
    "",
    "`/espn-link action:list-teams|set|show|clear`",
    "Links ESPN teams/managers to Discord users so posts can reference the right people.",
    "",
    "`/rivalry action:set|show|clear`",
    "Manually manages rivalry pairings used by the reporter workflow.",
    "",
    "`/reporter-ask` and `/reporter-status`",
    "Lets admins manually request quotes and inspect existing reporter inquiries.",
    "",
    "`/podcast-context` and `/podcast-host`",
    "Adds producer notes and renames the podcast hosts.",
    "",
    "`/troll-toggle`",
    "Turns the Fantasy Troll on or off in the social channel.",
    "",
    "`/mailbag-status`, `/mailbag-clear`, `/insider-tip action:show|clear-used|clear-all`",
    "Review and clean up queued community inputs.",
    "",
    "`/reminder-channel`, `/reminder-role`, `/reminder-toggle`, `/reminder-timezone`, `/reminder-message`, `/reminder-status`",
    "Configure and inspect the pre-lock lineup reminder system."
  ].join("\n");
}

function getParticipantHelpText() {
  return [
    "**How To Participate**",
    "",
    "`/mailbag-submit question:...`",
    "Ask the hosts a question or submit a hot take for the next podcast.",
    "",
    "`/highlights-opt-in enabled:true`",
    "Opt into MLB highlight DMs for players on your active ESPN lineup once your team is linked.",
    "",
    "`/highlights-status`",
    "Checks whether your highlight notifications are on and which linked team they follow.",
    "",
    "`/insider-tip action:submit text:...`",
    "Send a rumor, leak, or anonymous note that Backyard Sources might use in the social feed.",
    "",
    "`/reporter-respond response:...`",
    "If the bot asks you for comment, answer here and your quote can show up in posts or the podcast.",
    "",
    "`/participant-help`",
    "Re-open this quick guide any time.",
    "",
    "If you want the full operator/admin list, use `/bot-help`."
  ].join("\n");
}

function getOpenReporterInquiriesForUser(guildReporterState, userId) {
  return guildReporterState.inquiries.filter(
    (inquiry) => inquiry.status === "open" && inquiry.discordUserId === userId
  );
}

function getReporterAnnouncementChannelId(guildConfig) {
  return (
    guildConfig.socialChannelId ||
    guildConfig.transactionsChannelId ||
    guildConfig.podcastChannelId ||
    null
  );
}

async function notifyReporterInquiry(client, guildConfig, inquiry) {
  const announcementChannelId = getReporterAnnouncementChannelId(guildConfig);
  if (announcementChannelId) {
    const channel = await client.channels.fetch(announcementChannelId).catch(() => null);
    if (channel?.isTextBased()) {
      await channel.send({
        content: [
          `Reporter request for comment for ${inquiry.teamName} (${inquiry.manager})`,
          `${userMention(inquiry.discordUserId)} ${inquiry.prompt}`,
          "Reply with `/reporter-respond response:...` if this is your only open request.",
          `If you have multiple open requests, use \`/reporter-respond inquiry_id:${inquiry.id} response:...\``
        ].join("\n"),
        allowedMentions: { users: [inquiry.discordUserId] }
      });
    }
  }

  const user = await client.users.fetch(inquiry.discordUserId).catch(() => null);
  if (user) {
    await user.send([
      `Reporter request for comment for ${inquiry.teamName}:`,
      inquiry.prompt,
      "",
      "Reply in the server with `/reporter-respond response:...` if this is your only open request.",
      `Or use \`/reporter-respond inquiry_id:${inquiry.id} response:...\` if you have multiple open requests.`
    ].join("\n")).catch(() => {});
  }
}

export async function handleCommand(interaction) {
  if (!interaction.inGuild()) {
    await interaction.reply({
      content: "This command can only be used inside a server.",
      ephemeral: true
    });
    return;
  }

  const guildId = interaction.guildId;
  const guildConfig = await loadOrCreateGuildConfig(guildId);

  if (interaction.commandName === "reminder-channel") {
    guildConfig.channelId = interaction.options.getChannel("channel", true).id;
    await saveGuildConfig(guildId, guildConfig);
    await interaction.reply({
      content: `Lineup reminders will be posted in <#${guildConfig.channelId}>.`,
      ephemeral: true
    });
    return;
  }

  if (interaction.commandName === "reminder-role") {
    const role = interaction.options.getRole("role");
    guildConfig.roleId = role?.id || null;
    await saveGuildConfig(guildId, guildConfig);
    await interaction.reply({
      content: role
        ? `Lineup reminders will mention <@&${role.id}>.`
        : "Role mentions cleared. Reminders will no longer ping a role.",
      ephemeral: true
    });
    return;
  }

  if (interaction.commandName === "reminder-toggle") {
    guildConfig.enabled = interaction.options.getBoolean("enabled", true);
    await saveGuildConfig(guildId, guildConfig);
    await interaction.reply({
      content: guildConfig.enabled
        ? "Lineup reminders are enabled."
        : "Lineup reminders are disabled.",
      ephemeral: true
    });
    return;
  }

  if (interaction.commandName === "reminder-timezone") {
    const timezone = interaction.options.getString("timezone", true);
    if (!isValidTimezone(timezone)) {
      await interaction.reply({
        content: "That timezone is not valid. Try a value like `America/Los_Angeles`.",
        ephemeral: true
      });
      return;
    }

    guildConfig.timezone = timezone;
    await saveGuildConfig(guildId, guildConfig);
    await interaction.reply({
      content: `Reminder times will now be shown in \`${timezone}\`.`,
      ephemeral: true
    });
    return;
  }

  if (interaction.commandName === "reminder-message") {
    const text = interaction.options.getString("text");
    guildConfig.customMessage = text || null;
    await saveGuildConfig(guildId, guildConfig);
    await interaction.reply({
      content: text
        ? "Custom reminder text updated."
        : "Custom reminder text cleared.",
      ephemeral: true
    });
    return;
  }

  if (interaction.commandName === "reminder-status") {
    await interaction.reply({
      content: [
        `Enabled: ${guildConfig.enabled ? "yes" : "no"}`,
        `Channel: ${guildConfig.channelId ? `<#${guildConfig.channelId}>` : "not set"}`,
        `Role mention: ${guildConfig.roleId ? `<@&${guildConfig.roleId}>` : "none"}`,
        `Timezone: \`${guildConfig.timezone}\``,
        `Custom message: ${guildConfig.customMessage || "none"}`
      ].join("\n"),
      ephemeral: true
    });
    return;
  }

  if (interaction.commandName === "fantasy-channel") {
    const feature = interaction.options.getString("feature", true);
    const channel = interaction.options.getChannel("channel", true);
    const keyMap = {
      transactions: "transactionsChannelId",
      power: "powerRankingsChannelId",
      social: "socialChannelId",
      reporter: "reporterChannelId",
      podcast: "podcastChannelId"
    };

    guildConfig[keyMap[feature]] = channel.id;
    await saveGuildConfig(guildId, guildConfig);
    await interaction.reply({
      content: `${feature} posts will go to <#${channel.id}>.`,
      ephemeral: true
    });
    return;
  }

  if (interaction.commandName === "fantasy-status") {
    let databaseLine = "Database: not configured";
    const reporterState = await getReporterState();
    const guildReporterState = getReporterStateForGuild(reporterState, guildId);
    const mailbagState = await getMailbagState();
    const guildMailbagState = getMailbagStateForGuild(mailbagState, guildId);
    const insiderTipState = await getInsiderTipState();
    const guildInsiderTipState = getInsiderTipStateForGuild(insiderTipState, guildId);

    try {
      const dbHealth = await getDatabaseHealth();
      if (dbHealth.configured && dbHealth.connected) {
        databaseLine = `Database: connected (app_state rows: ${dbHealth.appStateEntries}, podcast episodes: ${dbHealth.podcastEpisodes})`;
      } else if (dbHealth.configured) {
        databaseLine = "Database: configured, but connection failed";
      }
    } catch (error) {
      databaseLine = `Database: error (${error.message || "unknown"})`;
    }

    await interaction.reply({
      content: [
        `ESPN league ID configured: ${appConfig.espnLeagueId ? "yes" : "no"}`,
        `OpenAI key configured: ${appConfig.openAiApiKey ? "yes" : "no"}`,
        databaseLine,
        `Transactions channel: ${guildConfig.transactionsChannelId ? `<#${guildConfig.transactionsChannelId}>` : "not set"}`,
        `Power rankings channel: ${guildConfig.powerRankingsChannelId ? `<#${guildConfig.powerRankingsChannelId}>` : "not set"}`,
        `Social channel: ${guildConfig.socialChannelId ? `<#${guildConfig.socialChannelId}>` : "not set"}`,
        `Reporter channel: ${guildConfig.reporterChannelId ? `<#${guildConfig.reporterChannelId}>` : "not set"}`,
        `Podcast channel: ${guildConfig.podcastChannelId ? `<#${guildConfig.podcastChannelId}>` : "not set"}`,
        `Fantasy Troll: ${guildConfig.fantasyTrollEnabled ? "enabled" : "disabled"}`,
        `Podcast manual context: ${guildConfig.podcastManualContext?.trim() ? "set" : "none"}`,
        `Podcast hosts: lead=${guildConfig.podcastHostNames?.lead || "Mason"}, hotTake=${guildConfig.podcastHostNames?.hotTake || "Rico"}, analyst=${guildConfig.podcastHostNames?.analyst || "Elena"}`,
        `Manual rivalries: ${(guildConfig.rivalries || []).length}`,
        `ESPN links: ${Object.keys(getCurrentEspnLinks(guildConfig)).length}`,
        `Highlight subscribers: ${Object.values(getCurrentHighlightSubscriptions(guildConfig)).filter((entry) => entry?.enabled).length}`,
        `Reporter inquiries: ${guildReporterState.inquiries.length}`,
        `Insider tips: ${guildInsiderTipState.tips.filter((tip) => !tip.usedAt).length} open`,
        `Mailbag questions: ${guildMailbagState.questions.filter((question) => question.status === "open").length} open`
      ].join("\n"),
      ephemeral: true
    });
    return;
  }

  if (interaction.commandName === "bot-help") {
    await interaction.reply({
      content: getBotHelpText(),
      ephemeral: true
    });
    return;
  }

  if (interaction.commandName === "participant-help") {
    await interaction.reply({
      content: getParticipantHelpText(),
      ephemeral: true
    });
    return;
  }

  if (interaction.commandName === "highlights-opt-in") {
    const enabled = interaction.options.getBoolean("enabled", true);
    const linkedEntry = Object.values(getCurrentEspnLinks(guildConfig)).find(
      (link) => link.discordUserId === interaction.user.id
    );

    if (enabled && !linkedEntry) {
      await interaction.reply({
        content: "You need to be linked to an ESPN team first. Ask a server admin to use `/espn-link action:set` for your team, then try again.",
        ephemeral: true
      });
      return;
    }

    guildConfig.highlightSubscriptions = {
      ...getCurrentHighlightSubscriptions(guildConfig),
      [interaction.user.id]: enabled
        ? {
            enabled: true,
            linkedTeamId: linkedEntry?.teamId || null,
            updatedAt: new Date().toISOString()
          }
        : {
            enabled: false,
            linkedTeamId: linkedEntry?.teamId || null,
            updatedAt: new Date().toISOString()
          }
    };
    await saveGuildConfig(guildId, guildConfig);
    await interaction.reply({
      content: enabled
        ? `MLB highlight notifications are on. I’ll DM you when a player on ${linkedEntry.teamName} posts a new MLB highlight clip.`
        : "MLB highlight notifications are off for you.",
      ephemeral: true
    });
    return;
  }

  if (interaction.commandName === "highlights-status") {
    const subscription = getCurrentHighlightSubscriptions(guildConfig)[interaction.user.id];
    const linkedEntry = Object.values(getCurrentEspnLinks(guildConfig)).find(
      (link) => link.discordUserId === interaction.user.id
    );

    await interaction.reply({
      content: [
        `Linked ESPN team: ${linkedEntry ? `${linkedEntry.teamName} (${linkedEntry.manager})` : "not linked"}`,
        `Highlights opt-in: ${subscription?.enabled ? "enabled" : "disabled"}`,
        subscription?.updatedAt ? `Last updated: ${subscription.updatedAt}` : "Last updated: never"
      ].join("\n"),
      ephemeral: true
    });
    return;
  }

  if (interaction.commandName === "troll-toggle") {
    guildConfig.fantasyTrollEnabled = interaction.options.getBoolean("enabled", true);
    await saveGuildConfig(guildId, guildConfig);
    await interaction.reply({
      content: guildConfig.fantasyTrollEnabled
        ? "Fantasy Troll is enabled for the social channel."
        : "Fantasy Troll is disabled.",
      ephemeral: true
    });
    return;
  }

  if (interaction.commandName === "podcast-context") {
    const action = interaction.options.getString("action", true);
    const text = interaction.options.getString("text")?.trim() || "";
    const existing = guildConfig.podcastManualContext?.trim() || "";

    if ((action === "add" || action === "replace") && !text) {
      await interaction.reply({
        content: "Please include `text` when using `add` or `replace`.",
        ephemeral: true
      });
      return;
    }

    if (action === "show") {
      await interaction.reply({
        content: existing || "No manual podcast context is saved yet.",
        ephemeral: true
      });
      return;
    }

    if (action === "clear") {
      guildConfig.podcastManualContext = "";
      await saveGuildConfig(guildId, guildConfig);
      await interaction.reply({
        content: "Podcast manual context cleared.",
        ephemeral: true
      });
      return;
    }

    const nextText = action === "replace"
      ? text
      : [existing, text].filter(Boolean).join("\n\n");

    guildConfig.podcastManualContext = nextText.slice(0, 4000);
    await saveGuildConfig(guildId, guildConfig);
    await interaction.reply({
      content: action === "replace"
        ? "Podcast manual context replaced."
        : "Podcast manual context appended.",
      ephemeral: true
    });
    return;
  }

  if (interaction.commandName === "podcast-host") {
    const action = interaction.options.getString("action", true);
    const currentHostNames = getCurrentHostNames(guildConfig);

    if (action === "show") {
      await interaction.reply({
        content: [
          `Lead host: ${currentHostNames.lead}`,
          `Hot take host: ${currentHostNames.hotTake}`,
          `Analyst host: ${currentHostNames.analyst}`
        ].join("\n"),
        ephemeral: true
      });
      return;
    }

    if (action === "reset") {
      guildConfig.podcastHostNames = {
        lead: "Mason",
        hotTake: "Rico",
        analyst: "Elena"
      };
      await saveGuildConfig(guildId, guildConfig);
      await interaction.reply({
        content: "Podcast host names reset to Mason, Rico, and Elena.",
        ephemeral: true
      });
      return;
    }

    const role = interaction.options.getString("role");
    const name = interaction.options.getString("name")?.trim();
    if (!role || !name) {
      await interaction.reply({
        content: "Please include both `role` and `name` when using `set`.",
        ephemeral: true
      });
      return;
    }

    guildConfig.podcastHostNames = {
      ...currentHostNames,
      [role]: name.slice(0, 40)
    };
    await saveGuildConfig(guildId, guildConfig);
    await interaction.reply({
      content: `${role} host is now named ${guildConfig.podcastHostNames[role]}.`,
      ephemeral: true
    });
    return;
  }

  if (interaction.commandName === "espn-link") {
    const action = interaction.options.getString("action", true);

    if (action === "list-teams") {
      const snapshot = await getLeagueSnapshot();
      const lines = snapshot.teams.map(
        (team) => `- ${team.id}: ${team.name} (${team.manager})`
      );
      await interaction.reply({
        content: lines.length > 0 ? lines.join("\n") : "No ESPN teams found yet.",
        ephemeral: true
      });
      return;
    }

    if (action === "show") {
      const links = getCurrentEspnLinks(guildConfig);
      const entries = Object.values(links);
      await interaction.reply({
        content: entries.length > 0
          ? entries
              .map(
                (link) =>
                  `- ${link.teamName} (${link.manager}, team ${link.teamId}) -> ${userMention(link.discordUserId)}`
              )
              .join("\n")
          : "No ESPN-to-Discord links are saved yet.",
        ephemeral: true
      });
      return;
    }

    const espnQuery = interaction.options.getString("espn");
    if (!espnQuery) {
      await interaction.reply({
        content: "Please include `espn` with a team id, team name, or manager name.",
        ephemeral: true
      });
      return;
    }

    const snapshot = await getLeagueSnapshot();
    const matchedTeam = findEspnTeam(snapshot, espnQuery);
    if (!matchedTeam) {
      await interaction.reply({
        content: "I couldn't find that ESPN team or manager. Use `/espn-link action:list-teams` to see the valid options.",
        ephemeral: true
      });
      return;
    }

    if (action === "clear") {
      const links = { ...getCurrentEspnLinks(guildConfig) };
      delete links[String(matchedTeam.id)];
      guildConfig.espnDiscordLinks = links;
      await saveGuildConfig(guildId, guildConfig);
      await interaction.reply({
        content: `Removed the Discord link for ${matchedTeam.name} (${matchedTeam.manager}).`,
        ephemeral: true
      });
      return;
    }

    const user = interaction.options.getUser("user");
    if (!user) {
      await interaction.reply({
        content: "Please include `user` when using `set`.",
        ephemeral: true
      });
      return;
    }

    guildConfig.espnDiscordLinks = {
      ...getCurrentEspnLinks(guildConfig),
      [String(matchedTeam.id)]: {
        teamId: matchedTeam.id,
        teamName: matchedTeam.name,
        manager: matchedTeam.manager,
        discordUserId: user.id
      }
    };
    await saveGuildConfig(guildId, guildConfig);
    await interaction.reply({
      content: `Linked ${matchedTeam.name} (${matchedTeam.manager}) to ${userMention(user.id)}.`,
      ephemeral: true
    });
    return;
  }

  if (interaction.commandName === "rivalry") {
    const action = interaction.options.getString("action", true);
    const currentRivalries = guildConfig.rivalries || [];

    if (action === "show") {
      if (currentRivalries.length === 0) {
        await interaction.reply({
          content: "No manual rivalries are configured yet.",
          ephemeral: true
        });
        return;
      }

      await interaction.reply({
        content: currentRivalries
          .map((rivalry, index) => `#${index + 1} ${rivalry.teamAName} vs ${rivalry.teamBName}`)
          .join("\n"),
        ephemeral: true
      });
      return;
    }

    const teamAQuery = interaction.options.getString("team_a");
    const teamBQuery = interaction.options.getString("team_b");
    if (!teamAQuery || !teamBQuery) {
      await interaction.reply({
        content: "Please include both `team_a` and `team_b`.",
        ephemeral: true
      });
      return;
    }

    const snapshot = await getLeagueSnapshot();
    const teamA = findEspnTeam(snapshot, teamAQuery);
    const teamB = findEspnTeam(snapshot, teamBQuery);
    if (!teamA || !teamB) {
      await interaction.reply({
        content: "I couldn't find one of those ESPN teams or managers. Use `/espn-link action:list-teams` to see valid options.",
        ephemeral: true
      });
      return;
    }

    if (teamA.id === teamB.id) {
      await interaction.reply({
        content: "A rivalry needs two different teams.",
        ephemeral: true
      });
      return;
    }

    const rivalryKey = [teamA.id, teamB.id].sort((left, right) => left - right).join("-");

    if (action === "clear") {
      guildConfig.rivalries = currentRivalries.filter((rivalry) => rivalry.key !== rivalryKey);
      await saveGuildConfig(guildId, guildConfig);
      await interaction.reply({
        content: `Removed the rivalry pairing for ${teamA.name} and ${teamB.name}.`,
        ephemeral: true
      });
      return;
    }

    const nextRivalries = [
      ...currentRivalries.filter((rivalry) => rivalry.key !== rivalryKey),
      {
        key: rivalryKey,
        teamAId: teamA.id,
        teamAName: teamA.name,
        teamBId: teamB.id,
        teamBName: teamB.name
      }
    ];
    guildConfig.rivalries = nextRivalries;
    await saveGuildConfig(guildId, guildConfig);
    await interaction.reply({
      content: `Saved rivalry: ${teamA.name} vs ${teamB.name}.`,
      ephemeral: true
    });
    return;
  }

  if (interaction.commandName === "reporter-ask") {
    const snapshot = await getLeagueSnapshot();
    const espnQuery = interaction.options.getString("espn", true);
    const matchedTeam = findEspnTeam(snapshot, espnQuery);
    if (!matchedTeam) {
      await interaction.reply({
        content: "I couldn't find that ESPN team or manager. Use `/espn-link action:list-teams` first if needed.",
        ephemeral: true
      });
      return;
    }

    const links = getCurrentEspnLinks(guildConfig);
    const link = links[String(matchedTeam.id)];
    if (!link) {
      await interaction.reply({
        content: `No Discord user is linked to ${matchedTeam.name} (${matchedTeam.manager}) yet.`,
        ephemeral: true
      });
      return;
    }

    const reporterState = await getReporterState();
    const guildReporterState = getReporterStateForGuild(reporterState, guildId);
    const rawFeature = interaction.options.getString("feature", true);
    const features = rawFeature === "both" ? ["social", "podcast"] : [rawFeature];
    const inquiry = {
      id: guildReporterState.nextInquiryId,
      teamId: matchedTeam.id,
      teamName: matchedTeam.name,
      manager: matchedTeam.manager,
      discordUserId: link.discordUserId,
      prompt: interaction.options.getString("question", true),
      features,
      status: "open",
      askedAt: new Date().toISOString(),
      askedByUserId: interaction.user.id,
      response: "",
      respondedAt: null,
      respondedByUserId: null,
      quoteUsage: {}
    };

    reporterState[guildId] = {
      nextInquiryId: guildReporterState.nextInquiryId + 1,
      inquiries: [inquiry, ...guildReporterState.inquiries].slice(0, 50),
      triggerKeys: guildReporterState.triggerKeys || {}
    };
    await saveReporterState(reporterState);
    await notifyReporterInquiry(interaction.client, guildConfig, inquiry);

    await interaction.reply({
      content: [
        `Request for comment #${inquiry.id} opened for ${matchedTeam.name} (${matchedTeam.manager}).`,
        `${userMention(link.discordUserId)} reporter request: ${inquiry.prompt}`,
        `They can reply with \`/reporter-respond response:...\` if this is their only open request.`,
        `This quote will feed: ${features.join(", ")}`
      ].join("\n"),
      allowedMentions: { users: [link.discordUserId] }
    });
    return;
  }

  if (interaction.commandName === "reporter-respond") {
    const inquiryId = interaction.options.getInteger("inquiry_id");
    const response = interaction.options.getString("response", true).trim();
    const reporterState = await getReporterState();
    const guildReporterState = getReporterStateForGuild(reporterState, guildId);
    const openInquiries = getOpenReporterInquiriesForUser(guildReporterState, interaction.user.id);
    const inquiry = inquiryId
      ? guildReporterState.inquiries.find((item) => item.id === inquiryId)
      : openInquiries.length === 1
        ? openInquiries[0]
        : null;

    if (!inquiry) {
      await interaction.reply({
        content: inquiryId
          ? `I couldn't find reporter inquiry #${inquiryId}.`
          : openInquiries.length === 0
            ? "You do not have any open reporter requests."
            : `You have ${openInquiries.length} open requests. Please include \`inquiry_id\`.`,
        ephemeral: true
      });
      return;
    }

    if (inquiry.discordUserId !== interaction.user.id) {
      await interaction.reply({
        content: "You are not the linked manager for this request for comment.",
        ephemeral: true
      });
      return;
    }

    inquiry.status = "responded";
    inquiry.response = response.slice(0, 1000);
    inquiry.respondedAt = new Date().toISOString();
    inquiry.respondedByUserId = interaction.user.id;
    inquiry.quoteUsage = inquiry.quoteUsage || {};
    reporterState[guildId] = guildReporterState;
    await saveReporterState(reporterState);

    await interaction.reply({
      content: `Response saved for inquiry #${inquiry.id}. The reporter can now use it in social posts and the podcast.`,
      ephemeral: true
    });
    return;
  }

  if (interaction.commandName === "reporter-status") {
    const reporterState = await getReporterState();
    const guildReporterState = getReporterStateForGuild(reporterState, guildId);
    const lines = guildReporterState.inquiries.slice(0, 8).map((inquiry) => {
      return [
        `#${inquiry.id} ${inquiry.teamName} (${inquiry.manager})`,
        `Status: ${inquiry.status}`,
        `Features: ${inquiry.features.join(", ")}`,
        inquiry.status === "responded"
          ? `Quote usage: social ${inquiry.quoteUsage?.social ? "used" : "open"}, podcast ${inquiry.quoteUsage?.podcast ? "used" : "open"}`
          : "Quote usage: not available until a response is submitted",
        `Prompt: ${inquiry.prompt}`,
        inquiry.response ? `Response: ${inquiry.response}` : "Response: awaiting comment"
      ].join("\n");
    });

    await interaction.reply({
      content: lines.length > 0 ? lines.join("\n\n") : "No reporter inquiries yet.",
      ephemeral: true
    });
    return;
  }

  if (interaction.commandName === "mailbag-submit") {
    const question = interaction.options.getString("question", true).trim();
    const mailbagState = await getMailbagState();
    const guildMailbagState = getMailbagStateForGuild(mailbagState, guildId);
    const entry = {
      id: guildMailbagState.nextQuestionId,
      question: question.slice(0, 500),
      askedByUserId: interaction.user.id,
      askedByDisplayName:
        interaction.member?.displayName ||
        interaction.user.globalName ||
        interaction.user.username,
      askedAt: new Date().toISOString(),
      status: "open",
      usedAt: null
    };

    mailbagState[guildId] = {
      nextQuestionId: guildMailbagState.nextQuestionId + 1,
      questions: [entry, ...guildMailbagState.questions].slice(0, 100)
    };
    await saveMailbagState(mailbagState);
    await interaction.reply({
      content: `Mailbag question #${entry.id} submitted for the next podcast.`,
      ephemeral: true
    });
    return;
  }

  if (interaction.commandName === "insider-tip") {
    const action = interaction.options.getString("action", true);
    const insiderTipState = await getInsiderTipState();
    const guildInsiderTipState = getInsiderTipStateForGuild(insiderTipState, guildId);

    if (action === "show") {
      const lines = guildInsiderTipState.tips.slice(0, 10).map((tip) => {
        const status = tip.usedAt ? `used at ${tip.usedAt}` : "open";
        return `#${tip.id} [${status}] ${tip.submittedByDisplayName}: ${tip.text}`;
      });
      await interaction.reply({
        content: lines.length > 0 ? lines.join("\n") : "No insider tips yet.",
        ephemeral: true
      });
      return;
    }

    if (action === "clear-used" || action === "clear-all") {
      insiderTipState[guildId] = {
        ...guildInsiderTipState,
        tips: action === "clear-all"
          ? []
          : guildInsiderTipState.tips.filter((tip) => !tip.usedAt)
      };
      await saveInsiderTipState(insiderTipState);
      await interaction.reply({
        content: action === "clear-all" ? "All insider tips cleared." : "Used insider tips cleared.",
        ephemeral: true
      });
      return;
    }

    const text = interaction.options.getString("text")?.trim();
    if (!text) {
      await interaction.reply({
        content: "Please include `text` when submitting an insider tip.",
        ephemeral: true
      });
      return;
    }

    const tip = {
      id: guildInsiderTipState.nextTipId,
      text: text.slice(0, 500),
      submittedByUserId: interaction.user.id,
      submittedByDisplayName:
        interaction.member?.displayName ||
        interaction.user.globalName ||
        interaction.user.username,
      submittedAt: new Date().toISOString(),
      usedAt: null
    };
    insiderTipState[guildId] = {
      nextTipId: guildInsiderTipState.nextTipId + 1,
      tips: [tip, ...guildInsiderTipState.tips].slice(0, 50)
    };
    await saveInsiderTipState(insiderTipState);
    await interaction.reply({
      content: `Insider tip #${tip.id} saved for Backyard Sources.`,
      ephemeral: true
    });
    return;
  }

  if (interaction.commandName === "mailbag-status") {
    const mailbagState = await getMailbagState();
    const guildMailbagState = getMailbagStateForGuild(mailbagState, guildId);
    const lines = guildMailbagState.questions.slice(0, 8).map((question) => {
      return `#${question.id} [${question.status}] ${question.askedByDisplayName}: ${question.question}`;
    });

    await interaction.reply({
      content: lines.length > 0 ? lines.join("\n") : "No mailbag questions yet.",
      ephemeral: true
    });
    return;
  }

  if (interaction.commandName === "mailbag-clear") {
    const scope = interaction.options.getString("scope", true);
    const mailbagState = await getMailbagState();
    const guildMailbagState = getMailbagStateForGuild(mailbagState, guildId);
    mailbagState[guildId] = {
      nextQuestionId: guildMailbagState.nextQuestionId,
      questions:
        scope === "all"
          ? []
          : guildMailbagState.questions.filter((question) => question.status !== "used")
    };
    await saveMailbagState(mailbagState);
    await interaction.reply({
      content: scope === "all" ? "All mailbag questions cleared." : "Used mailbag questions cleared.",
      ephemeral: true
    });
    return;
  }

  if (interaction.commandName === "fantasy-test") {
    await interaction.deferReply({ ephemeral: true });
    try {
      const testType = interaction.options.getString("type", true);
      const result = await handleFantasyTest(testType, guildId, interaction.client);
      if (typeof result === "string") {
        await interaction.editReply({
          content: result
        });
      } else {
        await interaction.editReply(result);
      }
    } catch (error) {
      await interaction.editReply({
        content: `Fantasy test failed: ${error.message || "Unknown error"}`
      });
    }
    return;
  }
}
