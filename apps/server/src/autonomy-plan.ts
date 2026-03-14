import {
  skillKeys,
  skillLabels,
  type AgentProfile,
  type AutonomyPlan,
  type OnchainReceipt,
  type SkillKey,
} from "@rdr/shared";

export type DoctrineProfile = {
  doctrine: string;
  summary: string;
  upgradeQueue: SkillKey[];
  combatDirective: string;
  objectiveDirective: string;
  objectivePosture: "contest" | "flank" | "hold";
  preferredFireRange: number;
  healthPickupThreshold: number;
  ammoPickupThreshold: number;
  dodgeDistance: number;
  flankWeight: number;
  centerBias: number;
};

function sumSkills(agent: AgentProfile, keys: SkillKey[]) {
  return keys.reduce((total, key) => total + agent.skills[key], 0);
}

export function deriveDoctrineProfile(agent: AgentProfile): DoctrineProfile {
  const quickTactics = sumSkills(agent, ["quickdraw", "tactics"]);
  const gritFortune = sumSkills(agent, ["grit", "fortune"]);
  const trailTactics = sumSkills(agent, ["trailcraft", "tactics"]);

  if (quickTactics >= gritFortune && quickTactics >= trailTactics) {
    return {
      doctrine: "Railshot Duelist",
      summary:
        "Open first, force quick trades, and win the lane before the ring tightens.",
      upgradeQueue: ["quickdraw", "tactics", "fortune"] as SkillKey[],
      combatDirective:
        "Open hard, punish exposed targets, then rotate inward before the ring punishes overextension.",
      objectiveDirective:
        "Contest the live objective early and make rivals fight through your firing lane.",
      objectivePosture: "contest",
      preferredFireRange: 760,
      healthPickupThreshold: 42,
      ammoPickupThreshold: 2,
      dodgeDistance: 180,
      flankWeight: 0.25,
      centerBias: 0.3,
    };
  }

  if (trailTactics >= quickTactics && trailTactics >= gritFortune) {
    return {
      doctrine: "Ghost Circuit Scout",
      summary:
        "Play angles, dodge cleanly, and turn supplies plus late-ring space into winning fights.",
      upgradeQueue: ["trailcraft", "tactics", "quickdraw"] as SkillKey[],
      combatDirective:
        "Sweep the edge, steal supplies, and collapse when rivals are distracted.",
      objectiveDirective:
        "Flank the live objective, let heavier riders commit first, then strike through the side lane.",
      objectivePosture: "flank",
      preferredFireRange: 600,
      healthPickupThreshold: 62,
      ammoPickupThreshold: 3,
      dodgeDistance: 260,
      flankWeight: 0.65,
      centerBias: 0.15,
    };
  }

  return {
    doctrine: "Iron Ledger Survivor",
    summary:
      "Absorb the early chaos, stay healthy, and win the long fight when the arena gets tight.",
    upgradeQueue: ["grit", "fortune", "quickdraw"] as SkillKey[],
    combatDirective:
      "Tank the opener, keep the chamber full, and outlast weaker riders as the circle closes.",
    objectiveDirective:
      "Hold the safest route to the live objective and only harvest it when health and ring position are stable.",
    objectivePosture: "hold",
    preferredFireRange: 540,
    healthPickupThreshold: 70,
    ammoPickupThreshold: 2,
    dodgeDistance: 220,
    flankWeight: 0.1,
    centerBias: 0.7,
  };
}

function pickNextSkill(agent: AgentProfile, queue: SkillKey[]) {
  for (const skill of queue) {
    if (agent.skills[skill] < 100) {
      return skill;
    }
  }
  return queue[0] ?? "quickdraw";
}

function buildMissionFrame(
  campaignPriority: AutonomyPlan["campaignPriority"],
  nextSkill: SkillKey,
  autonomyPassActive: boolean,
  recommendedQueue: AutonomyPlan["recommendedQueue"],
  doctrine: DoctrineProfile,
) {
  if (campaignPriority === "buy_skill") {
    return {
      missionTitle: `Approve ${skillLabels[nextSkill]}`,
      missionDetail: `${skillLabels[nextSkill]} is the cleanest leverage point for the ${doctrine.doctrine} doctrine right now.`,
      campaignHook:
        "One good upgrade turns the next paid run from a gamble into a compounding move.",
      nextMoves: [
        `Buy ${skillLabels[nextSkill]}`,
        recommendedQueue === "paid" ? "Queue a paid showdown" : "Run one more practice round",
        autonomyPassActive ? "Recycle any win into the next skill" : "Consider the x402 premium lane",
      ],
    };
  }

  if (campaignPriority === "queue_paid") {
    return {
      missionTitle: "Push the treasury",
      missionDetail:
        "The rider has enough readiness to convert another run into a real payout attempt on X Layer.",
      campaignHook:
        "The next clean finish is the one that starts to feel like a real economy loop.",
      nextMoves: [
        "Queue a paid showdown",
        `Protect the treasury with ${doctrine.objectivePosture} objective play`,
        `Reinvest into ${skillLabels[nextSkill]}`,
      ],
    };
  }

  if (campaignPriority === "buy_autonomy_pass") {
    return {
      missionTitle: "Open premium autonomy",
      missionDetail:
        "The premium lane is the next multiplier because the rider already knows how to enter and settle the frontier.",
      campaignHook:
        "Premium is where the agent starts to feel like it is running a real frontier operation, not just a single match.",
      nextMoves: [
        "Unlock the x402 autonomy pass",
        "Run a premium-guided paid showdown",
        `Compound the next ${skillLabels[nextSkill]} upgrade`,
      ],
    };
  }

  return {
    missionTitle: "Sharpen the doctrine",
    missionDetail:
      "One more low-risk round gives the planner better footing before it asks for more economic risk.",
    campaignHook:
      "A cheap practice win is still bait if it tees up the next paid push at the right moment.",
    nextMoves: [
      "Run a practice round",
      `Buy ${skillLabels[nextSkill]} when ready`,
      autonomyPassActive ? "Promote into paid runs" : "Unlock premium when the loop feels stable",
    ],
  };
}

export function buildAutonomyPlan(
  agent: AgentProfile,
  receipts: OnchainReceipt[],
  autonomyPassActive: boolean,
  autonomyPassValidUntil: string | null,
): AutonomyPlan {
  const doctrine = deriveDoctrineProfile(agent);
  const nextSkill = pickNextSkill(agent, doctrine.upgradeQueue);
  const skillPurchases = receipts.filter(
    (receipt) => receipt.purpose === "skill_purchase",
  ).length;
  const paidEntries = receipts.filter(
    (receipt) => receipt.purpose === "match_entry",
  ).length;
  const settlements = receipts.filter(
    (receipt) => receipt.purpose === "match_settlement",
  ).length;
  const economyPosture =
    settlements >= 3 ? "aggressive" : settlements >= 1 ? "compounding" : "bootstrap";
  const recommendedQueue =
    settlements > 0 || autonomyPassActive ? "paid" : "practice";
  const readinessScore = Math.max(
    10,
    Math.min(
      100,
      Math.round(
        skillPurchases * 18 +
          paidEntries * 10 +
          settlements * 28 +
          (autonomyPassActive ? 16 : 0) +
          (agent.mode === "autonomous" ? 8 : 0),
      ),
    ),
  );
  const confidenceBand =
    readinessScore >= 72 ? "high" : readinessScore >= 42 ? "medium" : "low";
  const campaignPriority = autonomyPassActive
    ? skillPurchases <= paidEntries
      ? "buy_skill"
      : recommendedQueue === "paid"
        ? "queue_paid"
        : "run_practice"
    : paidEntries >= 2
      ? "buy_autonomy_pass"
      : skillPurchases === 0
        ? "buy_skill"
        : recommendedQueue === "paid"
      ? "queue_paid"
      : "run_practice";
  const missionFrame = buildMissionFrame(
    campaignPriority,
    nextSkill,
    autonomyPassActive,
    recommendedQueue,
    doctrine,
  );

  return {
    agentId: agent.id,
    mode: agent.mode,
    doctrine: doctrine.doctrine,
    summary: doctrine.summary,
    nextSkill,
    nextSkillReason: `${skillLabels[nextSkill]} best reinforces the current doctrine without wasting upgrades on lower-leverage stats.`,
    upgradeQueue: doctrine.upgradeQueue,
    combatDirective: doctrine.combatDirective,
    objectiveDirective: doctrine.objectiveDirective,
    economyDirective: autonomyPassActive
      ? "Recycle wins into the next upgrade, then re-enter paid queues when the treasury can carry the cadence."
      : "Compound confirmed wins into the next best skill. The planner keeps the upgrade order tight.",
    x402Directive: autonomyPassActive
      ? "Premium autonomy is active: queue discipline, upgrade timing, and economy routing are all tighter now."
      : "Buy the x402 autonomy pass to unlock stronger planning and a tighter autonomous loop.",
    missionTitle: missionFrame.missionTitle,
    missionDetail: missionFrame.missionDetail,
    campaignHook: missionFrame.campaignHook,
    nextMoves: missionFrame.nextMoves,
    autonomyPassActive,
    autonomyPassValidUntil,
    campaignPriority,
    recommendedQueue,
    economyPosture,
    objectivePosture: doctrine.objectivePosture,
    readinessScore,
    confidenceBand,
    skillPurchases,
    paidEntries,
    settlements,
  };
}
