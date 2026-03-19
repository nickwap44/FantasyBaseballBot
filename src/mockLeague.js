export function getMockLeagueSnapshot() {
  return {
    id: 517803001,
    seasonId: 2026,
    currentScoringPeriod: 4,
    teams: [
      {
        id: 1,
        abbrev: "BOM",
        name: "Bronx Bombers",
        manager: "Nick",
        wins: 3,
        losses: 1,
        ties: 0,
        pointsFor: 289.4,
        pointsAgainst: 240.2,
        playoffSeed: 1,
        roster: buildRoster(["Juan Soto", "Mookie Betts", "Corbin Burnes", "Marcus Semien"])
      },
      {
        id: 2,
        abbrev: "SCR",
        name: "Scranton Sliders",
        manager: "Chris",
        wins: 3,
        losses: 1,
        ties: 0,
        pointsFor: 276.3,
        pointsAgainst: 250.7,
        playoffSeed: 2,
        roster: buildRoster(["Bobby Witt Jr.", "Tarik Skubal", "Matt Olson", "Corey Seager"])
      },
      {
        id: 3,
        abbrev: "BLC",
        name: "Bleacher Creatures",
        manager: "Taylor",
        wins: 2,
        losses: 2,
        ties: 0,
        pointsFor: 261.1,
        pointsAgainst: 257.5,
        playoffSeed: 3,
        roster: buildRoster(["Shohei Ohtani", "Zack Wheeler", "Yordan Alvarez", "Austin Riley"])
      },
      {
        id: 4,
        abbrev: "SUN",
        name: "Sunday Swingers",
        manager: "Jordan",
        wins: 2,
        losses: 2,
        ties: 0,
        pointsFor: 254.8,
        pointsAgainst: 258.2,
        playoffSeed: 4,
        roster: buildRoster(["Freddie Freeman", "Julio Rodriguez", "Yamamoto", "Gunnar Henderson"])
      },
      {
        id: 5,
        abbrev: "GAS",
        name: "Gas House Gorillas",
        manager: "Morgan",
        wins: 2,
        losses: 2,
        ties: 0,
        pointsFor: 248.9,
        pointsAgainst: 248.4,
        playoffSeed: 5,
        roster: buildRoster(["Ronald Acuna Jr.", "Spencer Strider", "Adley Rutschman", "Trea Turner"])
      },
      {
        id: 6,
        abbrev: "WVR",
        name: "Waiver Wire Wizards",
        manager: "Sam",
        wins: 2,
        losses: 2,
        ties: 0,
        pointsFor: 242.0,
        pointsAgainst: 251.1,
        playoffSeed: 6,
        roster: buildRoster(["Elly De La Cruz", "Logan Gilbert", "Fernando Tatis Jr.", "Ozzie Albies"])
      },
      {
        id: 7,
        abbrev: "CHK",
        name: "Check Swings",
        manager: "Drew",
        wins: 1,
        losses: 3,
        ties: 0,
        pointsFor: 233.7,
        pointsAgainst: 269.5,
        playoffSeed: 7,
        roster: buildRoster(["Kyle Tucker", "Pablo Lopez", "Rafael Devers", "Luis Castillo"])
      },
      {
        id: 8,
        abbrev: "RTO",
        name: "Roto Rooters",
        manager: "Casey",
        wins: 1,
        losses: 3,
        ties: 0,
        pointsFor: 228.2,
        pointsAgainst: 278.0,
        playoffSeed: 8,
        roster: buildRoster(["Vladimir Guerrero Jr.", "Dylan Cease", "Bo Bichette", "Pete Alonso"])
      },
      {
        id: 9,
        abbrev: "MUD",
        name: "Mudville Nine",
        manager: "Alex",
        wins: 1,
        losses: 3,
        ties: 0,
        pointsFor: 221.4,
        pointsAgainst: 271.3,
        playoffSeed: 9,
        roster: buildRoster(["Jose Ramirez", "George Kirby", "Bryce Harper", "Jose Altuve"])
      },
      {
        id: 10,
        abbrev: "DNG",
        name: "Dong Bongers",
        manager: "Pat",
        wins: 1,
        losses: 3,
        ties: 0,
        pointsFor: 218.8,
        pointsAgainst: 270.4,
        playoffSeed: 10,
        roster: buildRoster(["Aaron Judge", "Framber Valdez", "Manny Machado", "William Contreras"])
      }
    ],
    transactions: [
      {
        id: 9001,
        type: "WAIVER ADDED",
        status: "EXECUTED",
        teamId: 6,
        teamName: "Waiver Wire Wizards",
        biddingAmount: 17,
        executionDate: Date.now() - 2 * 60 * 60 * 1000,
        players: [
          { playerId: 101, type: "ADD", name: "Jackson Holliday" },
          { playerId: 102, type: "DROP", name: "Brandon Lowe" }
        ]
      },
      {
        id: 9002,
        type: "TRADE ACCEPTED",
        status: "ACCEPTED",
        teamId: 2,
        teamName: "Scranton Sliders",
        biddingAmount: null,
        executionDate: Date.now() - 6 * 60 * 60 * 1000,
        players: [
          { playerId: 103, type: "TRADE", name: "Corey Seager" },
          { playerId: 104, type: "TRADE", name: "Austin Riley" }
        ]
      },
      {
        id: 9003,
        type: "FREE AGENT ADDED",
        status: "EXECUTED",
        teamId: 10,
        teamName: "Dong Bongers",
        biddingAmount: null,
        executionDate: Date.now() - 10 * 60 * 60 * 1000,
        players: [
          { playerId: 105, type: "ADD", name: "Jordan Westburg" },
          { playerId: 106, type: "DROP", name: "Anthony Rizzo" }
        ]
      }
    ],
    matchups: [
      {
        matchupPeriodId: 4,
        homeTeamId: 1,
        awayTeamId: 10,
        homeTeam: "Bronx Bombers",
        awayTeam: "Dong Bongers",
        homeScore: 78.2,
        awayScore: 54.7,
        winner: "Bronx Bombers"
      },
      {
        matchupPeriodId: 4,
        homeTeamId: 2,
        awayTeamId: 9,
        homeTeam: "Scranton Sliders",
        awayTeam: "Mudville Nine",
        homeScore: 70.5,
        awayScore: 61.4,
        winner: "Scranton Sliders"
      },
      {
        matchupPeriodId: 4,
        homeTeamId: 3,
        awayTeamId: 8,
        homeTeam: "Bleacher Creatures",
        awayTeam: "Roto Rooters",
        homeScore: 64.1,
        awayScore: 68.3,
        winner: "Roto Rooters"
      },
      {
        matchupPeriodId: 4,
        homeTeamId: 4,
        awayTeamId: 7,
        homeTeam: "Sunday Swingers",
        awayTeam: "Check Swings",
        homeScore: 66.7,
        awayScore: 63.6,
        winner: "Sunday Swingers"
      },
      {
        matchupPeriodId: 4,
        homeTeamId: 5,
        awayTeamId: 6,
        homeTeam: "Gas House Gorillas",
        awayTeam: "Waiver Wire Wizards",
        homeScore: 58.0,
        awayScore: 60.1,
        winner: "Waiver Wire Wizards"
      }
    ]
  };
}

function buildRoster(playerNames) {
  return playerNames.map((name, index) => ({
    playerId: index + 1,
    lineupSlotId: index < 3 ? 1 : 20,
    acquisitionType: "DRAFT",
    playerName: name,
    proTeamId: null,
    defaultPositionId: null
  }));
}
