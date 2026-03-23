import {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  userMention
} from "discord.js";
import { config as appConfig } from "./config.js";
import { getDatabaseHealth } from "./database.js";
import { getGuildConfig, getReporterState, saveGuildConfig, saveReporterState } from "./storage.js";
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
    podcastChannelId: appConfig.podcastChannelId,
    podcastManualContext: "",
    podcastHostNames: {
      lead: "Mason",
      hotTake: "Rico",
      analyst: "Elena"
    },
    espnDiscordLinks: {}
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
    .addIntegerOption((option) =>
      option
        .setName("inquiry_id")
        .setDescription("The inquiry number.")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("response")
        .setDescription("Your response for the reporter.")
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("reporter-status")
    .setDescription("Show recent reporter inquiries and responses."),
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
    inquiries: []
  };
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
        `Podcast channel: ${guildConfig.podcastChannelId ? `<#${guildConfig.podcastChannelId}>` : "not set"}`,
        `Podcast manual context: ${guildConfig.podcastManualContext?.trim() ? "set" : "none"}`,
        `Podcast hosts: lead=${guildConfig.podcastHostNames?.lead || "Mason"}, hotTake=${guildConfig.podcastHostNames?.hotTake || "Rico"}, analyst=${guildConfig.podcastHostNames?.analyst || "Elena"}`,
        `ESPN links: ${Object.keys(getCurrentEspnLinks(guildConfig)).length}`,
        `Reporter inquiries: ${guildReporterState.inquiries.length}`
      ].join("\n"),
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
      respondedByUserId: null
    };

    reporterState[guildId] = {
      nextInquiryId: guildReporterState.nextInquiryId + 1,
      inquiries: [inquiry, ...guildReporterState.inquiries].slice(0, 50)
    };
    await saveReporterState(reporterState);

    await interaction.reply({
      content: [
        `Request for comment #${inquiry.id} opened for ${matchedTeam.name} (${matchedTeam.manager}).`,
        `${userMention(link.discordUserId)} reporter request: ${inquiry.prompt}`,
        `Reply with \`/reporter-respond inquiry_id:${inquiry.id} response:...\``,
        `This quote will feed: ${features.join(", ")}`
      ].join("\n"),
      allowedMentions: { users: [link.discordUserId] }
    });
    return;
  }

  if (interaction.commandName === "reporter-respond") {
    const inquiryId = interaction.options.getInteger("inquiry_id", true);
    const response = interaction.options.getString("response", true).trim();
    const reporterState = await getReporterState();
    const guildReporterState = getReporterStateForGuild(reporterState, guildId);
    const inquiry = guildReporterState.inquiries.find((item) => item.id === inquiryId);

    if (!inquiry) {
      await interaction.reply({
        content: `I couldn't find reporter inquiry #${inquiryId}.`,
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

  if (interaction.commandName === "fantasy-test") {
    await interaction.deferReply({ ephemeral: true });
    try {
      const testType = interaction.options.getString("type", true);
      const result = await handleFantasyTest(testType, guildId, interaction.client);
      await interaction.editReply({
        content: result
      });
    } catch (error) {
      await interaction.editReply({
        content: `Fantasy test failed: ${error.message || "Unknown error"}`
      });
    }
    return;
  }
}
