import { describe, expect, it } from "vitest";

import type { MatchSnapshot } from "@rdr/shared";

import { buildAgentMatchRecord, buildCampaignStats } from "./campaign.js";

function createMatch(
  matchId: string,
  overrides?: Partial<MatchSnapshot>,
): MatchSnapshot {
  return {
    matchId,
    status: "finished",
    startedAt: "2026-03-14T10:00:00.000Z",
    endsAt: "2026-03-14T10:03:00.000Z",
    seed: 1,
    paid: false,
    winnerAgentId: "agent-1",
    settlementTxHash: null,
    pickups: [],
    objective: null,
    safeZone: {
      centerX: 800,
      centerY: 450,
      radius: 200,
    },
    events: [],
    players: [
      {
        agentId: "agent-1",
        displayName: "Marshal-AAA111",
        health: 60,
        ammo: 3,
        isReloading: false,
        kills: 2,
        shotsFired: 7,
        shotsHit: 4,
        damageDealt: 90,
        score: 190,
        mode: "autonomous",
        x: 400,
        y: 300,
        alive: true,
      },
      {
        agentId: "bot-2",
        displayName: "HouseBot-2",
        health: 0,
        ammo: 0,
        isReloading: false,
        kills: 1,
        shotsFired: 6,
        shotsHit: 2,
        damageDealt: 55,
        score: 120,
        mode: "autonomous",
        x: 500,
        y: 400,
        alive: false,
      },
      {
        agentId: "bot-3",
        displayName: "HouseBot-3",
        health: 0,
        ammo: 1,
        isReloading: false,
        kills: 0,
        shotsFired: 5,
        shotsHit: 1,
        damageDealt: 25,
        score: 80,
        mode: "autonomous",
        x: 300,
        y: 500,
        alive: false,
      },
      {
        agentId: "bot-4",
        displayName: "HouseBot-4",
        health: 0,
        ammo: 0,
        isReloading: false,
        kills: 0,
        shotsFired: 4,
        shotsHit: 1,
        damageDealt: 20,
        score: 60,
        mode: "autonomous",
        x: 700,
        y: 200,
        alive: false,
      },
    ],
    ...overrides,
  };
}

describe("buildCampaignStats", () => {
  it("aggregates wins, placements, and payouts across finished matches", () => {
    const matches = [
      createMatch("m2", {
        paid: true,
        startedAt: "2026-03-14T12:00:00.000Z",
        endsAt: "2026-03-14T12:03:00.000Z",
      }),
      createMatch("m1", {
        paid: false,
        winnerAgentId: "bot-2",
        startedAt: "2026-03-14T11:00:00.000Z",
        endsAt: "2026-03-14T11:03:00.000Z",
        players: [
          {
            agentId: "bot-2",
            displayName: "HouseBot-2",
            health: 40,
            ammo: 2,
            isReloading: false,
            kills: 2,
            shotsFired: 7,
            shotsHit: 4,
            damageDealt: 110,
            score: 210,
            mode: "autonomous",
            x: 400,
            y: 300,
            alive: true,
          },
          {
            agentId: "agent-1",
            displayName: "Marshal-AAA111",
            health: 0,
            ammo: 0,
            isReloading: false,
            kills: 1,
            shotsFired: 5,
            shotsHit: 2,
            damageDealt: 70,
            score: 140,
            mode: "autonomous",
            x: 500,
            y: 400,
            alive: false,
          },
          {
            agentId: "bot-3",
            displayName: "HouseBot-3",
            health: 0,
            ammo: 1,
            isReloading: false,
            kills: 0,
            shotsFired: 5,
            shotsHit: 1,
            damageDealt: 25,
            score: 70,
            mode: "autonomous",
            x: 300,
            y: 500,
            alive: false,
          },
          {
            agentId: "bot-4",
            displayName: "HouseBot-4",
            health: 0,
            ammo: 0,
            isReloading: false,
            kills: 0,
            shotsFired: 4,
            shotsHit: 1,
            damageDealt: 20,
            score: 60,
            mode: "autonomous",
            x: 700,
            y: 200,
            alive: false,
          },
        ],
      }),
    ];

    const stats = buildCampaignStats("agent-1", matches);

    expect(stats.matchesPlayed).toBe(2);
    expect(stats.paidMatches).toBe(1);
    expect(stats.wins).toBe(1);
    expect(stats.totalKills).toBe(3);
    expect(stats.bestScore).toBe(190);
    expect(stats.recentPlacements).toEqual([1, 2]);
    expect(stats.currentStreak).toBe(2);
    expect(stats.careerPayoutWei).not.toBe("0");
    expect(stats.campaignTier).toBe("contender");
  });

  it("returns an empty rookie ledger when no matches exist", () => {
    const stats = buildCampaignStats("agent-1", []);

    expect(stats.matchesPlayed).toBe(0);
    expect(stats.averagePlacement).toBe(0);
    expect(stats.recentPlacements).toEqual([]);
    expect(stats.campaignTier).toBe("rookie");
  });

  it("builds a per-match record with payout and settlement details", () => {
    const match = createMatch("m3", {
      paid: true,
      settlementTxHash: "0xsettled",
    });

    const record = buildAgentMatchRecord("agent-1", match);

    expect(record).not.toBeNull();
    expect(record?.won).toBe(true);
    expect(record?.placement).toBe(1);
    expect(record?.payoutWei).not.toBe("0");
    expect(record?.settlementTxHash).toBe("0xsettled");
  });
});
