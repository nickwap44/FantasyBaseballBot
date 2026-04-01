import { getRecentMlbHighlights, matchHighlightsToPlayers } from "./mlbHighlights.js";

const MLB_STATS_API_URL = "https://statsapi.mlb.com/api/v1";
const MAX_GROUNDED_PLAYERS = 10;
const MAX_HIGHLIGHTS_PER_PLAYER = 2;

function normalizeText(value = "") {
  return value
    .normalize("NFKD")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function collectTransactionPlayerNames(snapshot) {
  return unique(
    (snapshot.transactions || [])
      .slice(0, 10)
      .flatMap((transaction) => transaction.players || [])
      .map((player) => player.name)
  );
}

function collectRosterPlayerNames(snapshot) {
  return unique(
    (snapshot.teams || [])
      .flatMap((team) => team.roster || [])
      .filter((entry) => entry.lineupSlotId < 20)
      .map((entry) => entry.playerName)
  );
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function searchMlbPlayerByName(playerName) {
  const url = new URL(`${MLB_STATS_API_URL}/people/search`);
  url.searchParams.set("sportId", "1");
  url.searchParams.set("names", playerName);

  const payload = await fetchJson(url);
  const people = payload.people || [];
  if (!people.length) {
    return null;
  }

  const normalizedTarget = normalizeText(playerName);
  const exactMatch =
    people.find((person) => normalizeText(person.fullName || "") === normalizedTarget) || people[0];

  if (!exactMatch?.id) {
    return null;
  }

  return {
    id: exactMatch.id,
    fullName: exactMatch.fullName || playerName,
    primaryPosition: exactMatch.primaryPosition?.abbreviation || "",
    currentTeam: exactMatch.currentTeam?.name || ""
  };
}

function getDateOffset(daysBack) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysBack);
  return date.toISOString().slice(0, 10);
}

function extractStatSplit(payload) {
  return payload?.stats?.[0]?.splits?.[0]?.stat || null;
}

async function fetchMlbStats(playerId, season, group, statsType, extraParams = {}) {
  const url = new URL(`${MLB_STATS_API_URL}/people/${playerId}/stats`);
  url.searchParams.set("stats", statsType);
  url.searchParams.set("group", group);
  url.searchParams.set("season", String(season));
  url.searchParams.set("sportId", "1");

  for (const [key, value] of Object.entries(extraParams)) {
    if (value != null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const payload = await fetchJson(url);
  return extractStatSplit(payload);
}

function buildHitterSummary(stats, label) {
  if (!stats) {
    return null;
  }

  const parts = [];
  if (stats.avg) {
    parts.push(`AVG ${stats.avg}`);
  }
  if (stats.ops) {
    parts.push(`OPS ${stats.ops}`);
  }
  if (stats.homeRuns != null) {
    parts.push(`HR ${stats.homeRuns}`);
  }
  if (stats.rbi != null) {
    parts.push(`RBI ${stats.rbi}`);
  }
  if (stats.stolenBases != null) {
    parts.push(`SB ${stats.stolenBases}`);
  }

  return parts.length ? `${label}: ${parts.join(", ")}` : null;
}

function buildPitcherSummary(stats, label) {
  if (!stats) {
    return null;
  }

  const parts = [];
  if (stats.era) {
    parts.push(`ERA ${stats.era}`);
  }
  if (stats.whip) {
    parts.push(`WHIP ${stats.whip}`);
  }
  if (stats.inningsPitched) {
    parts.push(`IP ${stats.inningsPitched}`);
  }
  if (stats.strikeOuts != null) {
    parts.push(`K ${stats.strikeOuts}`);
  }
  if (stats.saves != null && Number(stats.saves) > 0) {
    parts.push(`SV ${stats.saves}`);
  }
  if (stats.wins != null) {
    parts.push(`W ${stats.wins}`);
  }

  return parts.length ? `${label}: ${parts.join(", ")}` : null;
}

function chooseStatMode(player, hittingSeason, pitchingSeason) {
  const position = (player.primaryPosition || "").toUpperCase();
  if (["SP", "RP", "P"].includes(position)) {
    return pitchingSeason ? "pitching" : hittingSeason ? "hitting" : null;
  }

  if (["DH", "OF", "IF", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"].includes(position)) {
    return hittingSeason ? "hitting" : pitchingSeason ? "pitching" : null;
  }

  if (pitchingSeason && !hittingSeason) {
    return "pitching";
  }

  if (hittingSeason) {
    return "hitting";
  }

  return pitchingSeason ? "pitching" : null;
}

async function buildPlayerFactEntry(playerName, season, highlightsByPlayer) {
  try {
    const player = await searchMlbPlayerByName(playerName);
    const matchedHighlights = (highlightsByPlayer.get(playerName) || []).slice(0, MAX_HIGHLIGHTS_PER_PLAYER);
    if (!player) {
      if (!matchedHighlights.length) {
        return null;
      }

      return [
        `- ${playerName}:`,
        ...matchedHighlights.map((highlight) => `  Highlight: ${highlight.title}`)
      ].join("\n");
    }

    const recentStartDate = getDateOffset(7);
    const recentEndDate = new Date().toISOString().slice(0, 10);

    const [hittingSeason, pitchingSeason, hittingRecent, pitchingRecent] = await Promise.all([
      fetchMlbStats(player.id, season, "hitting", "season").catch(() => null),
      fetchMlbStats(player.id, season, "pitching", "season").catch(() => null),
      fetchMlbStats(player.id, season, "hitting", "byDateRange", {
        startDate: recentStartDate,
        endDate: recentEndDate
      }).catch(() => null),
      fetchMlbStats(player.id, season, "pitching", "byDateRange", {
        startDate: recentStartDate,
        endDate: recentEndDate
      }).catch(() => null)
    ]);

    const mode = chooseStatMode(player, hittingSeason, pitchingSeason);
    const lines = [`- ${player.fullName}:`];

    if (player.currentTeam || player.primaryPosition) {
      lines.push(
        `  MLB context: ${[player.currentTeam, player.primaryPosition].filter(Boolean).join(" | ")}`
      );
    }

    if (mode === "pitching") {
      const recentLine = buildPitcherSummary(pitchingRecent, "Last 7 days");
      const seasonLine = buildPitcherSummary(pitchingSeason, `Season ${season}`);
      if (recentLine) {
        lines.push(`  ${recentLine}`);
      }
      if (seasonLine) {
        lines.push(`  ${seasonLine}`);
      }
    } else {
      const recentLine = buildHitterSummary(hittingRecent, "Last 7 days");
      const seasonLine = buildHitterSummary(hittingSeason, `Season ${season}`);
      if (recentLine) {
        lines.push(`  ${recentLine}`);
      }
      if (seasonLine) {
        lines.push(`  ${seasonLine}`);
      }
    }

    for (const highlight of matchedHighlights) {
      lines.push(`  Highlight: ${highlight.title}`);
    }

    return lines.length > 1 ? lines.join("\n") : null;
  } catch (error) {
    console.warn(`Failed to build grounded player context for ${playerName}.`, {
      message: error.message
    });
    return null;
  }
}

function buildHighlightsByPlayer(highlights = [], playerNames = []) {
  const matches = matchHighlightsToPlayers(highlights, playerNames);
  const byPlayer = new Map();

  for (const match of matches) {
    const existing = byPlayer.get(match.playerName) || [];
    existing.push(match);
    byPlayer.set(match.playerName, existing);
  }

  return byPlayer;
}

export async function buildGroundedPlayerContext(snapshot, season = new Date().getFullYear()) {
  const transactionPlayers = collectTransactionPlayerNames(snapshot);
  const rosterPlayers = collectRosterPlayerNames(snapshot);
  const highlights = await getRecentMlbHighlights().catch((error) => {
    console.warn("Failed to fetch MLB highlights for grounded player context.", {
      message: error.message
    });
    return [];
  });

  const highlightsByPlayer = buildHighlightsByPlayer(highlights, rosterPlayers);
  const highlightedPlayers = [...highlightsByPlayer.keys()];
  const candidatePlayers = unique([...transactionPlayers, ...highlightedPlayers]).slice(0, MAX_GROUNDED_PLAYERS);

  if (!candidatePlayers.length) {
    return "";
  }

  const entries = await Promise.all(
    candidatePlayers.map((playerName) => buildPlayerFactEntry(playerName, season, highlightsByPlayer))
  );

  const validEntries = entries.filter(Boolean);
  if (!validEntries.length) {
    return "";
  }

  return [
    "Grounded player notes:",
    "Use only these notes for claims about MLB performance, role, or recent form.",
    "If a player is not covered here, do not invent hot streaks, slumps, injuries, or role changes.",
    "",
    ...validEntries
  ].join("\n");
}
