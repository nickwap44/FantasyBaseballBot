import { getDateInTimezone } from "./time.js";

const MLB_SCHEDULE_URL = "https://statsapi.mlb.com/api/v1/schedule";

async function fetchScheduleRange(startDate, endDate) {
  const url = new URL(MLB_SCHEDULE_URL);
  url.searchParams.set("sportId", "1");
  url.searchParams.set("startDate", startDate);
  url.searchParams.set("endDate", endDate);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch MLB schedule: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

export async function getUpcomingFirstPitch(now, timezone) {
  const startDate = getDateInTimezone(now, timezone);
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const endDate = getDateInTimezone(tomorrow, timezone);
  const payload = await fetchScheduleRange(startDate, endDate);

  const games = (payload.dates || [])
    .flatMap((day) => day.games || [])
    .map((game) => ({
      id: game.gamePk,
      startTime: new Date(game.gameDate),
      awayTeam: game.teams?.away?.team?.name || "Away team",
      homeTeam: game.teams?.home?.team?.name || "Home team"
    }))
    .filter((game) => !Number.isNaN(game.startTime.getTime()))
    .filter((game) => game.startTime.getTime() > now.getTime())
    .sort((left, right) => left.startTime.getTime() - right.startTime.getTime());

  return games[0] || null;
}
