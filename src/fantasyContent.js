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

function matchupBlock(matchups) {
  return matchups
    .map(
      (matchup) =>
        `- ${matchup.awayTeam} ${matchup.awayScore.toFixed(1)} at ${matchup.homeTeam} ${matchup.homeScore.toFixed(1)}`
    )
    .join("\n");
}

const PODCAST_TITLE = "The Backyard Bullpen";
const PODCAST_SUBTITLE = "The official podcast of the Backyard Baseball Association";
const PODCAST_SEGMENTS = [
  "Lead-off Check-In",
  "Panic Meter",
  "The April Coronation Watch",
  "Waiver Wire Crimes",
  "Disrespectful Trade Offer of the Week",
  "Bullpen Close"
];

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
    `Use these recurring show segments when they fit: ${PODCAST_SEGMENTS.join(", ")}.`,
    "Mason should actively introduce segment names like a real recurring show.",
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

async function buildPodcastPackageAudio(transcript, renderer) {
  const introMusic = await generateMusicCue("intro");
  const introTitle = await generateSpeech({
    text: `${PODCAST_TITLE}. ${PODCAST_SUBTITLE}.`,
    voice: getVoiceForSpeaker("Mason", renderer),
    format: "mp3",
    instructions:
      "Deliver this like a polished podcast show title. Warm, upbeat, and confident."
  });
  const bumper = await generateSpeech({
    text: "Now, here's Mason, Rico, and Elena.",
    voice: getVoiceForSpeaker("Mason", renderer),
    format: "mp3",
    instructions:
      "Read this like a short show bumper leading into the hosts. Crisp and energetic."
  });
  const body = await buildPodcastAudio(transcript, renderer);
  const outroBumper = await generateSpeech({
    text: `You've been listening to ${PODCAST_TITLE}. Thanks for tuning in to the Backyard Baseball Association.`,
    voice: getVoiceForSpeaker("Mason", renderer),
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

export async function buildTransactionGrades(snapshot, timezone, registryText = "") {
  return generateText({
    systemPrompt:
      "You are the fantasy baseball media desk for the Backyard Baseball Association. Grade recent waivers and trades immediately after they happen. Use short sections, letter grades, and one sharp line of analysis per move. Work in any supplied running jokes or host biases when relevant.",
    userPrompt: [
      `Generate instant transaction grades for ${formatDateTime(new Date(), timezone)}.`,
      registryText ? `Media registry:\n${registryText}` : "",
      "Transactions:",
      recentTransactionsBlock(snapshot.transactions.slice(0, 5))
    ].filter(Boolean).join("\n\n")
  });
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

export async function buildPodcastPackage(snapshot, podcastHistory, timezone, renderer = config.podcastRenderer) {
  const transcript = await generateText({
    systemPrompt:
      "You are a writers' room for a comedy-inflected fantasy baseball podcast. Make the dialogue lively, specific, and rooted in the supplied league data. Write like real people talking into microphones, with rhythm, overlap, and personality. If the league is pre-draft, focus on draft hype, projected contenders, and personality-driven banter.",
    userPrompt: buildPodcastPrompt(snapshot, podcastHistory, timezone),
    temperature: 1
  });

  const mp3Buffer = await buildPodcastPackageAudio(transcript, renderer);
  const transcriptBuffer = Buffer.from(transcript, "utf8");
  const summary = await generateText({
    systemPrompt:
      "Summarize a fantasy baseball podcast transcript in 4 short bullets. Preserve any running jokes or callbacks.",
    userPrompt: transcript
  });
  const memory = await buildPodcastMemory(transcript);

  return {
    transcript,
    summary: `**${PODCAST_TITLE}**\n${PODCAST_SUBTITLE}\n\n${summary}`,
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
    "Mason: Welcome to The Backyard Bullpen. We are back, the Backyard Baseball Association is already noisy, and Rico has somehow reopened the panic meter before breakfast.",
    "Rico: Because the panic meter is a public service, Mason. I am here for the people.",
    "Elena: You are here for the overreaction. The people are just caught in the blast radius.",
    "Mason: That's fair. Also, Elena laughed at that, which means we should mark the tape. Historic moment for the show.",
    "Rico: She laughs every time I tell the truth. She just does it like she's grading a paper.",
    "Elena: I laugh when you're accidentally insightful. It keeps the show fresh.",
    `Mason: On the field, ${snapshot.teams[0].name} still looks like the team everyone is chasing, but ${snapshot.teams[1].name} is making this a real conversation.`,
    "Rico: Real conversation? That's a title fight. That's two teams in the middle of the ring and one of them is carrying a folding chair.",
    "Elena: And this is why I have to translate for the audience. What Rico means is the top-end talent is real, but roster balance may decide it.",
    "Mason: Meanwhile, Waiver Wire Wizards spent seventeen dollars on Jackson Holliday, which means Rico has now started his annual April coronation segment.",
    "Rico: Annual? Timeless. Some people see a waiver claim. I see destiny with middle infield eligibility.",
    "Elena: Last week your destiny speech ended with you declaring the panic meter broken and then panicking for half an hour.",
    `Mason: Also, ${snapshot.matchups[0].homeTeam} is flattening ${snapshot.matchups[0].awayTeam} this week, and I can already hear the disrespectful-before-breakfast trade offers being drafted as we speak.`,
    "Rico: Good. Send them. Let chaos breathe.",
    "Elena: And then act shocked when the group chat remembers who sent them. That's another beautiful league tradition.",
    "Mason: That's the show. Rico is still crowning teams in April, Elena is still delivering drive-by reality checks, and the panic meter remains legally questionable. We'll catch you next time on The Backyard Bullpen."
  ].join("\n");

  const summary = [
    "- Mason framed the episode as a proper Backyard Bullpen show open and steered the room through the familiar chaos.",
    "- Rico revived the April coronation bit around the Jackson Holliday add and fully embraced the panic meter nonsense again.",
    `- Elena played cleanup with dry humor and gave a more grounded read on ${snapshot.teams[1].name} as a real threat.`,
    "- The panic meter, disrespectful-before-breakfast trade offers, and Elena's rare laughter all came back as running bits."
  ].join("\n");
  const memory = [
    "Running jokes: Rico's annual April coronation, the panic meter, disrespectful-before-breakfast trade offers, and Mason noting every time Elena visibly enjoys the chaos.",
    "Host chemistry: Mason plays ringmaster, Rico detonates takes on purpose, and Elena dryly punctures both of them before reluctantly laughing.",
    `League storylines: ${snapshot.teams[0].name} still sets the pace, while ${snapshot.teams[1].name} keeps drawing contender talk because of roster balance and steady pressure.`
  ].join("\n");

  return {
    transcript,
    summary: `**${PODCAST_TITLE}**\n${PODCAST_SUBTITLE}\n\n${summary}`,
    memory,
    audioAttachment: new AttachmentBuilder(await buildPodcastPackageAudio(transcript, renderer), {
      name: `fantasy-podcast-demo-week-${snapshot.currentScoringPeriod}.mp3`
    }),
    transcriptAttachment: new AttachmentBuilder(Buffer.from(transcript, "utf8"), {
      name: `fantasy-podcast-demo-week-${snapshot.currentScoringPeriod}.txt`
    })
  };
}
