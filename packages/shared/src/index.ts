import { z } from "zod";

export const gameConfig = {
  maxOwnedAgents: 3,
  maxQueuedAgentsPerUser: 1,
  arenaSize: {
    width: 1600,
    height: 900,
  },
  matchDurationMs: 3 * 60 * 1000,
  matchCountdownMs: 3 * 1000,
  humanQueueFillMs: 30 * 1000,
  paidQueueReservationMs: 90 * 1000,
  ticksPerSecond: 10,
  autonomyDecisionMs: 1_200,
  spawnHealth: 100,
  spawnAmmo: 6,
  maxAmmo: 6,
  movementSpeed: 225,
  projectileSpeed: 920,
  fireCooldownMs: 550,
  dodgeCooldownMs: 1_800,
  reloadDurationMs: 1_500,
  pickupSpawnMs: 12_000,
  pickupCollectRadius: 56,
  maxArenaPickups: 4,
  healthPickupValue: 25,
  ammoPickupValue: 3,
  objectiveFirstSpawnMs: 25_000,
  objectiveRespawnMs: 30_000,
  objectiveDurationMs: 20_000,
  objectiveCollectRadius: 72,
  objectiveAmmoValue: 3,
  objectiveHealthValue: 15,
  objectiveScoreValue: 80,
  bountyFirstSpawnMs: 12_000,
  bountyRespawnMs: 24_000,
  bountyScoreValue: 90,
  caravanFirstSpawnMs: 42_000,
  caravanRespawnMs: 45_000,
  caravanDurationMs: 18_000,
  caravanScoreValue: 120,
  caravanAmmoValue: 2,
  coverRadius: 108,
  coverMaxBonus: 18,
  safeZoneStartRadius: 520,
  safeZoneEndRadius: 150,
  safeZoneShrinkDelayMs: 20 * 1000,
  safeZoneDamagePerTick: 2,
  houseBotPrefix: "HouseBot",
} as const;

export const frontierLandmarks = [
  { id: "saloon", label: "Saloon", x: 520, y: 250, coverRadius: 108 },
  { id: "hotel", label: "Hotel", x: 1080, y: 250, coverRadius: 108 },
  { id: "wagon-street", label: "Wagon Street", x: 800, y: 280, coverRadius: 94 },
  { id: "west-street", label: "West Street", x: 610, y: 455, coverRadius: 88 },
  { id: "east-street", label: "East Street", x: 990, y: 455, coverRadius: 88 },
  { id: "wash", label: "Wash", x: 520, y: 640, coverRadius: 104 },
  { id: "stable", label: "Stable", x: 1080, y: 640, coverRadius: 104 },
  { id: "corral", label: "Main Corral", x: 800, y: 620, coverRadius: 96 },
] as const;

export type FrontierLandmark = (typeof frontierLandmarks)[number];

export const skillKeys = [
  "quickdraw",
  "grit",
  "trailcraft",
  "tactics",
  "fortune",
] as const;

export type SkillKey = (typeof skillKeys)[number];

export const skillLabels: Record<SkillKey, string> = {
  quickdraw: "Quickdraw",
  grit: "Grit",
  trailcraft: "Trailcraft",
  tactics: "Tactics",
  fortune: "Fortune",
};

export const baseSkillValue = 20;
export const maxSkillValue = 100;
export const spawnBonusBudget = 10;
export const skillPurchaseIncrement = 5;

export const skillSetSchema = z.object({
  quickdraw: z.number().int().min(baseSkillValue).max(maxSkillValue),
  grit: z.number().int().min(baseSkillValue).max(maxSkillValue),
  trailcraft: z.number().int().min(baseSkillValue).max(maxSkillValue),
  tactics: z.number().int().min(baseSkillValue).max(maxSkillValue),
  fortune: z.number().int().min(baseSkillValue).max(maxSkillValue),
});

export type SkillSet = z.infer<typeof skillSetSchema>;

export const agentModeSchema = z.enum(["manual", "autonomous"]);
export type AgentMode = z.infer<typeof agentModeSchema>;

export const agentProfileSchema = z.object({
  id: z.string().min(1),
  ownerAddress: z.string().min(1),
  baseName: z.string().min(2).max(18),
  displayName: z.string().min(3).max(32),
  uniqueSuffix: z.string().length(6),
  mode: agentModeSchema,
  isStarter: z.boolean(),
  walletAddress: z.string().min(1),
  skills: skillSetSchema,
  createdAt: z.string(),
});

export type AgentProfile = z.infer<typeof agentProfileSchema>;

export const transactionPurposeSchema = z.enum([
  "agent_registration",
  "skill_purchase",
  "match_entry",
  "match_settlement",
  "autonomy_pass",
]);

export type TransactionPurpose = z.infer<typeof transactionPurposeSchema>;

export const onchainReceiptSchema = z.object({
  txHash: z.string().min(1),
  chainId: z.number().int().positive(),
  status: z.enum(["pending", "confirmed", "failed"]),
  purpose: transactionPurposeSchema,
  explorerUrl: z.string().url().optional(),
  agentId: z.string().optional(),
  matchId: z.string().optional(),
  createdAt: z.string(),
});

export type OnchainReceipt = z.infer<typeof onchainReceiptSchema>;

export const arenaCommandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("move"),
    dx: z.number().min(-1).max(1),
    dy: z.number().min(-1).max(1),
  }),
  z.object({
    type: z.literal("fire"),
    targetX: z.number(),
    targetY: z.number(),
  }),
  z.object({
    type: z.literal("dodge"),
    targetX: z.number(),
    targetY: z.number(),
  }),
  z.object({
    type: z.literal("idle"),
  }),
  z.object({
    type: z.literal("reload"),
  }),
]);

export type ArenaCommand = z.infer<typeof arenaCommandSchema>;

export const autonomyActionSchema = z.object({
  reasoning: z.string().min(1).max(240),
  command: arenaCommandSchema,
});

export type AutonomyAction = z.infer<typeof autonomyActionSchema>;

export const arenaPickupTypeSchema = z.enum(["health", "ammo"]);
export type ArenaPickupType = z.infer<typeof arenaPickupTypeSchema>;

export const arenaPickupSchema = z.object({
  id: z.string(),
  type: arenaPickupTypeSchema,
  x: z.number(),
  y: z.number(),
  value: z.number().int().positive(),
});

export type ArenaPickup = z.infer<typeof arenaPickupSchema>;

export const safeZoneSchema = z.object({
  centerX: z.number(),
  centerY: z.number(),
  radius: z.number().positive(),
});

export type SafeZone = z.infer<typeof safeZoneSchema>;

export const arenaObjectiveSchema = z.object({
  id: z.string(),
  type: z.literal("supply_drop"),
  label: z.string(),
  rewardLabel: z.string(),
  x: z.number(),
  y: z.number(),
  expiresAt: z.string(),
});

export type ArenaObjective = z.infer<typeof arenaObjectiveSchema>;

export const arenaBountySchema = z.object({
  targetAgentId: z.string(),
  displayName: z.string(),
  bonusScore: z.number().int().positive(),
});

export type ArenaBounty = z.infer<typeof arenaBountySchema>;

export const arenaCaravanSchema = z.object({
  id: z.string(),
  label: z.string(),
  rewardLabel: z.string(),
  x: z.number(),
  y: z.number(),
  destinationX: z.number(),
  destinationY: z.number(),
  expiresAt: z.string(),
});

export type ArenaCaravan = z.infer<typeof arenaCaravanSchema>;

export const matchPlayerStateSchema = z.object({
  agentId: z.string(),
  displayName: z.string(),
  health: z.number(),
  ammo: z.number(),
  isReloading: z.boolean(),
  kills: z.number().int().nonnegative(),
  shotsFired: z.number().int().nonnegative(),
  shotsHit: z.number().int().nonnegative(),
  damageDealt: z.number().int().nonnegative(),
  score: z.number().int().nonnegative(),
  mode: agentModeSchema,
  x: z.number(),
  y: z.number(),
  coverLabel: z.string().nullable().optional(),
  coverBonus: z.number().int().nonnegative().optional(),
  alive: z.boolean(),
  lastCommand: arenaCommandSchema.optional(),
});

export const matchEventSchema = z.object({
  id: z.string(),
  type: z.enum([
    "spawn",
    "announcement",
    "autonomy",
    "objective",
    "bounty",
    "caravan",
    "move",
    "fire",
    "reload",
    "hit",
    "dodge",
    "pickup",
    "elimination",
    "timeout",
    "settled",
  ]),
  actorAgentId: z.string().optional(),
  targetAgentId: z.string().optional(),
  message: z.string(),
  createdAt: z.string(),
});

export const matchSnapshotSchema = z.object({
  matchId: z.string(),
  status: z.enum(["queued", "in_progress", "settling", "finished"]),
  startedAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  seed: z.number().int(),
  paid: z.boolean(),
  players: z.array(matchPlayerStateSchema),
  pickups: z.array(arenaPickupSchema),
  objective: arenaObjectiveSchema.nullable(),
  bounty: arenaBountySchema.nullable(),
  caravan: arenaCaravanSchema.nullable().optional(),
  safeZone: safeZoneSchema,
  events: z.array(matchEventSchema),
  winnerAgentId: z.string().nullable(),
  settlementTxHash: z.string().nullable(),
});

export type MatchSnapshot = z.infer<typeof matchSnapshotSchema>;
export type MatchEvent = z.infer<typeof matchEventSchema>;
export type MatchPlayerState = z.infer<typeof matchPlayerStateSchema>;

export const autonomyPlanSchema = z.object({
  agentId: z.string(),
  mode: agentModeSchema,
  doctrine: z.string(),
  summary: z.string(),
  nextSkill: z.enum(skillKeys),
  nextSkillReason: z.string(),
  upgradeQueue: z.array(z.enum(skillKeys)).min(1).max(5),
  combatDirective: z.string(),
  objectiveDirective: z.string(),
  economyDirective: z.string(),
  x402Directive: z.string(),
  missionTitle: z.string(),
  missionDetail: z.string(),
  campaignHook: z.string(),
  nextMoves: z.array(z.string()).min(3).max(3),
  autonomyPassActive: z.boolean(),
  autonomyPassValidUntil: z.string().nullable(),
  campaignPriority: z.enum([
    "buy_skill",
    "queue_paid",
    "buy_autonomy_pass",
    "run_practice",
  ]),
  recommendedQueue: z.enum(["practice", "paid"]),
  economyPosture: z.enum(["bootstrap", "compounding", "aggressive"]),
  objectivePosture: z.enum(["contest", "flank", "hold"]),
  readinessScore: z.number().int().min(0).max(100),
  confidenceBand: z.enum(["low", "medium", "high"]),
  skillPurchases: z.number().int().nonnegative(),
  paidEntries: z.number().int().nonnegative(),
  settlements: z.number().int().nonnegative(),
});

export type AutonomyPlan = z.infer<typeof autonomyPlanSchema>;

export const agentCampaignStatsSchema = z.object({
  agentId: z.string(),
  matchesPlayed: z.number().int().nonnegative(),
  paidMatches: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  podiums: z.number().int().nonnegative(),
  totalKills: z.number().int().nonnegative(),
  totalDamage: z.number().int().nonnegative(),
  totalScore: z.number().int().nonnegative(),
  bestScore: z.number().int().nonnegative(),
  averagePlacement: z.number().nonnegative(),
  recentPlacements: z.array(z.number().int().positive()).max(5),
  careerPayoutWei: z.string(),
  currentStreak: z.number().int().nonnegative(),
  campaignTier: z.enum(["rookie", "contender", "marshal", "legend"]),
});

export type AgentCampaignStats = z.infer<typeof agentCampaignStatsSchema>;

export const agentMatchRecordSchema = z.object({
  matchId: z.string(),
  finishedAt: z.string().nullable(),
  paid: z.boolean(),
  placement: z.number().int().positive(),
  players: z.number().int().positive(),
  kills: z.number().int().nonnegative(),
  damageDealt: z.number().int().nonnegative(),
  score: z.number().int().nonnegative(),
  payoutWei: z.string(),
  won: z.boolean(),
  settlementTxHash: z.string().nullable(),
});

export type AgentMatchRecord = z.infer<typeof agentMatchRecordSchema>;

export const createAgentInputSchema = z.object({
  baseName: z
    .string()
    .trim()
    .min(2)
    .max(18)
    .regex(/^[a-zA-Z0-9 ]+$/, "Use letters, numbers, and spaces only."),
});

export const setAgentModeInputSchema = z.object({
  mode: agentModeSchema,
});

export const queueForMatchInputSchema = z.object({
  agentId: z.string().min(1),
  paid: z.boolean().default(true),
  matchId: z.string().min(1).optional(),
  txHash: z.string().min(1).optional(),
});

export const settleWebhookInputSchema = z.object({
  txHash: z.string().min(1),
  matchId: z.string().min(1),
});

export const createNonceInputSchema = z.object({
  address: z.string().min(1),
});

export const verifySignatureInputSchema = z.object({
  address: z.string().min(1),
  nonce: z.string().min(1),
  signature: z.string().min(1),
});

export const buySkillInputSchema = z.object({
  agentId: z.string().min(1),
  skill: z.enum(skillKeys),
  txHash: z.string().min(1),
});

export const registerAgentInputSchema = z.object({
  agentId: z.string().min(1),
  txHash: z.string().min(1),
});

export const x402AutonomyPassInputSchema = z.object({
  agentId: z.string().min(1),
  paymentPayload: z.record(z.string(), z.unknown()).optional(),
});

export const apiErrorSchema = z.object({
  error: z.string(),
  details: z.unknown().optional(),
});

export type ApiError = z.infer<typeof apiErrorSchema>;

export const skillPriceBands = [
  {
    maxInclusive: 40,
    priceInWei: 1_000_000_000_000_000n,
  },
  {
    maxInclusive: 70,
    priceInWei: 2_000_000_000_000_000n,
  },
  {
    maxInclusive: 100,
    priceInWei: 4_000_000_000_000_000n,
  },
] as const;

export const matchEntryFeeWei = 2_000_000_000_000_000n;
export const winnerShareBasisPoints = 9_500n;
export const appTreasuryBasisPoints = 500n;

export const xLayerTestnet = {
  id: 1952,
  name: "X Layer Testnet",
  nativeCurrency: {
    decimals: 18,
    name: "OKB",
    symbol: "OKB",
  },
  rpcUrl: "https://testrpc.xlayer.tech/terigon",
  explorerUrl: "https://www.okx.com/web3/explorer/xlayer-test",
} as const;

export const xLayerMainnet = {
  id: 196,
  name: "X Layer Mainnet",
  nativeCurrency: {
    decimals: 18,
    name: "OKB",
    symbol: "OKB",
  },
  rpcUrl: "https://rpc.xlayer.tech",
  explorerUrl: "https://www.oklink.com/xlayer",
} as const;

export const arenaEconomyAbi = [
  {
    inputs: [
      {
        internalType: "address",
        name: "appTreasury",
        type: "address",
      },
      {
        internalType: "address",
        name: "operator",
        type: "address",
      },
    ],
    stateMutability: "nonpayable",
    type: "constructor",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "agentId",
        type: "bytes32",
      },
      {
        indexed: false,
        internalType: "address",
        name: "treasury",
        type: "address",
      },
      {
        indexed: false,
        internalType: "address",
        name: "owner",
        type: "address",
      },
    ],
    name: "AgentRegistered",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "agentId",
        type: "bytes32",
      },
      {
        indexed: false,
        internalType: "uint8",
        name: "skillId",
        type: "uint8",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "price",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "purchaseCount",
        type: "uint256",
      },
    ],
    name: "SkillPurchased",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "matchId",
        type: "bytes32",
      },
      {
        indexed: true,
        internalType: "bytes32",
        name: "agentId",
        type: "bytes32",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "price",
        type: "uint256",
      },
    ],
    name: "MatchEntered",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "matchId",
        type: "bytes32",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "pot",
        type: "uint256",
      },
    ],
    name: "MatchSealed",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "matchId",
        type: "bytes32",
      },
      {
        indexed: true,
        internalType: "bytes32",
        name: "winnerAgentId",
        type: "bytes32",
      },
      {
        indexed: false,
        internalType: "bytes32",
        name: "combatDigest",
        type: "bytes32",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "winnerPayout",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "treasuryPayout",
        type: "uint256",
      },
    ],
    name: "MatchSettled",
    type: "event",
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "agentId",
        type: "bytes32",
      },
      {
        internalType: "address",
        name: "treasury",
        type: "address",
      },
    ],
    name: "registerAgent",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "agentId",
        type: "bytes32",
      },
      {
        internalType: "uint8",
        name: "skillId",
        type: "uint8",
      },
    ],
    name: "purchaseSkill",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32",
      },
    ],
    name: "agents",
    outputs: [
      {
        internalType: "address",
        name: "owner",
        type: "address",
      },
      {
        internalType: "address",
        name: "treasury",
        type: "address",
      },
      {
        internalType: "bool",
        name: "exists",
        type: "bool",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "matchId",
        type: "bytes32",
      },
      {
        internalType: "bytes32",
        name: "agentId",
        type: "bytes32",
      },
    ],
    name: "enterMatch",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "matchId",
        type: "bytes32",
      },
    ],
    name: "lockMatch",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "matchId",
        type: "bytes32",
      },
      {
        internalType: "bytes32",
        name: "agentId",
        type: "bytes32",
      },
    ],
    name: "hasEnteredMatch",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32",
      },
    ],
    name: "matchPots",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32",
      },
    ],
    name: "lockedMatches",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "matchId",
        type: "bytes32",
      },
      {
        internalType: "bytes32",
        name: "winnerAgentId",
        type: "bytes32",
      },
      {
        internalType: "bytes32",
        name: "combatDigest",
        type: "bytes32",
      },
    ],
    name: "settleMatch",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "agentId",
        type: "bytes32",
      },
    ],
    name: "getSkillPurchaseCount",
    outputs: [
      {
        internalType: "uint256[5]",
        name: "",
        type: "uint256[5]",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

export function formatDisplayName(baseName: string, uniqueSuffix: string) {
  return `${baseName.trim()}-${uniqueSuffix}`;
}

export function sanitizeBaseName(baseName: string) {
  return baseName.replace(/\s+/g, " ").trim();
}

export function calculateSkillPurchasePrice(currentValue: number) {
  const nextValue = Math.min(
    maxSkillValue,
    currentValue + skillPurchaseIncrement,
  );

  if (nextValue <= 40) {
    return skillPriceBands[0].priceInWei;
  }

  if (nextValue <= 70) {
    return skillPriceBands[1].priceInWei;
  }

  return skillPriceBands[2].priceInWei;
}

export function applySkillUpgrade(skills: SkillSet, skill: SkillKey): SkillSet {
  return {
    ...skills,
    [skill]: Math.min(maxSkillValue, skills[skill] + skillPurchaseIncrement),
  };
}

export function toExplorerTxUrl(
  txHash: string,
  explorerBaseUrl: string = xLayerTestnet.explorerUrl,
) {
  return `${explorerBaseUrl}/tx/${txHash}`;
}

export function mapSkillToId(skill: SkillKey) {
  return skillKeys.indexOf(skill);
}

export function mapSkillIdToKey(skillId: number): SkillKey {
  return skillKeys[skillId] ?? "quickdraw";
}
