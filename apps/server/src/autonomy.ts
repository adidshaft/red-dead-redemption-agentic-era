import { autonomyActionSchema, type AgentProfile, type ArenaCommand, type AutonomyAction, type MatchSnapshot } from "@rdr/shared";

import { config } from "./config.js";

export type AutonomyContext = {
  agent: AgentProfile;
  snapshot: MatchSnapshot;
};

export function chooseFallbackCommand(context: AutonomyContext): ArenaCommand {
  const self = context.snapshot.players.find((player) => player.agentId === context.agent.id);
  const enemies = context.snapshot.players.filter((player) => player.agentId !== context.agent.id && player.alive);

  if (!self || enemies.length === 0) {
    return { type: "idle" };
  }

  const weakestEnemy = enemies.reduce((lowest, current) => (current.health < lowest.health ? current : lowest));
  const dx = weakestEnemy.x - self.x;
  const dy = weakestEnemy.y - self.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (self.health < 30 && distance < 240) {
    return {
      type: "dodge",
      targetX: self.x - dx,
      targetY: self.y - dy,
    };
  }

  if (distance < 420 && self.ammo > 0) {
    return {
      type: "fire",
      targetX: weakestEnemy.x,
      targetY: weakestEnemy.y,
    };
  }

  return {
    type: "move",
    dx: Math.max(-1, Math.min(1, dx / Math.max(distance, 1))),
    dy: Math.max(-1, Math.min(1, dy / Math.max(distance, 1))),
  };
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
                text: "You control one arena cowboy agent. Return strict JSON matching the schema. Prioritize survival, valid actions, and concise reasoning.",
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
