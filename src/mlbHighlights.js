import { getDateInTimezone } from "./time.js";

const MLB_SCHEDULE_URL = "https://statsapi.mlb.com/api/v1/schedule";
const MLB_GAME_CONTENT_URL = "https://statsapi.mlb.com/api/v1/game";
const HIGHLIGHT_LOOKBACK_HOURS = 36;

function normalizeText(value = "") {
  return value
    .normalize("NFKD")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function getGameDateRange(now) {
  const start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  return {
    startDate: getDateInTimezone(start, "America/New_York"),
    endDate: getDateInTimezone(now, "America/New_York")
  };
}

async function fetchScheduleRange(startDate, endDate) {
  const url = new URL(MLB_SCHEDULE_URL);
  url.searchParams.set("sportId", "1");
  url.searchParams.set("startDate", startDate);
  url.searchParams.set("endDate", endDate);
  url.searchParams.set("hydrate", "game(content(summary,media(epg)),teams)");

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch MLB schedule for highlights: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function fetchGameContent(gamePk) {
  const response = await fetch(`${MLB_GAME_CONTENT_URL}/${gamePk}/content`);
  if (!response.ok) {
    throw new Error(`Failed to fetch MLB game content ${gamePk}: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

function getScheduleGames(payload) {
  return (payload.dates || [])
    .flatMap((day) => day.games || [])
    .map((game) => ({
      gamePk: game.gamePk,
      gameDate: game.gameDate,
      homeTeam: game.teams?.home?.team?.name || "Home team",
      awayTeam: game.teams?.away?.team?.name || "Away team"
    }));
}

function getPlaybackUrl(item) {
  const preferredPlayback = (item.playbacks || []).find((playback) =>
    typeof playback.url === "string" &&
    playback.url &&
    (playback.name?.toLowerCase().includes("mp4") ||
      playback.name?.toLowerCase().includes("high") ||
      playback.name?.toLowerCase().includes("hls"))
  );

  return (
    item.shareLink ||
    item.url ||
    preferredPlayback?.url ||
    (item.playbacks || []).find((playback) => typeof playback.url === "string" && playback.url)?.url ||
    null
  );
}

function getPublishedAt(item, fallbackDate) {
  const value =
    item.date ||
    item.dateCreated ||
    item.timestamp ||
    item.lastModified ||
    fallbackDate;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(fallbackDate) : date;
}

function collectItemsFromEpg(payload) {
  return (payload.media?.epg || [])
    .filter((group) => (group.title || "").toLowerCase().includes("highlight"))
    .flatMap((group) => group.items || []);
}

function parseGameHighlights(payload, gameMeta, now) {
  const cutoff = now.getTime() - HIGHLIGHT_LOOKBACK_HOURS * 60 * 60 * 1000;
  const rawItems = [
    ...(payload.highlights?.highlights?.items || []),
    ...(payload.highlights?.live?.items || []),
    ...collectItemsFromEpg(payload)
  ];

  const seen = new Set();
  return rawItems
    .map((item) => {
      const key = String(item.guid || item.id || `${gameMeta.gamePk}:${item.title || "untitled"}`);
      if (seen.has(key)) {
        return null;
      }
      seen.add(key);

      const publishedAt = getPublishedAt(item, gameMeta.gameDate);
      if (publishedAt.getTime() < cutoff) {
        return null;
      }

      const searchText = [
        item.title,
        item.description,
        item.blurb,
        item.summary,
        item.headline,
        ...(item.keywordsAll || []).map((keyword) => keyword.value)
      ]
        .filter(Boolean)
        .join(" ");

      const url = getPlaybackUrl(item);
      if (!url) {
        return null;
      }

      return {
        id: key,
        title: item.title || "MLB highlight",
        description: item.description || item.blurb || "",
        searchText: normalizeText(searchText),
        url,
        publishedAt: publishedAt.toISOString(),
        gamePk: gameMeta.gamePk,
        homeTeam: gameMeta.homeTeam,
        awayTeam: gameMeta.awayTeam
      };
    })
    .filter(Boolean);
}

export function matchHighlightsToPlayers(highlights, players) {
  const normalizedPlayers = players
    .map((playerName) => ({
      playerName,
      normalizedName: normalizeText(playerName)
    }))
    .filter((entry) => entry.normalizedName);

  const matches = [];
  for (const highlight of highlights) {
    for (const player of normalizedPlayers) {
      if (highlight.searchText.includes(player.normalizedName)) {
        matches.push({
          ...highlight,
          playerName: player.playerName
        });
      }
    }
  }

  return matches;
}

export async function getRecentMlbHighlights(now = new Date()) {
  const { startDate, endDate } = getGameDateRange(now);
  const schedulePayload = await fetchScheduleRange(startDate, endDate);
  const games = getScheduleGames(schedulePayload);
  const gameContents = await Promise.all(
    games.map(async (game) => {
      try {
        const content = await fetchGameContent(game.gamePk);
        return parseGameHighlights(content, game, now);
      } catch (error) {
        console.warn(`Failed to fetch MLB highlight content for game ${game.gamePk}.`, {
          message: error.message
        });
        return [];
      }
    })
  );

  return gameContents
    .flat()
    .sort((left, right) => new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime());
}
