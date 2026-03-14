import {
  matchEntryFeeWei,
  winnerShareBasisPoints,
  type AgentCampaignStats,
  type MatchPlayerState,
  type MatchSnapshot,
} from "@rdr/shared";

function sortPlayers(left: MatchPlayerState, right: MatchPlayerState) {
  return (
    right.score - left.score ||
    right.kills - left.kills ||
    right.damageDealt - left.damageDealt ||
    right.health - left.health
  );
}

function deriveCampaignTier(stats: Omit<AgentCampaignStats, "campaignTier">) {
  if (stats.wins >= 5 || stats.careerPayoutWei !== "0" && stats.totalScore >= 700) {
    return "legend" as const;
  }

  if (
    stats.wins >= 3 ||
    stats.podiums >= 5 ||
    stats.paidMatches >= 4 ||
    stats.totalScore >= 400
  ) {
    return "marshal" as const;
  }

  if (stats.matchesPlayed >= 3 || stats.totalScore >= 180) {
    return "contender" as const;
  }

  return "rookie" as const;
}

export function buildCampaignStats(
  agentId: string,
  matches: MatchSnapshot[],
): AgentCampaignStats {
  const relevantMatches = [...matches]
    .filter(
      (match) =>
        match.status === "finished" &&
        match.players.some((player) => player.agentId === agentId),
    )
    .sort((left, right) => {
      const leftTime = new Date(left.endsAt ?? left.startedAt ?? 0).getTime();
      const rightTime = new Date(right.endsAt ?? right.startedAt ?? 0).getTime();
      return rightTime - leftTime;
    });

  let paidMatches = 0;
  let wins = 0;
  let podiums = 0;
  let totalKills = 0;
  let totalDamage = 0;
  let totalScore = 0;
  let bestScore = 0;
  let placementSum = 0;
  let careerPayoutWei = 0n;
  const recentPlacements: number[] = [];

  for (const match of relevantMatches) {
    const standings = [...match.players].sort(sortPlayers);
    const placement =
      standings.findIndex((player) => player.agentId === agentId) + 1;
    const self = standings[placement - 1];
    if (!self || placement === 0) {
      continue;
    }

    if (match.paid) {
      paidMatches += 1;
    }
    if (placement === 1) {
      wins += 1;
    }
    if (placement <= 3) {
      podiums += 1;
    }

    totalKills += self.kills;
    totalDamage += self.damageDealt;
    totalScore += self.score;
    bestScore = Math.max(bestScore, self.score);
    placementSum += placement;
    if (recentPlacements.length < 5) {
      recentPlacements.push(placement);
    }

    if (match.paid && match.winnerAgentId === agentId) {
      const totalPot = matchEntryFeeWei * BigInt(match.players.length);
      careerPayoutWei += (totalPot * winnerShareBasisPoints) / 10_000n;
    }
  }

  let currentStreak = 0;
  for (const placement of relevantMatches
    .map((match) => [...match.players].sort(sortPlayers).findIndex((player) => player.agentId === agentId) + 1)
    .filter((placement) => placement > 0)) {
    if (placement <= 2) {
      currentStreak += 1;
      continue;
    }
    break;
  }

  const baseStats = {
    agentId,
    matchesPlayed: relevantMatches.length,
    paidMatches,
    wins,
    podiums,
    totalKills,
    totalDamage,
    totalScore,
    bestScore,
    averagePlacement:
      relevantMatches.length > 0
        ? Number((placementSum / relevantMatches.length).toFixed(2))
        : 0,
    recentPlacements,
    careerPayoutWei: careerPayoutWei.toString(),
    currentStreak,
  };

  return {
    ...baseStats,
    campaignTier: deriveCampaignTier(baseStats),
  };
}
