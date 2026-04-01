import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";

export const DEFAULT_STYLE_TRANSCRIPTS_DIR = path.resolve("data", "podcast-style-transcripts");
const SUPPORTED_EXTENSIONS = new Set([".txt", ".md"]);

const DEFAULT_ROLE_ALIASES = {
  lead: ["dan hanzus", "dan"],
  hotTake: ["marc sessler", "mark sessler", "marc", "mark"],
  analyst: ["conor orr", "conor"]
};

function parseAliasList(value, fallback) {
  if (!value?.trim()) {
    return fallback;
  }

  return value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function getRoleAliases() {
  return {
    lead: parseAliasList(config.podcastStyleLeadAliases, DEFAULT_ROLE_ALIASES.lead),
    hotTake: parseAliasList(config.podcastStyleHotTakeAliases, DEFAULT_ROLE_ALIASES.hotTake),
    analyst: parseAliasList(config.podcastStyleAnalystAliases, DEFAULT_ROLE_ALIASES.analyst)
  };
}

function normalizeSpeakerName(value = "") {
  return value
    .normalize("NFKD")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function getRoleForSpeaker(speaker, roleAliases) {
  const normalized = normalizeSpeakerName(speaker);

  for (const [role, aliases] of Object.entries(roleAliases)) {
    if (aliases.some((alias) => normalized === alias || normalized.includes(alias))) {
      return role;
    }
  }

  return null;
}

function parseTranscriptTurns(text, roleAliases) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf(":");
      if (separator === -1) {
        return null;
      }

      const speaker = line.slice(0, separator).trim();
      const role = getRoleForSpeaker(speaker, roleAliases);
      const body = line.slice(separator + 1).trim();
      if (!role || !body) {
        return null;
      }

      return {
        role,
        speaker,
        text: body
      };
    })
    .filter(Boolean);
}

function parseTranscriptUtterances(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^\d{2}:\d{2}:\d{2}$/.test(line))
    .filter((line) => !/^episodes analyzed:/i.test(line));
}

function wordCount(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

function average(values) {
  if (!values.length) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function ratio(numerator, denominator) {
  if (!denominator) {
    return 0;
  }

  return numerator / denominator;
}

function summarizeRoleMetrics(turns, role) {
  const roleTurns = turns.filter((turn) => turn.role === role);
  const texts = roleTurns.map((turn) => turn.text);
  const wordsPerTurn = texts.map(wordCount);
  const questionTurns = texts.filter((text) => text.includes("?")).length;
  const exclamationTurns = texts.filter((text) => text.includes("!")).length;
  const shortTurns = wordsPerTurn.filter((count) => count <= 8).length;
  const metaphorTurns = texts.filter((text) => /like|as if|feels like/i.test(text)).length;

  return {
    turns: roleTurns.length,
    avgWords: average(wordsPerTurn),
    questionRate: ratio(questionTurns, roleTurns.length),
    exclamationRate: ratio(exclamationTurns, roleTurns.length),
    shortTurnRate: ratio(shortTurns, roleTurns.length),
    metaphorRate: ratio(metaphorTurns, roleTurns.length)
  };
}

function describeShowEnergy(turns) {
  const avgWords = average(turns.map((turn) => wordCount(turn.text)));
  const shortTurnRate = ratio(
    turns.filter((turn) => wordCount(turn.text) <= 8).length,
    turns.length
  );

  if (avgWords <= 18 && shortTurnRate >= 0.2) {
    return "high-energy, quick-turn banter with frequent pop-ins and minimal monologues";
  }

  if (avgWords <= 24) {
    return "conversational and brisk, with regular host handoffs and short reactions";
  }

  return "more measured, but still conversational rather than essay-like";
}

function describeLead(metrics) {
  const traits = ["acts as the traffic cop and segment guide"];

  if (metrics.questionRate >= 0.2) {
    traits.push("uses questions and resets to keep the room moving");
  }

  if (metrics.avgWords >= 20) {
    traits.push("takes the longest setup turns before handing off");
  } else {
    traits.push("keeps intros tight and tees up others quickly");
  }

  return traits.join("; ");
}

function describeHotTake(metrics) {
  const traits = ["functions as the emotional accelerator"];

  if (metrics.exclamationRate >= 0.15) {
    traits.push("punches lines with high-emphasis reactions");
  }

  if (metrics.shortTurnRate >= 0.2) {
    traits.push("fires off short interjections and momentum swings");
  }

  if (metrics.metaphorRate >= 0.15) {
    traits.push("leans on images, odd comparisons, and theatrical phrasing");
  }

  return traits.join("; ");
}

function describeAnalyst(metrics) {
  const traits = ["acts as the grounding voice after chaos"];

  if (metrics.questionRate >= 0.15) {
    traits.push("clarifies with skeptical follow-up questions");
  }

  if (metrics.avgWords >= 16) {
    traits.push("gives concise but complete corrections and framing");
  } else {
    traits.push("cuts in with short, corrective reality checks");
  }

  return traits.join("; ");
}

async function getTranscriptFiles(dirPath) {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
      .map((entry) => path.join(dirPath, entry.name));
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

export async function buildPodcastStyleProfile() {
  const transcriptDir = config.podcastStyleTranscriptsDir || DEFAULT_STYLE_TRANSCRIPTS_DIR;
  const roleAliases = getRoleAliases();
  const files = await getTranscriptFiles(transcriptDir);

  if (!files.length) {
    return "";
  }

  const transcripts = await Promise.all(
    files.map(async (filePath) => {
      const text = await readFile(filePath, "utf8");
      return {
        turns: parseTranscriptTurns(text, roleAliases),
        utterances: parseTranscriptUtterances(text)
      };
    })
  );

  const turns = transcripts.flatMap((entry) => entry.turns).filter(Boolean);
  const utterances = transcripts.flatMap((entry) => entry.utterances).filter(Boolean);
  if (!utterances.length) {
    return "";
  }

  const leadMetrics = summarizeRoleMetrics(turns, "lead");
  const hotTakeMetrics = summarizeRoleMetrics(turns, "hotTake");
  const analystMetrics = summarizeRoleMetrics(turns, "analyst");
  const roleAware = turns.length > 0;
  const utteranceTurns = utterances.map((text) => ({ text }));

  return [
    "Transcript-derived show style profile:",
    `Episodes analyzed: ${files.length}`,
    `Overall energy: ${describeShowEnergy(utteranceTurns)}.`,
    "Use this as structural inspiration only. Do not quote, mimic, or reproduce any recognizable lines or bits from the source transcripts.",
    "",
    ...(roleAware
      ? [
          "Role dynamics:",
          `- Lead host archetype: ${describeLead(leadMetrics)}.`,
          `- Chaos host archetype: ${describeHotTake(hotTakeMetrics)}.`,
          `- Analyst host archetype: ${describeAnalyst(analystMetrics)}.`
        ]
      : [
          "Role dynamics:",
          "- Source transcripts were mostly unlabeled by speaker, so use them for overall pacing and chemistry rather than role-specific mimicry.",
          "- Keep a clear lead host, an energy-spiking host, and a grounding analyst as original characters."
        ]),
    "",
    "Format guidance:",
    "- Open with a quick cold open before the formal show setup.",
    "- Favor fast exchanges, layered reactions, and regular callbacks over long solo speeches.",
    "- Let the lead host reset the room when tangents get too loose.",
    "- Let the chaos host spike the energy, then have the analyst translate it back into something concrete.",
    "- Keep the chemistry loose, funny, and football-talk-radio adjacent, but still original to this league."
  ].join("\n");
}
