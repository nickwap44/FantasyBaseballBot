import { AttachmentBuilder } from "discord.js";
import { generateMusicCue, stitchMp3Segments } from "./audioAssembler.js";
import { config } from "./config.js";
import { generateSpeech, generateText } from "./openaiClient.js";
import { buildRealtimePodcastAudio } from "./realtimePodcastRenderer.js";
import { formatDateTime } from "./time.js";

function scoreTeamStrength(team) {
  const starterCount = team.roster.filter((entry) => entry.lineupSlotId < 20).length;
  const benchCount = team.roster.length - starterCount;
  return team.pointsFor + starterCount * 2 + benchCount * 0.5 - team.losses * 3;
}

function recentTransactionsBlock(transactions) {
  if (transactions.length === 0) {
    return "No new transactions were found in the recent ESPN activity feed.";
  }

  return transactions
    .slice(0, 10)
    .map((transaction) => {
      const players = transaction.players.map((player) => `${player.type} ${player.name}`).join(", ");
      const amount = transaction.biddingAmount ? ` for $${transaction.biddingAmount}` : "";
      return `- ${transaction.teamName} ${transaction.type}${amount}: ${players}`;
    })
    .join("\n");
}

function standingsBlock(teams) {
  return [...teams]
    .sort((left, right) => {
      if (right.wins !== left.wins) {
        return right.wins - left.wins;
      }

      return right.pointsFor - left.pointsFor;
    })
    .map(
      (team, index) =>
        `${index + 1}. ${team.name} (${team.wins}-${team.losses}${team.ties ? `-${team.ties}` : ""}, PF ${team.pointsFor.toFixed(1)})`
    )
    .join("\n");
}

function strongestTeamsBlock(teams) {
  return [...teams]
    .sort((left, right) => scoreTeamStrength(right) - scoreTeamStrength(left))
    .slice(0, 5)
    .map((team, index) => `${index + 1}. ${team.name} (${team.manager})`)
    .join("\n");
}

function normalizeMetric(value, min, max) {
  if (max === min) {
    return 50;
  }

  return ((value - min) / (max - min)) * 100;
}

function getRosterDepthScore(team) {
  const starterCount = team.roster.filter((entry) => entry.lineupSlotId < 20).length;
  const benchCount = team.roster.length - starterCount;
  return starterCount * 0.75 + benchCount * 0.25;
}

function getPowerRankingRows(snapshot, espnDiscordLinks = {}) {
  const teams = snapshot.teams || [];
  const pointDiffs = teams.map((team) => (team.pointsFor || 0) - (team.pointsAgainst || 0));
  const pointsForValues = teams.map((team) => team.pointsFor || 0);
  const depthValues = teams.map((team) => getRosterDepthScore(team));

  const minPointsFor = Math.min(...pointsForValues);
  const maxPointsFor = Math.max(...pointsForValues);
  const minPointDiff = Math.min(...pointDiffs);
  const maxPointDiff = Math.max(...pointDiffs);
  const minDepth = Math.min(...depthValues);
  const maxDepth = Math.max(...depthValues);

  return teams
    .map((team) => {
      const wins = team.wins || 0;
      const losses = team.losses || 0;
      const ties = team.ties || 0;
      const gamesPlayed = wins + losses + ties;
      const recordScore = gamesPlayed > 0 ? ((wins + ties * 0.5) / gamesPlayed) * 100 : 50;
      const pointsForScore = normalizeMetric(team.pointsFor || 0, minPointsFor, maxPointsFor);
      const pointDiff = (team.pointsFor || 0) - (team.pointsAgainst || 0);
      const pointDiffScore = normalizeMetric(pointDiff, minPointDiff, maxPointDiff);
      const rosterDepthScore = normalizeMetric(getRosterDepthScore(team), minDepth, maxDepth);
      const powerScore =
        recordScore * 0.45 +
        pointsForScore * 0.25 +
        pointDiffScore * 0.2 +
        rosterDepthScore * 0.1;

      return {
        team,
        pointDiff,
        powerScore,
        recordScore,
        pointsForScore,
        pointDiffScore,
        rosterDepthScore,
        linkedUserId: espnDiscordLinks[String(team.id)]?.discordUserId || null
      };
    })
    .sort((left, right) => {
      if (right.powerScore !== left.powerScore) {
        return right.powerScore - left.powerScore;
      }

      if ((right.team.pointsFor || 0) !== (left.team.pointsFor || 0)) {
        return (right.team.pointsFor || 0) - (left.team.pointsFor || 0);
      }

      if (right.pointDiff !== left.pointDiff) {
        return right.pointDiff - left.pointDiff;
      }

      return left.team.name.localeCompare(right.team.name);
    });
}

function formatManagerTag(row) {
  if (row.linkedUserId) {
    return `<@${row.linkedUserId}>`;
  }

  return row.team.manager || "Unknown manager";
}

function matchupBlock(matchups) {
  return matchups
    .map(
      (matchup) =>
        `- ${matchup.awayTeam} ${matchup.awayScore.toFixed(1)} at ${matchup.homeTeam} ${matchup.homeScore.toFixed(1)}`
    )
    .join("\n");
}

function isSeasonPreviewMode(snapshot) {
  const hasRecordedStandings = snapshot.teams.some(
    (team) => (team.wins || 0) > 0 || (team.losses || 0) > 0 || (team.ties || 0) > 0
  );
  const hasScoredMatchups = snapshot.matchups.some(
    (matchup) => (matchup.homeScore || 0) > 0 || (matchup.awayScore || 0) > 0
  );

  return !hasRecordedStandings && !hasScoredMatchups;
}

const PODCAST_TITLE = "The Backyard Bullpen";
const PODCAST_SUBTITLE = "The official podcast of the Backyard Baseball Association";
const LEAGUE_INSIDER_HANDLE = "@BBAInsider";
const LEAGUE_INSIDER_NAME = "Backyard Sources";
const PODCAST_SEGMENTS = [
  "Lead-off Check-In",
  "Panic Meter",
  "The April Coronation Watch",
  "Waiver Wire Crimes",
  "Disrespectful Trade Offer of the Week",
  "Bullpen Close"
];

function getDefaultHostNames() {
  return {
    lead: "Mason",
    hotTake: "Rico",
    analyst: "Elena"
  };
}

function resolveHostNames(hostNames = {}) {
  const defaults = getDefaultHostNames();
  return {
    lead: hostNames.lead || defaults.lead,
    hotTake: hostNames.hotTake || defaults.hotTake,
    analyst: hostNames.analyst || defaults.analyst
  };
}

function getHostRoleFromSpeaker(speaker, hostNames = {}) {
  const normalized = speaker.toLowerCase();
  const resolved = resolveHostNames(hostNames);

  if (normalized === resolved.lead.toLowerCase() || normalized.includes("mason")) {
    return "lead";
  }

  if (normalized === resolved.hotTake.toLowerCase() || normalized.includes("rico")) {
    return "hotTake";
  }

  if (normalized === resolved.analyst.toLowerCase() || normalized.includes("elena")) {
    return "analyst";
  }

  return "lead";
}

export async function buildTransactionsSummary(
  snapshot,
  timezone,
  registryText = "",
  linkedManagersContext = "",
  reporterContextText = ""
) {
  return generateText({
    systemPrompt:
      "You are the fantasy baseball media desk for the Backyard Baseball Association. Write one daily Discord transaction roundup with a headline, 3-5 bullets, and a short closing takeaway. Fold transaction grades directly into the recap instead of creating a separate post. If there is no activity yet, say that the league is still quiet and preview what managers should watch for. Use any supplied running jokes or host biases sparingly when they fit. When linked Discord users are provided, use their exact mention token inline naturally when referencing that manager or team. If reporter quotes are provided, weave the strongest quote into the roundup when it fits.",
    userPrompt: [
      `League transaction activity as of ${formatDateTime(new Date(), timezone)}:`,
      registryText ? `Media registry:\n${registryText}` : "",
      linkedManagersContext ? `Linked Discord users:\n${linkedManagersContext}` : "",
      reporterContextText ? `Reporter quotes:\n${reporterContextText}` : "",
      "Transactions:",
      recentTransactionsBlock(snapshot.transactions)
    ].filter(Boolean).join("\n\n")
  }).then((text) => {
    if (text.trim()) {
      return text;
    }

    const recentItems = snapshot.transactions.slice(0, 3);
    return [
      "**Daily Transactions Report**",
      `Filed for ${formatDateTime(new Date(), timezone)}`,
      "",
      ...(recentItems.length > 0
        ? recentItems.map((transaction) => {
            const players = transaction.players.map((player) => `${player.type} ${player.name}`).join(", ");
            const bid = transaction.biddingAmount ? ` for $${transaction.biddingAmount}` : "";
            return `- ${transaction.teamName} made a ${transaction.type.toLowerCase()}${bid}: ${players}.`;
          })
        : ["- No new transaction activity was returned today."]),
      "",
      "Takeaway: the recap generator came back empty, so this is the fallback box score version."
    ].join("\n");
  });
}

export function buildDemoTransactionsSummary(snapshot, timezone) {
  return [
    `**Daily Transactions Demo**`,
    `Generated for ${formatDateTime(new Date(), timezone)}`,
    "",
    ...snapshot.transactions.slice(0, 3).map((transaction) => {
      const players = transaction.players.map((player) => `${player.type} ${player.name}`).join(", ");
      const bid = transaction.biddingAmount ? ` for $${transaction.biddingAmount}` : "";
      const grade =
        transaction.type.toLowerCase() === "trade" ? "B+" : transaction.biddingAmount >= 15 ? "A-" : "B";
      return `- ${transaction.teamName} made a ${transaction.type.toLowerCase()}${bid}: ${players}. Grade: **${grade}**.`;
    }),
    "",
    "Takeaway: the waiver wire is already getting spicy, and the daily recap now handles the grades in one pass."
  ].join("\n");
}

export function buildPowerRankings(snapshot, timezone, espnDiscordLinks = {}) {
  if (snapshot.teams.length === 0) {
    return "No teams are populated in ESPN yet, so power rankings will unlock after the draft loads into the league.";
  }

  const ranked = getPowerRankingRows(snapshot, espnDiscordLinks);

  return [
    `**BBA Power Rankings**`,
    `Filed for ${formatDateTime(new Date(), timezone)}`,
    `Formula: 45% record, 25% points scored, 20% point differential, 10% roster depth.`,
    "",
    ...ranked.map((row, index) => {
      const team = row.team;
      const record = `${team.wins}-${team.losses}${team.ties ? `-${team.ties}` : ""}`;
      const diffPrefix = row.pointDiff >= 0 ? "+" : "";
      return `${index + 1}. ${team.name} - ${formatManagerTag(row)} | Score ${row.powerScore.toFixed(1)} | Record ${record} | PF ${team.pointsFor.toFixed(1)} | Diff ${diffPrefix}${row.pointDiff.toFixed(1)}`;
    }),
    "",
    `Top roster on the numbers: ${ranked[0].team.name}`,
    `Biggest climb path: ${ranked[ranked.length - 1].team.name} can move fast with one strong scoring week.`
  ].join("\n");
}

export function buildDemoPowerRankings(snapshot, timezone, espnDiscordLinks = {}) {
  return buildPowerRankings(snapshot, timezone, espnDiscordLinks);
}

export async function buildSocialPost(
  snapshot,
  timezone,
  linkedManagersContext = "",
  reporterContextText = ""
) {
  return generateText({
    systemPrompt:
      `You write one fake Twitter/X-style post for a fantasy baseball league as ${LEAGUE_INSIDER_NAME} (${LEAGUE_INSIDER_HANDLE}). It should feel like a single insider update, rumor, or pointed reaction from a plugged-in league source, not a recap. Keep it under 280 characters, make it punchy and conversational, and sound like someone who knows the league politics and has heard things. Write in a consistent insider voice that feels like a recognizable account the league has come to know. If the league is still pre-draft, make it about draft anticipation, quiet tension, or early trash talk. When linked Discord users are provided, use their exact mention token inline naturally when referencing that manager or team. If reporter quotes are provided, treat them as direct requests-for-comment and weave the best quote in when it fits. Do not include hashtags unless they genuinely add something.`,
    userPrompt: [
      `Create a post for ${formatDateTime(new Date(), timezone)}.`,
      linkedManagersContext ? `Linked Discord users:\n${linkedManagersContext}` : "",
      reporterContextText ? `Reporter quotes:\n${reporterContextText}` : "",
      "Recent transactions:",
      recentTransactionsBlock(snapshot.transactions.slice(0, 5)),
      "",
      "League standings:",
      standingsBlock(snapshot.teams.slice(0, 6))
    ].join("\n")
  }).then((text) => {
    if (text.trim()) {
      return text.trim();
    }

    const topTransaction = snapshot.transactions[0];
    if (topTransaction) {
      const amount = topTransaction.biddingAmount ? ` for $${topTransaction.biddingAmount}` : "";
      return `${LEAGUE_INSIDER_HANDLE}: League sources are already side-eyeing ${topTransaction.teamName} after a ${topTransaction.type.toLowerCase()}${amount}. Somebody in this league thinks today changed everything.`;
    }

    const topTeam = snapshot.teams[0];
    if (topTeam) {
      return `${LEAGUE_INSIDER_HANDLE}: Quiet league day, but nobody in the BBA believes the calm lasts. ${topTeam.name} still has the room talking, and the replies are getting louder.`;
    }

    return `${LEAGUE_INSIDER_HANDLE}: Slow news cycle in the BBA, which usually means somebody is typing a reckless take right now.`;
  });
}

export function buildDemoSocialPost(snapshot, timezone) {
  const topTransaction = snapshot.transactions[0];
  return [
    `**${LEAGUE_INSIDER_NAME} Demo**`,
    `Posted ${formatDateTime(new Date(), timezone)}`,
    "",
    `${LEAGUE_INSIDER_HANDLE}: Hearing Waiver Wire Wizards dropped $${topTransaction.biddingAmount} on Jackson Holliday like they think the trophy gets handed out in April. League sources say the room respects the aggression and fears the hubris.`
  ].join("\n");
}

function buildPodcastPrompt(snapshot, historyText, timezone, hostNames = {}) {
  const resolvedHostNames = resolveHostNames(hostNames);
  const seasonPreviewMode = isSeasonPreviewMode(snapshot);
  return [
    "Write a fantasy baseball podcast transcript for three hosts.",
    `Host 1: ${resolvedHostNames.lead}, the straight man and lead host. He runs the show and introduces segments.`,
    `Host 2: ${resolvedHostNames.hotTake}, the hot take artist who overreacts and flies off the handle.`,
    `Host 3: ${resolvedHostNames.analyst}, the steady analyst who grounds everything in evidence.`,
    "Keep the total transcript in the 5-10 minute range, roughly 700-1200 words.",
    seasonPreviewMode
      ? "This is a season preview episode because meaningful games have not started yet. Include a cold open, one contender/pretender segment, one draft and roster-construction segment, one rivalry or league-drama segment, and one bold-predictions closing segment."
      : "Include a cold open, one standings segment, one matchup/results segment, one transactions/news segment, and one closing prediction segment.",
    "The hosts should sound like long-time friends and recurring co-hosts who know each other's rhythms.",
    "They should tease each other, laugh, interrupt lightly, and keep a few running jokes alive across episodes.",
    "Use the memory block as canon for inside jokes, unresolved debates, and recurring bits.",
    "Include at least two playful callbacks or inside-joke moments when the memory block gives you something to use.",
    `Use these recurring show segments when they fit: ${PODCAST_SEGMENTS.join(", ")}.`,
    `${resolvedHostNames.lead} should actively introduce segment names like a real recurring show.`,
    "Make every line start with the speaker name followed by a colon.",
    "Write for spoken audio, not for reading.",
    "Use short, natural sentences and contractions.",
    "Let hosts interrupt, react, and play off each other instead of delivering long monologues.",
    "Avoid stat-dump paragraphs. Fold numbers into conversation naturally.",
    "Use occasional quick asides, laughter beats, and rhetorical questions where they fit.",
    "Do not include stage directions, sound effects, or narration outside the host dialogue.",
    `Current generation time: ${formatDateTime(new Date(), timezone)}`,
    "",
    "Recent podcast memory:",
    historyText || "No prior episode notes yet.",
    "",
    "Standings:",
    standingsBlock(snapshot.teams),
    "",
    seasonPreviewMode ? "Scheduled matchups / early slate context:" : "Current matchups/results:",
    matchupBlock(snapshot.matchups),
    "",
    "Recent transactions:",
    recentTransactionsBlock(snapshot.transactions)
  ].join("\n");
}

function parseTranscriptLines(transcript, hostNames = {}) {
  const resolvedHostNames = resolveHostNames(hostNames);
  return transcript
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf(":");
      if (separator === -1) {
        return { speaker: resolvedHostNames.lead, text: line };
      }

      return {
        speaker: line.slice(0, separator).trim(),
        text: line.slice(separator + 1).trim()
      };
    })
    .filter((line) => line.text);
}

export function getVoiceForSpeaker(speaker, renderer = "tts", hostNames = {}) {
  const role = getHostRoleFromSpeaker(speaker, hostNames);
  if (role === "lead") {
    return "cedar";
  }

  if (role === "hotTake") {
    return "ash";
  }

  return "marin";
}

export function getVoiceInstructionsForSpeaker(speaker, hostNames = {}) {
  const role = getHostRoleFromSpeaker(speaker, hostNames);

  if (role === "hotTake") {
    return [
      "Sound energetic, impulsive, and a little unhinged in a fun sports-radio way.",
      "Punch key words, vary pacing, and lean into hot-take confidence.",
      "Let quick laughs, incredulous scoffs, and playful jabs come through naturally.",
      "Keep it natural and conversational, not announcer-stiff."
    ].join(" ");
  }

  if (role === "analyst") {
    return [
      "Sound calm, grounded, and analytically sharp with a warm, natural cadence.",
      "Use a measured delivery, but let dry humor and knowing amusement slip through sometimes.",
      "Keep it thoughtful, human, and easy to follow."
    ].join(" ");
  }

  return [
    "Sound like a polished but relaxed podcast host with easy chemistry.",
    "Be confident, conversational, and smooth, with crisp pacing, natural emphasis, and the occasional amused laugh.",
    "Keep the delivery friendly and human, not robotic or overly theatrical."
  ].join(" ");
}

function buildNarratedTranscript(transcript, hostNames = {}) {
  return parseTranscriptLines(transcript, hostNames)
    .slice(0, 80)
    .filter((line) => line.text);
}

function formatClockTimestamp(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.max(0, Math.floor(totalSeconds % 60));
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function estimateLineDurationSeconds(text) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(4, (words / 155) * 60 + 0.6);
}

function getTopicLabelForLine(text, seasonPreviewMode) {
  const normalized = text.toLowerCase();

  if (
    normalized.includes("welcome to the backyard bullpen") ||
    normalized.includes("before we get rolling") ||
    normalized.includes("welcome back")
  ) {
    return "Cold Open";
  }

  if (normalized.includes("panic meter")) {
    return "Panic Meter";
  }

  if (normalized.includes("april coronation")) {
    return "April Coronation Watch";
  }

  if (normalized.includes("waiver") || normalized.includes("trade offer") || normalized.includes("trade")) {
    return "Waiver Wire and Trade Desk";
  }

  if (seasonPreviewMode && (normalized.includes("draft") || normalized.includes("roster"))) {
    return "Draft and Roster Check";
  }

  if (seasonPreviewMode && (normalized.includes("rivalry") || normalized.includes("drama"))) {
    return "Rivalry and League Drama";
  }

  if (
    normalized.includes("looks like the team everyone is chasing") ||
    normalized.includes("sets the pace") ||
    normalized.includes("real conversation") ||
    normalized.includes("contender")
  ) {
    return seasonPreviewMode ? "Season Preview Board" : "Standings Check";
  }

  if (
    !seasonPreviewMode &&
    (normalized.includes("flattening") ||
      normalized.includes("this week") ||
      normalized.includes("matchup") ||
      normalized.includes("results"))
  ) {
    return "Matchup Spotlight";
  }

  if (
    normalized.includes("that's the show") ||
    normalized.includes("we'll catch you next time") ||
    normalized.includes("thanks for tuning in")
  ) {
    return "Bullpen Close";
  }

  return null;
}

function buildPodcastTopicGuide(transcript, snapshot, hostNames = {}) {
  return buildPodcastTopicGuideWithMetadata(transcript, snapshot, hostNames, {
    title: PODCAST_TITLE,
    subtitle: PODCAST_SUBTITLE
  });
}

function buildPodcastTopicGuideWithMetadata(
  transcript,
  snapshot,
  hostNames = {},
  {
    title = PODCAST_TITLE,
    subtitle = PODCAST_SUBTITLE
  } = {}
) {
  const lines = parseTranscriptLines(transcript, hostNames);
  const seasonPreviewMode = isSeasonPreviewMode(snapshot);
  const topics = [];
  let elapsedSeconds = 0;

  for (const line of lines) {
    const topicLabel = getTopicLabelForLine(line.text, seasonPreviewMode);
    if (topicLabel && !topics.some((entry) => entry.label === topicLabel)) {
      topics.push({
        timestamp: formatClockTimestamp(elapsedSeconds),
        label: topicLabel
      });
    }

    elapsedSeconds += estimateLineDurationSeconds(line.text);
  }

  if (topics.length < 4) {
    const fallbackLabels = seasonPreviewMode
      ? ["Cold Open", "Season Preview Board", "Draft and Roster Check", "Bullpen Close"]
      : ["Cold Open", "Standings Check", "Waiver Wire and Trade Desk", "Bullpen Close"];
    const totalDuration = Math.max(elapsedSeconds, 60);
    const segmentSpacing = totalDuration / fallbackLabels.length;

    for (let index = 0; index < fallbackLabels.length; index += 1) {
      const label = fallbackLabels[index];
      if (topics.some((entry) => entry.label === label)) {
        continue;
      }

      topics.push({
        timestamp: formatClockTimestamp(segmentSpacing * index),
        label
      });
    }
  }

  const sortedTopics = topics
    .sort((left, right) => {
      const leftSeconds = left.timestamp.split(":").reduce((total, value) => total * 60 + Number(value), 0);
      const rightSeconds = right.timestamp.split(":").reduce((total, value) => total * 60 + Number(value), 0);
      return leftSeconds - rightSeconds;
    })
    .slice(0, 6);

  return [
    `**${title}**`,
    subtitle,
    "",
    "**Topics**",
    ...sortedTopics.map((topic) => `${topic.timestamp} - ${topic.label}`)
  ].join("\n");
}

async function buildTtsPodcastAudio(transcript, hostNames = {}) {
  const lines = buildNarratedTranscript(transcript, hostNames);
  const segments = [];

  for (const line of lines) {
    segments.push(
      await generateSpeech({
        text: line.text,
        voice: getVoiceForSpeaker(line.speaker, "tts", hostNames),
        format: "mp3",
        instructions: getVoiceInstructionsForSpeaker(line.speaker, hostNames)
      })
    );
  }

  return stitchMp3Segments(segments);
}

async function buildPodcastAudio(transcript, renderer, hostNames = {}) {
  const lines = buildNarratedTranscript(transcript, hostNames);
  if (renderer === "realtime") {
    return buildRealtimePodcastAudio(
      lines,
      (speaker) => getVoiceForSpeaker(speaker, "realtime", hostNames),
      (speaker) => getVoiceInstructionsForSpeaker(speaker, hostNames)
    );
  }

  return buildTtsPodcastAudio(transcript, hostNames);
}

async function buildPodcastPackageAudio(transcript, renderer, hostNames = {}) {
  const resolvedHostNames = resolveHostNames(hostNames);
  const introMusic = await generateMusicCue("intro");
  const introTitle = await generateSpeech({
    text: `${PODCAST_TITLE}. ${PODCAST_SUBTITLE}.`,
    voice: getVoiceForSpeaker(resolvedHostNames.lead, renderer, resolvedHostNames),
    format: "mp3",
    instructions:
      "Deliver this like a polished podcast show title. Warm, upbeat, and confident."
  });
  const bumper = await generateSpeech({
    text: `Now, here's ${resolvedHostNames.lead}, ${resolvedHostNames.hotTake}, and ${resolvedHostNames.analyst}.`,
    voice: getVoiceForSpeaker(resolvedHostNames.lead, renderer, resolvedHostNames),
    format: "mp3",
    instructions:
      "Read this like a short show bumper leading into the hosts. Crisp and energetic."
  });
  const body = await buildPodcastAudio(transcript, renderer, resolvedHostNames);
  const outroBumper = await generateSpeech({
    text: `You've been listening to ${PODCAST_TITLE}. Thanks for tuning in to the Backyard Baseball Association.`,
    voice: getVoiceForSpeaker(resolvedHostNames.lead, renderer, resolvedHostNames),
    format: "mp3",
    instructions:
      "Read this like a clean podcast sign-off. Friendly, smooth, and conclusive."
  });
  const outroMusic = await generateMusicCue("outro");

  return stitchMp3Segments([introMusic, introTitle, bumper, body, outroBumper, outroMusic]);
}

async function buildPodcastMemory(transcript) {
  return generateText({
    systemPrompt:
      "Extract durable podcast memory for future episodes. Return three short sections titled Running jokes, Host chemistry, and League storylines. Keep it concise and specific.",
    userPrompt: transcript
  });
}

export async function buildTransactionGrades(
  snapshot,
  timezone,
  registryText = "",
  linkedManagersContext = "",
  reporterContextText = ""
) {
  return generateText({
    systemPrompt:
      "You are the fantasy baseball media desk for the Backyard Baseball Association. Grade recent waivers and trades immediately after they happen. Use short sections, letter grades, and one sharp line of analysis per move. Work in any supplied running jokes or host biases when relevant. When linked Discord users are provided, use their exact mention token inline naturally when discussing that manager or team. If reporter quotes are provided, weave the strongest quote into the coverage when it fits.",
    userPrompt: [
      `Generate instant transaction grades for ${formatDateTime(new Date(), timezone)}.`,
      registryText ? `Media registry:\n${registryText}` : "",
      linkedManagersContext ? `Linked Discord users:\n${linkedManagersContext}` : "",
      reporterContextText ? `Reporter quotes:\n${reporterContextText}` : "",
      "Transactions:",
      recentTransactionsBlock(snapshot.transactions.slice(0, 5))
    ].filter(Boolean).join("\n\n")
  }).then((text) => {
    if (text.trim()) {
      return text;
    }

    return [
      "**Instant Transaction Grades**",
      `Filed for ${formatDateTime(new Date(), timezone)}`,
      "",
      "The media desk reviewed the latest move, but the write-up came back empty.",
      "Consider this a provisional C+ until Rico starts yelling and Elena asks for more sample size."
    ].join("\n");
  });
}

export function formatReporterContext(reporterContext = []) {
  if (!reporterContext.length) {
    return "";
  }

  return reporterContext
    .map((item) => {
      return [
        `- Team: ${item.teamName}`,
        `Manager: ${item.manager}`,
        `Prompt: ${item.prompt}`,
        `Reply: ${item.response}`,
        `Feature tags: ${item.features.join(", ")}`
      ].join("\n");
    })
    .join("\n\n");
}

export function buildDemoTransactionGrades(snapshot, timezone) {
  return [
    `**Instant Waiver and Trade Grades Demo**`,
    `Filed for ${formatDateTime(new Date(), timezone)}`,
    "",
    "Waiver Wire Wizards: **A-**",
    "Jackson Holliday for $17 is exactly the kind of upside swing Rico will call destiny and Elena will call barely defensible.",
    "",
    "Scranton Sliders trade: **B+**",
    "Big-name swap, real ceiling, but Mason would like everybody to stop acting like one trade in April rewrites the standings.",
    "",
    "Dong Bongers free-agent add: **B**",
    "Solid cleanup move. Not glamorous, but this is how you avoid ending up on the panic meter."
  ].join("\n");
}

export async function buildRegistryUpdate(snapshot, existingRegistryText = "") {
  return generateText({
    systemPrompt:
      "You maintain the shared media universe for a fantasy baseball league. Update and compress durable continuity into three sections titled Running jokes, Host biases, and League storylines. Keep only the strongest recurring material and avoid repetition.",
    userPrompt: [
      existingRegistryText ? `Existing registry:\n${existingRegistryText}` : "No existing registry yet.",
      "",
      "New league inputs:",
      `Standings:\n${standingsBlock(snapshot.teams)}`,
      "",
      `Transactions:\n${recentTransactionsBlock(snapshot.transactions.slice(0, 8))}`
    ].join("\n")
  });
}

export async function buildPodcastPackage(
  snapshot,
  podcastHistory,
  timezone,
  renderer = config.podcastRenderer,
  hostNames = {},
  linkedManagersContext = "",
  reporterContextText = "",
  socialDiscussionText = ""
) {
  const resolvedHostNames = resolveHostNames(hostNames);
  const transcript = await generateText({
    systemPrompt:
      "You are a writers' room for a comedy-inflected fantasy baseball podcast. Make the dialogue lively, specific, and rooted in the supplied league data. Write like real people talking into microphones, with rhythm, overlap, and personality. If the league is pre-draft or meaningful games have not started yet, shift into a true season preview: contenders, draft fallout, roster strengths, rivalry hype, sleepers, bust calls, and personality-driven banter instead of fake game recaps. If recent social-channel discussion is provided, treat it as part of the league conversation and let the hosts react to it naturally when it fits. Never put raw Discord mention tokens like <@123> into the spoken transcript.",
    userPrompt: [
      buildPodcastPrompt(snapshot, podcastHistory, timezone, resolvedHostNames),
      linkedManagersContext ? `Linked Discord users for reference only:\n${linkedManagersContext}` : "",
      reporterContextText ? `Reporter quotes and requests for comment:\n${reporterContextText}` : "",
      socialDiscussionText ? `Recent social channel discussion:\n${socialDiscussionText}` : ""
    ].filter(Boolean).join("\n\n"),
    temperature: 1
  });

  const mp3Buffer = await buildPodcastPackageAudio(transcript, renderer, resolvedHostNames);
  const transcriptBuffer = Buffer.from(transcript, "utf8");
  const summary = buildPodcastTopicGuide(transcript, snapshot, resolvedHostNames);
  const memory = await buildPodcastMemory(transcript);

  return {
    transcript,
    summary,
    memory,
    audioAttachment: new AttachmentBuilder(mp3Buffer, {
      name: `fantasy-podcast-week-${snapshot.currentScoringPeriod}.mp3`
    }),
    transcriptAttachment: new AttachmentBuilder(transcriptBuffer, {
      name: `fantasy-podcast-week-${snapshot.currentScoringPeriod}.txt`
    })
  };
}

export async function buildEmergencyPodcastPackage(
  snapshot,
  focusTransaction,
  podcastHistory,
  timezone,
  renderer = config.podcastRenderer,
  hostNames = {},
  linkedManagersContext = "",
  reporterContextText = "",
  socialDiscussionText = ""
) {
  const resolvedHostNames = resolveHostNames(hostNames);
  const transcript = await generateText({
    systemPrompt:
      "You are a writers' room for a short emergency fantasy baseball podcast bulletin. Write lively, funny, radio-ready dialogue for three hosts who know each other well. Keep it focused on one breaking league event, around 180-320 words total, with fast pacing and distinct personalities. The lead host should frame the emergency, the hot take host should overreact, and the analyst should stabilize the conversation. If recent social-channel discussion is provided, let the hosts reference the league reaction and chatter around the move. Never put raw Discord mention tokens like <@123> into the spoken transcript.",
    userPrompt: [
      `Write an emergency mini-episode for ${formatDateTime(new Date(), timezone)}.`,
      `Focus event: ${focusTransaction.teamName} made a ${focusTransaction.type}${focusTransaction.biddingAmount ? ` for $${focusTransaction.biddingAmount}` : ""}.`,
      `Players involved: ${focusTransaction.players.map((player) => `${player.type} ${player.name}`).join(", ") || "No named players provided."}`,
      "This is triggered by league reaction in Discord, so the hosts should treat it like a breaking-news segment.",
      `Hosts: ${resolvedHostNames.lead} (lead), ${resolvedHostNames.hotTake} (hot take), ${resolvedHostNames.analyst} (analyst).`,
      "Include a quick cold open, one breaking-news exchange, one argument about impact, and a short sign-off.",
      podcastHistory ? `Recent show memory:\n${podcastHistory}` : "",
      linkedManagersContext ? `Linked Discord users for reference only:\n${linkedManagersContext}` : "",
      reporterContextText ? `Reporter quotes and requests for comment:\n${reporterContextText}` : "",
      socialDiscussionText ? `Recent social channel discussion:\n${socialDiscussionText}` : ""
    ].filter(Boolean).join("\n\n"),
    temperature: 1
  });

  const memory = await buildPodcastMemory(transcript);
  const mp3Buffer = await buildPodcastPackageAudio(transcript, renderer, resolvedHostNames);

  return {
    transcript,
    summary: buildPodcastTopicGuideWithMetadata(transcript, snapshot, resolvedHostNames, {
      title: "Emergency Bullpen",
      subtitle: "Breaking news from the Backyard Baseball Association"
    }),
    memory,
    audioAttachment: new AttachmentBuilder(mp3Buffer, {
      name: `emergency-bullpen-${focusTransaction.id}.mp3`
    }),
    transcriptAttachment: new AttachmentBuilder(Buffer.from(transcript, "utf8"), {
      name: `emergency-bullpen-${focusTransaction.id}.txt`
    })
  };
}

export async function buildDemoPodcastPackage(
  snapshot,
  timezone,
  renderer = config.podcastRenderer,
  manualContext = "",
  hostNames = {}
) {
  const resolvedHostNames = resolveHostNames(hostNames);
  const manualContextLine = manualContext.trim()
    ? `${resolvedHostNames.lead}: Before we get rolling, producer's note for the room: ${manualContext.trim().slice(0, 280)}`
    : null;
  const transcript = [
    ...(manualContextLine ? [manualContextLine] : []),
    `${resolvedHostNames.lead}: Welcome to The Backyard Bullpen. We are back, the Backyard Baseball Association is already noisy, and ${resolvedHostNames.hotTake} has somehow reopened the panic meter before breakfast.`,
    `${resolvedHostNames.hotTake}: Because the panic meter is a public service, ${resolvedHostNames.lead}. I am here for the people.`,
    `${resolvedHostNames.analyst}: You are here for the overreaction. The people are just caught in the blast radius.`,
    `${resolvedHostNames.lead}: That's fair. Also, ${resolvedHostNames.analyst} laughed at that, which means we should mark the tape. Historic moment for the show.`,
    `${resolvedHostNames.hotTake}: ${resolvedHostNames.analyst} laughs every time I tell the truth. She just does it like she's grading a paper.`,
    `${resolvedHostNames.analyst}: I laugh when you're accidentally insightful. It keeps the show fresh.`,
    `${resolvedHostNames.lead}: On the field, ${snapshot.teams[0].name} still looks like the team everyone is chasing, but ${snapshot.teams[1].name} is making this a real conversation.`,
    `${resolvedHostNames.hotTake}: Real conversation? That's a title fight. That's two teams in the middle of the ring and one of them is carrying a folding chair.`,
    `${resolvedHostNames.analyst}: And this is why I have to translate for the audience. What ${resolvedHostNames.hotTake} means is the top-end talent is real, but roster balance may decide it.`,
    `${resolvedHostNames.lead}: Meanwhile, Waiver Wire Wizards spent seventeen dollars on Jackson Holliday, which means ${resolvedHostNames.hotTake} has now started the annual April coronation segment.`,
    `${resolvedHostNames.hotTake}: Annual? Timeless. Some people see a waiver claim. I see destiny with middle infield eligibility.`,
    `${resolvedHostNames.analyst}: Last week your destiny speech ended with you declaring the panic meter broken and then panicking for half an hour.`,
    `${resolvedHostNames.lead}: Also, ${snapshot.matchups[0].homeTeam} is flattening ${snapshot.matchups[0].awayTeam} this week, and I can already hear the disrespectful-before-breakfast trade offers being drafted as we speak.`,
    `${resolvedHostNames.hotTake}: Good. Send them. Let chaos breathe.`,
    `${resolvedHostNames.analyst}: And then act shocked when the group chat remembers who sent them. That's another beautiful league tradition.`,
    `${resolvedHostNames.lead}: That's the show. ${resolvedHostNames.hotTake} is still crowning teams in April, ${resolvedHostNames.analyst} is still delivering drive-by reality checks, and the panic meter remains legally questionable. We'll catch you next time on The Backyard Bullpen.`
  ].join("\n");

  const summary = [
    buildPodcastTopicGuide(transcript, snapshot, resolvedHostNames)
  ].join("\n");
  const memory = [
    `Running jokes: ${resolvedHostNames.hotTake}'s annual April coronation, the panic meter, disrespectful-before-breakfast trade offers, and ${resolvedHostNames.lead} noting every time ${resolvedHostNames.analyst} visibly enjoys the chaos.`,
    `Host chemistry: ${resolvedHostNames.lead} plays ringmaster, ${resolvedHostNames.hotTake} detonates takes on purpose, and ${resolvedHostNames.analyst} dryly punctures both of them before reluctantly laughing.`,
    `League storylines: ${snapshot.teams[0].name} still sets the pace, while ${snapshot.teams[1].name} keeps drawing contender talk because of roster balance and steady pressure.${manualContext.trim() ? ` Manual context in play: ${manualContext.trim().slice(0, 180)}` : ""}`
  ].join("\n");

  return {
    transcript,
    summary,
    memory,
    audioAttachment: new AttachmentBuilder(await buildPodcastPackageAudio(transcript, renderer, resolvedHostNames), {
      name: `fantasy-podcast-demo-week-${snapshot.currentScoringPeriod}.mp3`
    }),
    transcriptAttachment: new AttachmentBuilder(Buffer.from(transcript, "utf8"), {
      name: `fantasy-podcast-demo-week-${snapshot.currentScoringPeriod}.txt`
    })
  };
}
