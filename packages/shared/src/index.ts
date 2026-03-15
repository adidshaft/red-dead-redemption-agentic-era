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
  humanQueueFillMs: 6 * 1000,
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

export const frontierMapIds = ["dust_circuit", "deadrock_gulch"] as const;
export type FrontierMapId = (typeof frontierMapIds)[number];

export type FrontierSolid =
  | {
      shape: "rect";
      width: number;
      height: number;
    }
  | {
      shape: "circle";
      radius: number;
    };

export type FrontierObstacle = {
  id: string;
  label: string;
  x: number;
  y: number;
  solid: FrontierSolid;
};

export type FrontierLandmark = {
  id: string;
  label: string;
  x: number;
  y: number;
  coverRadius: number;
  obstacleId?: string;
};

export type FrontierMap = {
  id: FrontierMapId;
  name: string;
  landmarks: FrontierLandmark[];
  obstacles: FrontierObstacle[];
  spawnPoints: Array<{ x: number; y: number }>;
  caravanLanes: Array<{
    id: string;
    y: number;
    startX: number;
    endX: number;
  }>;
};

export const frontierMaps: Record<FrontierMapId, FrontierMap> = {
  dust_circuit: {
    id: "dust_circuit",
    name: "The Dust Circuit",
    landmarks: [
      {
        id: "saloon",
        label: "Saloon",
        x: 210,
        y: 198,
        coverRadius: 124,
        obstacleId: "saloon",
      },
      {
        id: "hotel",
        label: "Hotel",
        x: 1270,
        y: 190,
        coverRadius: 124,
        obstacleId: "hotel",
      },
      {
        id: "wagon-street",
        label: "Wagon Street",
        x: 810,
        y: 275,
        coverRadius: 96,
        obstacleId: "wagon-street",
      },
      {
        id: "west-street",
        label: "West Street",
        x: 555,
        y: 270,
        coverRadius: 92,
        obstacleId: "west-street",
      },
      {
        id: "east-street",
        label: "East Street",
        x: 1035,
        y: 220,
        coverRadius: 94,
        obstacleId: "east-street",
      },
      {
        id: "wash",
        label: "Wash",
        x: 208,
        y: 650,
        coverRadius: 122,
        obstacleId: "wash",
      },
      {
        id: "stable",
        label: "Stable",
        x: 1265,
        y: 650,
        coverRadius: 122,
        obstacleId: "stable",
      },
      {
        id: "corral",
        label: "Main Corral",
        x: 1140,
        y: 510,
        coverRadius: 104,
        obstacleId: "corral",
      },
    ],
    obstacles: [
      {
        id: "saloon",
        label: "Saloon",
        x: 150,
        y: 150,
        solid: { shape: "rect", width: 250, height: 122 },
      },
      {
        id: "hotel",
        label: "Hotel",
        x: 1210,
        y: 140,
        solid: { shape: "rect", width: 250, height: 128 },
      },
      {
        id: "wash",
        label: "Wash",
        x: 145,
        y: 652,
        solid: { shape: "rect", width: 260, height: 124 },
      },
      {
        id: "stable",
        label: "Stable",
        x: 1205,
        y: 648,
        solid: { shape: "rect", width: 260, height: 128 },
      },
      {
        id: "east-street",
        label: "Water Tower",
        x: 1035,
        y: 220,
        solid: { shape: "circle", radius: 52 },
      },
      {
        id: "wagon-street",
        label: "Stage Wagon",
        x: 810,
        y: 275,
        solid: { shape: "rect", width: 132, height: 64 },
      },
      {
        id: "corral",
        label: "Main Corral",
        x: 1140,
        y: 510,
        solid: { shape: "rect", width: 170, height: 96 },
      },
      {
        id: "west-street",
        label: "West Street Crates",
        x: 555,
        y: 270,
        solid: { shape: "circle", radius: 38 },
      },
      {
        id: "center-crates",
        label: "Center Crates",
        x: 720,
        y: 360,
        solid: { shape: "circle", radius: 42 },
      },
      {
        id: "wash-fence",
        label: "Wash Fence",
        x: 420,
        y: 625,
        solid: { shape: "rect", width: 140, height: 24 },
      },
      {
        id: "stable-fence",
        label: "Stable Fence",
        x: 1010,
        y: 615,
        solid: { shape: "rect", width: 120, height: 24 },
      },
      {
        id: "south-crates-west",
        label: "South Crates West",
        x: 640,
        y: 610,
        solid: { shape: "circle", radius: 36 },
      },
      {
        id: "south-crates-east",
        label: "South Crates East",
        x: 955,
        y: 610,
        solid: { shape: "circle", radius: 36 },
      },
    ],
    spawnPoints: [
      { x: 340, y: 320 },
      { x: gameConfig.arenaSize.width - 340, y: 320 },
      { x: 340, y: gameConfig.arenaSize.height - 240 },
      {
        x: gameConfig.arenaSize.width - 340,
        y: gameConfig.arenaSize.height - 240,
      },
    ],
    caravanLanes: [
      {
        id: "north-road",
        y: 282,
        startX: -140,
        endX: gameConfig.arenaSize.width + 140,
      },
      {
        id: "south-road",
        y: 640,
        startX: -140,
        endX: gameConfig.arenaSize.width + 140,
      },
    ],
  },
  deadrock_gulch: {
    id: "deadrock_gulch",
    name: "Deadrock Gulch",
    landmarks: [
      {
        id: "sheriff",
        label: "Sheriff House",
        x: 240,
        y: 188,
        coverRadius: 122,
        obstacleId: "sheriff",
      },
      {
        id: "dry-store",
        label: "Dry Store",
        x: 1270,
        y: 194,
        coverRadius: 124,
        obstacleId: "dry-store",
      },
      {
        id: "mine-cart",
        label: "Mine Cart Pass",
        x: 790,
        y: 245,
        coverRadius: 100,
        obstacleId: "mine-cart",
      },
      {
        id: "telegraph",
        label: "Telegraph Rise",
        x: 560,
        y: 340,
        coverRadius: 92,
        obstacleId: "telegraph",
      },
      {
        id: "west-rocks",
        label: "West Rocks",
        x: 420,
        y: 585,
        coverRadius: 104,
        obstacleId: "west-rocks",
      },
      {
        id: "east-rocks",
        label: "East Rocks",
        x: 1110,
        y: 560,
        coverRadius: 108,
        obstacleId: "east-rocks",
      },
      {
        id: "chapel",
        label: "Chapel Bluff",
        x: 760,
        y: 680,
        coverRadius: 118,
        obstacleId: "chapel",
      },
      {
        id: "gulch-wreck",
        label: "Gulch Wreck",
        x: 620,
        y: 480,
        coverRadius: 94,
        obstacleId: "gulch-wreck",
      },
    ],
    obstacles: [
      {
        id: "sheriff",
        label: "Sheriff House",
        x: 210,
        y: 158,
        solid: { shape: "rect", width: 220, height: 116 },
      },
      {
        id: "dry-store",
        label: "Dry Store",
        x: 1260,
        y: 170,
        solid: { shape: "rect", width: 230, height: 122 },
      },
      {
        id: "mine-cart",
        label: "Mine Cart Pass",
        x: 790,
        y: 245,
        solid: { shape: "rect", width: 140, height: 66 },
      },
      {
        id: "telegraph",
        label: "Telegraph Rise",
        x: 560,
        y: 340,
        solid: { shape: "circle", radius: 38 },
      },
      {
        id: "west-rocks",
        label: "West Rocks",
        x: 420,
        y: 585,
        solid: { shape: "circle", radius: 58 },
      },
      {
        id: "east-rocks",
        label: "East Rocks",
        x: 1110,
        y: 560,
        solid: { shape: "circle", radius: 62 },
      },
      {
        id: "chapel",
        label: "Chapel Bluff",
        x: 760,
        y: 675,
        solid: { shape: "rect", width: 220, height: 120 },
      },
      {
        id: "rail-fence",
        label: "Rail Fence",
        x: 960,
        y: 340,
        solid: { shape: "rect", width: 140, height: 24 },
      },
      {
        id: "gulch-wreck",
        label: "Gulch Wreck",
        x: 620,
        y: 480,
        solid: { shape: "rect", width: 120, height: 56 },
      },
    ],
    spawnPoints: [
      { x: 300, y: 300 },
      { x: gameConfig.arenaSize.width - 300, y: 300 },
      { x: 320, y: gameConfig.arenaSize.height - 230 },
      {
        x: gameConfig.arenaSize.width - 320,
        y: gameConfig.arenaSize.height - 230,
      },
    ],
    caravanLanes: [
      {
        id: "north-gulch",
        y: 300,
        startX: -140,
        endX: gameConfig.arenaSize.width + 140,
      },
      {
        id: "south-gulch",
        y: 570,
        startX: -140,
        endX: gameConfig.arenaSize.width + 140,
      },
    ],
  },
};

export const frontierLandmarks = frontierMaps.dust_circuit.landmarks;
export const frontierObstacles = frontierMaps.dust_circuit.obstacles;

export function getFrontierMap(mapId: FrontierMapId = "dust_circuit") {
  return frontierMaps[mapId];
}

export function isPointInsideFrontierObstacle(
  x: number,
  y: number,
  obstacle: FrontierObstacle,
  padding = 0,
) {
  if (obstacle.solid.shape === "circle") {
    return Math.hypot(x - obstacle.x, y - obstacle.y) <= obstacle.solid.radius + padding;
  }

  const halfWidth = obstacle.solid.width / 2 + padding;
  const halfHeight = obstacle.solid.height / 2 + padding;
  return (
    x >= obstacle.x - halfWidth &&
    x <= obstacle.x + halfWidth &&
    y >= obstacle.y - halfHeight &&
    y <= obstacle.y + halfHeight
  );
}

export function isFrontierPositionBlocked(
  mapId: FrontierMapId,
  x: number,
  y: number,
  padding = 0,
) {
  return getFrontierMap(mapId).obstacles.some((obstacle) =>
    isPointInsideFrontierObstacle(x, y, obstacle, padding),
  );
}

export function resolveFrontierPosition(
  mapId: FrontierMapId,
  x: number,
  y: number,
  padding = 0,
) {
  let resolvedX = x;
  let resolvedY = y;
  const obstacles = getFrontierMap(mapId).obstacles;

  for (let iteration = 0; iteration < 3; iteration += 1) {
    let collided = false;

    for (const obstacle of obstacles) {
      if (!isPointInsideFrontierObstacle(resolvedX, resolvedY, obstacle, padding)) {
        continue;
      }

      collided = true;
      if (obstacle.solid.shape === "circle") {
        const dx = resolvedX - obstacle.x;
        const dy = resolvedY - obstacle.y;
        const distance = Math.max(1, Math.hypot(dx, dy));
        const pushRadius = obstacle.solid.radius + padding;
        resolvedX = obstacle.x + (dx / distance) * pushRadius;
        resolvedY = obstacle.y + (dy / distance) * pushRadius;
        continue;
      }

      const halfWidth = obstacle.solid.width / 2 + padding;
      const halfHeight = obstacle.solid.height / 2 + padding;
      const distanceToLeft = Math.abs(resolvedX - (obstacle.x - halfWidth));
      const distanceToRight = Math.abs(obstacle.x + halfWidth - resolvedX);
      const distanceToTop = Math.abs(resolvedY - (obstacle.y - halfHeight));
      const distanceToBottom = Math.abs(obstacle.y + halfHeight - resolvedY);
      const smallest = Math.min(
        distanceToLeft,
        distanceToRight,
        distanceToTop,
        distanceToBottom,
      );

      if (smallest === distanceToLeft) {
        resolvedX = obstacle.x - halfWidth;
      } else if (smallest === distanceToRight) {
        resolvedX = obstacle.x + halfWidth;
      } else if (smallest === distanceToTop) {
        resolvedY = obstacle.y - halfHeight;
      } else {
        resolvedY = obstacle.y + halfHeight;
      }
    }

    if (!collided) {
      break;
    }
  }

  return {
    x: resolvedX,
    y: resolvedY,
  };
}

export function findNearestFrontierLandmark(
  mapId: FrontierMapId,
  x: number,
  y: number,
) {
  return getFrontierMap(mapId).landmarks
    .map((landmark) => ({
      landmark,
      distance: Math.hypot(landmark.x - x, landmark.y - y),
    }))
    .sort((left, right) => left.distance - right.distance)[0] ?? null;
}

export function findOpenFrontierPosition(
  mapId: FrontierMapId,
  x: number,
  y: number,
  padding = 0,
) {
  if (!isFrontierPositionBlocked(mapId, x, y, padding)) {
    return { x, y };
  }

  for (let radius = 18; radius <= 220; radius += 18) {
    for (let step = 0; step < 16; step += 1) {
      const angle = (Math.PI * 2 * step) / 16;
      const candidateX = x + Math.cos(angle) * radius;
      const candidateY = y + Math.sin(angle) * radius;
      if (!isFrontierPositionBlocked(mapId, candidateX, candidateY, padding)) {
        return { x: candidateX, y: candidateY };
      }
    }
  }

  return resolveFrontierPosition(mapId, x, y, padding);
}

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
  mapId: z.enum(frontierMapIds).optional().default("dust_circuit"),
  status: z.enum(["queued", "in_progress", "settling", "finished"]),
  startedAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  seed: z.number().int(),
  paid: z.boolean(),
  players: z.array(matchPlayerStateSchema),
  pickups: z.array(arenaPickupSchema),
  objective: arenaObjectiveSchema.nullable().optional().default(null),
  bounty: arenaBountySchema.nullable().optional().default(null),
  caravan: arenaCaravanSchema.nullable().optional().default(null),
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

export const frontierRiderProfileSchema = z.object({
  agentId: z.string(),
  displayName: z.string(),
  kind: z.enum(["player", "house_bot"]),
  mode: agentModeSchema,
  walletAddress: z.string().nullable(),
  onchainLinked: z.boolean(),
  campaignTierLabel: z.string(),
  wins: z.number().int().nonnegative(),
  matchesPlayed: z.number().int().nonnegative(),
  currentStreak: z.number().int().nonnegative(),
  bestScore: z.number().int().nonnegative(),
  careerPayoutWei: z.string(),
  skillPurchases: z.number().int().nonnegative(),
  paidEntries: z.number().int().nonnegative(),
  settlements: z.number().int().nonnegative(),
  premiumPassActive: z.boolean(),
  latestPlacement: z.number().int().positive().nullable(),
  latestResultLabel: z.string(),
  lastReceiptPurpose: transactionPurposeSchema.nullable(),
});

export type FrontierRiderProfile = z.infer<typeof frontierRiderProfileSchema>;

export const frontierRecentResultSchema = z.object({
  matchId: z.string(),
  winnerAgentId: z.string().nullable(),
  winnerDisplayName: z.string(),
  mapId: z.enum(frontierMapIds),
  paid: z.boolean(),
  endedAt: z.string().nullable(),
  players: z.number().int().positive(),
  settlementTxHash: z.string().nullable(),
  payoutWei: z.string(),
});

export type FrontierRecentResult = z.infer<typeof frontierRecentResultSchema>;

export const liveFrontierResponseSchema = z.object({
  matches: z.array(matchSnapshotSchema),
  riderProfiles: z.array(frontierRiderProfileSchema),
  recentResults: z.array(frontierRecentResultSchema),
});

export type LiveFrontierResponse = z.infer<typeof liveFrontierResponseSchema>;

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
