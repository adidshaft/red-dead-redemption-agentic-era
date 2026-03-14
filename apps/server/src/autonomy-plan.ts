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
        "This agent wants first contact, faster takedowns, and decisive trades before the ring closes.",
      upgradeQueue: ["quickdraw", "tactics", "fortune"] as SkillKey[],
      combatDirective:
        "Open aggressively, punish exposed targets, then rotate inward before the dust ring forces bad fights.",
      objectiveDirective:
        "Contest live objectives early, hold the firing lane, and force rivals to challenge your pressure.",
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
        "This agent plays for angle control, cleaner dodges, and late-circle positioning around supplies.",
      upgradeQueue: ["trailcraft", "tactics", "quickdraw"] as SkillKey[],
      combatDirective:
        "Sweep the circle edge for pickups, dodge into cleaner angles, and collapse on distracted rivals.",
      objectiveDirective:
        "Flank around the live objective, let heavier riders commit first, then collapse through side angles.",
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
      "This agent values staying power, swingy fortune spikes, and steady attrition through longer fights.",
    upgradeQueue: ["grit", "fortune", "quickdraw"] as SkillKey[],
    combatDirective:
      "Tank the early chaos, keep the chamber topped off, and outlast weaker riders when the arena shrinks.",
    objectiveDirective:
      "Hold the safest route to the live objective, harvest the reward only when the ring and health state are stable.",
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
      ? "Recycle settlement wins into the next recommended upgrade, then re-enter paid queues when the treasury can sustain the fee cadence."
      : "Use confirmed wins and manual approvals to compound skills. The planner will keep recommending the next highest-leverage upgrade.",
    x402Directive: autonomyPassActive
      ? "Premium autonomy is active: use the planner for stronger queue discipline, upgrade timing, and economy routing."
      : "Buy the x402 autonomy pass to unlock premium planning and a tighter autonomous play loop.",
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
