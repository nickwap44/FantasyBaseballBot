import {
  getMailbagState,
  getGuildConfig,
  getGuildConfigs,
  getFantasyState,
  getMediaRegistry,
  getReporterState,
  saveMailbagState,
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
  buildEmergencyPodcastPackage,
  buildPodcastPackage,
  buildPowerRankings,
  buildRegistryUpdate,
  buildSocialPost,
  buildTransactionGrades,
  buildTransactionsSummary,
  formatMailbagQuestions,
  formatReporterContext
} from "./fantasyContent.js";
import { config } from "./config.js";
import { savePodcastEpisode } from "./database.js";
import { getMockLeagueSnapshot } from "./mockLeague.js";
import { generateText } from "./openaiClient.js";
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
    return hour === 14 && minute < 10;
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

async function getRecentSocialDiscussion(client, guildConfig, { limit = 25, hours = 168 } = {}) {
  const channelId = guildConfig.socialChannelId;
  if (!channelId) {
    return "";
  }

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) {
    return "";
  }

  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  const messages = await channel.messages.fetch({ limit }).catch(() => null);
  if (!messages) {
    return "";
  }

  const lines = [...messages.values()]
    .filter((message) => !message.author?.bot)
    .filter((message) => message.createdTimestamp >= cutoff)
    .map((message) => {
      const text = (message.content || "").replace(/\s+/g, " ").trim();
      if (!text) {
        return null;
      }

      const displayName =
        message.member?.displayName ||
        message.author?.globalName ||
        message.author?.username ||
        "Unknown user";
      return `- ${displayName}: ${text.slice(0, 220)}`;
    })
    .filter(Boolean)
    .reverse()
    .slice(-15);

  return lines.join("\n");
}

function getOpenMailbagQuestions(mailbagState, guildId, limit = 4) {
  return getMailbagStateForGuild(mailbagState, guildId)
    .questions
    .filter((question) => question.status === "open")
    .slice(0, limit);
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

async function buildFantasyTrollReply(messageContent) {
  return generateText({
    systemPrompt:
      "You are Fantasy Troll, a smug but playful fantasy baseball contrarian in a Discord social channel. Reply directly to the user's take by contradicting it, poking holes in it, or reframing it in the most annoying plausible way. Keep it to 1-2 short sentences, under 220 characters, and make it feel teasing rather than hateful. Do not use profanity, slurs, threats, or harassment. Do not mention being an AI.",
    userPrompt: `Reply to this post with a contradiction:\n\n${messageContent}`
  }).then((text) => {
    if (text.trim()) {
      return text.trim();
    }

    return "Counterpoint: that take sounds confident for something that's going to age badly by tomorrow.";
  });
}

const EMERGENCY_REACTION_THRESHOLD = 5;
const EMERGENCY_UNIQUE_USER_THRESHOLD = 3;
const EMERGENCY_ELIGIBILITY_WINDOW_MS = 24 * 60 * 60 * 1000;

function listEmergencyCandidates(state) {
  return state.reactionEligibleTransactionPosts || [];
}

function pruneEmergencyCandidates(state, now = Date.now()) {
  const eligiblePosts = listEmergencyCandidates(state).filter((entry) => {
    const createdAt = new Date(entry.createdAt).getTime();
    return Number.isFinite(createdAt) && now - createdAt <= EMERGENCY_ELIGIBILITY_WINDOW_MS;
  });

  return {
    ...state,
    reactionEligibleTransactionPosts: eligiblePosts
  };
}

function pickEmergencyFocusTransaction(snapshot) {
  const transactions = snapshot.transactions || [];
  const trade = transactions.find((transaction) => transaction.type?.includes("TRADE"));
  if (trade) {
    return trade;
  }

  const waiverClaim = [...transactions]
    .filter((transaction) => Number.isFinite(transaction.biddingAmount) && transaction.biddingAmount > 0)
    .sort((left, right) => (right.biddingAmount || 0) - (left.biddingAmount || 0))[0];

  return waiverClaim || transactions[0] || null;
}

function registerReactionEligibleTransactionPost(state, message, focusTransaction) {
  if (!focusTransaction) {
    return pruneEmergencyCandidates(state);
  }

  const nextPosts = [
    ...listEmergencyCandidates(state).filter((entry) => entry.messageId !== message.id),
    {
      messageId: message.id,
      channelId: message.channelId,
      createdAt: new Date().toISOString(),
      triggeredAt: null,
      focusTransaction
    }
  ].slice(-8);

  return pruneEmergencyCandidates({
    ...state,
    reactionEligibleTransactionPosts: nextPosts
  });
}

async function getReactionMetrics(message) {
  let totalReactions = 0;
  const uniqueUsers = new Set();

  for (const reaction of message.reactions.cache.values()) {
    const users = await reaction.users.fetch();
    for (const [, user] of users) {
      if (user.bot) {
        continue;
      }

      totalReactions += 1;
      uniqueUsers.add(user.id);
    }
  }

  return {
    totalReactions,
    uniqueUserCount: uniqueUsers.size
  };
}

async function triggerEmergencyPodcast(
  client,
  guildId,
  guildConfig,
  guildState,
  snapshot,
  messageId,
  logger = console
) {
  const candidates = listEmergencyCandidates(guildState);
  if (candidates.length === 0) {
    return guildState;
  }

  const latestCandidate = candidates.find((entry) => entry.messageId === messageId);

  if (!latestCandidate || latestCandidate.triggeredAt || !latestCandidate.focusTransaction) {
    return guildState;
  }

  const podcastChannelId = guildConfig.podcastChannelId;
  if (!podcastChannelId) {
    return guildState;
  }

  const channel = await client.channels.fetch(podcastChannelId).catch(() => null);
  if (!channel?.isTextBased()) {
    return guildState;
  }

  const renderer =
    config.featureRealtimePodcast && config.podcastRenderer === "realtime"
      ? "realtime"
      : "tts";
  const hostNames = guildConfig.podcastHostNames || {};
  const linkedManagersContext = await getLinkedManagersContext(client, guildId, snapshot, guildConfig);
  const reporterContextText = formatReporterContext(
    getReporterQuotesForFeature(await getReporterState(), guildId, "podcast")
  );
  const previousMemory = [
    guildState.podcastMemoryHistory?.slice(-4).join("\n\n") || "",
    guildConfig.podcastManualContext?.trim()
      ? `Producer notes and manual context:\n${guildConfig.podcastManualContext.trim()}`
      : ""
  ].filter(Boolean).join("\n\n");
  const socialDiscussionText = await getRecentSocialDiscussion(client, guildConfig, {
    limit: 30,
    hours: 24
  });
  const podcast = await buildEmergencyPodcastPackage(
    snapshot,
    latestCandidate.focusTransaction,
    previousMemory,
    guildConfig.timezone,
    renderer,
    hostNames,
    linkedManagersContext,
    reporterContextText,
    socialDiscussionText
  );

  await channel.send({
    content: [
      "Emergency Bullpen is live.",
      `Triggered by community reaction to today's transactions post. Renderer: ${renderer}.`,
      "",
      podcast.summary
    ].join("\n"),
    files: [podcast.audioAttachment, podcast.transcriptAttachment]
  });

  await savePodcastEpisode({
    guildId,
    episodeKind: "emergency",
    renderer,
    title: "Emergency Bullpen",
    summary: podcast.summary,
    memory: podcast.memory,
    transcript: podcast.transcript
  });

  return {
    ...guildState,
    reactionEligibleTransactionPosts: candidates.map((entry) =>
      entry.messageId === latestCandidate.messageId
        ? { ...entry, triggeredAt: new Date().toISOString() }
        : entry
    ),
    podcastHistory: [...(guildState.podcastHistory || []), podcast.summary].slice(-6),
    podcastMemoryHistory: [...(guildState.podcastMemoryHistory || []), podcast.memory].slice(-8)
  };
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
    guildConfig.reporterChannelId ||
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

async function sendFeatureMessage(client, guildId, guildConfig, feature, snapshot, state, registry, mailbagState) {
  const channelId = getFeatureChannelId(guildConfig, feature);
  if (!channelId) {
    return state;
  }

  const channel = await client.channels.fetch(channelId);
  if (!channel?.isTextBased()) {
    return state;
  }

  if (feature === "transactions") {
    const linkedManagersContext = await getLinkedManagersContext(client, guildId, snapshot, guildConfig);
    const reporterContextText = formatReporterContext(
      getReporterQuotesForFeature(await getReporterState(), guildId, "transactions")
    );
    const content = await buildTransactionsSummary(
      snapshot,
      guildConfig.timezone,
      formatRegistryForPrompt(registry),
      linkedManagersContext,
      reporterContextText
    );
    const sentMessage = await channel.send(
      appendMentionFooter(content, buildMentionFooter(snapshot, guildConfig, "transactions"))
    );
    return registerReactionEligibleTransactionPost(
      state,
      sentMessage,
      pickEmergencyFocusTransaction(snapshot)
    );
  }

  if (feature === "power") {
    const content = buildPowerRankings(
      snapshot,
      guildConfig.timezone,
      getCurrentEspnLinks(guildConfig)
    );
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
    const socialDiscussionText = await getRecentSocialDiscussion(client, guildConfig, {
      limit: 40,
      hours: 168
    });
    const mailbagQuestions = getOpenMailbagQuestions(mailbagState, guildId, 4);
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
      reporterContextText,
      socialDiscussionText,
      formatMailbagQuestions(mailbagQuestions)
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

    if (mailbagQuestions.length > 0) {
      const guildMailbagState = getMailbagStateForGuild(mailbagState, guildId);
      mailbagState[guildId] = {
        ...guildMailbagState,
        questions: guildMailbagState.questions.map((question) =>
          mailbagQuestions.some((entry) => entry.id === question.id)
            ? { ...question, status: "used", usedAt: new Date().toISOString() }
            : question
        )
      };
    }

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
  const mailbagState = await getMailbagState();
  const nextState = { ...fantasyState };
  const nextRegistry = { ...mediaRegistry };

  for (const [guildId, guildConfig] of Object.entries(guildConfigs)) {
    const timezone = guildConfig.timezone || "America/Los_Angeles";
    nextState[guildId] = pruneEmergencyCandidates(nextState[guildId] || {});
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
      logger.error(`Fantasy registry update failed for guild ${guildId}:`, error);
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
          nextRegistry[guildId],
          mailbagState
        );
        nextState[guildId] = {
          ...updatedState,
          [runKey]: new Date().toISOString()
        };
        await saveFantasyState(nextState);
      } catch (error) {
        logger.error(`Fantasy job failed for ${feature} in guild ${guildId}:`, error);
      }
    }
  }

  await saveFantasyState(nextState);
  await saveMediaRegistry(nextRegistry);
  await saveReporterState(reporterState);
  await saveMailbagState(mailbagState);
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

export async function handleFantasyReactionAdd(reaction, user, client, logger = console) {
  if (user?.bot) {
    return;
  }

  if (reaction.partial) {
    await reaction.fetch().catch(() => null);
  }

  if (reaction.message?.partial) {
    await reaction.message.fetch().catch(() => null);
  }

  const message = reaction.message;
  const guildId = message?.guildId;
  if (!message || !guildId) {
    return;
  }

  const fantasyState = await getFantasyState();
  const guildState = pruneEmergencyCandidates(fantasyState[guildId] || {});
  const candidate = listEmergencyCandidates(guildState).find((entry) => entry.messageId === message.id);
  if (!candidate || candidate.triggeredAt) {
    if (fantasyState[guildId] !== guildState) {
      await saveFantasyState({
        ...fantasyState,
        [guildId]: guildState
      });
    }
    return;
  }

  const candidateCreatedAt = new Date(candidate.createdAt).getTime();
  if (!Number.isFinite(candidateCreatedAt) || Date.now() - candidateCreatedAt > EMERGENCY_ELIGIBILITY_WINDOW_MS) {
    await saveFantasyState({
      ...fantasyState,
      [guildId]: guildState
    });
    return;
  }

  const { totalReactions, uniqueUserCount } = await getReactionMetrics(message);
  if (
    totalReactions < EMERGENCY_REACTION_THRESHOLD ||
    uniqueUserCount < EMERGENCY_UNIQUE_USER_THRESHOLD
  ) {
    if (fantasyState[guildId] !== guildState) {
      await saveFantasyState({
        ...fantasyState,
        [guildId]: guildState
      });
    }
    return;
  }

  const lockedGuildState = {
    ...guildState,
    reactionEligibleTransactionPosts: listEmergencyCandidates(guildState).map((entry) =>
      entry.messageId === candidate.messageId
        ? { ...entry, triggeredAt: new Date().toISOString() }
        : entry
    )
  };
  const lockedState = {
    ...fantasyState,
    [guildId]: lockedGuildState
  };
  await saveFantasyState(lockedState);

  try {
    const guildConfig = await getGuildConfig(guildId);
    if (!guildConfig) {
      return;
    }

    const snapshot = await getLeagueSnapshot();
    const finalGuildState = await triggerEmergencyPodcast(
      client,
      guildId,
      guildConfig,
      lockedGuildState,
      snapshot,
      candidate.messageId,
      logger
    );

    await saveFantasyState({
      ...lockedState,
      [guildId]: finalGuildState
    });
  } catch (error) {
    logger.error(`Emergency podcast trigger failed for guild ${guildId}:`, error);
  }
}

export async function handleFantasySocialMessage(message, logger = console) {
  if (!message.inGuild() || message.author?.bot) {
    return;
  }

  const content = message.content?.trim();
  if (!content) {
    return;
  }

  const guildConfig = await getGuildConfig(message.guildId);
  if (!guildConfig?.fantasyTrollEnabled) {
    return;
  }

  if (!guildConfig.socialChannelId || message.channelId !== guildConfig.socialChannelId) {
    return;
  }

  try {
    const reply = await buildFantasyTrollReply(content);
    await message.reply({
      content: reply,
      allowedMentions: {
        repliedUser: true
      }
    });
  } catch (error) {
    logger.error(`Fantasy Troll reply failed for guild ${message.guildId}:`, error);
  }
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
    const linkedManagersContext = await getLinkedManagersContext(client, guildId, snapshot, guildConfig || {});
    const reporterContextText = formatReporterContext(
      getReporterQuotesForFeature(await getReporterState(), guildId, "transactions")
    );
    const content = testType.startsWith("demo-")
      ? buildDemoTransactionsSummary(snapshot, timezone)
      : await buildTransactionsSummary(
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
      return "Demo transaction recap posted.";
    }

    return finalContent;
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
      ? buildDemoPowerRankings(snapshot, timezone, getCurrentEspnLinks(guildConfig || {}))
      : buildPowerRankings(snapshot, timezone, getCurrentEspnLinks(guildConfig || {}));
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
    const mailbagState = await getMailbagState();
    const socialDiscussionText = await getRecentSocialDiscussion(client, guildConfig || {}, {
      limit: 40,
      hours: 168
    });
    const mailbagQuestions = getOpenMailbagQuestions(mailbagState, guildId, 4);
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
          reporterContextText,
          socialDiscussionText,
          formatMailbagQuestions(mailbagQuestions)
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
