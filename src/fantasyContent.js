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
      "You are an entertaining but accurate fantasy baseball league reporter. Write a concise daily transaction recap for Discord with a headline and 3-5 bullets. If there is no activity yet, say that the league is still quiet and preview what managers should watch for.",
    userPrompt: [
      `League transaction activity as of ${formatDateTime(new Date(), timezone)}:`,
      recentTransactionsBlock(snapshot.transactions)
    ].join("\n\n")
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
      return `- ${transaction.teamName} made a ${transaction.type.toLowerCase()}${bid}: ${players}`;
    }),
    "",
    "Takeaway: the waiver wire is already getting spicy, and managers are starting to show their tells."
  ].join("\n");
}

export async function buildPowerRankings(snapshot, timezone) {
  if (snapshot.teams.length === 0) {
    return "No teams are populated in ESPN yet, so power rankings will unlock after the draft loads into the league.";
  }

  return generateText({
    systemPrompt:
      "You are a sharp fantasy baseball columnist. Write weekly power rankings for Discord. Include two sections: current performance rankings and strongest rosters right now. Be punchy but grounded in the data.",
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

export function buildDemoPowerRankings(snapshot, timezone) {
  const ranked = [...snapshot.teams]
    .sort((left, right) => scoreTeamStrength(right) - scoreTeamStrength(left))
    .slice(0, 5);

  return [
    `**Weekly Power Rankings Demo**`,
    `Generated for ${formatDateTime(new Date(), timezone)}`,
    "",
    ...ranked.map(
      (team, index) =>
        `${index + 1}. ${team.name} (${team.manager}) - ${team.wins}-${team.losses}, PF ${team.pointsFor.toFixed(1)}`
    ),
    "",
    `Biggest riser: ${ranked[1]?.name || ranked[0]?.name}`,
    `Most complete roster right now: ${ranked[0]?.name}`
  ].join("\n");
}

export async function buildSocialPost(snapshot, timezone) {
  return generateText({
    systemPrompt:
      "You write one fake social-media post for a fantasy baseball league. Pick one exaggerated persona, react to a real league event, keep it under 120 words, and make it feel like a single post rather than a recap. If the league is still pre-draft, make it about draft anticipation or early trash talk.",
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

export function buildDemoSocialPost(snapshot, timezone) {
  const topTransaction = snapshot.transactions[0];
  return [
    `**Social Feed Demo**`,
    `Posted ${formatDateTime(new Date(), timezone)}`,
    "",
    `"Waiver Wire Wizards just dropped $${topTransaction.biddingAmount} on Jackson Holliday like they're one move away from a dynasty. Respect the aggression, fear the hubris."`
  ].join("\n");
}

function buildPodcastPrompt(snapshot, historyText, timezone) {
  return [
    "Write a fantasy baseball podcast transcript for three hosts.",
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
      "You are a writers' room for a comedy-inflected fantasy baseball podcast. Make the dialogue lively, specific, and rooted in the supplied league data. If the league is pre-draft, focus on draft hype, projected contenders, and personality-driven banter.",
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
      "Summarize a fantasy baseball podcast transcript in 4 short bullets. Preserve any running jokes or callbacks.",
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

export async function buildDemoPodcastPackage(snapshot, timezone) {
  const transcript = [
    "Mason: Welcome back to the league podcast, where the standings are tight and the waiver claims are somehow even tighter.",
    "Rico: I am telling you right now, the Waiver Wire Wizards are drunk on power after that Jackson Holliday pickup.",
    "Elena: It was aggressive, but not irrational. They needed upside, and they found it.",
    `Mason: The current top of the table is ${snapshot.teams[0].name}, but ${snapshot.teams[1].name} is hanging right there and looks like a real threat.`,
    "Rico: Threat? They're lurking. That's a horror movie roster. Nobody wants that in a playoff bracket.",
    "Elena: The more interesting question is whether the middle tier has enough pitching depth to keep up over six months.",
    `Mason: Meanwhile, ${snapshot.matchups[0].homeTeam} is putting a number on ${snapshot.matchups[0].awayTeam} this week, and that's going to get people talking.`,
    "Rico: Talking? I'm yelling. Some of these bottom teams are already managing like it's July.",
    "Elena: Small sample caveat, but yes, some managers are definitely chasing too hard too early.",
    "Mason: That's it for this week's demo episode. Stay active, trust your process, and please stop offering lopsided trades before breakfast."
  ].join("\n");

  const summary = [
    "- Mason framed the week around tightening standings and active waiver movement.",
    "- Rico exploded over Waiver Wire Wizards going big on Jackson Holliday.",
    `- Elena flagged ${snapshot.teams[1].name} as a serious contender with sustainable upside.`,
    `- The hosts closed on ${snapshot.matchups[0].homeTeam} looking like the team to beat right now.`
  ].join("\n");

  const lines = parseTranscriptLines(transcript);
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

  return {
    transcript,
    summary,
    audioAttachment: new AttachmentBuilder(combineWavBuffersToMp3(wavBuffers), {
      name: `fantasy-podcast-demo-week-${snapshot.currentScoringPeriod}.mp3`
    }),
    transcriptAttachment: new AttachmentBuilder(Buffer.from(transcript, "utf8"), {
      name: `fantasy-podcast-demo-week-${snapshot.currentScoringPeriod}.txt`
    })
  };
}
