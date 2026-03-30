import { config } from "./config.js";

const SPORT_CODE_MAP = {
  baseball: "flb",
  football: "ffl",
  basketball: "fba",
  hockey: "fhl"
};

const PUBLIC_LEAGUE_CODE_MAP = {
  baseball: "mlb",
  football: "nfl",
  basketball: "nba",
  hockey: "nhl"
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

async function fetchPlayerInfoByIds(playerIds) {
  if (!playerIds.length) {
    return [];
  }

  const sportCode = SPORT_CODE_MAP[config.espnSport] || config.espnSport;
  const url = new URL(
    `https://fantasy.espn.com/apis/v3/games/${sportCode}/seasons/${config.espnSeason}/segments/0/leagues/${config.espnLeagueId}`
  );
  url.searchParams.append("view", "kona_player_info");

  const response = await fetch(url, {
    headers: {
      Cookie: getEspnCookieHeader(),
      Accept: "application/json",
      "X-Fantasy-Filter": JSON.stringify({
        players: {
          filterIds: {
            value: playerIds
          },
          limit: playerIds.length
        }
      })
    }
  });

  if (!response.ok) {
    throw new Error(`ESPN player info request failed: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  return payload.players || [];
}

async function fetchPublicAthleteNamesByIds(playerIds) {
  if (!playerIds.length) {
    return new Map();
  }

  const leagueCode = PUBLIC_LEAGUE_CODE_MAP[config.espnSport] || config.espnSport;
  const lookups = await Promise.all(
    playerIds.map(async (playerId) => {
      const url = `https://sports.core.api.espn.com/v2/sports/${config.espnSport}/leagues/${leagueCode}/athletes/${playerId}`;
      const response = await fetch(url, {
        headers: {
          Accept: "application/json"
        }
      });

      if (!response.ok) {
        return [playerId, null];
      }

      const payload = await response.json();
      return [playerId, getPlayerDisplayNameOrNull(payload)];
    })
  );

  return new Map(lookups.filter(([, name]) => isResolvedPlayerName(name)));
}

function getMemberMap(members = []) {
  return new Map(
    members.map((member) => {
      const displayName = [member.firstName, member.lastName].filter(Boolean).join(" ").trim();
      return [member.id, displayName || member.displayName || "Unknown manager"];
    })
  );
}

function decodeFantasyTeamName(rawName) {
  if (!rawName) {
    return "";
  }

  if (typeof rawName === "string") {
    return rawName.trim();
  }

  if (Array.isArray(rawName)) {
    const decoded = rawName
      .map((value) => (Number.isFinite(value) ? String.fromCharCode(value) : ""))
      .join("")
      .trim();
    return decoded;
  }

  return "";
}

function getTeamName(team) {
  return (
    decodeFantasyTeamName(team.name) ||
    [team.location, team.nickname].filter(Boolean).join(" ").trim() ||
    team.abbrev ||
    "Unknown Team"
  );
}

function getManagerName(team, memberMap) {
  const primaryOwner = team.owners?.[0];
  return memberMap.get(primaryOwner) || "Unknown manager";
}

function getCurrentScoringPeriod(payload) {
  return payload?.status?.currentScoringPeriod || payload?.scoringPeriodId || 1;
}

function getPlayerDisplayName(playerLike, fallbackId = null) {
  if (!playerLike) {
    return fallbackId ? `Player ${fallbackId}` : "Unknown player";
  }

  return (
    playerLike.fullName ||
    [playerLike.firstName, playerLike.lastName].filter(Boolean).join(" ").trim() ||
    playerLike.name ||
    (fallbackId ? `Player ${fallbackId}` : "Unknown player")
  );
}

function getPlayerDisplayNameOrNull(playerLike) {
  if (!playerLike) {
    return null;
  }

  const name = getPlayerDisplayName(playerLike);
  return name === "Unknown player" ? null : name;
}

function isResolvedPlayerName(name) {
  return Boolean(name) && !/^Player \d+$/.test(name) && name !== "Unknown player";
}

function resolveTransactionPlayerName(item, playerNames) {
  const candidates = [
    item.playerName,
    getPlayerDisplayNameOrNull(item.playerPoolEntry?.player),
    getPlayerDisplayNameOrNull(item.player),
    playerNames.get(item.playerId)
  ];

  for (const candidate of candidates) {
    if (isResolvedPlayerName(candidate)) {
      return candidate;
    }
  }

  return getPlayerDisplayName(null, item.playerId);
}

function buildPlayerNameMap(payload) {
  const playerNames = new Map();

  for (const team of payload.teams || []) {
    for (const entry of team.roster?.entries || []) {
      playerNames.set(
        entry.playerId,
        getPlayerDisplayName(entry.playerPoolEntry?.player, entry.playerId)
      );
    }
  }

  const playersCollection = payload.players;
  if (Array.isArray(playersCollection)) {
    for (const player of playersCollection) {
      const playerId = player.id ?? player.playerId;
      if (playerId == null) {
        continue;
      }

      playerNames.set(playerId, getPlayerDisplayName(player, playerId));
    }
  } else if (playersCollection && typeof playersCollection === "object") {
    for (const [key, player] of Object.entries(playersCollection)) {
      const playerId = Number.parseInt(key, 10);
      if (Number.isFinite(playerId)) {
        playerNames.set(playerId, getPlayerDisplayName(player, playerId));
      }
    }
  }

  return playerNames;
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
  const playerNames = buildPlayerNameMap(payload);

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
        name: resolveTransactionPlayerName(item, playerNames)
      }))
    }))
    .filter((transaction) => transaction.executionDate)
    .sort((left, right) => right.executionDate - left.executionDate);
}

function collectUnresolvedTransactionPlayerIds(transactions) {
  return [...new Set(
    transactions
      .flatMap((transaction) => transaction.players || [])
      .filter((player) => /^Player \d+$/.test(player.name))
      .map((player) => player.playerId)
      .filter((playerId) => Number.isFinite(playerId))
  )];
}

async function enrichTransactionPlayers(transactions) {
  const unresolvedIds = collectUnresolvedTransactionPlayerIds(transactions);
  if (!unresolvedIds.length) {
    return transactions;
  }

  let enrichedTransactions = transactions;

  try {
    const playerInfo = await fetchPlayerInfoByIds(unresolvedIds);
    const playerNameMap = new Map(
      playerInfo.map((entry) => {
        const playerId = entry.id ?? entry.playerId;
        return [
          playerId,
          getPlayerDisplayNameOrNull(entry.player) ||
            getPlayerDisplayNameOrNull(entry) ||
            getPlayerDisplayName(null, playerId)
        ];
      })
    );

    enrichedTransactions = transactions.map((transaction) => ({
      ...transaction,
      players: transaction.players.map((player) => ({
        ...player,
        name: playerNameMap.get(player.playerId) || player.name
      }))
    }));
  } catch (error) {
    console.warn("ESPN player info lookup failed while resolving transaction names.", {
      message: error.message,
      unresolvedIds: unresolvedIds.slice(0, 25)
    });
  }

  const stillUnresolved = collectUnresolvedTransactionPlayerIds(enrichedTransactions);
  if (!stillUnresolved.length) {
    return enrichedTransactions;
  }

  try {
    const publicAthleteNameMap = await fetchPublicAthleteNamesByIds(stillUnresolved);
    enrichedTransactions = enrichedTransactions.map((transaction) => ({
      ...transaction,
      players: transaction.players.map((player) => ({
        ...player,
        name: publicAthleteNameMap.get(player.playerId) || player.name
      }))
    }));
  } catch (error) {
    console.warn("Public ESPN athlete lookup failed while resolving transaction names.", {
      message: error.message,
      unresolvedIds: stillUnresolved.slice(0, 25)
    });
  }

  const finalUnresolved = collectUnresolvedTransactionPlayerIds(enrichedTransactions);
  if (finalUnresolved.length) {
    console.warn("Still unresolved ESPN transaction player IDs after all lookup passes.", {
      unresolvedIds: finalUnresolved.slice(0, 25)
    });
  }

  return enrichedTransactions;
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
    transactions: await enrichTransactionPlayers(summarizeTransactions(payload)),
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
