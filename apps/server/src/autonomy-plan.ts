import {
  skillKeys,
  skillLabels,
  type AgentProfile,
  type AutonomyPlan,
  type OnchainReceipt,
  type SkillKey,
} from "@rdr/shared";

function sumSkills(agent: AgentProfile, keys: SkillKey[]) {
  return keys.reduce((total, key) => total + agent.skills[key], 0);
}

function getDoctrine(agent: AgentProfile) {
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
    };
  }

  return {
    doctrine: "Iron Ledger Survivor",
    summary:
      "This agent values staying power, swingy fortune spikes, and steady attrition through longer fights.",
    upgradeQueue: ["grit", "fortune", "quickdraw"] as SkillKey[],
    combatDirective:
      "Tank the early chaos, keep the chamber topped off, and outlast weaker riders when the arena shrinks.",
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
  const doctrine = getDoctrine(agent);
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
    skillPurchases,
    paidEntries,
    settlements,
  };
}
