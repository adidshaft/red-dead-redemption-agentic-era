import { describe, expect, it } from "vitest";

import type { AgentProfile, MatchSnapshot } from "@rdr/shared";

import { chooseFallbackCommand } from "./autonomy.js";

function createContext(overrides?: Partial<AgentProfile>, snapshotOverrides?: Partial<MatchSnapshot>) {
  const agent: AgentProfile = {
    id: "agent-1",
    ownerAddress: "0x1",
    baseName: "Marshal",
    displayName: "Marshal-ABC123",
    uniqueSuffix: "ABC123",
    mode: "autonomous",
    isStarter: true,
    walletAddress: "0x0000000000000000000000000000000000000001",
    skills: {
      quickdraw: 30,
      grit: 25,
      trailcraft: 25,
      tactics: 30,
      fortune: 20,
    },
    createdAt: new Date().toISOString(),
    ...overrides,
  };

  const snapshot: MatchSnapshot = {
    matchId: "m1",
    status: "in_progress",
    startedAt: new Date().toISOString(),
    endsAt: new Date(Date.now() + 60_000).toISOString(),
    seed: 42,
    paid: false,
    winnerAgentId: null,
    players: [
      {
        agentId: agent.id,
        displayName: agent.displayName,
        health: 100,
        ammo: 6,
        isReloading: false,
        kills: 0,
        shotsFired: 0,
        shotsHit: 0,
        damageDealt: 0,
        score: 0,
        mode: agent.mode,
        x: 200,
        y: 200,
        alive: true,
      },
      {
        agentId: "enemy-1",
        displayName: "Enemy-1",
        health: 80,
        ammo: 6,
        isReloading: false,
        kills: 0,
        shotsFired: 0,
        shotsHit: 0,
        damageDealt: 0,
        score: 0,
        mode: "manual",
        x: 320,
        y: 200,
        alive: true,
      },
    ],
    pickups: [],
    safeZone: {
      centerX: 800,
      centerY: 450,
      radius: 900,
    },
    events: [],
    settlementTxHash: null,
    ...snapshotOverrides,
  };

  return { agent, snapshot };
}

describe("chooseFallbackCommand", () => {
  it("fires when an enemy is in range and ammo is available", () => {
    const command = chooseFallbackCommand(createContext());
    expect(command.type).toBe("fire");
  });

  it("dodges when health is low and the enemy is close", () => {
    const command = chooseFallbackCommand(
      createContext(undefined, {
        players: [
          {
            agentId: "agent-1",
            displayName: "Marshal-ABC123",
            health: 20,
            ammo: 6,
            isReloading: false,
            kills: 0,
            shotsFired: 0,
            shotsHit: 0,
            damageDealt: 0,
            score: 0,
            mode: "autonomous",
            x: 200,
            y: 200,
            alive: true,
          },
          {
            agentId: "enemy-1",
            displayName: "Enemy-1",
            health: 80,
            ammo: 6,
            isReloading: false,
            kills: 0,
            shotsFired: 0,
            shotsHit: 0,
            damageDealt: 0,
            score: 0,
            mode: "manual",
            x: 260,
            y: 220,
            alive: true,
          },
        ],
      }),
    );

    expect(command.type).toBe("dodge");
  });

  it("reloads when out of ammo and no ammo pickup is available", () => {
    const command = chooseFallbackCommand(
      createContext(undefined, {
        players: [
          {
            agentId: "agent-1",
            displayName: "Marshal-ABC123",
            health: 75,
            ammo: 0,
            isReloading: false,
            kills: 0,
            shotsFired: 0,
            shotsHit: 0,
            damageDealt: 0,
            score: 0,
            mode: "autonomous",
            x: 200,
            y: 200,
            alive: true,
          },
          {
            agentId: "enemy-1",
            displayName: "Enemy-1",
            health: 80,
            ammo: 6,
            isReloading: false,
            kills: 0,
            shotsFired: 0,
            shotsHit: 0,
            damageDealt: 0,
            score: 0,
            mode: "manual",
            x: 520,
            y: 200,
            alive: true,
          },
        ],
        pickups: [],
      }),
    );

    expect(command).toEqual({ type: "reload" });
  });

  it("moves toward health supplies when badly hurt", () => {
    const command = chooseFallbackCommand(
      createContext(undefined, {
        players: [
          {
            agentId: "agent-1",
            displayName: "Marshal-ABC123",
            health: 40,
            ammo: 4,
            isReloading: false,
            kills: 0,
            shotsFired: 0,
            shotsHit: 0,
            damageDealt: 0,
            score: 0,
            mode: "autonomous",
            x: 200,
            y: 200,
            alive: true,
          },
          {
            agentId: "enemy-1",
            displayName: "Enemy-1",
            health: 80,
            ammo: 6,
            isReloading: false,
            kills: 0,
            shotsFired: 0,
            shotsHit: 0,
            damageDealt: 0,
            score: 0,
            mode: "manual",
            x: 420,
            y: 220,
            alive: true,
          },
        ],
        pickups: [
          {
            id: "pickup-health",
            type: "health",
            x: 230,
            y: 200,
            value: 25,
          },
        ],
      }),
    );

    expect(command.type).toBe("move");
    if (command.type === "move") {
      expect(command.dx).toBeGreaterThan(0);
    }
  });

  it("rides back into the safe zone before doing anything else", () => {
    const command = chooseFallbackCommand(
      createContext(undefined, {
        players: [
          {
            agentId: "agent-1",
            displayName: "Marshal-ABC123",
            health: 80,
            ammo: 4,
            isReloading: false,
            kills: 0,
            shotsFired: 0,
            shotsHit: 0,
            damageDealt: 0,
            score: 0,
            mode: "autonomous",
            x: 1500,
            y: 820,
            alive: true,
          },
          {
            agentId: "enemy-1",
            displayName: "Enemy-1",
            health: 80,
            ammo: 6,
            isReloading: false,
            kills: 0,
            shotsFired: 0,
            shotsHit: 0,
            damageDealt: 0,
            score: 0,
            mode: "manual",
            x: 1320,
            y: 760,
            alive: true,
          },
        ],
        safeZone: {
          centerX: 800,
          centerY: 450,
          radius: 260,
        },
      }),
    );

    expect(command.type).toBe("move");
    if (command.type === "move") {
      expect(command.dx).toBeLessThan(0);
      expect(command.dy).toBeLessThan(0);
    }
  });
});
