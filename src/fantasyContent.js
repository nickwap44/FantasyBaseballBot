import { AttachmentBuilder } from "discord.js";
import { combineWavBuffersToMp3 } from "./audio.js";
import { generateSpeech, generateText } from "./openaiClient.js";
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

function matchupBlock(matchups) {
  return matchups
    .map(
      (matchup) =>
        `- ${matchup.awayTeam} ${matchup.awayScore.toFixed(1)} at ${matchup.homeTeam} ${matchup.homeScore.toFixed(1)}`
    )
    .join("\n");
}

export async function buildTransactionsSummary(snapshot, timezone) {
  return generateText({
    systemPrompt:
      "You are an entertaining but accurate fantasy football league reporter. Write a concise daily transaction recap for Discord with a headline and 3-5 bullets.",
    userPrompt: [
      `League transaction activity as of ${formatDateTime(new Date(), timezone)}:`,
      recentTransactionsBlock(snapshot.transactions)
    ].join("\n\n")
  });
}

export async function buildPowerRankings(snapshot, timezone) {
  return generateText({
    systemPrompt:
      "You are a sharp fantasy football columnist. Write weekly power rankings for Discord. Include two sections: current performance rankings and strongest rosters right now. Be punchy but grounded in the data.",
    userPrompt: [
      `Generate power rankings as of ${formatDateTime(new Date(), timezone)}.`,
      "Standings:",
      standingsBlock(snapshot.teams),
      "",
      "Current week's matchups:",
      matchupBlock(snapshot.matchups),
      "",
      "Strongest roster candidates:",
      strongestTeamsBlock(snapshot.teams)
    ].join("\n")
  });
}

export async function buildSocialPost(snapshot, timezone) {
  return generateText({
    systemPrompt:
      "You write one fake social-media post for a fantasy football league. Pick one exaggerated persona, react to a real league event, keep it under 120 words, and make it feel like a single post rather than a recap.",
    userPrompt: [
      `Create a post for ${formatDateTime(new Date(), timezone)}.`,
      "Recent transactions:",
      recentTransactionsBlock(snapshot.transactions.slice(0, 5)),
      "",
      "League standings:",
      standingsBlock(snapshot.teams.slice(0, 6))
    ].join("\n")
  });
}

function buildPodcastPrompt(snapshot, historyText, timezone) {
  return [
    "Write a fantasy football podcast transcript for three hosts.",
    "Host 1: Mason, the straight man and lead host. He runs the show and introduces segments.",
    "Host 2: Rico, the hot take artist who overreacts and flies off the handle.",
    "Host 3: Elena, the steady analyst who grounds everything in evidence.",
    "Keep the total transcript in the 5-10 minute range, roughly 700-1200 words.",
    "Include a cold open, one standings segment, one matchup/results segment, one transactions/news segment, and one closing prediction segment.",
    "The hosts should sound like they know each other and reference prior talking points naturally.",
    "Make every line start with the speaker name followed by a colon.",
    `Current generation time: ${formatDateTime(new Date(), timezone)}`,
    "",
    "Recent podcast memory:",
    historyText || "No prior episode notes yet.",
    "",
    "Standings:",
    standingsBlock(snapshot.teams),
    "",
    "Current matchups/results:",
    matchupBlock(snapshot.matchups),
    "",
    "Recent transactions:",
    recentTransactionsBlock(snapshot.transactions)
  ].join("\n");
}

function parseTranscriptLines(transcript) {
  return transcript
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf(":");
      if (separator === -1) {
        return { speaker: "Mason", text: line };
      }

      return {
        speaker: line.slice(0, separator).trim(),
        text: line.slice(separator + 1).trim()
      };
    })
    .filter((line) => line.text);
}

function getVoiceForSpeaker(speaker) {
  const normalized = speaker.toLowerCase();
  if (normalized.includes("rico")) {
    return "ash";
  }

  if (normalized.includes("elena")) {
    return "sage";
  }

  return "alloy";
}

export async function buildPodcastPackage(snapshot, podcastHistory, timezone) {
  const transcript = await generateText({
    systemPrompt:
      "You are a writers' room for a comedy-inflected fantasy football podcast. Make the dialogue lively, specific, and rooted in the supplied league data.",
    userPrompt: buildPodcastPrompt(snapshot, podcastHistory, timezone),
    temperature: 1
  });

  const lines = parseTranscriptLines(transcript).slice(0, 80);
  const wavBuffers = [];

  for (const line of lines) {
    wavBuffers.push(
      await generateSpeech({
        text: line.text,
        voice: getVoiceForSpeaker(line.speaker),
        format: "wav"
      })
    );
  }

  const mp3Buffer = combineWavBuffersToMp3(wavBuffers);
  const transcriptBuffer = Buffer.from(transcript, "utf8");
  const summary = await generateText({
    systemPrompt:
      "Summarize a fantasy football podcast transcript in 4 short bullets. Preserve any running jokes or callbacks.",
    userPrompt: transcript
  });

  return {
    transcript,
    summary,
    audioAttachment: new AttachmentBuilder(mp3Buffer, {
      name: `fantasy-podcast-week-${snapshot.currentScoringPeriod}.mp3`
    }),
    transcriptAttachment: new AttachmentBuilder(transcriptBuffer, {
      name: `fantasy-podcast-week-${snapshot.currentScoringPeriod}.txt`
    })
  };
}
