import crypto from "node:crypto";

import { Pool } from "pg";

import {
  createDefaultAgentBudgetPolicy,
  gameConfig,
  matchSnapshotSchema,
} from "@rdr/shared";
import type {
  AgentBudgetPolicy,
  AgentMode,
  AgentProfile,
  MatchEvent,
  MatchSnapshot,
  OnchainReceipt,
  SkillSet,
} from "@rdr/shared";

type DbAgentRow = {
  id: string;
  owner_address: string;
  base_name: string;
  display_name: string;
  unique_suffix: string;
  mode: AgentMode;
  is_starter: boolean;
  wallet_address: string;
  skills: SkillSet;
  budget_policy: AgentBudgetPolicy | null;
  auto_spend_wei: string;
  created_at: Date;
  deleted_at?: Date | null;
};

export type MatchRecord = {
  id: string;
  status: string;
  seed: number;
  startedAt: string | null;
  endedAt: string | null;
  winnerAgentId: string | null;
  combatDigest: string | null;
};

function normalizeStoredMatchSnapshot(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return payload;
  }

  const snapshot = payload as Record<string, unknown>;
  const players = Array.isArray(snapshot.players)
    ? snapshot.players.map((player) => {
        if (!player || typeof player !== "object") {
          return player;
        }

        return {
          isReloading: false,
          kills: 0,
          shotsFired: 0,
          shotsHit: 0,
          damageDealt: 0,
          score: 0,
          coverLabel: null,
          coverBonus: 0,
          ...player,
        };
      })
    : [];

  return {
    paid: false,
    pickups: [],
    objective: null,
    bounty: null,
    caravan: null,
    safeZone: {
      centerX: gameConfig.arenaSize.width / 2,
      centerY: gameConfig.arenaSize.height / 2,
      radius: gameConfig.safeZoneStartRadius,
    },
    events: [],
    winnerAgentId: null,
    settlementTxHash: null,
    ...snapshot,
    players,
  };
}

export class Database {
  public readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
    });
  }

  async init() {
    const bootstrapStatements = [
      `
        CREATE TABLE IF NOT EXISTS users (
          address TEXT PRIMARY KEY,
          nonce TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `,
      `
        CREATE TABLE IF NOT EXISTS agents (
          id TEXT PRIMARY KEY,
          owner_address TEXT NOT NULL REFERENCES users(address),
          base_name TEXT NOT NULL,
          display_name TEXT NOT NULL,
          unique_suffix TEXT NOT NULL,
          mode TEXT NOT NULL,
          is_starter BOOLEAN NOT NULL DEFAULT FALSE,
          wallet_address TEXT NOT NULL,
          wallet_account_id TEXT,
          encrypted_private_key TEXT,
          skills JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `,
      `
        CREATE TABLE IF NOT EXISTS agent_wallets (
          agent_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
          wallet_address TEXT NOT NULL,
          wallet_account_id TEXT,
          encrypted_private_key TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `,
      `
        CREATE TABLE IF NOT EXISTS matches (
          id TEXT PRIMARY KEY,
          status TEXT NOT NULL,
          seed INTEGER NOT NULL,
          payload JSONB NOT NULL,
          started_at TIMESTAMPTZ,
          ended_at TIMESTAMPTZ,
          winner_agent_id TEXT,
          combat_digest TEXT,
          settlement_tx_hash TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `,
      `
        CREATE TABLE IF NOT EXISTS match_events (
          id TEXT PRIMARY KEY,
          match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
          type TEXT NOT NULL,
          actor_agent_id TEXT,
          target_agent_id TEXT,
          message TEXT NOT NULL,
          payload JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `,
      `
        CREATE TABLE IF NOT EXISTS transactions (
          id TEXT PRIMARY KEY,
          tx_hash TEXT NOT NULL UNIQUE,
          chain_id INTEGER NOT NULL,
          status TEXT NOT NULL,
          purpose TEXT NOT NULL,
          agent_id TEXT,
          match_id TEXT,
          explorer_url TEXT,
          payload JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          confirmed_at TIMESTAMPTZ
        )
      `,
      `
        CREATE TABLE IF NOT EXISTS autonomy_passes (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
          valid_until TIMESTAMPTZ NOT NULL,
          payment_tx_hash TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `,
    ];

    for (const statement of bootstrapStatements) {
      await this.pool.query(statement);
    }

    await this.pool.query(`
      ALTER TABLE agents ADD COLUMN IF NOT EXISTS budget_policy JSONB
    `);
    await this.pool.query(`
      ALTER TABLE agents ADD COLUMN IF NOT EXISTS auto_spend_wei TEXT NOT NULL DEFAULT '0'
    `);
    await this.pool.query(`
      ALTER TABLE agents ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ
    `);
    await this.pool.query(
      `
        UPDATE agents
        SET budget_policy = $1::jsonb
        WHERE budget_policy IS NULL
      `,
      [JSON.stringify(createDefaultAgentBudgetPolicy())],
    );
  }

  async upsertUser(address: string, nonce?: string) {
    await this.pool.query(
      `
        INSERT INTO users (address, nonce)
        VALUES ($1, $2)
        ON CONFLICT (address)
        DO UPDATE SET nonce = COALESCE($2, users.nonce), updated_at = NOW()
      `,
      [address.toLowerCase(), nonce ?? null],
    );
  }

  async setNonce(address: string, nonce: string) {
    await this.upsertUser(address, nonce);
  }

  async getUser(address: string) {
    const result = await this.pool.query<{ address: string; nonce: string | null }>(
      `SELECT address, nonce FROM users WHERE address = $1`,
      [address.toLowerCase()],
    );
    return result.rows[0] ?? null;
  }

  async countAgentsByOwner(ownerAddress: string) {
    const result = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM agents WHERE owner_address = $1 AND deleted_at IS NULL`,
      [ownerAddress.toLowerCase()],
    );
    return Number(result.rows[0]?.count ?? "0");
  }

  async createAgent(input: {
    id: string;
    ownerAddress: string;
    baseName: string;
    displayName: string;
    uniqueSuffix: string;
    mode: AgentMode;
    isStarter: boolean;
    walletAddress: string;
    walletAccountId?: string | null;
    encryptedPrivateKey?: string | null;
    skills: SkillSet;
    budgetPolicy: AgentBudgetPolicy;
  }) {
    await this.pool.query(
      `
        INSERT INTO agents (
          id, owner_address, base_name, display_name, unique_suffix, mode, is_starter, wallet_address, wallet_account_id, encrypted_private_key, skills, budget_policy, auto_spend_wei
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13
        )
      `,
      [
        input.id,
        input.ownerAddress.toLowerCase(),
        input.baseName,
        input.displayName,
        input.uniqueSuffix,
        input.mode,
        input.isStarter,
        input.walletAddress,
        input.walletAccountId ?? null,
        input.encryptedPrivateKey ?? null,
        JSON.stringify(input.skills),
        JSON.stringify(input.budgetPolicy),
        "0",
      ],
    );

    await this.pool.query(
      `
        INSERT INTO agent_wallets (agent_id, wallet_address, wallet_account_id, encrypted_private_key)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (agent_id)
        DO UPDATE SET wallet_address = EXCLUDED.wallet_address, wallet_account_id = EXCLUDED.wallet_account_id, encrypted_private_key = EXCLUDED.encrypted_private_key
      `,
      [input.id, input.walletAddress, input.walletAccountId ?? null, input.encryptedPrivateKey ?? null],
    );

    return this.getAgentById(input.id);
  }

  async listAgentsByOwner(ownerAddress: string) {
    const result = await this.pool.query<DbAgentRow>(
      `SELECT id, owner_address, base_name, display_name, unique_suffix, mode, is_starter, wallet_address, skills, budget_policy, auto_spend_wei, created_at, deleted_at FROM agents WHERE owner_address = $1 AND deleted_at IS NULL ORDER BY created_at ASC`,
      [ownerAddress.toLowerCase()],
    );
    return result.rows.map(mapAgentRow);
  }

  async getAgentById(
    agentId: string,
    options?: { includeDeleted?: boolean },
  ) {
    const result = await this.pool.query<DbAgentRow>(
      `SELECT id, owner_address, base_name, display_name, unique_suffix, mode, is_starter, wallet_address, skills, budget_policy, auto_spend_wei, created_at, deleted_at FROM agents WHERE id = $1 ${options?.includeDeleted ? "" : "AND deleted_at IS NULL"}`,
      [agentId],
    );
    const row = result.rows[0];
    return row ? mapAgentRow(row) : null;
  }

  async softDeleteAgent(agentId: string) {
    const result = await this.pool.query<{ id: string }>(
      `
        UPDATE agents
        SET deleted_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING id
      `,
      [agentId],
    );
    return Boolean(result.rows[0]?.id);
  }

  async updateAgentMode(agentId: string, mode: AgentMode) {
    await this.pool.query(`UPDATE agents SET mode = $2, updated_at = NOW() WHERE id = $1`, [agentId, mode]);
    return this.getAgentById(agentId);
  }

  async updateAgentSkills(agentId: string, skills: SkillSet) {
    await this.pool.query(`UPDATE agents SET skills = $2::jsonb, updated_at = NOW() WHERE id = $1`, [
      agentId,
      JSON.stringify(skills),
    ]);
    return this.getAgentById(agentId);
  }

  async updateAgentBudgetPolicy(agentId: string, budgetPolicy: AgentBudgetPolicy) {
    await this.pool.query(
      `UPDATE agents SET budget_policy = $2::jsonb, updated_at = NOW() WHERE id = $1`,
      [agentId, JSON.stringify(budgetPolicy)],
    );
    return this.getAgentById(agentId);
  }

  async incrementAgentAutoSpend(agentId: string, amountWei: string) {
    await this.pool.query(
      `UPDATE agents SET auto_spend_wei = (COALESCE(auto_spend_wei, '0')::numeric + $2::numeric)::text, updated_at = NOW() WHERE id = $1`,
      [agentId, amountWei],
    );
    return this.getAgentById(agentId);
  }

  async createOrUpdateMatch(snapshot: MatchSnapshot, combatDigest?: string | null, settlementTxHash?: string | null) {
    await this.pool.query(
      `
        INSERT INTO matches (id, status, seed, payload, started_at, ended_at, winner_agent_id, combat_digest, settlement_tx_hash)
        VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9)
        ON CONFLICT (id)
        DO UPDATE SET
          status = EXCLUDED.status,
          payload = EXCLUDED.payload,
          started_at = EXCLUDED.started_at,
          ended_at = EXCLUDED.ended_at,
          winner_agent_id = EXCLUDED.winner_agent_id,
          combat_digest = EXCLUDED.combat_digest,
          settlement_tx_hash = COALESCE(EXCLUDED.settlement_tx_hash, matches.settlement_tx_hash)
      `,
      [
        snapshot.matchId,
        snapshot.status,
        snapshot.seed,
        JSON.stringify(snapshot),
        snapshot.startedAt ? new Date(snapshot.startedAt) : null,
        snapshot.status === "finished" ? new Date() : null,
        snapshot.winnerAgentId,
        combatDigest ?? null,
        settlementTxHash ?? null,
      ],
    );
  }

  async appendMatchEvents(matchId: string, events: MatchEvent[]) {
    for (const event of events) {
      await this.pool.query(
        `
          INSERT INTO match_events (id, match_id, type, actor_agent_id, target_agent_id, message, payload, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
          ON CONFLICT (id) DO NOTHING
        `,
        [event.id, matchId, event.type, event.actorAgentId ?? null, event.targetAgentId ?? null, event.message, JSON.stringify(event), event.createdAt],
      );
    }
  }

  async createOrUpdateTransaction(receipt: OnchainReceipt) {
    await this.pool.query(
      `
        INSERT INTO transactions (id, tx_hash, chain_id, status, purpose, agent_id, match_id, explorer_url, payload, confirmed_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
        ON CONFLICT (tx_hash)
        DO UPDATE SET
          status = EXCLUDED.status,
          purpose = EXCLUDED.purpose,
          agent_id = COALESCE(EXCLUDED.agent_id, transactions.agent_id),
          match_id = COALESCE(EXCLUDED.match_id, transactions.match_id),
          explorer_url = COALESCE(EXCLUDED.explorer_url, transactions.explorer_url),
          payload = EXCLUDED.payload,
          confirmed_at = COALESCE(EXCLUDED.confirmed_at, transactions.confirmed_at)
      `,
      [
        crypto.randomUUID(),
        receipt.txHash,
        receipt.chainId,
        receipt.status,
        receipt.purpose,
        receipt.agentId ?? null,
        receipt.matchId ?? null,
        receipt.explorerUrl ?? null,
        JSON.stringify(receipt),
        receipt.status === "confirmed" ? receipt.createdAt : null,
      ],
    );
  }

  async listAgentTransactions(agentId: string) {
    const result = await this.pool.query<{ payload: OnchainReceipt }>(
      `SELECT payload FROM transactions WHERE agent_id = $1 ORDER BY created_at DESC`,
      [agentId],
    );
    return result.rows.map((row) => row.payload);
  }

  async listMatchesForAgent(agentId: string) {
    const result = await this.pool.query<{ payload: unknown }>(
      `
        SELECT payload
        FROM matches
        WHERE status = 'finished'
          AND EXISTS (
            SELECT 1
            FROM jsonb_array_elements(payload->'players') AS player
            WHERE player->>'agentId' = $1
          )
        ORDER BY COALESCE(ended_at, created_at) DESC
      `,
      [agentId],
    );

    return result.rows.map((row) =>
      matchSnapshotSchema.parse(normalizeStoredMatchSnapshot(row.payload)),
    );
  }

  async listRecentFinishedMatches(limit = 8) {
    const result = await this.pool.query<{ payload: unknown }>(
      `
        SELECT payload
        FROM matches
        WHERE status = 'finished'
        ORDER BY COALESCE(ended_at, created_at) DESC
        LIMIT $1
      `,
      [limit],
    );

    return result.rows.map((row) =>
      matchSnapshotSchema.parse(normalizeStoredMatchSnapshot(row.payload)),
    );
  }

  async listRecentTransactions(limit = 8) {
    const result = await this.pool.query<{ payload: OnchainReceipt }>(
      `
        SELECT payload
        FROM transactions
        WHERE status = 'confirmed'
        ORDER BY COALESCE(confirmed_at, created_at) DESC
        LIMIT $1
      `,
      [limit],
    );
    return result.rows.map((row) => row.payload);
  }

  async listFrontierAgents(limit = 12) {
    const result = await this.pool.query<DbAgentRow>(
      `
        SELECT id, owner_address, base_name, display_name, unique_suffix, mode, is_starter, wallet_address, skills, budget_policy, auto_spend_wei, created_at, deleted_at
        FROM agents
        WHERE deleted_at IS NULL
        ORDER BY created_at DESC
        LIMIT $1
      `,
      [limit],
    );
    return result.rows.map(mapAgentRow);
  }

  async createAutonomyPass(agentId: string, validUntil: Date, paymentTxHash?: string | null) {
    await this.pool.query(
      `
        INSERT INTO autonomy_passes (id, agent_id, valid_until, payment_tx_hash)
        VALUES ($1, $2, $3, $4)
      `,
      [crypto.randomUUID(), agentId, validUntil.toISOString(), paymentTxHash ?? null],
    );
  }

  async hasActiveAutonomyPass(agentId: string) {
    const result = await this.pool.query<{ active: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM autonomy_passes WHERE agent_id = $1 AND valid_until > NOW()) AS active`,
      [agentId],
    );
    return result.rows[0]?.active ?? false;
  }

  async getLatestAutonomyPass(agentId: string) {
    const result = await this.pool.query<{
      valid_until: Date;
      payment_tx_hash: string | null;
    }>(
      `SELECT valid_until, payment_tx_hash
       FROM autonomy_passes
       WHERE agent_id = $1
       ORDER BY valid_until DESC
       LIMIT 1`,
      [agentId],
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return {
      validUntil: row.valid_until.toISOString(),
      paymentTxHash: row.payment_tx_hash,
    };
  }

  async close() {
    await this.pool.end();
  }
}

function mapAgentRow(row: DbAgentRow): AgentProfile {
  return {
    id: row.id,
    ownerAddress: row.owner_address,
    baseName: row.base_name,
    displayName: row.display_name,
    uniqueSuffix: row.unique_suffix,
    mode: row.mode,
    isStarter: row.is_starter,
    walletAddress: row.wallet_address,
    skills: row.skills,
    budgetPolicy: row.budget_policy ?? createDefaultAgentBudgetPolicy(),
    autoSpendWei: row.auto_spend_wei ?? "0",
    createdAt: row.created_at.toISOString(),
  };
}
