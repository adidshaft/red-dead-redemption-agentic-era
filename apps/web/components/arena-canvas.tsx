"use client";

import { useEffect, useRef } from "react";

import type { ArenaCommand, MatchSnapshot } from "@rdr/shared";

type ArenaCanvasProps = {
  snapshot: MatchSnapshot | null;
  selectedAgentId?: string;
  canControl: boolean;
  onCommand: (command: ArenaCommand) => void;
};

export function ArenaCanvas({ snapshot, selectedAgentId, canControl, onCommand }: ArenaCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const snapshotRef = useRef<MatchSnapshot | null>(snapshot);
  const onCommandRef = useRef(onCommand);
  const selectedAgentIdRef = useRef(selectedAgentId);
  const canControlRef = useRef(canControl);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    onCommandRef.current = onCommand;
  }, [onCommand]);

  useEffect(() => {
    selectedAgentIdRef.current = selectedAgentId;
  }, [selectedAgentId]);

  useEffect(() => {
    canControlRef.current = canControl;
  }, [canControl]);

  useEffect(() => {
    let destroyed = false;
    let game: any = null;

    async function mount() {
      if (!containerRef.current) {
        return;
      }

      const Phaser = await import("phaser");
      if (destroyed || !containerRef.current) {
        return;
      }

      class ArenaScene extends Phaser.Scene {
        private sprites = new Map<string, any>();
        private labels = new Map<string, any>();
        private lastMoveEmit = 0;
        private pointerPosition = { x: 0, y: 0 };

        constructor() {
          super("ArenaScene");
        }

        create() {
          this.cameras.main.setBackgroundColor("#3b2418");
          this.add.rectangle(800, 450, 1600, 900, 0x5d3c20, 0.25).setStrokeStyle(4, 0xe9c58d, 0.22);

          const graphics = this.add.graphics();
          graphics.lineStyle(1, 0xf3dbb0, 0.06);
          for (let x = 0; x <= 1600; x += 80) {
            graphics.moveTo(x, 0);
            graphics.lineTo(x, 900);
          }
          for (let y = 0; y <= 900; y += 80) {
            graphics.moveTo(0, y);
            graphics.lineTo(1600, y);
          }
          graphics.strokePath();

          const keys = this.input.keyboard?.addKeys("W,A,S,D,SPACE") as Record<string, any> | undefined;
          this.input.on("pointermove", (pointer: any) => {
            this.pointerPosition = { x: pointer.worldX, y: pointer.worldY };
          });
          this.input.on("pointerdown", () => {
            if (!canControlRef.current || !selectedAgentIdRef.current) {
              return;
            }
            onCommandRef.current({
              type: "fire",
              targetX: this.pointerPosition.x,
              targetY: this.pointerPosition.y,
            });
          });
          this.input.keyboard?.on("keydown-SPACE", () => {
            if (!canControlRef.current || !selectedAgentIdRef.current) {
              return;
            }
            onCommandRef.current({
              type: "dodge",
              targetX: this.pointerPosition.x,
              targetY: this.pointerPosition.y,
            });
          });

          this.events.on("update", () => {
            const nextSnapshot = snapshotRef.current;
            if (!nextSnapshot) {
              return;
            }

            for (const player of nextSnapshot.players) {
              if (!this.sprites.has(player.agentId)) {
                const color = player.agentId === selectedAgentIdRef.current ? 0xf3bf7b : player.mode === "autonomous" ? 0xdf6c39 : 0x7ed2b4;
                const body = this.add.circle(player.x, player.y, 18, color, player.alive ? 1 : 0.35);
                const ring = this.add.circle(player.x, player.y, 26, 0x000000, 0).setStrokeStyle(2, 0xf4e3c7, 0.25);
                const hp = this.add.rectangle(player.x, player.y - 28, Math.max(24, player.health * 0.8), 6, 0x0f1012, 0.9);
                const label = this.add.text(player.x, player.y + 28, player.displayName, {
                  fontFamily: "var(--font-body)",
                  fontSize: "12px",
                  color: "#f8f2e8",
                  align: "center",
                }).setOrigin(0.5);
                const container = this.add.container(player.x, player.y, [ring, body, hp]);
                this.sprites.set(player.agentId, container);
                this.labels.set(player.agentId, label);
              }

              const sprite = this.sprites.get(player.agentId);
              const label = this.labels.get(player.agentId);
              if (sprite && label) {
                sprite.setPosition(player.x, player.y);
                const [_ring, body, hp] = sprite.list as any[];
                body.setFillStyle(
                  player.agentId === selectedAgentIdRef.current ? 0xf3bf7b : player.mode === "autonomous" ? 0xdf6c39 : 0x7ed2b4,
                  player.alive ? 1 : 0.35,
                );
                hp.setSize(Math.max(24, player.health * 0.8), 6);
                label.setPosition(player.x, player.y + 28);
                label.setAlpha(player.alive ? 1 : 0.45);
              }
            }

            for (const [agentId, sprite] of this.sprites.entries()) {
              if (!nextSnapshot.players.some((player) => player.agentId === agentId)) {
                sprite.destroy(true);
                this.sprites.delete(agentId);
                this.labels.get(agentId)?.destroy();
                this.labels.delete(agentId);
              }
            }

            if (keys && canControlRef.current && selectedAgentIdRef.current) {
              const dx = (keys.D?.isDown ? 1 : 0) - (keys.A?.isDown ? 1 : 0);
              const dy = (keys.S?.isDown ? 1 : 0) - (keys.W?.isDown ? 1 : 0);
              if (Date.now() - this.lastMoveEmit > 90) {
                this.lastMoveEmit = Date.now();
                if (dx !== 0 || dy !== 0) {
                  onCommandRef.current({
                    type: "move",
                    dx,
                    dy,
                  });
                } else {
                  onCommandRef.current({ type: "idle" });
                }
              }
            }
          });
        }
      }

      game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: containerRef.current,
        width: 1600,
        height: 900,
        backgroundColor: "#26170f",
        scale: {
          mode: Phaser.Scale.FIT,
          autoCenter: Phaser.Scale.CENTER_BOTH,
        },
        scene: [ArenaScene],
      });
    }

    void mount();

    return () => {
      destroyed = true;
      game?.destroy(true);
    };
  }, []);

  return <div ref={containerRef} className="h-full w-full overflow-hidden rounded-[28px] border border-white/10 bg-[#1b110c]" />;
}
