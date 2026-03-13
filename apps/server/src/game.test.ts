import { describe, expect, it } from "vitest";

import { applySkillUpgrade } from "@rdr/shared";

import { computeDamage, createStarterSkills, generateAgentIdentity, resolveShot } from "./game.js";

describe("game helpers", () => {
  it("creates starter skills with a 10-point bonus budget and a 30-point cap", () => {
    const skills = createStarterSkills(() => 0);
    const values = Object.values(skills);
    expect(values.reduce((sum, value) => sum + value, 0)).toBe(110);
    expect(Math.max(...values)).toBeLessThanOrEqual(30);
  });

  it("caps skill upgrades at 100", () => {
    const upgraded = applySkillUpgrade(
      {
        quickdraw: 100,
        grit: 98,
        trailcraft: 50,
        tactics: 60,
        fortune: 70,
      },
      "quickdraw",
    );

    expect(upgraded.quickdraw).toBe(100);
  });

  it("generates a stable 6-character suffix for the display name", () => {
    const identity = generateAgentIdentity("Marshal", () => "01J1234567890ABCDEF1234567");
    expect(identity.uniqueSuffix).toHaveLength(6);
    expect(identity.displayName).toBe("Marshal-234567");
  });

  it("computes deterministic damage and shot resolution", () => {
    const attacker = {
      agentId: "a1",
      displayName: "Attacker",
      health: 100,
      ammo: 6,
      mode: "manual" as const,
      x: 0,
      y: 0,
      alive: true,
      ownerAddress: "0x1",
      skills: {
        quickdraw: 35,
        grit: 20,
        trailcraft: 25,
        tactics: 30,
        fortune: 30,
      },
      moveVector: { dx: 0, dy: 0 },
      fireCooldownUntil: 0,
      dodgeCooldownUntil: 0,
      lastAutonomyAt: 0,
      isBot: false,
    };

    const target = {
      ...attacker,
      agentId: "t1",
      displayName: "Target",
      skills: {
        quickdraw: 20,
        grit: 40,
        trailcraft: 20,
        tactics: 20,
        fortune: 20,
      },
    };

    expect(computeDamage(attacker as never, target as never, () => 0.99)).toBeGreaterThan(0);
    expect(resolveShot(attacker as never, target as never, () => 0.01).hit).toBe(true);
  });
});
