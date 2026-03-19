import {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder
} from "discord.js";
import { config as appConfig } from "./config.js";
import { getGuildConfig, saveGuildConfig } from "./storage.js";
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
    podcastChannelId: appConfig.podcastChannelId
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
    await interaction.reply({
      content: [
        `ESPN league ID configured: ${appConfig.espnLeagueId ? "yes" : "no"}`,
        `OpenAI key configured: ${appConfig.openAiApiKey ? "yes" : "no"}`,
        `Transactions channel: ${guildConfig.transactionsChannelId ? `<#${guildConfig.transactionsChannelId}>` : "not set"}`,
        `Power rankings channel: ${guildConfig.powerRankingsChannelId ? `<#${guildConfig.powerRankingsChannelId}>` : "not set"}`,
        `Social channel: ${guildConfig.socialChannelId ? `<#${guildConfig.socialChannelId}>` : "not set"}`,
        `Podcast channel: ${guildConfig.podcastChannelId ? `<#${guildConfig.podcastChannelId}>` : "not set"}`
      ].join("\n"),
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
