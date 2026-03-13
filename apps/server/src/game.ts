import crypto from "node:crypto";

import {
  baseSkillValue,
  formatDisplayName,
  gameConfig,
  sanitizeBaseName,
  type AgentProfile,
  type ArenaCommand,
  type MatchEvent,
  type MatchPlayerState,
  type MatchSnapshot,
  type SkillKey,
  type SkillSet,
} from "@rdr/shared";
import { ulid } from "ulid";
import { keccak256, stringToHex, type Hex } from "viem";

import type { Database } from "./db.js";
import type { XLayerChainService } from "./onchain.js";
import { decideAutonomousAction } from "./autonomy.js";

type QueueEntry = {
  userAddress: string;
  agent: AgentProfile;
  queuedAt: number;
  entryTxHash?: string | null;
};

type RuntimePlayer = MatchPlayerState & {
  ownerAddress: string;
  skills: SkillSet;
  moveVector: { dx: number; dy: number };
  fireCooldownUntil: number;
  dodgeCooldownUntil: number;
  lastAutonomyAt: number;
  isBot: boolean;
};

type MatchRuntime = {
  snapshot: MatchSnapshot;
  players: Map<string, RuntimePlayer>;
  timer: NodeJS.Timeout;
};

export function createStarterSkills(random = Math.random): SkillSet {
  const skills: SkillSet = {
    quickdraw: baseSkillValue,
    grit: baseSkillValue,
    trailcraft: baseSkillValue,
    tactics: baseSkillValue,
    fortune: baseSkillValue,
  };

  const keys = Object.keys(skills) as SkillKey[];
  let remaining = 10;

  while (remaining > 0) {
    const key = keys[Math.floor(random() * keys.length)] ?? "quickdraw";
    if (skills[key] < 30) {
      skills[key] += 1;
      remaining -= 1;
    }
  }

  return skills;
}

export function generateAgentIdentity(baseName: string, idFactory = ulid) {
  const id = idFactory();
  const uniqueSuffix = id.slice(-6).toUpperCase();
  return {
    id,
    uniqueSuffix,
    displayName: formatDisplayName(sanitizeBaseName(baseName), uniqueSuffix),
  };
}

export function computeDamage(attacker: RuntimePlayer, target: RuntimePlayer, random = Math.random) {
  const critRoll = random();
  const baseDamage = 12 + Math.round(attacker.skills.quickdraw * 0.12 + attacker.skills.tactics * 0.08);
  const mitigation = Math.round(target.skills.grit * 0.05);
  const critBonus = critRoll < 0.08 + attacker.skills.fortune * 0.001 ? 8 : 0;
  return Math.max(6, baseDamage + critBonus - mitigation);
}

export function resolveShot(attacker: RuntimePlayer, target: RuntimePlayer, random = Math.random) {
  const hitChance = Math.max(
    0.4,
    Math.min(0.92, 0.55 + attacker.skills.quickdraw * 0.002 + attacker.skills.tactics * 0.0015 - target.skills.trailcraft * 0.0012),
  );
  const hit = random() <= hitChance;
  const damage = hit ? computeDamage(attacker, target, random) : 0;
  return { hit, damage };
}

export function createCombatDigest(snapshot: MatchSnapshot): Hex {
  return keccak256(stringToHex(JSON.stringify(snapshot)));
}

function createEvent(event: Omit<MatchEvent, "id" | "createdAt">): MatchEvent {
  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    ...event,
  };
}

export type CoordinatorBroadcasts = {
  emitSnapshot(matchId: string, snapshot: MatchSnapshot): void;
  emitEvents(matchId: string, events: MatchEvent[]): void;
  emitMatchResult(matchId: string, snapshot: MatchSnapshot): void;
  emitQueueUpdate(userAddress: string, payload: { status: "queued" | "ready"; matchId?: string }): void;
};

export class ArenaCoordinator {
  private readonly queue: QueueEntry[] = [];
  private readonly matches = new Map<string, MatchRuntime>();
  private readonly pendingAutonomy = new Set<string>();
  private readonly queueTimer: NodeJS.Timeout;

  constructor(
    private readonly db: Database,
    private readonly chainService: XLayerChainService,
    private readonly broadcasts: CoordinatorBroadcasts,
  ) {
    this.queueTimer = setInterval(() => {
      void this.flushQueue();
    }, 1_000);
  }

  dispose() {
    clearInterval(this.queueTimer);
    for (const match of this.matches.values()) {
      clearInterval(match.timer);
    }
  }

  async enqueue(userAddress: string, agent: AgentProfile, entryTxHash?: string | null) {
    const alreadyQueued = this.queue.some((entry) => entry.userAddress === userAddress);
    if (alreadyQueued) {
      throw new Error("Each player may queue one agent at a time.");
    }

    this.queue.push({ userAddress, agent, queuedAt: Date.now(), entryTxHash });
    this.broadcasts.emitQueueUpdate(userAddress, { status: "queued" });
    await this.flushQueue();
  }

  getMatch(matchId: string) {
    return this.matches.get(matchId)?.snapshot ?? null;
  }

  getAllLiveMatches() {
    return Array.from(this.matches.values()).map((runtime) => runtime.snapshot);
  }

  applyCommand(matchId: string, agentId: string, command: ArenaCommand) {
    const runtime = this.matches.get(matchId);
    if (!runtime) {
      return;
    }

    const actor = runtime.players.get(agentId);
    if (!actor || !actor.alive) {
      return;
    }

    const events = this.applyPlayerCommand(runtime, actor, command);
    this.persistAndBroadcast(runtime, events);
  }

  private async flushQueue() {
    if (this.queue.length === 0) {
      return;
    }

    if (this.queue.length < 4) {
      const queueAge = gameConfig.humanQueueFillMs;
      const now = Date.now();
      const oldestEligible = this.queue[0];
      if (!oldestEligible || now - oldestEligible.queuedAt < queueAge) {
        return;
      }
    }

    const entrants = this.queue.splice(0, Math.min(4, this.queue.length));
    while (entrants.length < 4) {
      entrants.push(this.createBotEntry());
    }

    const runtime = this.createMatchRuntime(entrants);
    this.matches.set(runtime.snapshot.matchId, runtime);
    await this.db.createOrUpdateMatch(runtime.snapshot);

    for (const entrant of entrants.filter((entry) => !entry.userAddress.startsWith("house-bot-"))) {
      this.broadcasts.emitQueueUpdate(entrant.userAddress, { status: "ready", matchId: runtime.snapshot.matchId });
    }

    this.broadcasts.emitSnapshot(runtime.snapshot.matchId, runtime.snapshot);
  }

  private createBotEntry(): QueueEntry {
    const botId = ulid();
    const suffix = botId.slice(-6).toUpperCase();
    return {
      userAddress: `house-bot-${suffix}`.toLowerCase(),
      queuedAt: Date.now(),
      agent: {
        id: botId,
        ownerAddress: `house-bot-${suffix}`.toLowerCase(),
        baseName: "HouseBot",
        displayName: `HouseBot-${suffix}`,
        uniqueSuffix: suffix,
        mode: "autonomous",
        isStarter: false,
        walletAddress: "0x0000000000000000000000000000000000000000",
        skills: createStarterSkills(),
        createdAt: new Date().toISOString(),
      },
    };
  }

  private createMatchRuntime(entries: QueueEntry[]): MatchRuntime {
    const matchId = ulid();
    const startedAt = new Date().toISOString();
    const endsAt = new Date(Date.now() + gameConfig.matchDurationMs).toISOString();
    const seed = Math.floor(Math.random() * 1_000_000);
    const players = new Map<string, RuntimePlayer>();
    const spawnPoints = [
      { x: 160, y: 160 },
      { x: gameConfig.arenaSize.width - 160, y: 160 },
      { x: 160, y: gameConfig.arenaSize.height - 160 },
      { x: gameConfig.arenaSize.width - 160, y: gameConfig.arenaSize.height - 160 },
    ];

    const events: MatchEvent[] = [];

    entries.forEach((entry, index) => {
      const spawn = spawnPoints[index] ?? { x: 200, y: 200 };
      const player: RuntimePlayer = {
        agentId: entry.agent.id,
        displayName: entry.agent.displayName,
        health: gameConfig.spawnHealth,
        ammo: gameConfig.spawnAmmo,
        mode: entry.agent.mode,
        x: spawn.x,
        y: spawn.y,
        alive: true,
        ownerAddress: entry.agent.ownerAddress,
        skills: entry.agent.skills,
        moveVector: { dx: 0, dy: 0 },
        fireCooldownUntil: 0,
        dodgeCooldownUntil: 0,
        lastAutonomyAt: 0,
        isBot: entry.userAddress.startsWith("house-bot-"),
      };
      players.set(entry.agent.id, player);
      events.push(
        createEvent({
          type: "spawn",
          actorAgentId: entry.agent.id,
          message: `${entry.agent.displayName} rides into the arena.`,
        }),
      );
    });

    const snapshot: MatchSnapshot = {
      matchId,
      status: "in_progress",
      startedAt,
      endsAt,
      seed,
      players: Array.from(players.values()).map(toSnapshotPlayer),
      events,
      winnerAgentId: null,
    };

    const timer = setInterval(() => {
      void this.tickMatch(matchId);
    }, 1000 / gameConfig.ticksPerSecond);

    return {
      snapshot,
      players,
      timer,
    };
  }

  private async tickMatch(matchId: string) {
    const runtime = this.matches.get(matchId);
    if (!runtime || runtime.snapshot.status !== "in_progress") {
      return;
    }

    const now = Date.now();
    const events: MatchEvent[] = [];

    for (const player of runtime.players.values()) {
      if (!player.alive) {
        continue;
      }

      player.x = clamp(player.x + player.moveVector.dx * (gameConfig.movementSpeed / gameConfig.ticksPerSecond), 60, gameConfig.arenaSize.width - 60);
      player.y = clamp(player.y + player.moveVector.dy * (gameConfig.movementSpeed / gameConfig.ticksPerSecond), 60, gameConfig.arenaSize.height - 60);

      if (player.mode === "autonomous" && now - player.lastAutonomyAt >= gameConfig.autonomyDecisionMs) {
        player.lastAutonomyAt = now;
        void this.runAutonomy(runtime, player.agentId);
      }
    }

    runtime.snapshot.players = Array.from(runtime.players.values()).map(toSnapshotPlayer);
    const alivePlayers = runtime.snapshot.players.filter((player) => player.alive);
    if (alivePlayers.length <= 1) {
      if (alivePlayers[0]) {
        runtime.snapshot.winnerAgentId = alivePlayers[0].agentId;
      }
      await this.finishMatch(runtime);
      return;
    }

    if (runtime.snapshot.endsAt && new Date(runtime.snapshot.endsAt).getTime() <= now) {
      const winner = alivePlayers.sort((left, right) => right.health - left.health)[0];
      runtime.snapshot.winnerAgentId = winner?.agentId ?? null;
      events.push(
        createEvent({
          type: "timeout",
          message: winner ? `${winner.displayName} wins on the clock.` : "The dust settles with no winner.",
          actorAgentId: winner?.agentId,
        }),
      );
      this.persistAndBroadcast(runtime, events);
      await this.finishMatch(runtime);
      return;
    }

    if (events.length > 0) {
      this.persistAndBroadcast(runtime, events);
    } else {
      this.broadcasts.emitSnapshot(runtime.snapshot.matchId, runtime.snapshot);
    }
  }

  private async runAutonomy(runtime: MatchRuntime, agentId: string) {
    const key = `${runtime.snapshot.matchId}:${agentId}`;
    if (this.pendingAutonomy.has(key)) {
      return;
    }

    this.pendingAutonomy.add(key);
    try {
      const runtimePlayer = runtime.players.get(agentId);
      const storedAgent = await this.db.getAgentById(agentId);
      const agent =
        storedAgent ??
        (runtimePlayer
          ? {
              id: agentId,
              ownerAddress: runtimePlayer.ownerAddress,
              baseName: "HouseBot",
              displayName: runtimePlayer.displayName,
              uniqueSuffix: agentId.slice(-6).toUpperCase(),
              mode: runtimePlayer.mode,
              isStarter: false,
              walletAddress: "0x0000000000000000000000000000000000000000",
              skills: runtimePlayer.skills,
              createdAt: new Date().toISOString(),
            }
          : null);
      if (!agent) {
        return;
      }

      const action = await decideAutonomousAction({
        agent,
        snapshot: runtime.snapshot,
      });

      const actor = runtime.players.get(agentId);
      if (!actor || !actor.alive) {
        return;
      }

      const events = this.applyPlayerCommand(runtime, actor, action.command);
      if (events.length > 0) {
        this.persistAndBroadcast(runtime, events);
      }
    } finally {
      this.pendingAutonomy.delete(key);
    }
  }

  private applyPlayerCommand(runtime: MatchRuntime, actor: RuntimePlayer, command: ArenaCommand) {
    const now = Date.now();
    const events: MatchEvent[] = [];

    actor.lastCommand = command;

    if (command.type === "move") {
      actor.moveVector = { dx: command.dx, dy: command.dy };
      events.push(
        createEvent({
          type: "move",
          actorAgentId: actor.agentId,
          message: `${actor.displayName} changes course.`,
        }),
      );
    }

    if (command.type === "idle") {
      actor.moveVector = { dx: 0, dy: 0 };
    }

    if (command.type === "dodge" && now >= actor.dodgeCooldownUntil) {
      const dx = command.targetX - actor.x;
      const dy = command.targetY - actor.y;
      const distance = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      const dodgeDistance = 120 + actor.skills.trailcraft;
      actor.x = clamp(actor.x + (dx / distance) * dodgeDistance, 60, gameConfig.arenaSize.width - 60);
      actor.y = clamp(actor.y + (dy / distance) * dodgeDistance, 60, gameConfig.arenaSize.height - 60);
      actor.dodgeCooldownUntil = now + gameConfig.dodgeCooldownMs;
      events.push(
        createEvent({
          type: "dodge",
          actorAgentId: actor.agentId,
          message: `${actor.displayName} dives for cover.`,
        }),
      );
    }

    if (command.type === "fire" && actor.ammo > 0 && now >= actor.fireCooldownUntil) {
      actor.fireCooldownUntil = now + gameConfig.fireCooldownMs;
      actor.ammo -= 1;

      const target = this.pickTarget(runtime, actor, command.targetX, command.targetY);
      if (!target) {
        events.push(
          createEvent({
            type: "fire",
            actorAgentId: actor.agentId,
            message: `${actor.displayName} fires into the dust.`,
          }),
        );
      } else {
        const resolution = resolveShot(actor, target);
        if (resolution.hit) {
          target.health = Math.max(0, target.health - resolution.damage);
          events.push(
            createEvent({
              type: "hit",
              actorAgentId: actor.agentId,
              targetAgentId: target.agentId,
              message: `${actor.displayName} hits ${target.displayName} for ${resolution.damage}.`,
            }),
          );

          if (target.health <= 0) {
            target.alive = false;
            target.moveVector = { dx: 0, dy: 0 };
            events.push(
              createEvent({
                type: "elimination",
                actorAgentId: actor.agentId,
                targetAgentId: target.agentId,
                message: `${target.displayName} is eliminated.`,
              }),
            );
          }
        } else {
          events.push(
            createEvent({
              type: "fire",
              actorAgentId: actor.agentId,
              targetAgentId: target.agentId,
              message: `${actor.displayName} misses ${target.displayName}.`,
            }),
          );
        }
      }
    }

    runtime.snapshot.players = Array.from(runtime.players.values()).map(toSnapshotPlayer);
    return events;
  }

  private pickTarget(runtime: MatchRuntime, actor: RuntimePlayer, targetX: number, targetY: number) {
    let selected: RuntimePlayer | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const candidate of runtime.players.values()) {
      if (!candidate.alive || candidate.agentId === actor.agentId) {
        continue;
      }

      const dx = candidate.x - targetX;
      const dy = candidate.y - targetY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance < bestScore) {
        bestScore = distance;
        selected = candidate;
      }
    }
    return selected;
  }

  private persistAndBroadcast(runtime: MatchRuntime, events: MatchEvent[]) {
    runtime.snapshot.events = [...runtime.snapshot.events, ...events].slice(-30);
    runtime.snapshot.players = Array.from(runtime.players.values()).map(toSnapshotPlayer);
    void this.db.appendMatchEvents(runtime.snapshot.matchId, events);
    void this.db.createOrUpdateMatch(runtime.snapshot);
    this.broadcasts.emitEvents(runtime.snapshot.matchId, events);
    this.broadcasts.emitSnapshot(runtime.snapshot.matchId, runtime.snapshot);
  }

  private async finishMatch(runtime: MatchRuntime) {
    runtime.snapshot.status = "settling";
    const combatDigest = createCombatDigest(runtime.snapshot);
    const winnerAgentId = runtime.snapshot.winnerAgentId;
    let settlementTxHash: string | null = null;

    if (winnerAgentId) {
      const receipt = await this.chainService.settleMatch(runtime.snapshot.matchId, winnerAgentId, combatDigest);
      settlementTxHash = receipt?.txHash ?? null;
      if (receipt) {
        await this.db.createOrUpdateTransaction(receipt);
      }
    }

    runtime.snapshot.status = "finished";
    const settlementEvent = createEvent({
      type: "settled",
      actorAgentId: runtime.snapshot.winnerAgentId ?? undefined,
      message: runtime.snapshot.winnerAgentId ? `Match settled for ${runtime.snapshot.winnerAgentId}.` : "Match closed without a winner.",
    });
    runtime.snapshot.events = [
      ...runtime.snapshot.events,
      settlementEvent,
    ].slice(-30);

    await this.db.appendMatchEvents(runtime.snapshot.matchId, [settlementEvent]);
    await this.db.createOrUpdateMatch(runtime.snapshot, combatDigest, settlementTxHash);
    clearInterval(runtime.timer);
    this.broadcasts.emitMatchResult(runtime.snapshot.matchId, runtime.snapshot);
    this.broadcasts.emitSnapshot(runtime.snapshot.matchId, runtime.snapshot);
    this.matches.delete(runtime.snapshot.matchId);
  }
}

function toSnapshotPlayer(player: RuntimePlayer): MatchPlayerState {
  return {
    agentId: player.agentId,
    displayName: player.displayName,
    health: player.health,
    ammo: player.ammo,
    mode: player.mode,
    x: player.x,
    y: player.y,
    alive: player.alive,
    lastCommand: player.lastCommand,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
