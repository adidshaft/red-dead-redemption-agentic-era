"use client";

import { useEffect, useRef } from "react";

import type { ArenaCommand, MatchSnapshot } from "@rdr/shared";

type ArenaCanvasProps = {
  snapshot: MatchSnapshot | null;
  selectedAgentId?: string;
  canControl: boolean;
  onCommand: (command: ArenaCommand) => void;
  onControlReadyChange?: (ready: boolean) => void;
};

export function ArenaCanvas({
  snapshot,
  selectedAgentId,
  canControl,
  onCommand,
  onControlReadyChange,
}: ArenaCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const snapshotRef = useRef<MatchSnapshot | null>(snapshot);
  const onCommandRef = useRef(onCommand);
  const selectedAgentIdRef = useRef(selectedAgentId);
  const canControlRef = useRef(canControl);
  const onControlReadyChangeRef = useRef(onControlReadyChange);
  const pointerPositionRef = useRef({ x: 800, y: 450 });
  const pressedKeysRef = useRef({
    w: false,
    a: false,
    s: false,
    d: false,
  });
  const lastMovementRef = useRef({
    signature: "idle",
    emittedAt: 0,
  });

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
    onControlReadyChangeRef.current = onControlReadyChange;
  }, [onControlReadyChange]);

  useEffect(() => {
    function selectedPlayerIsControllable() {
      const nextSnapshot = snapshotRef.current;
      const nextSelectedAgentId = selectedAgentIdRef.current;
      if (
        !canControlRef.current ||
        !nextSnapshot ||
        nextSnapshot.status !== "in_progress" ||
        !nextSelectedAgentId
      ) {
        return false;
      }

      return nextSnapshot.players.some(
        (player) => player.agentId === nextSelectedAgentId && player.alive,
      );
    }

    function emitMovement(force = false) {
      if (!selectedPlayerIsControllable()) {
        if (lastMovementRef.current.signature !== "idle") {
          onCommandRef.current({ type: "idle" });
          lastMovementRef.current = {
            signature: "idle",
            emittedAt: Date.now(),
          };
        }
        return;
      }

      const dx =
        (pressedKeysRef.current.d ? 1 : 0) - (pressedKeysRef.current.a ? 1 : 0);
      const dy =
        (pressedKeysRef.current.s ? 1 : 0) - (pressedKeysRef.current.w ? 1 : 0);
      const signature = `${dx}:${dy}`;
      const now = Date.now();
      const shouldEmit =
        force ||
        signature !== lastMovementRef.current.signature ||
        (signature !== "0:0" && now - lastMovementRef.current.emittedAt >= 180);

      if (!shouldEmit) {
        return;
      }

      if (dx === 0 && dy === 0) {
        onCommandRef.current({ type: "idle" });
        lastMovementRef.current = { signature: "idle", emittedAt: now };
        return;
      }

      onCommandRef.current({
        type: "move",
        dx,
        dy,
      });
      lastMovementRef.current = { signature, emittedAt: now };
    }

    function handleKeyChange(event: KeyboardEvent, isPressed: boolean) {
      const key = event.key.toLowerCase();
      const isSpace = event.code === "Space" || key === " ";
      if (key === "w" || key === "a" || key === "s" || key === "d") {
        if (selectedPlayerIsControllable()) {
          event.preventDefault();
          event.stopPropagation();
        }
        pressedKeysRef.current[key] = isPressed;
        emitMovement(true);
        return;
      }

      if (
        isSpace &&
        isPressed &&
        !event.repeat &&
        selectedPlayerIsControllable()
      ) {
        event.preventDefault();
        event.stopPropagation();
        onCommandRef.current({
          type: "dodge",
          targetX: pointerPositionRef.current.x,
          targetY: pointerPositionRef.current.y,
        });
        return;
      }

      if (
        key === "r" &&
        isPressed &&
        !event.repeat &&
        selectedPlayerIsControllable()
      ) {
        event.preventDefault();
        event.stopPropagation();
        onCommandRef.current({ type: "reload" });
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      handleKeyChange(event, true);
    }

    function handleKeyUp(event: KeyboardEvent) {
      handleKeyChange(event, false);
    }

    function handleBlur() {
      pressedKeysRef.current = { w: false, a: false, s: false, d: false };
      emitMovement(true);
    }

      const movementInterval = window.setInterval(() => {
      emitMovement(false);
    }, 90);

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    window.addEventListener("keyup", handleKeyUp, { capture: true });
    window.addEventListener("blur", handleBlur);

    return () => {
      window.clearInterval(movementInterval);
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
      window.removeEventListener("keyup", handleKeyUp, { capture: true });
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

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
        private pickupSprites = new Map<string, any>();
        private safeZoneGraphics?: any;
        private processedEventIds = new Set<string>();
        private activeMatchId: string | null = null;

        constructor() {
          super("ArenaScene");
        }

        create() {
          this.cameras.main.setBackgroundColor("#2a1710");
          onControlReadyChangeRef.current?.(true);

          // Deep warm dirt base
          this.add.rectangle(800, 450, 1600, 900, 0x1a120b, 1);
          // Mid-ground gradient shadow
          this.add.rectangle(800, 450, 1500, 800, 0x24180e, 0.85);
          // Highlighted center dust
          this.add.rectangle(800, 450, 1200, 600, 0x301c10, 0.5);

          // Faint tactical/ledger grid
          const graphics = this.add.graphics();
          graphics.lineStyle(1, 0x96dcc8, 0.05);
          for (let x = 0; x <= 1600; x += 80) {
            graphics.moveTo(x, 0);
            graphics.lineTo(x, 900);
          }
          for (let y = 0; y <= 900; y += 80) {
            graphics.moveTo(0, y);
            graphics.lineTo(1600, y);
          }
          graphics.strokePath();

          // Center ledger ring
          const cg = this.add.graphics();
          cg.lineStyle(2, 0x96dcc8, 0.12);
          cg.strokeCircle(800, 450, 120);
          cg.lineStyle(1, 0xe58d3c, 0.25);
          cg.strokeCircle(800, 450, 10);
          this.safeZoneGraphics = this.add.graphics();

          this.input.on("pointermove", (pointer: any) => {
            pointerPositionRef.current = { x: pointer.worldX, y: pointer.worldY };
          });
          this.input.on("pointerdown", () => {
            if (!canControlRef.current || !selectedAgentIdRef.current) {
              return;
            }
            onCommandRef.current({
              type: "fire",
              targetX: pointerPositionRef.current.x,
              targetY: pointerPositionRef.current.y,
            });
          });

          this.events.on("update", () => {
            const nextSnapshot = snapshotRef.current;
            if (!nextSnapshot) {
              return;
            }

            if (this.activeMatchId !== nextSnapshot.matchId) {
              this.activeMatchId = nextSnapshot.matchId;
              this.processedEventIds.clear();
            }

            if (this.safeZoneGraphics) {
              this.safeZoneGraphics.clear();
              if (
                nextSnapshot.status === "in_progress" ||
                nextSnapshot.status === "finished" ||
                nextSnapshot.status === "settling"
              ) {
                this.safeZoneGraphics.lineStyle(4, 0xf4c885, 0.48);
                this.safeZoneGraphics.strokeCircle(
                  nextSnapshot.safeZone.centerX,
                  nextSnapshot.safeZone.centerY,
                  nextSnapshot.safeZone.radius,
                );
                this.safeZoneGraphics.lineStyle(1, 0xe84a4a, 0.08);
                this.safeZoneGraphics.strokeCircle(
                  nextSnapshot.safeZone.centerX,
                  nextSnapshot.safeZone.centerY,
                  nextSnapshot.safeZone.radius + 16,
                );
              }
            }

            for (const player of nextSnapshot.players) {
              if (!this.sprites.has(player.agentId)) {
                const isSelected = player.agentId === selectedAgentIdRef.current;
                const baseColor = isSelected ? 0xf4c885 : player.mode === "autonomous" ? 0xb53c1e : 0x7ed2b4;
                const glowGfx = this.add.graphics();
                glowGfx.fillStyle(baseColor, isSelected ? 0.35 : 0.15);
                glowGfx.fillCircle(0, 0, isSelected ? 48 : 36);
                glowGfx.setBlendMode(Phaser.BlendModes.ADD);

                const body = this.add.circle(0, 0, isSelected ? 24 : 18, baseColor, player.alive ? 1 : 0.25);
                const ring = this.add.circle(0, 0, isSelected ? 34 : 26, 0x000000, 0).setStrokeStyle(isSelected ? 4 : 2, isSelected ? 0xffe6b3 : 0xffffff, isSelected ? 0.8 : 0.25);
                
                const maxBar = isSelected ? 46 : 32;
                const hpFrac = Math.max(0, Math.min(1, player.health / 100));
                const hpColor = hpFrac > 0.5 ? 0x7ed2b4 : hpFrac > 0.25 ? 0xf4c885 : 0xe84a4a;
                const hpBg = this.add.rectangle(0, -38, maxBar, 8, 0x0d0a08, 0.85);
                hpBg.setStrokeStyle(1, 0x4a3b32, 0.8);
                const hp = this.add.rectangle(0 - (maxBar / 2) + Math.max(2, hpFrac * maxBar) / 2, -38, Math.max(2, hpFrac * maxBar), 6, hpColor, 0.95);
                
                const labelBg = this.add.rectangle(0, 32, 100, 20, 0x000000, 0.4);
                const label = this.add.text(0, 32, player.displayName, {
                  fontFamily: "var(--font-heading)",
                  fontSize: isSelected ? "15px" : "12px",
                  color: isSelected ? "#f4c885" : "#f2e3cd",
                  align: "center",
                  letterSpacing: isSelected ? 1 : 0,
                }).setOrigin(0.5);

                const container = this.add.container(player.x, player.y, [glowGfx, ring, body, hpBg, hp, labelBg, label]);
                this.sprites.set(player.agentId, container);
                this.labels.set(player.agentId, { hpBg, hp, ring, body, glowGfx, labelBg, label });
              }

              const sprite = this.sprites.get(player.agentId);
              const spriteData = this.labels.get(player.agentId);
              if (sprite && spriteData) {
                sprite.setPosition(player.x, player.y);
                const isSelected = player.agentId === selectedAgentIdRef.current;
                const baseColor = isSelected ? 0xf4c885 : player.mode === "autonomous" ? 0xb53c1e : 0x7ed2b4;

                spriteData.body.setFillStyle(baseColor, player.alive ? 1 : 0.25);
                spriteData.glowGfx.clear();
                spriteData.glowGfx.fillStyle(baseColor, isSelected ? 0.35 : 0.15);
                spriteData.glowGfx.fillCircle(0, 0, isSelected ? 48 : 36);
                
                if (isSelected && player.alive) {
                    spriteData.ring.rotation += 0.05;
                }
                spriteData.ring.setStrokeStyle(isSelected ? 4 : 2, isSelected ? 0xffe6b3 : 0xffffff, isSelected ? 0.8 : 0.25);

                const maxBar2 = isSelected ? 46 : 32;
                const hpFrac2 = Math.max(0, Math.min(1, player.health / 100));
                const hpColor2 = hpFrac2 > 0.5 ? 0x7ed2b4 : hpFrac2 > 0.25 ? 0xf4c885 : 0xe84a4a;
                
                spriteData.hpBg.setSize(maxBar2, 8);
                const hpWidth = Math.max(2, hpFrac2 * maxBar2);
                spriteData.hp.setSize(hpWidth, 6);
                spriteData.hp.setPosition(0 - (maxBar2 / 2) + hpWidth / 2, -38);
                spriteData.hp.setFillStyle(hpColor2, 0.95);

                spriteData.label.setAlpha(player.alive ? 1 : 0.45);
                spriteData.labelBg.setAlpha(player.alive ? 1 : 0.15);
                spriteData.labelBg.width = spriteData.label.width + 12;
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

            for (const pickup of nextSnapshot.pickups) {
              if (!this.pickupSprites.has(pickup.id)) {
                const accent = pickup.type === "health" ? 0x7ed2b4 : 0xf4c885;
                const label = pickup.type === "health" ? "+" : "A";
                const glowGfx = this.add.graphics();
                glowGfx.fillStyle(accent, 0.25);
                glowGfx.fillCircle(0, 0, 32);
                glowGfx.setBlendMode(Phaser.BlendModes.ADD);

                const body = this.add.rectangle(0, 0, 26, 26, accent, 0.95);
                body.setStrokeStyle(2, 0x060403, 0.8);
                body.rotation = Math.PI / 4; // Diamond shape
                
                const icon = this.add.text(0, 0, label, {
                  fontFamily: "var(--font-heading)",
                  fontSize: "18px",
                  color: "#060403",
                  fontStyle: "bold",
                }).setOrigin(0.5);

                const container = this.add.container(pickup.x, pickup.y, [
                  glowGfx,
                  body,
                  icon,
                ]);
                this.pickupSprites.set(pickup.id, container);
              }

              const sprite = this.pickupSprites.get(pickup.id);
              if (sprite) {
                sprite.setPosition(pickup.x, pickup.y);
                const [glowGfx, body] = sprite.list as any[];
                body.rotation += 0.02; // Spin animation
              }
            }

            for (const [pickupId, sprite] of this.pickupSprites.entries()) {
              if (!nextSnapshot.pickups.some((pickup) => pickup.id === pickupId)) {
                sprite.destroy(true);
                this.pickupSprites.delete(pickupId);
              }
            }

            for (const event of nextSnapshot.events) {
              if (this.processedEventIds.has(event.id)) {
                continue;
              }

              this.processedEventIds.add(event.id);
              this.playEventEffect(event);
            }
          });
        }

        private playEventEffect(event: MatchSnapshot["events"][number]) {
          const actorSprite = event.actorAgentId
            ? this.sprites.get(event.actorAgentId)
            : null;
          const targetSprite = event.targetAgentId
            ? this.sprites.get(event.targetAgentId)
            : null;
          const actorPosition = actorSprite
            ? { x: actorSprite.x, y: actorSprite.y }
            : null;
          const targetPosition = targetSprite
            ? { x: targetSprite.x, y: targetSprite.y }
            : null;

          switch (event.type) {
            case "announcement":
              if (
                event.message.toLowerCase().includes("dust ring") ||
                event.message.toLowerCase().includes("frontier tightens")
              ) {
                this.flashBanner("RING CLOSES");
              } else if (event.message.toLowerCase().includes("final circle")) {
                this.flashBanner("FINAL CIRCLE");
              } else {
                this.flashBanner("DRAW");
              }
              break;
            case "autonomy":
              if (actorPosition) {
                this.pulseAt(actorPosition.x, actorPosition.y, 0x7ed2b4, 0.22, 20);
              } else {
                this.flashBanner("DIRECTIVE");
              }
              break;
            case "spawn":
              if (actorPosition) {
                this.pulseAt(actorPosition.x, actorPosition.y, 0xe9c58d, 0.16, 26);
              }
              break;
            case "fire":
              if (actorPosition) {
                this.pulseAt(actorPosition.x, actorPosition.y, 0xf6c27a, 0.24, 18);
              }
              if (actorPosition && targetPosition) {
                this.flashLine(actorPosition, targetPosition, 0xf6c27a);
              }
              break;
            case "hit":
              if (targetPosition) {
                this.pulseAt(targetPosition.x, targetPosition.y, 0xdf6c39, 0.28, 22);
              }
              break;
            case "reload":
              if (actorPosition) {
                this.pulseAt(actorPosition.x, actorPosition.y, 0x7ab7ff, 0.24, 20);
              }
              break;
            case "dodge":
              if (actorPosition) {
                this.ringAt(actorPosition.x, actorPosition.y, 0xd9b27a);
              }
              break;
            case "pickup":
              if (actorPosition) {
                this.pulseAt(actorPosition.x, actorPosition.y, 0x82d39e, 0.22, 24);
              } else {
                this.flashBanner("SUPPLIES");
              }
              break;
            case "elimination":
              if (targetPosition) {
                this.ringAt(targetPosition.x, targetPosition.y, 0xe84a4a, 44, 300);
                this.pulseAt(targetPosition.x, targetPosition.y, 0xe84a4a, 0.4, 60);
              }
              break;
            case "settled":
              this.flashBanner("SETTLED");
              break;
            default:
              break;
          }
        }

        private pulseAt(
          x: number,
          y: number,
          color: number,
          alpha = 0.2,
          radius = 20,
        ) {
          const pulse = this.add.circle(x, y, radius, color, alpha);
          pulse.setBlendMode(Phaser.BlendModes.ADD);
          this.tweens.add({
            targets: pulse,
            scale: 1.8,
            alpha: 0,
            duration: 180,
            ease: "Quad.easeOut",
            onComplete: () => pulse.destroy(),
          });
        }

        private ringAt(
          x: number,
          y: number,
          color: number,
          radius = 32,
          duration = 170,
        ) {
          const ring = this.add.circle(x, y, radius, color, 0);
          ring.setStrokeStyle(4, color, 0.45);
          this.tweens.add({
            targets: ring,
            scale: 1.6,
            alpha: 0,
            duration,
            ease: "Cubic.easeOut",
            onComplete: () => ring.destroy(),
          });
        }

        private flashLine(
          from: { x: number; y: number },
          to: { x: number; y: number },
          color: number,
        ) {
          const graphics = this.add.graphics();
          graphics.lineStyle(3, color, 0.9);
          graphics.beginPath();
          graphics.moveTo(from.x, from.y);
          graphics.lineTo(to.x, to.y);
          graphics.strokePath();
          this.tweens.add({
            targets: graphics,
            alpha: 0,
            duration: 120,
            ease: "Sine.easeOut",
            onComplete: () => graphics.destroy(),
          });
        }

        private flashBanner(label: string) {
          const banner = this.add.text(800, 110, label, {
            fontFamily: "var(--font-heading)",
            fontSize: "42px",
            color: "#f6dfb7",
            stroke: "#120b08",
            strokeThickness: 10,
          }).setOrigin(0.5);
          this.tweens.add({
            targets: banner,
            alpha: 0,
            y: 86,
            duration: 480,
            ease: "Quad.easeOut",
            onComplete: () => banner.destroy(),
          });
        }
      }

      game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: containerRef.current,
        height: 900,
        backgroundColor: "#0d0a08",
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
      onControlReadyChangeRef.current?.(false);
      game?.destroy(true);
    };
  }, []);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-[28px] border border-white/10 bg-[#0d0a08] outline-none group">
      <div
        ref={containerRef}
        tabIndex={0}
        className="h-full w-full outline-none"
      />
      <div className="pointer-events-none absolute inset-0 z-40 h-full w-full" style={{ backgroundImage: 'url(/ui/arena_frame.png)', backgroundSize: '100% 100%', backgroundRepeat: 'no-repeat' }} />
    </div>
  );
}
