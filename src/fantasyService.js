import {
  getGuildConfig,
  getGuildConfigs,
  getFantasyState,
  getMediaRegistry,
  saveFantasyState,
  saveMediaRegistry
} from "./storage.js";
import { getLeagueSnapshot, testEspnConnection } from "./espnApi.js";
import {
  buildDemoPodcastPackage,
  buildDemoPowerRankings,
  buildDemoSocialPost,
  buildDemoTransactionGrades,
  buildDemoTransactionsSummary,
  buildPodcastPackage,
  buildPowerRankings,
  buildRegistryUpdate,
  buildSocialPost,
  buildTransactionGrades,
  buildTransactionsSummary
} from "./fantasyContent.js";
import { config } from "./config.js";
import { getMockLeagueSnapshot } from "./mockLeague.js";
import { getDateInTimezone } from "./time.js";

function getFeatureChannelId(guildConfig, feature) {
  const map = {
    transactions: guildConfig.transactionsChannelId,
    power: guildConfig.powerRankingsChannelId,
    social: guildConfig.socialChannelId,
    podcast: guildConfig.podcastChannelId
  };

  return map[feature] || null;
}

async function sendTestContentToFeatureChannel(client, guildConfig, feature, content) {
  const channelId = getFeatureChannelId(guildConfig, feature);
  if (!channelId) {
    throw new Error(`${feature} channel is not configured.`);
  }

  const channel = await client.channels.fetch(channelId);
  if (!channel?.isTextBased()) {
    throw new Error(`${feature} channel is not available.`);
  }

  await channel.send(content);
}

function isTimeToRun(now, timezone, feature) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).formatToParts(now);

  const data = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const hour = Number.parseInt(data.hour, 10);
  const minute = Number.parseInt(data.minute, 10);
  const weekday = data.weekday;

  if (feature === "transactions") {
    return hour === 9 && minute < 10;
  }

  if (feature === "social") {
    return hour === 13 && minute < 10;
  }

  if (feature === "power") {
    return weekday === "Tue" && hour === 9 && minute < 10;
  }

  if (feature === "podcast") {
    return weekday === "Tue" && hour === 10 && minute < 10;
  }

  return false;
}

function getStateKey(feature, timezone, now) {
  return `${feature}:${timezone}:${getDateInTimezone(now, timezone)}`;
}

function formatRegistryForPrompt(registry) {
  if (!registry) {
    return "";
  }

  return [
    registry.runningJokes ? `Running jokes:\n${registry.runningJokes}` : "",
    registry.hostBiases ? `Host biases:\n${registry.hostBiases}` : "",
    registry.leagueStorylines ? `League storylines:\n${registry.leagueStorylines}` : ""
  ].filter(Boolean).join("\n\n");
}

function parseRegistrySections(text) {
  const sections = {
    runningJokes: "",
    hostBiases: "",
    leagueStorylines: ""
  };

  const runningMatch = text.match(/Running jokes:\s*([\s\S]*?)(?:Host biases:|League storylines:|$)/i);
  const biasMatch = text.match(/Host biases:\s*([\s\S]*?)(?:League storylines:|$)/i);
  const storyMatch = text.match(/League storylines:\s*([\s\S]*)$/i);

  sections.runningJokes = runningMatch?.[1]?.trim() || "";
  sections.hostBiases = biasMatch?.[1]?.trim() || "";
  sections.leagueStorylines = storyMatch?.[1]?.trim() || "";
  return sections;
}

async function maybeSendInstantTransactionGrades(client, guildId, guildConfig, snapshot, state, registry) {
  const transactionsChannelId = guildConfig.transactionsChannelId;
  if (!transactionsChannelId || snapshot.transactions.length === 0) {
    return state;
  }

  const latestTransactionId = String(snapshot.transactions[0].id);
  if (state.lastGradedTransactionId === latestTransactionId) {
    return state;
  }

  const channel = await client.channels.fetch(transactionsChannelId);
  if (!channel?.isTextBased()) {
    return state;
  }

  const grades = await buildTransactionGrades(
    snapshot,
    guildConfig.timezone,
    formatRegistryForPrompt(registry)
  );
  await channel.send(grades);

  return {
    ...state,
    lastGradedTransactionId: latestTransactionId
  };
}

async function sendFeatureMessage(client, guildId, guildConfig, feature, snapshot, state, registry) {
  const channelId = getFeatureChannelId(guildConfig, feature);
  if (!channelId) {
    return state;
  }

  const channel = await client.channels.fetch(channelId);
  if (!channel?.isTextBased()) {
    return state;
  }

  if (feature === "transactions") {
    const content = await buildTransactionsSummary(snapshot, guildConfig.timezone);
    await channel.send(content);
    return state;
  }

  if (feature === "power") {
    const content = await buildPowerRankings(snapshot, guildConfig.timezone);
    await channel.send(content);
    return state;
  }

  if (feature === "social") {
    const content = await buildSocialPost(snapshot, guildConfig.timezone);
    await channel.send(content);
    return state;
  }

  if (feature === "podcast") {
    const previousMemory = [
      state.podcastMemoryHistory?.slice(-4).join("\n\n") || "",
      formatRegistryForPrompt(registry)
    ].filter(Boolean).join("\n\n");
    const renderer =
      config.featureRealtimePodcast && config.podcastRenderer === "realtime"
        ? "realtime"
        : "tts";
    const podcast = await buildPodcastPackage(
      snapshot,
      previousMemory,
      guildConfig.timezone,
      renderer
    );
    await channel.send({
      content: [
        "Weekly fantasy podcast is live.",
        `AI-generated voices and script based on league results and transaction activity. Renderer: ${renderer}.`,
        "",
        podcast.summary
      ].join("\n"),
      files: [podcast.audioAttachment, podcast.transcriptAttachment]
    });

    return {
      ...state,
      podcastHistory: [...(state.podcastHistory || []), podcast.summary].slice(-6),
      podcastMemoryHistory: [...(state.podcastMemoryHistory || []), podcast.memory].slice(-8)
    };
  }

  return state;
}

export async function runFantasyJobs(client, logger = console) {
  const guildConfigs = await getGuildConfigs();
  const now = new Date();
  const snapshot = await getLeagueSnapshot();
  const fantasyState = await getFantasyState();
  const mediaRegistry = await getMediaRegistry();
  const nextState = { ...fantasyState };
  const nextRegistry = { ...mediaRegistry };

  for (const [guildId, guildConfig] of Object.entries(guildConfigs)) {
    const timezone = guildConfig.timezone || "America/Los_Angeles";
    nextState[guildId] = nextState[guildId] || {};
    nextRegistry[guildId] = nextRegistry[guildId] || {
      runningJokes: "",
      hostBiases: "",
      leagueStorylines: ""
    };

    try {
      nextState[guildId] = await maybeSendInstantTransactionGrades(
        client,
        guildId,
        guildConfig,
        snapshot,
        nextState[guildId],
        nextRegistry[guildId]
      );

      const updatedRegistryText = await buildRegistryUpdate(
        snapshot,
        formatRegistryForPrompt(nextRegistry[guildId])
      );
      nextRegistry[guildId] = parseRegistrySections(updatedRegistryText);
    } catch (error) {
      logger.error(`Fantasy registry/transaction grade update failed for guild ${guildId}:`, error);
    }

    for (const feature of ["transactions", "power", "social", "podcast"]) {
      const runKey = getStateKey(feature, timezone, now);
      if (!isTimeToRun(now, timezone, feature)) {
        continue;
      }

      if (nextState[guildId][runKey]) {
        continue;
      }

      try {
        const updatedState = await sendFeatureMessage(
          client,
          guildId,
          guildConfig,
          feature,
          snapshot,
          nextState[guildId],
          nextRegistry[guildId]
        );
        nextState[guildId] = {
          ...updatedState,
          [runKey]: new Date().toISOString()
        };
      } catch (error) {
        logger.error(`Fantasy job failed for ${feature} in guild ${guildId}:`, error);
      }
    }
  }

  await saveFantasyState(nextState);
  await saveMediaRegistry(nextRegistry);
}

export function startFantasyLoop(client, intervalMs) {
  runFantasyJobs(client).catch((error) => {
    console.error("Initial fantasy job check failed:", error);
  });

  return setInterval(() => {
    runFantasyJobs(client).catch((error) => {
      console.error("Scheduled fantasy job check failed:", error);
    });
  }, intervalMs);
}

export async function handleFantasyTest(testType, guildId, client) {
  if (testType === "espn") {
    const result = await testEspnConnection();
    return [
      `Connected to ESPN ${result.sport} league \`${result.leagueId}\` for season \`${result.seasonId}\`.`,
      `Teams found: ${result.teamCount}`,
      `Current scoring period: ${result.currentScoringPeriod}`,
      "",
      ...(result.recentTransactions.length > 0
        ? [
            "Recent transactions:",
            ...result.recentTransactions.map(
              (transaction) => `- ${transaction.teamName}: ${transaction.type}`
            )
          ]
        : ["No recent transactions were returned yet. That can be normal before the draft or before league activity starts."])
    ].join("\n");
  }

  const snapshot = testType.startsWith("demo-")
    ? getMockLeagueSnapshot()
    : await getLeagueSnapshot();
  const guildConfig = await getGuildConfig(guildId);
  const timezone = guildConfig?.timezone || "America/Los_Angeles";
  const normalizedType = testType
    .replace("demo-", "")
    .replace("-realtime", "")
    .replace("-tts", "");

  if (normalizedType === "transactions") {
    const content = testType.startsWith("demo-")
      ? buildDemoTransactionsSummary(snapshot, timezone)
      : await buildTransactionsSummary(snapshot, timezone);
    if (testType.startsWith("demo-")) {
      await sendTestContentToFeatureChannel(client, guildConfig, "transactions", content);
      return "Demo transaction recap posted.";
    }

    return content;
  }

  if (normalizedType === "transaction-grades") {
    const content = testType.startsWith("demo-")
      ? buildDemoTransactionGrades(snapshot, timezone)
      : await buildTransactionGrades(snapshot, timezone);
    if (testType.startsWith("demo-")) {
      await sendTestContentToFeatureChannel(client, guildConfig, "transactions", content);
      return "Demo transaction grades posted.";
    }

    return content;
  }

  if (normalizedType === "power") {
    const content = testType.startsWith("demo-")
      ? buildDemoPowerRankings(snapshot, timezone)
      : await buildPowerRankings(snapshot, timezone);
    if (testType.startsWith("demo-")) {
      await sendTestContentToFeatureChannel(client, guildConfig, "power", content);
      return "Demo power rankings posted.";
    }

    return content;
  }

  if (normalizedType === "social") {
    const content = testType.startsWith("demo-")
      ? buildDemoSocialPost(snapshot, timezone)
      : await buildSocialPost(snapshot, timezone);
    if (testType.startsWith("demo-")) {
      await sendTestContentToFeatureChannel(client, guildConfig, "social", content);
      return "Demo social post sent.";
    }

    return content;
  }

  if (normalizedType === "podcast") {
    const renderer = testType.endsWith("-realtime")
      ? "realtime"
      : testType.endsWith("-tts")
        ? "tts"
        : config.featureRealtimePodcast && config.podcastRenderer === "realtime"
          ? "realtime"
          : "tts";
    const podcast = testType.startsWith("demo-")
      ? await buildDemoPodcastPackage(snapshot, timezone, renderer)
      : await buildPodcastPackage(snapshot, "", timezone, renderer);
    const channelId = guildConfig?.podcastChannelId;
    if (!channelId) {
      throw new Error("Podcast channel is not configured.");
    }

    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased()) {
      throw new Error("Podcast channel is not available.");
    }

    await channel.send({
      content: [
        testType.startsWith("demo-") ? "Demo podcast test episode." : "Manual podcast test episode.",
        `AI-generated voices and script. Renderer: ${renderer}.`,
        "",
        podcast.summary
      ].join("\n"),
      files: [podcast.audioAttachment, podcast.transcriptAttachment]
    });

    return "Podcast test episode posted.";
  }

  throw new Error(`Unknown fantasy test type: ${testType}`);
}
