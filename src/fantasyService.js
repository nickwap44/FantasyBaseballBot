import {
  getGuildConfig,
  getGuildConfigs,
  getFantasyState,
  getMediaRegistry,
  getReporterState,
  saveFantasyState,
  saveMediaRegistry,
  saveReporterState
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
  buildTransactionsSummary,
  formatReporterContext
} from "./fantasyContent.js";
import { config } from "./config.js";
import { savePodcastEpisode } from "./database.js";
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

function getLatestTransactionId(snapshot) {
  return snapshot.transactions?.length > 0 ? String(snapshot.transactions[0].id) : null;
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

function getCurrentEspnLinks(guildConfig) {
  return guildConfig.espnDiscordLinks || {};
}

async function getLinkedManagersContext(client, guildId, snapshot, guildConfig) {
  const links = getCurrentEspnLinks(guildConfig);
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  const lines = [];

  for (const team of snapshot.teams) {
    const link = links[String(team.id)];
    if (!link) {
      continue;
    }

    const member = guild
      ? await guild.members.fetch(link.discordUserId).catch(() => null)
      : null;
    const displayName = member?.displayName || member?.user?.globalName || member?.user?.username || "Unknown user";
    lines.push(
      `- ${team.name} managed by ${team.manager} is linked to Discord user ${displayName} with mention token <@${link.discordUserId}>`
    );
  }

  return lines.join("\n");
}

function getRelevantTeamIds(snapshot, feature) {
  if (feature === "transactions") {
    return snapshot.transactions.slice(0, 5).map((transaction) => transaction.teamId);
  }

  if (feature === "social") {
    return [
      ...snapshot.transactions.slice(0, 3).map((transaction) => transaction.teamId),
      ...snapshot.teams.slice(0, 3).map((team) => team.id)
    ];
  }

  if (feature === "podcast") {
    return [
      ...snapshot.transactions.slice(0, 4).map((transaction) => transaction.teamId),
      ...snapshot.matchups.flatMap((matchup) => [matchup.homeTeamId, matchup.awayTeamId]).slice(0, 6)
    ];
  }

  return [];
}

function buildMentionFooter(snapshot, guildConfig, feature) {
  const links = getCurrentEspnLinks(guildConfig);
  const teamsById = new Map(snapshot.teams.map((team) => [String(team.id), team]));
  const featured = [];

  for (const teamId of getRelevantTeamIds(snapshot, feature)) {
    const key = String(teamId);
    const link = links[key];
    const team = teamsById.get(key);
    if (!link || !team) {
      continue;
    }

    if (featured.some((entry) => entry.discordUserId === link.discordUserId)) {
      continue;
    }

    featured.push({
      discordUserId: link.discordUserId,
      teamName: team.name
    });
  }

  if (featured.length === 0) {
    return "";
  }

  return `Featured managers: ${featured
    .map((entry) => `<@${entry.discordUserId}> (${entry.teamName})`)
    .join(", ")}`;
}

function appendMentionFooter(content, footer) {
  if (!footer) {
    return content;
  }

  return [content.trim(), "", footer].filter(Boolean).join("\n");
}

function getReporterStateForGuild(reporterState, guildId) {
  return reporterState[guildId] || {
    nextInquiryId: 1,
    inquiries: [],
    triggerKeys: {}
  };
}

function getReporterQuotesForFeature(reporterState, guildId, feature) {
  const state = getReporterStateForGuild(reporterState, guildId);
  return state.inquiries
    .filter((inquiry) => inquiry.status === "responded")
    .filter((inquiry) => inquiry.features.includes(feature))
    .slice(-5)
    .map((inquiry) => ({
      teamName: inquiry.teamName,
      manager: inquiry.manager,
      prompt: inquiry.prompt,
      response: inquiry.response,
      features: inquiry.features
    }));
}

function markReporterTrigger(reporterState, guildId, triggerKey) {
  const state = getReporterStateForGuild(reporterState, guildId);
  reporterState[guildId] = {
    ...state,
    triggerKeys: {
      ...(state.triggerKeys || {}),
      [triggerKey]: new Date().toISOString()
    }
  };
}

function wasReporterTriggerHandled(reporterState, guildId, triggerKey) {
  const state = getReporterStateForGuild(reporterState, guildId);
  return Boolean(state.triggerKeys?.[triggerKey]);
}

function getReporterAnnouncementChannelId(guildConfig) {
  return (
    guildConfig.socialChannelId ||
    guildConfig.transactionsChannelId ||
    guildConfig.podcastChannelId ||
    null
  );
}

async function notifyReporterInquiry(client, guildId, guildConfig, inquiry, reasonLabel) {
  const announcementChannelId = getReporterAnnouncementChannelId(guildConfig);
  if (announcementChannelId) {
    const channel = await client.channels.fetch(announcementChannelId).catch(() => null);
    if (channel?.isTextBased()) {
      await channel.send({
        content: [
          `Reporter request for comment: ${reasonLabel}`,
          `${inquiry.teamName} (${inquiry.manager}) - ${inquiry.prompt}`,
          `${`<@${inquiry.discordUserId}>`} respond with \`/reporter-respond response:...\``,
          inquiry.features.length > 0 ? `This may appear in: ${inquiry.features.join(", ")}` : ""
        ].filter(Boolean).join("\n"),
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
      `Reply in the server with \`/reporter-respond response:...\``,
      inquiry.features.length > 0 ? `Your quote may appear in: ${inquiry.features.join(", ")}` : ""
    ].filter(Boolean).join("\n")).catch(() => {});
  }
}

async function createReporterInquiry(
  client,
  reporterState,
  guildId,
  guildConfig,
  inquiryInput,
  reasonLabel
) {
  const state = getReporterStateForGuild(reporterState, guildId);
  const inquiry = {
    id: state.nextInquiryId,
    status: "open",
    askedAt: new Date().toISOString(),
    askedByUserId: "bot",
    response: "",
    respondedAt: null,
    respondedByUserId: null,
    ...inquiryInput
  };

  reporterState[guildId] = {
    ...state,
    nextInquiryId: state.nextInquiryId + 1,
    inquiries: [inquiry, ...state.inquiries].slice(0, 75)
  };

  await notifyReporterInquiry(client, guildId, guildConfig, inquiry, reasonLabel);
  return inquiry;
}

async function maybeCreateAutomaticReporterInquiries(
  client,
  guildId,
  guildConfig,
  snapshot,
  reporterState,
  logger = console
) {
  const links = getCurrentEspnLinks(guildConfig);
  if (Object.keys(links).length === 0) {
    return;
  }

  for (const transaction of snapshot.transactions.slice(0, 5)) {
    const link = links[String(transaction.teamId)];
    if (!link) {
      continue;
    }

    if (transaction.type.includes("TRADE")) {
      const triggerKey = `trade:${transaction.id}`;
      if (!wasReporterTriggerHandled(reporterState, guildId, triggerKey)) {
        await createReporterInquiry(
          client,
          reporterState,
          guildId,
          guildConfig,
          {
            teamId: transaction.teamId,
            teamName: transaction.teamName,
            manager: snapshot.teams.find((team) => team.id === transaction.teamId)?.manager || "Unknown manager",
            discordUserId: link.discordUserId,
            prompt: `The league office flagged your trade as controversial. What's your defense of this move?`,
            features: ["transactions", "social", "podcast"]
          },
          "Controversial trade"
        );
        markReporterTrigger(reporterState, guildId, triggerKey);
      }
    }

    if (transaction.biddingAmount && transaction.biddingAmount >= 15) {
      const triggerKey = `waiver:${transaction.id}`;
      if (!wasReporterTriggerHandled(reporterState, guildId, triggerKey)) {
        await createReporterInquiry(
          client,
          reporterState,
          guildId,
          guildConfig,
          {
            teamId: transaction.teamId,
            teamName: transaction.teamName,
            manager: snapshot.teams.find((team) => team.id === transaction.teamId)?.manager || "Unknown manager",
            discordUserId: link.discordUserId,
            prompt: `You dropped $${transaction.biddingAmount} on this move. Tell the people why the bid was worth it.`,
            features: ["transactions", "social", "podcast"]
          },
          "Big waiver bid"
        );
        markReporterTrigger(reporterState, guildId, triggerKey);
      }
    }
  }

  const rankedTeams = [...snapshot.teams].sort((a, b) => {
    if (b.wins !== a.wins) {
      return b.wins - a.wins;
    }

    return b.pointsFor - a.pointsFor;
  });

  const rivalryMatchup = snapshot.matchups
    .filter((matchup) => matchup.homeTeamId && matchup.awayTeamId)
    .map((matchup) => {
      const homeIndex = rankedTeams.findIndex((team) => team.id === matchup.homeTeamId);
      const awayIndex = rankedTeams.findIndex((team) => team.id === matchup.awayTeamId);
      return {
        ...matchup,
        rivalryScore: (homeIndex + 1) + (awayIndex + 1)
      };
    })
    .sort((a, b) => a.rivalryScore - b.rivalryScore)[0];

  if (rivalryMatchup) {
    const sortedIds = [rivalryMatchup.homeTeamId, rivalryMatchup.awayTeamId].sort((a, b) => a - b);
    const triggerKey = `rivalry:${snapshot.currentScoringPeriod}:${sortedIds.join("-")}`;
    if (!wasReporterTriggerHandled(reporterState, guildId, triggerKey)) {
      for (const teamId of sortedIds) {
        const link = links[String(teamId)];
        const team = snapshot.teams.find((entry) => entry.id === teamId);
        if (!link || !team) {
          continue;
        }

        const opponentId = sortedIds.find((id) => id !== teamId);
        const opponent = snapshot.teams.find((entry) => entry.id === opponentId);
        await createReporterInquiry(
          client,
          reporterState,
          guildId,
          guildConfig,
          {
            teamId,
            teamName: team.name,
            manager: team.manager,
            discordUserId: link.discordUserId,
            prompt: `Rivalry week is heating up against ${opponent?.name || "your opponent"}. What's your message before the matchup swings?`,
            features: ["social", "podcast"]
          },
          "Rivalry week spotlight"
        );
      }
      markReporterTrigger(reporterState, guildId, triggerKey);
    }
  }

  const blowoutMatchup = snapshot.matchups
    .filter((matchup) => matchup.homeTeamId && matchup.awayTeamId)
    .map((matchup) => ({
      ...matchup,
      margin: Math.abs(matchup.homeScore - matchup.awayScore)
    }))
    .sort((a, b) => b.margin - a.margin)[0];

  if (blowoutMatchup && blowoutMatchup.margin >= 15) {
    const winnerTeamId =
      blowoutMatchup.homeScore >= blowoutMatchup.awayScore
        ? blowoutMatchup.homeTeamId
        : blowoutMatchup.awayTeamId;
    const loserTeamId =
      winnerTeamId === blowoutMatchup.homeTeamId
        ? blowoutMatchup.awayTeamId
        : blowoutMatchup.homeTeamId;
    const triggerKey = `blowout:${snapshot.currentScoringPeriod}:${winnerTeamId}:${loserTeamId}`;
    if (!wasReporterTriggerHandled(reporterState, guildId, triggerKey)) {
      for (const [teamId, prompt] of [
        [
          winnerTeamId,
          "That result looked like a statement win. What's your message after running up the score?"
        ],
        [
          loserTeamId,
          "The league just watched that matchup get away from you. What happened out there?"
        ]
      ]) {
        const link = links[String(teamId)];
        const team = snapshot.teams.find((entry) => entry.id === teamId);
        if (!link || !team) {
          continue;
        }

        await createReporterInquiry(
          client,
          reporterState,
          guildId,
          guildConfig,
          {
            teamId,
            teamName: team.name,
            manager: team.manager,
            discordUserId: link.discordUserId,
            prompt,
            features: ["social", "podcast"]
          },
          "Blowout result"
        );
      }
      markReporterTrigger(reporterState, guildId, triggerKey);
    }
  }
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

  const linkedManagersContext = await getLinkedManagersContext(client, guildId, snapshot, guildConfig);
  const reporterContextText = formatReporterContext(
    getReporterQuotesForFeature(await getReporterState(), guildId, "transactions")
  );
  const grades = await buildTransactionGrades(
    snapshot,
    guildConfig.timezone,
    formatRegistryForPrompt(registry),
    linkedManagersContext,
    reporterContextText
  );
  await channel.send(appendMentionFooter(grades, buildMentionFooter(snapshot, guildConfig, "transactions")));

  return {
    ...state,
    lastGradedTransactionId: latestTransactionId
  };
}

async function maybeRefreshMediaRegistry(snapshot, timezone, now, state, registry) {
  const latestTransactionId = getLatestTransactionId(snapshot);
  const registryRunKey = getStateKey("media-registry", timezone, now);
  const shouldRefreshDaily = !state[registryRunKey];
  const shouldRefreshForNewTransaction =
    latestTransactionId && state.lastRegistryTransactionId !== latestTransactionId;

  if (!shouldRefreshDaily && !shouldRefreshForNewTransaction) {
    return { state, registry };
  }

  const updatedRegistryText = await buildRegistryUpdate(
    snapshot,
    formatRegistryForPrompt(registry)
  );

  return {
    state: {
      ...state,
      [registryRunKey]: new Date().toISOString(),
      lastRegistryTransactionId: latestTransactionId || state.lastRegistryTransactionId || null
    },
    registry: parseRegistrySections(updatedRegistryText)
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
    const linkedManagersContext = await getLinkedManagersContext(client, guildId, snapshot, guildConfig);
    const reporterContextText = formatReporterContext(
      getReporterQuotesForFeature(await getReporterState(), guildId, "social")
    );
    const content = await buildSocialPost(
      snapshot,
      guildConfig.timezone,
      linkedManagersContext,
      reporterContextText
    );
    await channel.send(appendMentionFooter(content, buildMentionFooter(snapshot, guildConfig, "social")));
    return state;
  }

  if (feature === "podcast") {
    const hostNames = guildConfig.podcastHostNames || {};
    const linkedManagersContext = await getLinkedManagersContext(client, guildId, snapshot, guildConfig);
    const reporterContextText = formatReporterContext(
      getReporterQuotesForFeature(await getReporterState(), guildId, "podcast")
    );
    const previousMemory = [
      state.podcastMemoryHistory?.slice(-4).join("\n\n") || "",
      formatRegistryForPrompt(registry),
      guildConfig.podcastManualContext?.trim()
        ? `Producer notes and manual context:\n${guildConfig.podcastManualContext.trim()}`
        : ""
    ].filter(Boolean).join("\n\n");
    const renderer =
      config.featureRealtimePodcast && config.podcastRenderer === "realtime"
        ? "realtime"
        : "tts";
    const podcast = await buildPodcastPackage(
      snapshot,
      previousMemory,
      guildConfig.timezone,
      renderer,
      hostNames,
      linkedManagersContext,
      reporterContextText
    );
    await channel.send({
      content: [
        "Weekly fantasy podcast is live.",
        `AI-generated voices and script based on league results and transaction activity. Renderer: ${renderer}.`,
        "",
        podcast.summary,
        buildMentionFooter(snapshot, guildConfig, "podcast")
      ].join("\n"),
      files: [podcast.audioAttachment, podcast.transcriptAttachment]
    });
    await savePodcastEpisode({
      guildId,
      episodeKind: "weekly",
      renderer,
      title: "The Backyard Bullpen",
      summary: podcast.summary,
      memory: podcast.memory,
      transcript: podcast.transcript
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
  const reporterState = await getReporterState();
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
      await maybeCreateAutomaticReporterInquiries(
        client,
        guildId,
        guildConfig,
        snapshot,
        reporterState,
        logger
      );

      nextState[guildId] = await maybeSendInstantTransactionGrades(
        client,
        guildId,
        guildConfig,
        snapshot,
        nextState[guildId],
        nextRegistry[guildId]
      );

      const registryRefresh = await maybeRefreshMediaRegistry(
        snapshot,
        timezone,
        now,
        nextState[guildId],
        nextRegistry[guildId]
      );
      nextState[guildId] = registryRefresh.state;
      nextRegistry[guildId] = registryRefresh.registry;
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
  await saveReporterState(reporterState);
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
    const linkedManagersContext = await getLinkedManagersContext(client, guildId, snapshot, guildConfig || {});
    const reporterContextText = formatReporterContext(
      getReporterQuotesForFeature(await getReporterState(), guildId, "transactions")
    );
    const content = testType.startsWith("demo-")
      ? buildDemoTransactionGrades(snapshot, timezone)
      : await buildTransactionGrades(
          snapshot,
          timezone,
          "",
          linkedManagersContext,
          reporterContextText
        );
    const finalContent = appendMentionFooter(
      content,
      buildMentionFooter(snapshot, guildConfig || {}, "transactions")
    );
    if (testType.startsWith("demo-")) {
      await sendTestContentToFeatureChannel(client, guildConfig, "transactions", finalContent);
      return "Demo transaction grades posted.";
    }

    return finalContent;
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
    const linkedManagersContext = await getLinkedManagersContext(client, guildId, snapshot, guildConfig || {});
    const reporterContextText = formatReporterContext(
      getReporterQuotesForFeature(await getReporterState(), guildId, "social")
    );
    const content = testType.startsWith("demo-")
      ? buildDemoSocialPost(snapshot, timezone)
      : await buildSocialPost(
          snapshot,
          timezone,
          linkedManagersContext,
          reporterContextText
        );
    const finalContent = appendMentionFooter(
      content,
      buildMentionFooter(snapshot, guildConfig || {}, "social")
    );
    if (testType.startsWith("demo-")) {
      await sendTestContentToFeatureChannel(client, guildConfig, "social", finalContent);
      return "Demo social post sent.";
    }

    return finalContent;
  }

  if (normalizedType === "podcast") {
    const hostNames = guildConfig?.podcastHostNames || {};
    const linkedManagersContext = await getLinkedManagersContext(client, guildId, snapshot, guildConfig || {});
    const reporterContextText = formatReporterContext(
      getReporterQuotesForFeature(await getReporterState(), guildId, "podcast")
    );
    const renderer = testType.endsWith("-realtime")
      ? "realtime"
      : testType.endsWith("-tts")
        ? "tts"
        : config.featureRealtimePodcast && config.podcastRenderer === "realtime"
          ? "realtime"
          : "tts";
    const podcast = testType.startsWith("demo-")
      ? await buildDemoPodcastPackage(
          snapshot,
          timezone,
          renderer,
          guildConfig?.podcastManualContext || "",
          hostNames
        )
      : await buildPodcastPackage(
          snapshot,
          guildConfig?.podcastManualContext
            ? `Producer notes and manual context:\n${guildConfig.podcastManualContext}`
            : "",
          timezone,
          renderer,
          hostNames,
          linkedManagersContext,
          reporterContextText
        );
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
        podcast.summary,
        buildMentionFooter(snapshot, guildConfig || {}, "podcast")
      ].join("\n"),
      files: [podcast.audioAttachment, podcast.transcriptAttachment]
    });
    await savePodcastEpisode({
      guildId,
      episodeKind: testType.startsWith("demo-") ? "demo" : "manual",
      renderer,
      title: "The Backyard Bullpen",
      summary: podcast.summary,
      memory: podcast.memory,
      transcript: podcast.transcript
    });

    return "Podcast test episode posted.";
  }

  throw new Error(`Unknown fantasy test type: ${testType}`);
}
