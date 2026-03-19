import { config } from "./config.js";

const SPORT_CODE_MAP = {
  baseball: "flb",
  football: "ffl",
  basketball: "fba",
  hockey: "fhl"
};

function getEspnCookieHeader() {
  if (!config.espnS2 || !config.espnSwid) {
    throw new Error("ESPN private league cookies are missing.");
  }

  return `espn_s2=${config.espnS2}; SWID=${config.espnSwid}`;
}

async function fetchLeague(views) {
  if (!config.espnLeagueId) {
    throw new Error("ESPN league ID is missing.");
  }

  const sportCode = SPORT_CODE_MAP[config.espnSport] || config.espnSport;
  const url = new URL(
    `https://lm-api-reads.fantasy.espn.com/apis/v3/games/${sportCode}/seasons/${config.espnSeason}/segments/0/leagues/${config.espnLeagueId}`
  );

  for (const view of views) {
    url.searchParams.append("view", view);
  }

  const response = await fetch(url, {
    headers: {
      Cookie: getEspnCookieHeader(),
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`ESPN API request failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

function getMemberMap(members = []) {
  return new Map(
    members.map((member) => {
      const displayName = [member.firstName, member.lastName].filter(Boolean).join(" ").trim();
      return [member.id, displayName || member.displayName || "Unknown manager"];
    })
  );
}

function getTeamName(team) {
  return [team.location, team.nickname].filter(Boolean).join(" ").trim() || team.abbrev || "Unknown Team";
}

function getManagerName(team, memberMap) {
  const primaryOwner = team.owners?.[0];
  return memberMap.get(primaryOwner) || "Unknown manager";
}

function getCurrentScoringPeriod(payload) {
  return payload?.status?.currentScoringPeriod || payload?.scoringPeriodId || 1;
}

function summarizeTeams(payload) {
  const memberMap = getMemberMap(payload.members);

  return (payload.teams || []).map((team) => ({
    id: team.id,
    abbrev: team.abbrev,
    name: getTeamName(team),
    manager: getManagerName(team, memberMap),
    wins: team.record?.overall?.wins || 0,
    losses: team.record?.overall?.losses || 0,
    ties: team.record?.overall?.ties || 0,
    pointsFor: team.record?.overall?.pointsFor || 0,
    pointsAgainst: team.record?.overall?.pointsAgainst || 0,
    playoffSeed: team.playoffSeed || null,
    roster: (team.roster?.entries || []).map((entry) => ({
      playerId: entry.playerId,
      lineupSlotId: entry.lineupSlotId,
      acquisitionType: entry.acquisitionType,
      playerName:
        entry.playerPoolEntry?.player?.fullName ||
        entry.playerPoolEntry?.player?.firstName ||
        `Player ${entry.playerId}`,
      proTeamId: entry.playerPoolEntry?.player?.proTeamId || null,
      defaultPositionId: entry.playerPoolEntry?.player?.defaultPositionId || null
    }))
  }));
}

function summarizeTransactions(payload) {
  const teams = new Map((payload.teams || []).map((team) => [team.id, getTeamName(team)]));

  return (payload.transactions || [])
    .map((transaction) => ({
      id: transaction.id,
      type: transaction.type,
      status: transaction.status,
      teamId: transaction.teamId,
      teamName: teams.get(transaction.teamId) || "Unknown team",
      biddingAmount: transaction.bidAmount || null,
      executionDate: transaction.executionDate || transaction.proposedDate || transaction.processDate,
      players: (transaction.items || []).map((item) => ({
        playerId: item.playerId,
        type: item.type,
        name: item.playerName || `Player ${item.playerId}`
      }))
    }))
    .filter((transaction) => transaction.executionDate)
    .sort((left, right) => right.executionDate - left.executionDate);
}

function summarizeMatchups(payload) {
  const teams = new Map((payload.teams || []).map((team) => [team.id, getTeamName(team)]));
  const scoringPeriodId = getCurrentScoringPeriod(payload);
  const schedule = payload.schedule || [];

  return schedule
    .filter((matchup) => matchup.matchupPeriodId === scoringPeriodId)
    .map((matchup) => ({
      matchupPeriodId: matchup.matchupPeriodId,
      homeTeamId: matchup.home?.teamId || null,
      awayTeamId: matchup.away?.teamId || null,
      homeTeam: teams.get(matchup.home?.teamId) || "Bye",
      awayTeam: teams.get(matchup.away?.teamId) || "Bye",
      homeScore: matchup.home?.totalPoints || 0,
      awayScore: matchup.away?.totalPoints || 0,
      winner:
        matchup.home?.totalPoints > matchup.away?.totalPoints
          ? teams.get(matchup.home?.teamId) || null
          : matchup.away?.totalPoints > matchup.home?.totalPoints
            ? teams.get(matchup.away?.teamId) || null
            : "Tie"
    }));
}

export async function getLeagueSnapshot() {
  const payload = await fetchLeague([
    "mSettings",
    "mTeam",
    "mRoster",
    "mStandings",
    "mMatchup",
    "mPendingTransactions",
    "mTransactions2"
  ]);

  return {
    id: payload.id,
    seasonId: payload.seasonId,
    currentScoringPeriod: getCurrentScoringPeriod(payload),
    teams: summarizeTeams(payload),
    transactions: summarizeTransactions(payload),
    matchups: summarizeMatchups(payload),
    raw: payload
  };
}

export async function testEspnConnection() {
  const snapshot = await getLeagueSnapshot();
  return {
    sport: config.espnSport,
    leagueId: snapshot.id,
    seasonId: snapshot.seasonId,
    teamCount: snapshot.teams.length,
    currentScoringPeriod: snapshot.currentScoringPeriod,
    recentTransactions: snapshot.transactions.slice(0, 3)
  };
}
