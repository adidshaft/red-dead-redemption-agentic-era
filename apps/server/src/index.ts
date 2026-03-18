import crypto from "node:crypto";

import cors from "@fastify/cors";
import Fastify, { type FastifyRequest } from "fastify";
import { Server } from "socket.io";
import {
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from "@x402/core/http";
import type {
  PaymentPayloadV1,
  PaymentRequiredV1,
  PaymentRequirementsV1,
  SettleResponseV1,
} from "@x402/core/types/v1";
import {
  apiErrorSchema,
  applySkillUpgrade,
  arenaCommandSchema,
  buySkillInputSchema,
  calculateSkillPurchasePrice,
  createDefaultAgentBudgetPolicy,
  createAgentInputSchema,
  createNonceInputSchema,
  type FrontierChainActivity,
  type FrontierRecentResult,
  type FrontierRiderProfile,
  gameConfig,
  matchEntryFeeWei,
  type MatchPlayerState,
  type OnchainReceipt,
  queueForMatchInputSchema,
  registerAgentInputSchema,
  setAgentModeInputSchema,
  settleWebhookInputSchema,
  toExplorerTxUrl,
  updateBudgetPolicyInputSchema,
  verifySignatureInputSchema,
  winnerShareBasisPoints,
  x402AutonomyPassInputSchema,
} from "@rdr/shared";

import {
  buildNonceMessage,
  issueAccessToken,
  readAddressFromToken,
  verifyWalletSignature,
} from "./auth.js";
import { buildAutonomyPlan } from "./autonomy-plan.js";
import { buildAgentMatchRecord, buildCampaignStats } from "./campaign.js";
import { config } from "./config.js";
import { Database } from "./db.js";
import {
  AgentWalletFactory,
  OnchainOsClient,
  XLayerChainService,
} from "./onchain.js";
import {
  ArenaCoordinator,
  createStarterSkills,
  generateAgentIdentity,
} from "./game.js";

const app = Fastify({ logger: true });
const io = new Server(app.server, {
  cors: {
    origin: config.PUBLIC_APP_URL,
    credentials: true,
  },
});

const db = new Database(config.DATABASE_URL);
const onchainOsClient = new OnchainOsClient();
const walletFactory = new AgentWalletFactory(onchainOsClient);
const chainService = new XLayerChainService();

function buildAutonomyPassRequirements(payTo: string): PaymentRequirementsV1 {
  return {
    scheme: "exact",
    network: `eip155:${config.XLAYER_MAINNET_CHAIN_ID}`,
    maxAmountRequired: config.X402_AUTONOMY_AMOUNT,
    resource: `${config.NEXT_PUBLIC_SERVER_URL}/payments/x402/autonomy-pass`,
    description: "Unlock premium autonomy routing for 24 hours.",
    mimeType: "application/json",
    outputSchema: {
      type: "object",
      properties: {
        status: { type: "string" },
        validUntil: { type: "string" },
      },
      required: ["status", "validUntil"],
    },
    payTo,
    maxTimeoutSeconds: config.X402_AUTONOMY_TIMEOUT_SECONDS,
    asset: config.X402_AUTONOMY_ASSET,
    extra: {
      name: config.X402_AUTONOMY_ASSET_NAME,
      version: config.X402_AUTONOMY_ASSET_VERSION,
    },
  };
}

function buildAutonomyPassChallenge(
  paymentRequirements: PaymentRequirementsV1,
): PaymentRequiredV1 {
  return {
    x402Version: 1,
    error: "Premium autonomy requires an x402 payment.",
    accepts: [paymentRequirements],
  };
}

function extractPaymentPayload(request: FastifyRequest) {
  const signatureHeader =
    typeof request.headers["payment-signature"] === "string"
      ? request.headers["payment-signature"]
      : typeof request.headers["x-payment"] === "string"
        ? request.headers["x-payment"]
        : null;
  if (!signatureHeader) {
    return null;
  }

  try {
    return decodePaymentSignatureHeader(signatureHeader) as unknown as PaymentPayloadV1;
  } catch {
    return null;
  }
}

const coordinator = new ArenaCoordinator(db, chainService, {
  emitSnapshot(matchId, snapshot) {
    io.to(`match:${matchId}`).emit("match:snapshot", snapshot);
  },
  emitEvents(matchId, events) {
    io.to(`match:${matchId}`).emit("match:event", events);
  },
  emitMatchResult(matchId, snapshot) {
    io.to(`match:${matchId}`).emit("match:result", snapshot);
  },
  emitQueueUpdate(userAddress, payload) {
    io.to(`user:${userAddress.toLowerCase()}`).emit("queue:update", payload);
  },
});

io.use((socket, next) => {
  const token =
    typeof socket.handshake.auth.token === "string"
      ? socket.handshake.auth.token
      : "";
  const address = readAddressFromToken(token, config.SESSION_SECRET);
  if (!address) {
    next(new Error("Unauthorized"));
    return;
  }

  socket.data.address = address.toLowerCase();
  next();
});

io.on("connection", (socket) => {
  const address = socket.data.address as string;
  socket.join(`user:${address}`);

  socket.on("match:join", (payload: { matchId: string }) => {
    socket.join(`match:${payload.matchId}`);
    const snapshot = coordinator.getMatch(payload.matchId);
    if (snapshot) {
      socket.emit("match:snapshot", snapshot);
    }
  });

  socket.on(
    "match:command",
    async (payload: { matchId: string; agentId: string; command: unknown }) => {
      const agent = await db.getAgentById(payload.agentId);
      if (!agent || agent.ownerAddress !== address) {
        return;
      }

      coordinator.applyCommand(
        payload.matchId,
        payload.agentId,
        payload.command as never,
      );
    },
  );

  socket.on("match:leave", (payload: { matchId: string }) => {
    socket.leave(`match:${payload.matchId}`);
  });
});

function unauthorizedReply() {
  return {
    statusCode: 401,
    body: {
      error: "Unauthorized",
    },
  };
}

function buildHouseBotProfile(
  player: Pick<MatchPlayerState, "agentId" | "displayName" | "mode" | "score">,
): FrontierRiderProfile {
  return {
    agentId: player.agentId,
    displayName: player.displayName,
    kind: "house_bot",
    mode: player.mode,
    walletAddress: null,
    onchainLinked: false,
    campaignTierLabel: "HOUSE BOT",
    wins: 0,
    matchesPlayed: 0,
    currentStreak: 0,
    bestScore: player.score,
    careerPayoutWei: "0",
    skillPurchases: 0,
    paidEntries: 0,
    settlements: 0,
    premiumPassActive: false,
    latestPlacement: null,
    latestResultLabel: "Operator-managed sparring bot",
    lastReceiptPurpose: null,
  };
}

async function buildFrontierRiderProfileForAgentId(
  agentId: string,
  livePlayer?: MatchPlayerState | null,
): Promise<FrontierRiderProfile> {
  const liveDisplayName = livePlayer?.displayName ?? agentId;
  const liveMode = livePlayer?.mode ?? "manual";
  const liveScore = livePlayer?.score ?? 0;
  const isHouseBot =
    agentId.toLowerCase().startsWith("house-bot-") ||
    liveDisplayName.startsWith(gameConfig.houseBotPrefix);

  if (isHouseBot) {
    return buildHouseBotProfile({
      agentId,
      displayName: liveDisplayName,
      mode: liveMode,
      score: liveScore,
    });
  }

  const agent = await db.getAgentById(agentId, { includeDeleted: true });
  if (!agent) {
    return {
      agentId,
      displayName: liveDisplayName,
      kind: "player",
      mode: liveMode,
      walletAddress: null,
      onchainLinked: false,
      campaignTierLabel: "UNSYNCED",
      wins: 0,
      matchesPlayed: 0,
      currentStreak: 0,
      bestScore: liveScore,
      careerPayoutWei: "0",
      skillPurchases: 0,
      paidEntries: 0,
      settlements: 0,
      premiumPassActive: false,
      latestPlacement: null,
      latestResultLabel: "Live rider record unavailable",
      lastReceiptPurpose: null,
    };
  }

  const [matches, receipts, premiumPassActive] = await Promise.all([
    db.listMatchesForAgent(agent.id),
    db.listAgentTransactions(agent.id),
    db.hasActiveAutonomyPass(agent.id),
  ]);

  const campaign = buildCampaignStats(agent.id, matches);
  const latestRecord = matches
    .map((match) => buildAgentMatchRecord(agent.id, match))
    .find((record): record is NonNullable<typeof record> => Boolean(record));

  return {
    agentId: agent.id,
    displayName: agent.displayName,
    kind: "player",
    mode: agent.mode,
    walletAddress: agent.walletAddress,
    onchainLinked: Boolean(agent.walletAddress),
    campaignTierLabel: campaign.campaignTier.toUpperCase(),
    wins: campaign.wins,
    matchesPlayed: campaign.matchesPlayed,
    currentStreak: campaign.currentStreak,
    bestScore: campaign.bestScore,
    careerPayoutWei: campaign.careerPayoutWei,
    skillPurchases: receipts.filter((receipt) => receipt.purpose === "skill_purchase")
      .length,
    paidEntries: receipts.filter((receipt) => receipt.purpose === "match_entry")
      .length,
    settlements: receipts.filter((receipt) => receipt.purpose === "match_settlement")
      .length,
      premiumPassActive,
      latestPlacement: latestRecord?.placement ?? null,
      latestResultLabel: latestRecord
        ? latestRecord.won
          ? "Won last showdown"
        : `Placed #${latestRecord.placement} last run`
      : "No closed run yet",
    lastReceiptPurpose: receipts[0]?.purpose ?? null,
  };
}

async function buildFrontierRiderProfile(
  player: MatchPlayerState,
): Promise<FrontierRiderProfile> {
  return buildFrontierRiderProfileForAgentId(player.agentId, player);
}

function sortFrontierProfiles(
  left: FrontierRiderProfile,
  right: FrontierRiderProfile,
) {
  if (left.kind !== right.kind) {
    return left.kind === "player" ? -1 : 1;
  }

  const leftPayout = BigInt(left.careerPayoutWei);
  const rightPayout = BigInt(right.careerPayoutWei);

  return (
    right.wins - left.wins ||
    right.currentStreak - left.currentStreak ||
    (rightPayout > leftPayout ? 1 : rightPayout < leftPayout ? -1 : 0) ||
    right.bestScore - left.bestScore ||
    right.matchesPlayed - left.matchesPlayed
  );
}

function buildFrontierRecentResult(match: Awaited<ReturnType<Database["listRecentFinishedMatches"]>>[number]): FrontierRecentResult {
  const winner =
    match.winnerAgentId
      ? match.players.find((player) => player.agentId === match.winnerAgentId)
      : null;
  const payoutWei =
    match.paid && match.winnerAgentId
      ? (
          (matchEntryFeeWei * BigInt(match.players.length) * winnerShareBasisPoints) /
          10_000n
        ).toString()
      : "0";

  return {
    matchId: match.matchId,
    winnerAgentId: match.winnerAgentId,
    winnerDisplayName: winner?.displayName ?? "No winner logged",
    mapId: match.mapId ?? "dust_circuit",
    paid: match.paid,
    endedAt: match.endsAt,
    players: match.players.length,
    settlementTxHash: match.settlementTxHash,
    payoutWei,
  };
}

async function buildFrontierChainActivity(
  receipt: OnchainReceipt,
): Promise<FrontierChainActivity> {
  const agent = receipt.agentId
    ? await db.getAgentById(receipt.agentId, { includeDeleted: true })
    : null;
  return {
    txHash: receipt.txHash,
    purpose: receipt.purpose,
    agentId: receipt.agentId ?? null,
    agentDisplayName: agent?.displayName ?? null,
    matchId: receipt.matchId ?? null,
    explorerUrl: receipt.explorerUrl ?? null,
    createdAt: receipt.createdAt,
    laneLabel:
      receipt.purpose === "autonomy_pass"
        ? "X Layer mainnet x402"
        : "X Layer testnet frontier",
    summary: (() => {
      switch (receipt.purpose) {
        case "agent_registration":
          return `${agent?.displayName ?? "A rider"} linked a treasury wallet onchain.`;
        case "skill_purchase":
          return `${agent?.displayName ?? "A rider"} leveled up a combat skill on X Layer.`;
        case "match_entry":
          return receipt.matchId
            ? `${agent?.displayName ?? "A rider"} entered paid match ${receipt.matchId.slice(-6)}.`
            : `${agent?.displayName ?? "A rider"} entered a paid showdown.`;
        case "match_settlement":
          return `${agent?.displayName ?? "A rider"} closed a paid run and locked the payout ledger.`;
        case "autonomy_pass":
          return `${agent?.displayName ?? "A rider"} unlocked premium autonomy through x402.`;
      }
    })(),
  };
}

function getBearerToken(authorizationHeader?: string) {
  if (!authorizationHeader?.startsWith("Bearer ")) {
    return null;
  }
  return authorizationHeader.slice("Bearer ".length);
}

async function requireAddress(request: {
  headers: { authorization?: string };
}) {
  const token = getBearerToken(request.headers.authorization);
  if (!token) {
    return null;
  }
  return readAddressFromToken(token, config.SESSION_SECRET);
}

await app.register(cors, {
  origin: config.PUBLIC_APP_URL,
  credentials: true,
  methods: ["GET", "HEAD", "POST", "DELETE", "OPTIONS"],
});

app.get("/health", async () => ({
  status: "ok",
  chainId: config.XLAYER_TESTNET_CHAIN_ID,
}));

app.post("/auth/nonce", async (request, reply) => {
  const parsed = createNonceInputSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply
      .status(400)
      .send({ error: "Invalid request", details: parsed.error.flatten() });
  }

  const nonce = crypto.randomUUID();
  await db.setNonce(parsed.data.address, nonce);
  return {
    nonce,
    message: buildNonceMessage(parsed.data.address, nonce),
  };
});

app.post("/auth/verify", async (request, reply) => {
  const parsed = verifySignatureInputSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply
      .status(400)
      .send({ error: "Invalid request", details: parsed.error.flatten() });
  }

  const user = await db.getUser(parsed.data.address);
  if (!user?.nonce || user.nonce !== parsed.data.nonce) {
    return reply.status(400).send({ error: "Invalid nonce" });
  }

  const verified = await verifyWalletSignature(parsed.data);
  if (!verified) {
    return reply.status(401).send({ error: "Signature verification failed" });
  }

  await db.upsertUser(parsed.data.address);
  return {
    token: issueAccessToken(parsed.data.address, config.SESSION_SECRET),
    address: parsed.data.address.toLowerCase(),
  };
});

app.get("/agents", async (request, reply) => {
  const address = await requireAddress(request);
  if (!address) {
    return reply.status(401).send(unauthorizedReply().body);
  }

  const agents = await db.listAgentsByOwner(address);
  return {
    agents,
    contractAddress: config.NEXT_PUBLIC_ARENA_ECONOMY_ADDRESS ?? null,
  };
});

app.get("/agents/:id/autonomy-plan", async (request, reply) => {
  const address = await requireAddress(request);
  if (!address) {
    return reply.status(401).send(unauthorizedReply().body);
  }

  const agentId = (request.params as { id: string }).id;
  const agent = await db.getAgentById(agentId);
  if (!agent || agent.ownerAddress !== address) {
    return reply.status(404).send({ error: "Agent not found" });
  }

  const [receipts, autonomyPassActive] = await Promise.all([
    db.listAgentTransactions(agent.id),
    db.hasActiveAutonomyPass(agent.id),
  ]);
  const latestAutonomyPass = await db.getLatestAutonomyPass(agent.id);

  return {
    plan: buildAutonomyPlan(
      agent,
      receipts,
      autonomyPassActive,
      latestAutonomyPass?.validUntil ?? null,
    ),
  };
});

app.get("/agents/:id/campaign", async (request, reply) => {
  const address = await requireAddress(request);
  if (!address) {
    return reply.status(401).send(unauthorizedReply().body);
  }

  const agentId = (request.params as { id: string }).id;
  const agent = await db.getAgentById(agentId);
  if (!agent || agent.ownerAddress !== address) {
    return reply.status(404).send({ error: "Agent not found" });
  }

  const matches = await db.listMatchesForAgent(agent.id);
  return {
    campaign: buildCampaignStats(agent.id, matches),
  };
});

app.get("/agents/:id/matches", async (request, reply) => {
  const address = await requireAddress(request);
  if (!address) {
    return reply.status(401).send(unauthorizedReply().body);
  }

  const agentId = (request.params as { id: string }).id;
  const agent = await db.getAgentById(agentId);
  if (!agent || agent.ownerAddress !== address) {
    return reply.status(404).send({ error: "Agent not found" });
  }

  const matches = await db.listMatchesForAgent(agent.id);
  return {
    matches: matches
      .map((match) => buildAgentMatchRecord(agent.id, match))
      .filter((record): record is NonNullable<typeof record> => Boolean(record))
      .slice(0, 8),
  };
});

app.post("/agents", async (request, reply) => {
  const address = await requireAddress(request);
  if (!address) {
    return reply.status(401).send(unauthorizedReply().body);
  }

  const parsed = createAgentInputSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply
      .status(400)
      .send({ error: "Invalid request", details: parsed.error.flatten() });
  }

  const count = await db.countAgentsByOwner(address);
  if (count >= gameConfig.maxOwnedAgents) {
    return reply.status(400).send({ error: "Agent cap reached" });
  }

  await db.upsertUser(address);

  const identity = generateAgentIdentity(parsed.data.baseName);
  const wallet = await walletFactory.create();
  const agent = await db.createAgent({
    id: identity.id,
    ownerAddress: address,
    baseName: parsed.data.baseName,
    displayName: identity.displayName,
    uniqueSuffix: identity.uniqueSuffix,
    mode: "manual",
    isStarter: count === 0,
    walletAddress: wallet.address,
    walletAccountId: wallet.walletAccountId,
    encryptedPrivateKey: wallet.encryptedPrivateKey,
    skills: createStarterSkills(),
    budgetPolicy: createDefaultAgentBudgetPolicy(),
  });

  if (!agent) {
    return reply.status(500).send({ error: "Agent creation failed" });
  }

  return {
    agent,
    registrationRequired: Boolean(config.NEXT_PUBLIC_ARENA_ECONOMY_ADDRESS),
  };
});

app.delete("/agents/:id", async (request, reply) => {
  const address = await requireAddress(request);
  if (!address) {
    return reply.status(401).send(unauthorizedReply().body);
  }

  const agentId = (request.params as { id: string }).id;
  const agent = await db.getAgentById(agentId);
  if (!agent || agent.ownerAddress !== address) {
    return reply.status(404).send({ error: "Agent not found" });
  }

  if (coordinator.isAgentBusy(agentId)) {
    return reply.status(409).send({
      error:
        "This rider is queued or in a live match. Let the run finish before retiring it.",
    });
  }

  const deleted = await db.softDeleteAgent(agentId);
  if (!deleted) {
    return reply.status(404).send({ error: "Agent not found" });
  }

  return {
    deletedAgentId: agentId,
  };
});

app.post("/agents/:id/register", async (request, reply) => {
  const address = await requireAddress(request);
  if (!address) {
    return reply.status(401).send(unauthorizedReply().body);
  }

  const agentId = (request.params as { id: string }).id;
  const agent = await db.getAgentById(agentId);
  if (!agent || agent.ownerAddress !== address) {
    return reply.status(404).send({ error: "Agent not found" });
  }

  const parsed = registerAgentInputSchema.safeParse({
    ...(request.body as Record<string, unknown>),
    agentId,
  });
  if (!parsed.success) {
    return reply
      .status(400)
      .send({ error: "Invalid request", details: parsed.error.flatten() });
  }

  const receipt = await chainService.verifyRegistrationTx(
    parsed.data.txHash,
    agent.id,
    agent.walletAddress,
  );
  if (!receipt) {
    return reply
      .status(400)
      .send({ error: "Registration transaction could not be verified" });
  }

  await db.createOrUpdateTransaction(receipt);
  return {
    receipt,
  };
});

app.post("/agents/:id/mode", async (request, reply) => {
  const address = await requireAddress(request);
  if (!address) {
    return reply.status(401).send(unauthorizedReply().body);
  }

  const agentId = (request.params as { id: string }).id;
  const agent = await db.getAgentById(agentId);
  if (!agent || agent.ownerAddress !== address) {
    return reply.status(404).send({ error: "Agent not found" });
  }

  const parsed = setAgentModeInputSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply
      .status(400)
      .send({ error: "Invalid request", details: parsed.error.flatten() });
  }

  const updated = await db.updateAgentMode(agentId, parsed.data.mode);
  return {
    agent: updated,
  };
});

app.post("/agents/:id/budget-policy", async (request, reply) => {
  const address = await requireAddress(request);
  if (!address) {
    return reply.status(401).send(unauthorizedReply().body);
  }

  const agentId = (request.params as { id: string }).id;
  const agent = await db.getAgentById(agentId);
  if (!agent || agent.ownerAddress !== address) {
    return reply.status(404).send({ error: "Agent not found" });
  }

  const parsed = updateBudgetPolicyInputSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply
      .status(400)
      .send({ error: "Invalid request", details: parsed.error.flatten() });
  }

  const updated = await db.updateAgentBudgetPolicy(agentId, parsed.data);
  return {
    agent: updated,
  };
});

app.get("/agents/:id/transactions", async (request, reply) => {
  const address = await requireAddress(request);
  if (!address) {
    return reply.status(401).send(unauthorizedReply().body);
  }

  const agentId = (request.params as { id: string }).id;
  const agent = await db.getAgentById(agentId);
  if (!agent || agent.ownerAddress !== address) {
    return reply.status(404).send({ error: "Agent not found" });
  }

  return {
    receipts: await db.listAgentTransactions(agentId),
  };
});

app.post("/agents/:id/skills", async (request, reply) => {
  const address = await requireAddress(request);
  if (!address) {
    return reply.status(401).send(unauthorizedReply().body);
  }

  const agentId = (request.params as { id: string }).id;
  const agent = await db.getAgentById(agentId);
  if (!agent || agent.ownerAddress !== address) {
    return reply.status(404).send({ error: "Agent not found" });
  }

  const parsed = buySkillInputSchema.safeParse({
    ...(request.body as Record<string, unknown>),
    agentId,
  });
  if (!parsed.success) {
    return reply
      .status(400)
      .send({ error: "Invalid request", details: parsed.error.flatten() });
  }

  const receipt = await chainService.verifySkillPurchaseTx(
    parsed.data.txHash,
    agentId,
    parsed.data.skill,
  );
  if (!receipt) {
    return reply
      .status(400)
      .send({ error: "Skill purchase transaction could not be verified" });
  }

  const updatedSkills = applySkillUpgrade(agent.skills, parsed.data.skill);
  let updatedAgent = await db.updateAgentSkills(agentId, updatedSkills);
  if (parsed.data.source === "autonomy" && agent.budgetPolicy.enabled) {
    const spentAmountWei = calculateSkillPurchasePrice(
      agent.skills[parsed.data.skill],
    ).toString();
    updatedAgent = await db.incrementAgentAutoSpend(agentId, spentAmountWei);
  }
  await db.createOrUpdateTransaction(receipt);

  return {
    agent: updatedAgent,
    receipt,
    nextPriceWei: calculateSkillPurchasePrice(
      updatedSkills[parsed.data.skill],
    ).toString(),
  };
});

app.post("/matches/queue", async (request, reply) => {
  const address = await requireAddress(request);
  if (!address) {
    return reply.status(401).send(unauthorizedReply().body);
  }

  const parsed = queueForMatchInputSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply
      .status(400)
      .send({ error: "Invalid request", details: parsed.error.flatten() });
  }

  const agent = await db.getAgentById(parsed.data.agentId);
  if (!agent || agent.ownerAddress !== address) {
    return reply.status(404).send({ error: "Agent not found" });
  }

  if (parsed.data.paid) {
    if (!chainService.isOperatorReady()) {
      return reply.status(503).send({
        error: "Paid matches require a deployed contract and operator wallet.",
      });
    }

    if (!parsed.data.txHash) {
      const prepared = coordinator.preparePaidMatch(address, agent);
      return {
        status: "payment_required",
        matchId: prepared.matchId,
      };
    }

    if (!parsed.data.matchId) {
      return reply
        .status(400)
        .send({ error: "matchId is required to confirm a paid queue entry" });
    }

    const entryReceipt = await chainService.verifyMatchEntryTx(
      parsed.data.txHash,
      parsed.data.matchId,
      agent.id,
    );
    if (!entryReceipt) {
      return reply
        .status(400)
        .send({ error: "Match entry transaction could not be verified" });
    }

    await db.createOrUpdateTransaction(entryReceipt);
    const queued = await coordinator.confirmPaidEntry(
      address,
      agent,
      parsed.data.matchId,
      parsed.data.txHash,
    );
    return {
      status: "queued",
      matchId: queued.matchId,
      entryReceipt,
    };
  }

  await coordinator.enqueuePractice(address, agent);
  return {
    status: "queued",
  };
});

app.post("/matches/:id/command", async (request, reply) => {
  const address = await requireAddress(request);
  if (!address) {
    return reply.status(401).send(unauthorizedReply().body);
  }

  const matchId = (request.params as { id: string }).id;
  const body = request.body as {
    agentId?: string;
    command?: unknown;
  };

  if (!body.agentId) {
    return reply.status(400).send({ error: "agentId is required" });
  }

  const agent = await db.getAgentById(body.agentId);
  if (!agent || agent.ownerAddress !== address) {
    return reply.status(404).send({ error: "Agent not found" });
  }

  const parsedCommand = arenaCommandSchema.safeParse(body.command);
  if (!parsedCommand.success) {
    return reply
      .status(400)
      .send({ error: "Invalid command", details: parsedCommand.error.flatten() });
  }

  coordinator.applyCommand(matchId, body.agentId, parsedCommand.data);
  return {
    accepted: true,
  };
});

app.get("/matches/queue-status", async (request, reply) => {
  const address = await requireAddress(request);
  if (!address) {
    return reply.status(401).send(unauthorizedReply().body);
  }

  return coordinator.getQueueStatus(address);
});

app.get("/matches/live", async () => {
  const matches = coordinator.getAllLiveMatches();
  const uniquePlayers = new Map<string, MatchPlayerState>();

  for (const match of matches) {
    for (const player of match.players) {
      uniquePlayers.set(player.agentId, player);
    }
  }

  const riderProfiles = await Promise.all(
    Array.from(uniquePlayers.values()).map((player) =>
      buildFrontierRiderProfile(player),
    ),
  );
  const [recentResults, leaders, chainActivity] = await Promise.all([
    db.listRecentFinishedMatches(8).then((matches) =>
      matches.map(buildFrontierRecentResult),
    ),
    db.listFrontierAgents(12).then(async (agents) => {
      const profiles = await Promise.all(
        agents.map((agent) => buildFrontierRiderProfileForAgentId(agent.id)),
      );
      return profiles.sort(sortFrontierProfiles).slice(0, 6);
    }),
    db.listRecentTransactions(8).then((receipts) =>
      Promise.all(receipts.map((receipt) => buildFrontierChainActivity(receipt))),
    ),
  ]);

  return {
    matches,
    riderProfiles,
    recentResults,
    leaders,
    chainActivity,
  };
});

app.get("/frontier/riders/:id", async (request, reply) => {
  const agentId = (request.params as { id: string }).id;
  const agent = await db.getAgentById(agentId, { includeDeleted: true });

  if (!agent) {
    return reply.status(404).send({ error: "Rider dossier not found" });
  }

  const [profile, matches, receipts] = await Promise.all([
    buildFrontierRiderProfileForAgentId(agent.id),
    db.listMatchesForAgent(agent.id),
    db.listAgentTransactions(agent.id),
  ]);

  return {
    dossier: {
      profile,
      recentMatches: matches
        .map((match) => buildAgentMatchRecord(agent.id, match))
        .filter((record): record is NonNullable<typeof record> => Boolean(record))
        .slice(0, 5),
      recentReceipts: receipts.slice(0, 5),
    },
  };
});

app.get("/matches/:id", async (request, reply) => {
  const matchId = (request.params as { id: string }).id;
  const match = coordinator.getMatch(matchId);
  if (!match) {
    return reply.status(404).send({ error: "Match not found" });
  }

  return {
    match,
  };
});

app.post("/matches/:id/settle-webhook", async (request, reply) => {
  const parsed = settleWebhookInputSchema.safeParse({
    ...(request.body as Record<string, unknown>),
    matchId: (request.params as { id: string }).id,
  });

  if (!parsed.success) {
    return reply
      .status(400)
      .send({ error: "Invalid request", details: parsed.error.flatten() });
  }

  return {
    accepted: true,
    txHash: parsed.data.txHash,
    matchId: parsed.data.matchId,
  };
});

app.post("/payments/x402/autonomy-pass", async (request, reply) => {
  const address = await requireAddress(request);
  if (!address) {
    return reply.status(401).send(unauthorizedReply().body);
  }

  const parsed = x402AutonomyPassInputSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply
      .status(400)
      .send({ error: "Invalid request", details: parsed.error.flatten() });
  }

  const agent = await db.getAgentById(parsed.data.agentId);
  if (!agent || agent.ownerAddress !== address) {
    return reply.status(404).send({ error: "Agent not found" });
  }

  const paymentRequirements = buildAutonomyPassRequirements(
    config.APP_TREASURY_ADDRESS ?? agent.walletAddress,
  );
  const paymentRequired = buildAutonomyPassChallenge(paymentRequirements);
  const paymentPayload =
    extractPaymentPayload(request) ??
    (parsed.data.paymentPayload as PaymentPayloadV1 | undefined) ??
    null;

  if (!paymentPayload) {
    const supported = await onchainOsClient.getSupportedPayments();
    reply.header(
      "PAYMENT-REQUIRED",
      encodePaymentRequiredHeader(paymentRequired as unknown as Parameters<
        typeof encodePaymentRequiredHeader
      >[0]),
    );
    return reply.status(402).send({
      error: "Payment required",
      mainnet: true,
      scheme: "exact",
      chainId: config.XLAYER_MAINNET_CHAIN_ID,
      amount: config.X402_AUTONOMY_AMOUNT,
      asset: config.X402_AUTONOMY_ASSET,
      payTo: paymentRequirements.payTo,
      paymentRequired,
      supported,
    });
  }

  const verification = await onchainOsClient.verifyPayment(
    paymentPayload,
    paymentRequirements,
  );
  const verificationRecord = verification as
    | (Record<string, unknown> & { data?: Array<{ valid?: boolean }> })
    | null;
  const verified =
    verificationRecord?.code === "0" ||
    verificationRecord?.success === true ||
    verificationRecord?.isValid === true ||
    verificationRecord?.data?.[0]?.valid === true;
  if (!verified) {
    return reply
      .status(400)
      .send({ error: "Payment verification failed", details: verification });
  }

  const settlement = await onchainOsClient.settlePayment(
    paymentPayload,
    paymentRequirements,
  );
  const settlementRecord = settlement as
    | (SettleResponseV1 & { data?: Array<{ txHash?: string }> })
    | null;
  const validUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const paymentTxHash =
    settlementRecord?.data?.[0]?.txHash ??
    settlementRecord?.transaction ??
    null;
  await db.createAutonomyPass(
    agent.id,
    validUntil,
    paymentTxHash,
  );

  const receipt =
    paymentTxHash
      ? {
          txHash: paymentTxHash,
          chainId: config.XLAYER_MAINNET_CHAIN_ID,
          status: "confirmed" as const,
          purpose: "autonomy_pass" as const,
          agentId: agent.id,
          explorerUrl: toExplorerTxUrl(
            paymentTxHash,
            config.NEXT_PUBLIC_XLAYER_MAINNET_EXPLORER_URL,
          ),
          createdAt: new Date().toISOString(),
        }
      : null;
  if (receipt) {
    await db.createOrUpdateTransaction(receipt);
  }

  if (paymentTxHash) {
    const paymentResponse: SettleResponseV1 = {
      success: true,
      transaction: paymentTxHash,
      network: paymentRequirements.network,
    };
    reply.header(
      "PAYMENT-RESPONSE",
      encodePaymentResponseHeader(paymentResponse),
    );
  }

  return {
    status: "active",
    validUntil: validUntil.toISOString(),
    settlement,
    receipt,
  };
});

app.setErrorHandler((error, _request, reply) => {
  app.log.error(error);
  const parsed = apiErrorSchema.parse({
    error: error instanceof Error ? error.message : "Unknown server error",
  });
  reply.status(500).send(parsed);
});

const start = async () => {
  await db.init();
  await app.listen({ port: config.SERVER_PORT, host: "0.0.0.0" });
};

start().catch(async (error) => {
  app.log.error(error);
  coordinator.dispose();
  await db.close();
  process.exit(1);
});
