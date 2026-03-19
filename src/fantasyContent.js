import { AttachmentBuilder } from "discord.js";
import { stitchMp3Segments } from "./audioAssembler.js";
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
    "The hosts should sound like long-time friends and recurring co-hosts who know each other's rhythms.",
    "They should tease each other, laugh, interrupt lightly, and keep a few running jokes alive across episodes.",
    "Use the memory block as canon for inside jokes, unresolved debates, and recurring bits.",
    "Include at least two playful callbacks or inside-joke moments when the memory block gives you something to use.",
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

export function getVoiceForSpeaker(speaker, renderer = "tts") {
  const normalized = speaker.toLowerCase();
  if (renderer === "realtime") {
    if (normalized.includes("mason")) {
      return "cedar";
    }

    if (normalized.includes("rico")) {
      return "ash";
    }

    return "marin";
  }

  if (normalized.includes("mason")) {
    return "cedar";
  }

  if (normalized.includes("rico")) {
    return "ash";
  }

  return "marin";
}

export function getVoiceInstructionsForSpeaker(speaker) {
  const normalized = speaker.toLowerCase();

  if (normalized.includes("rico")) {
    return [
      "Sound energetic, impulsive, and a little unhinged in a fun sports-radio way.",
      "Punch key words, vary pacing, and lean into hot-take confidence.",
      "Let quick laughs, incredulous scoffs, and playful jabs come through naturally.",
      "Keep it natural and conversational, not announcer-stiff."
    ].join(" ");
  }

  if (normalized.includes("elena")) {
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

function buildNarratedTranscript(transcript) {
  return parseTranscriptLines(transcript)
    .slice(0, 80)
    .filter((line) => line.text);
}

async function buildTtsPodcastAudio(transcript) {
  const lines = buildNarratedTranscript(transcript);
  const segments = [];

  for (const line of lines) {
    segments.push(
      await generateSpeech({
        text: line.text,
        voice: getVoiceForSpeaker(line.speaker, "tts"),
        format: "mp3",
        instructions: getVoiceInstructionsForSpeaker(line.speaker)
      })
    );
  }

  return stitchMp3Segments(segments);
}

async function buildPodcastAudio(transcript, renderer) {
  const lines = buildNarratedTranscript(transcript);
  if (renderer === "realtime") {
    return buildRealtimePodcastAudio(lines, (speaker) => getVoiceForSpeaker(speaker, "realtime"), getVoiceInstructionsForSpeaker);
  }

  return buildTtsPodcastAudio(transcript);
}

async function buildPodcastMemory(transcript) {
  return generateText({
    systemPrompt:
      "Extract durable podcast memory for future episodes. Return three short sections titled Running jokes, Host chemistry, and League storylines. Keep it concise and specific.",
    userPrompt: transcript
  });
}

export async function buildPodcastPackage(snapshot, podcastHistory, timezone, renderer = config.podcastRenderer) {
  const transcript = await generateText({
    systemPrompt:
      "You are a writers' room for a comedy-inflected fantasy baseball podcast. Make the dialogue lively, specific, and rooted in the supplied league data. Write like real people talking into microphones, with rhythm, overlap, and personality. If the league is pre-draft, focus on draft hype, projected contenders, and personality-driven banter.",
    userPrompt: buildPodcastPrompt(snapshot, podcastHistory, timezone),
    temperature: 1
  });

  const mp3Buffer = await buildPodcastAudio(transcript, renderer);
  const transcriptBuffer = Buffer.from(transcript, "utf8");
  const summary = await generateText({
    systemPrompt:
      "Summarize a fantasy baseball podcast transcript in 4 short bullets. Preserve any running jokes or callbacks.",
    userPrompt: transcript
  });
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

export async function buildDemoPodcastPackage(
  snapshot,
  timezone,
  renderer = config.podcastRenderer
) {
  const transcript = [
    "Mason: Welcome back to the league podcast. The standings are tight, Rico is already trying to hand out a trophy in April, and somehow Elena is still pretending she's not enjoying this.",
    "Rico: Pretending? Elena loves it. She just smiles like a Bond villain instead of yelling like I do.",
    "Elena: That is not true. I smile like a person watching you declare a dynasty every time someone wins two waiver claims in a row.",
    "Mason: There it is. Thirty seconds in and we're already back to Rico's annual April coronation.",
    "Rico: Because I have vision, Mason. Waiver Wire Wizards dropped seventeen bucks on Jackson Holliday and I can feel history happening.",
    "Elena: You felt history last week when you said the panic meter was broken, and then you immediately panicked for twelve straight minutes.",
    "Mason: We do need to put the panic meter on a T-shirt at this point. That's become a real problem for the league.",
    `Mason: Anyway, ${snapshot.teams[0].name} is sitting on top right now, but ${snapshot.teams[1].name} is close enough to make this interesting fast.`,
    "Rico: Close enough? They're lurking. That's a roster that walks into the room and steals your lunch money.",
    "Elena: The offense is real, but the bigger thing is roster balance. They don't need hero-ball from one superstar every night.",
    `Mason: And meanwhile ${snapshot.matchups[0].homeTeam} is putting a pretty loud number on ${snapshot.matchups[0].awayTeam} this week, which is going to restart every group chat argument we already had on Sunday.`,
    "Rico: Good. That's what the league is for. Mild overreaction, selective memory, and one truly disrespectful trade offer before breakfast.",
    "Elena: Which, for the record, is still the funniest running bit in this league because none of you think you're the one sending the disrespectful offer.",
    "Mason: That's the show. Rico is crowning teams, Elena is rolling her eyes in 4K, and the panic meter remains deeply compromised. We'll see you next episode."
  ].join("\n");

  const summary = [
    "- Mason steered the show while calling back to Rico's habit of crowning teams too early.",
    "- Rico went all in on the Jackson Holliday move and doubled down on the annual April coronation bit.",
    `- Elena countered with steadier analysis and backed ${snapshot.teams[1].name} as a real contender for sustainable reasons.`,
    "- The panic meter and disrespectful-before-breakfast trade offers both returned as recurring inside jokes."
  ].join("\n");
  const memory = [
    "Running jokes: Rico's annual April coronation, the broken panic meter, and the disrespectful-before-breakfast trade offer bit.",
    "Host chemistry: Mason referees the room with amused frustration, Rico barges into takes at full speed, and Elena lands dry counters that make both of them crack up.",
    `League storylines: ${snapshot.teams[0].name} looks like the current standard, while ${snapshot.teams[1].name} keeps getting real contender buzz because of roster balance.`
  ].join("\n");

  return {
    transcript,
    summary,
    memory,
    audioAttachment: new AttachmentBuilder(await buildPodcastAudio(transcript, renderer), {
      name: `fantasy-podcast-demo-week-${snapshot.currentScoringPeriod}.mp3`
    }),
    transcriptAttachment: new AttachmentBuilder(Buffer.from(transcript, "utf8"), {
      name: `fantasy-podcast-demo-week-${snapshot.currentScoringPeriod}.txt`
    })
  };
}
