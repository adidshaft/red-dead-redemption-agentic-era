import { autonomyActionSchema, type AgentProfile, type ArenaCommand, type AutonomyAction, type MatchSnapshot } from "@rdr/shared";

import { deriveDoctrineProfile } from "./autonomy-plan.js";
import { config } from "./config.js";

export type AutonomyContext = {
  agent: AgentProfile;
  snapshot: MatchSnapshot;
};

function clampUnit(value: number) {
  return Math.max(-1, Math.min(1, value));
}

function moveToward(fromX: number, fromY: number, toX: number, toY: number): ArenaCommand {
  const dx = toX - fromX;
  const dy = toY - fromY;
  return {
    type: "move",
    dx: clampUnit(dx / Math.max(Math.abs(dx), 1)),
    dy: clampUnit(dy / Math.max(Math.abs(dy), 1)),
  };
}

export function chooseFallbackCommand(context: AutonomyContext): ArenaCommand {
  const self = context.snapshot.players.find((player) => player.agentId === context.agent.id);
  const enemies = context.snapshot.players.filter((player) => player.agentId !== context.agent.id && player.alive);
  const doctrine = deriveDoctrineProfile(context.agent);

  if (!self || enemies.length === 0) {
    return { type: "idle" };
  }

  const nearestEnemy = enemies.reduce((closest, current) => {
    const currentDistance = Math.hypot(current.x - self.x, current.y - self.y);
    const closestDistance = Math.hypot(closest.x - self.x, closest.y - self.y);
    return currentDistance < closestDistance ? current : closest;
  });
  const nearestHealthPickup = context.snapshot.pickups
    .filter((pickup) => pickup.type === "health")
    .sort(
      (left, right) =>
        Math.hypot(left.x - self.x, left.y - self.y) -
        Math.hypot(right.x - self.x, right.y - self.y),
    )[0];
  const nearestAmmoPickup = context.snapshot.pickups
    .filter((pickup) => pickup.type === "ammo")
    .sort(
      (left, right) =>
        Math.hypot(left.x - self.x, left.y - self.y) -
        Math.hypot(right.x - self.x, right.y - self.y),
    )[0];
  const dx = nearestEnemy.x - self.x;
  const dy = nearestEnemy.y - self.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const centerX = 800;
  const centerY = 450;
  const centerDx = centerX - self.x;
  const centerDy = centerY - self.y;
  const atEdge =
    self.x < 180 || self.x > 1420 || self.y < 180 || self.y > 720;
  const zoneDx = context.snapshot.safeZone.centerX - self.x;
  const zoneDy = context.snapshot.safeZone.centerY - self.y;
  const zoneDistance = Math.hypot(zoneDx, zoneDy);
  const outsideSafeZone =
    zoneDistance > Math.max(0, context.snapshot.safeZone.radius - 36);
  const activeObjective = context.snapshot.objective;

  if (outsideSafeZone) {
    return moveToward(self.x, self.y, context.snapshot.safeZone.centerX, context.snapshot.safeZone.centerY);
  }

  if (self.health < 30 && distance < 240) {
    return {
      type: "dodge",
      targetX: self.x - dx,
      targetY: self.y - dy,
    };
  }

  if (self.health < doctrine.healthPickupThreshold && nearestHealthPickup) {
    return moveToward(self.x, self.y, nearestHealthPickup.x, nearestHealthPickup.y);
  }

  if ((self.ammo <= doctrine.ammoPickupThreshold || self.isReloading) && nearestAmmoPickup) {
    return moveToward(self.x, self.y, nearestAmmoPickup.x, nearestAmmoPickup.y);
  }

  if (self.ammo === 0 && !self.isReloading) {
    return {
      type: "reload",
    };
  }

  if (activeObjective) {
    const objectiveDistance = Math.hypot(
      activeObjective.x - self.x,
      activeObjective.y - self.y,
    );
    const enemyToObjectiveDistance = Math.hypot(
      activeObjective.x - nearestEnemy.x,
      activeObjective.y - nearestEnemy.y,
    );

    if (
      doctrine.objectivePosture === "contest" &&
      objectiveDistance > 120 &&
      (self.health > 38 || enemyToObjectiveDistance < 160)
    ) {
      return moveToward(self.x, self.y, activeObjective.x, activeObjective.y);
    }

    if (
      doctrine.objectivePosture === "flank" &&
      objectiveDistance > 90
    ) {
      const flankX = activeObjective.x - dy * 0.35;
      const flankY = activeObjective.y + dx * 0.35;
      return moveToward(self.x, self.y, flankX, flankY);
    }

    if (
      doctrine.objectivePosture === "hold" &&
      objectiveDistance > 150 &&
      self.health >= 55
    ) {
      return moveToward(self.x, self.y, activeObjective.x, activeObjective.y);
    }
  }

  if (
    doctrine.doctrine === "Ghost Circuit Scout" &&
    nearestAmmoPickup &&
    self.ammo <= 3 &&
    distance > 180
  ) {
    return moveToward(self.x, self.y, nearestAmmoPickup.x, nearestAmmoPickup.y);
  }

  if (
    doctrine.doctrine === "Ghost Circuit Scout" &&
    nearestHealthPickup &&
    self.health < 78 &&
    distance > 220
  ) {
    return moveToward(self.x, self.y, nearestHealthPickup.x, nearestHealthPickup.y);
  }

  if (distance < doctrine.preferredFireRange && self.ammo > 0) {
    return {
      type: "fire",
      targetX: nearestEnemy.x,
      targetY: nearestEnemy.y,
    };
  }

  if (
    doctrine.doctrine === "Ghost Circuit Scout" &&
    distance < doctrine.dodgeDistance &&
    self.health > 55
  ) {
    const flankX = nearestEnemy.x + dy * doctrine.flankWeight;
    const flankY = nearestEnemy.y - dx * doctrine.flankWeight;
    return {
      type: "dodge",
      targetX: flankX,
      targetY: flankY,
    };
  }

  if (atEdge && distance > 220) {
    return moveToward(
      self.x,
      self.y,
      centerX + centerDx * doctrine.centerBias * 0.15,
      centerY + centerDy * doctrine.centerBias * 0.15,
    );
  }

  if (distance < doctrine.dodgeDistance && self.health > 45) {
    return {
      type: "dodge",
      targetX: self.x - dy,
      targetY: self.y + dx,
    };
  }

  if (doctrine.doctrine === "Iron Ledger Survivor" && distance > 260) {
    return moveToward(
      self.x,
      self.y,
      centerX + dx * 0.4,
      centerY + dy * 0.4,
    );
  }

  if (doctrine.doctrine === "Ghost Circuit Scout" && distance > doctrine.preferredFireRange) {
    const orbitX = nearestEnemy.x - dy * doctrine.flankWeight;
    const orbitY = nearestEnemy.y + dx * doctrine.flankWeight;
    return moveToward(self.x, self.y, orbitX, orbitY);
  }

  return moveToward(self.x, self.y, nearestEnemy.x, nearestEnemy.y);
}

export async function decideAutonomousAction(context: AutonomyContext): Promise<AutonomyAction> {
  const fallback = {
    reasoning: "Fallback behavior tree selected the safest available action.",
    command: chooseFallbackCommand(context),
  } satisfies AutonomyAction;

  if (!config.OPENAI_API_KEY) {
    return fallback;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1_500);

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: config.OPENAI_MODEL,
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text: "You control one arena cowboy agent. Return strict JSON matching the schema. Prioritize survival, live objectives, valid actions, supplies, and concise reasoning.",
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: JSON.stringify(context),
              },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "arena_autonomy_action",
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["reasoning", "command"],
              properties: {
                reasoning: {
                  type: "string",
                },
                command: {
                  oneOf: [
                    {
                      type: "object",
                      additionalProperties: false,
                      required: ["type", "dx", "dy"],
                      properties: {
                        type: { const: "move" },
                        dx: { type: "number", minimum: -1, maximum: 1 },
                        dy: { type: "number", minimum: -1, maximum: 1 },
                      },
                    },
                    {
                      type: "object",
                      additionalProperties: false,
                      required: ["type", "targetX", "targetY"],
                      properties: {
                        type: { const: "fire" },
                        targetX: { type: "number" },
                        targetY: { type: "number" },
                      },
                    },
                    {
                      type: "object",
                      additionalProperties: false,
                      required: ["type", "targetX", "targetY"],
                      properties: {
                        type: { const: "dodge" },
                        targetX: { type: "number" },
                        targetY: { type: "number" },
                      },
                    },
                    {
                      type: "object",
                      additionalProperties: false,
                      required: ["type"],
                      properties: {
                        type: { const: "idle" },
                      },
                    },
                    {
                      type: "object",
                      additionalProperties: false,
                      required: ["type"],
                      properties: {
                        type: { const: "reload" },
                      },
                    },
                  ],
                },
              },
            },
          },
        },
      }),
    });

    if (!response.ok) {
      return fallback;
    }

    const json = (await response.json()) as {
      output_text?: string;
      output?: Array<{
        content?: Array<{ text?: string }>;
      }>;
    };

    const rawText =
      json.output_text ??
      json.output?.flatMap((item) => item.content ?? []).map((item) => item.text).filter(Boolean).join("\n");

    if (!rawText) {
      return fallback;
    }

    const parsed = autonomyActionSchema.safeParse(JSON.parse(rawText));
    return parsed.success ? parsed.data : fallback;
  } catch {
    return fallback;
  } finally {
    clearTimeout(timeout);
  }
}
