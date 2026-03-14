import crypto from "node:crypto";

import cors from "@fastify/cors";
import Fastify from "fastify";
import { Server } from "socket.io";
import {
  apiErrorSchema,
  applySkillUpgrade,
  arenaCommandSchema,
  buySkillInputSchema,
  calculateSkillPurchasePrice,
  createAgentInputSchema,
  createNonceInputSchema,
  gameConfig,
  queueForMatchInputSchema,
  registerAgentInputSchema,
  setAgentModeInputSchema,
  settleWebhookInputSchema,
  toExplorerTxUrl,
  verifySignatureInputSchema,
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
  });

  if (!agent) {
    return reply.status(500).send({ error: "Agent creation failed" });
  }

  return {
    agent,
    registrationRequired: Boolean(config.NEXT_PUBLIC_ARENA_ECONOMY_ADDRESS),
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
  const updatedAgent = await db.updateAgentSkills(agentId, updatedSkills);
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

app.get("/matches/live", async () => ({
  matches: coordinator.getAllLiveMatches(),
}));

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

  if (!parsed.data.paymentPayload) {
    const supported = await onchainOsClient.getSupportedPayments();
    return reply.status(402).send({
      error: "Payment required",
      scheme: "exact",
      chainId: config.XLAYER_TESTNET_CHAIN_ID,
      amount: "1000000",
      asset: "USDC",
      payTo: config.APP_TREASURY_ADDRESS ?? agent.walletAddress,
      supported,
    });
  }

  const verification = await onchainOsClient.verifyPayment(
    String(config.XLAYER_TESTNET_CHAIN_ID),
    parsed.data.paymentPayload,
  );
  const verified = verification?.code === "0" || verification?.success === true;
  if (!verified) {
    return reply
      .status(400)
      .send({ error: "Payment verification failed", details: verification });
  }

  const settlement = await onchainOsClient.settlePayment(
    String(config.XLAYER_TESTNET_CHAIN_ID),
    parsed.data.paymentPayload,
  );
  const validUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const paymentTxHash = settlement?.data?.[0]?.txHash ?? null;
  await db.createAutonomyPass(
    agent.id,
    validUntil,
    paymentTxHash,
  );

  const receipt =
    paymentTxHash
      ? {
          txHash: paymentTxHash,
          chainId: config.XLAYER_TESTNET_CHAIN_ID,
          status: "confirmed" as const,
          purpose: "autonomy_pass" as const,
          agentId: agent.id,
          explorerUrl: toExplorerTxUrl(
            paymentTxHash,
            config.NEXT_PUBLIC_XLAYER_EXPLORER_URL,
          ),
          createdAt: new Date().toISOString(),
        }
      : null;
  if (receipt) {
    await db.createOrUpdateTransaction(receipt);
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
