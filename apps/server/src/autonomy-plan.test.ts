import { describe, expect, it } from "vitest";

import {
  createDefaultAgentBudgetPolicy,
  type AgentProfile,
  type OnchainReceipt,
} from "@rdr/shared";

import { buildAutonomyPlan } from "./autonomy-plan.js";

function createAgent(overrides?: Partial<AgentProfile>): AgentProfile {
  return {
    id: "agent-1",
    ownerAddress: "0x1",
    baseName: "Marshal",
    displayName: "Marshal-ABC123",
    uniqueSuffix: "ABC123",
    mode: "autonomous",
    isStarter: true,
    walletAddress: "0x0000000000000000000000000000000000000001",
    budgetPolicy: createDefaultAgentBudgetPolicy(),
    autoSpendWei: "0",
    skills: {
      quickdraw: 36,
      grit: 24,
      trailcraft: 26,
      tactics: 34,
      fortune: 22,
    },
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("buildAutonomyPlan", () => {
  it("builds a doctrine-aligned plan and counts receipts", () => {
    const receipts: OnchainReceipt[] = [
      {
        txHash: "0x1",
        chainId: 1952,
        status: "confirmed",
        purpose: "skill_purchase",
        agentId: "agent-1",
        createdAt: new Date().toISOString(),
      },
      {
        txHash: "0x2",
        chainId: 1952,
        status: "confirmed",
        purpose: "match_entry",
        agentId: "agent-1",
        matchId: "m1",
        createdAt: new Date().toISOString(),
      },
    ];

    const plan = buildAutonomyPlan(createAgent(), receipts, false, null);

    expect(plan.doctrine).toBe("Railshot Duelist");
    expect(plan.nextSkill).toBe("quickdraw");
    expect(plan.skillPurchases).toBe(1);
    expect(plan.paidEntries).toBe(1);
    expect(plan.settlements).toBe(0);
    expect(plan.recommendedQueue).toBe("practice");
    expect(plan.objectivePosture).toBe("contest");
    expect(plan.objectiveDirective.toLowerCase()).toContain("objective");
    expect(plan.readinessScore).toBeGreaterThan(0);
    expect(plan.confidenceBand).toBe("low");
    expect(plan.autoBuyReady).toBe(false);
    expect(plan.autoBuyBlockedReason).toContain("Budget autopilot is off");
  });

  it("switches economy guidance when the x402 autonomy pass is active", () => {
    const plan = buildAutonomyPlan(
      createAgent(),
      [],
      true,
      "2026-03-15T10:00:00.000Z",
    );

    expect(plan.autonomyPassActive).toBe(true);
    expect(plan.autonomyPassValidUntil).toBe("2026-03-15T10:00:00.000Z");
    expect(plan.x402Directive.toLowerCase()).toContain("premium autonomy");
    expect(plan.confidenceBand).toBe("low");
  });

  it("arms budget-aware auto-buy when the next skill fits the spend policy", () => {
    const plan = buildAutonomyPlan(
      createAgent({
        budgetPolicy: {
          ...createDefaultAgentBudgetPolicy(),
          enabled: true,
          autoPromptSkillBuy: true,
          autoQueuePractice: true,
        },
      }),
      [],
      false,
      null,
    );

    expect(plan.autoBuyReady).toBe(true);
    expect(plan.autoBuyBlockedReason).toBeNull();
    expect(plan.budgetRemainingWei).toBe("6000000000000000");
    expect(plan.nextSkillPriceWei).toBe("2000000000000000");
    expect(plan.autoPracticeReady).toBe(true);
  });
});
