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
      if (key === "w" || key === "a" || key === "s" || key === "d") {
        if (selectedPlayerIsControllable()) {
          event.preventDefault();
        }
        pressedKeysRef.current[key] = isPressed;
        emitMovement(true);
        return;
      }

      if (
        key === " " &&
        isPressed &&
        !event.repeat &&
        selectedPlayerIsControllable()
      ) {
        event.preventDefault();
        onCommandRef.current({
          type: "dodge",
          targetX: pointerPositionRef.current.x,
          targetY: pointerPositionRef.current.y,
        });
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

        constructor() {
          super("ArenaScene");
        }

        create() {
          this.cameras.main.setBackgroundColor("#3b2418");
          this.add.rectangle(800, 450, 1600, 900, 0x5d3c20, 0.25).setStrokeStyle(4, 0xe9c58d, 0.22);
          onControlReadyChangeRef.current?.(true);

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

            for (const player of nextSnapshot.players) {
              if (!this.sprites.has(player.agentId)) {
                const isSelected = player.agentId === selectedAgentIdRef.current;
                const color = isSelected ? 0xf3bf7b : player.mode === "autonomous" ? 0xdf6c39 : 0x7ed2b4;
                const glow = this.add.circle(player.x, player.y, isSelected ? 38 : 30, color, isSelected ? 0.18 : 0.08);
                const body = this.add.circle(player.x, player.y, isSelected ? 22 : 18, color, player.alive ? 1 : 0.35);
                const ring = this.add.circle(player.x, player.y, isSelected ? 30 : 26, 0x000000, 0).setStrokeStyle(isSelected ? 3 : 2, 0xf4e3c7, isSelected ? 0.55 : 0.25);
                const hp = this.add.rectangle(player.x, player.y - 34, Math.max(isSelected ? 38 : 24, player.health * (isSelected ? 0.95 : 0.8)), 7, 0x0f1012, 0.9);
                const label = this.add.text(player.x, player.y + 28, player.displayName, {
                  fontFamily: "var(--font-body)",
                  fontSize: isSelected ? "14px" : "12px",
                  color: "#f8f2e8",
                  align: "center",
                }).setOrigin(0.5);
                const container = this.add.container(player.x, player.y, [glow, ring, body, hp]);
                this.sprites.set(player.agentId, container);
                this.labels.set(player.agentId, label);
              }

              const sprite = this.sprites.get(player.agentId);
              const label = this.labels.get(player.agentId);
              if (sprite && label) {
                sprite.setPosition(player.x, player.y);
                const [glow, ring, body, hp] = sprite.list as any[];
                const isSelected = player.agentId === selectedAgentIdRef.current;
                body.setFillStyle(
                  isSelected ? 0xf3bf7b : player.mode === "autonomous" ? 0xdf6c39 : 0x7ed2b4,
                  player.alive ? 1 : 0.35,
                );
                glow.setRadius(isSelected ? 38 : 30);
                glow.setFillStyle(isSelected ? 0xf3bf7b : player.mode === "autonomous" ? 0xdf6c39 : 0x7ed2b4, isSelected ? 0.18 : 0.08);
                ring.setStrokeStyle(isSelected ? 3 : 2, 0xf4e3c7, isSelected ? 0.55 : 0.25);
                hp.setSize(Math.max(isSelected ? 38 : 24, player.health * (isSelected ? 0.95 : 0.8)), 7);
                label.setPosition(player.x, player.y + 28);
                label.setAlpha(player.alive ? 1 : 0.45);
                label.setFontSize(isSelected ? "14px" : "12px");
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
      onControlReadyChangeRef.current?.(false);
      game?.destroy(true);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      className="h-full w-full overflow-hidden rounded-[28px] border border-white/10 bg-[#1b110c] outline-none"
    />
  );
}
