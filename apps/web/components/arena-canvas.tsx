"use client";

import { useEffect, useRef } from "react";

import {
  frontierLandmarks,
  type ArenaCommand,
  type MatchSnapshot,
} from "@rdr/shared";

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
    function isEditableTarget(target: EventTarget | null) {
      if (!(target instanceof HTMLElement)) {
        return false;
      }

      return Boolean(
        target.closest(
          'input, textarea, select, [contenteditable="true"], [role="textbox"]',
        ),
      );
    }

    function shouldTrapArenaKeys(event: KeyboardEvent) {
      const nextSnapshot = snapshotRef.current;
      const nextSelectedAgentId = selectedAgentIdRef.current;
      const key = event.key.toLowerCase();
      const isActionKey =
        key === "w" ||
        key === "a" ||
        key === "s" ||
        key === "d" ||
        key === "r" ||
        event.code === "Space" ||
        key === " ";

      if (!isActionKey || isEditableTarget(event.target)) {
        return false;
      }

      return Boolean(
        nextSelectedAgentId &&
          nextSnapshot &&
          (nextSnapshot.status === "queued" ||
            nextSnapshot.status === "in_progress" ||
            nextSnapshot.status === "settling"),
      );
    }

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
      const trapArenaKeys = shouldTrapArenaKeys(event);
      if (trapArenaKeys) {
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
        event.preventDefault();
        event.stopPropagation();
      }
      if (key === "w" || key === "a" || key === "s" || key === "d") {
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

    function handleKeyPress(event: KeyboardEvent) {
      if (!shouldTrapArenaKeys(event)) {
        return;
      }

      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      event.preventDefault();
      event.stopPropagation();
    }

    function handleBlur() {
      pressedKeysRef.current = { w: false, a: false, s: false, d: false };
      emitMovement(true);
    }

      const movementInterval = window.setInterval(() => {
      emitMovement(false);
    }, 90);

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    window.addEventListener("keypress", handleKeyPress, { capture: true });
    window.addEventListener("keyup", handleKeyUp, { capture: true });
    window.addEventListener("blur", handleBlur);

    return () => {
      window.clearInterval(movementInterval);
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
      window.removeEventListener("keypress", handleKeyPress, { capture: true });
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
        private objectiveSprite?: any;
        private caravanSprite?: any;
        private safeZoneGraphics?: any;
        private guidanceGraphics?: any;
        private reticle?: any;
        private processedEventIds = new Set<string>();
        private activeMatchId: string | null = null;

        constructor() {
          super("ArenaScene");
        }

        create() {
          this.cameras.main.setBackgroundColor("#2a1710");
          onControlReadyChangeRef.current?.(true);

          this.buildFrontierBackdrop();
          this.buildFrontierLandmarks();
          this.buildAmbientDust();
          this.safeZoneGraphics = this.add.graphics();
          this.guidanceGraphics = this.add.graphics();
          this.reticle = this.buildReticle();

          this.input.on("pointermove", (pointer: any) => {
            pointerPositionRef.current = { x: pointer.worldX, y: pointer.worldY };
            this.reticle?.setPosition(pointer.worldX, pointer.worldY);
          });
          this.input.on("pointerdown", () => {
            if (!canControlRef.current || !selectedAgentIdRef.current) {
              return;
            }
            this.pulseAt(
              pointerPositionRef.current.x,
              pointerPositionRef.current.y,
              0xf6c27a,
              0.18,
              14,
            );
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

            const selectedPlayer = nextSnapshot.players.find(
              (player) =>
                player.agentId === selectedAgentIdRef.current && player.alive,
            );

            if (this.reticle) {
              const [outer, inner, h, v] = this.reticle.list as any[];
              const engaged =
                canControlRef.current &&
                nextSnapshot.status === "in_progress" &&
                Boolean(selectedPlayer);
              const reticleColor = !engaged
                ? 0x8f7b65
                : selectedPlayer?.isReloading
                  ? 0x7ab7ff
                  : (selectedPlayer?.health ?? 100) <= 30
                    ? 0xe84a4a
                    : nextSnapshot.objective
                      ? 0xdf6c39
                      : 0xf0bf76;
              outer.setStrokeStyle(2, reticleColor, engaged ? 0.72 : 0.28);
              inner.setFillStyle(reticleColor, engaged ? 0.9 : 0.38);
              h.setFillStyle(engaged ? 0xf6ead7 : 0xc0ad99, engaged ? 0.72 : 0.4);
              v.setFillStyle(engaged ? 0xf6ead7 : 0xc0ad99, engaged ? 0.72 : 0.4);
              this.reticle.setAlpha(engaged ? 1 : 0.5);
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

            if (this.guidanceGraphics) {
              this.guidanceGraphics.clear();
              if (
                selectedPlayer &&
                nextSnapshot.status === "in_progress"
              ) {
                const nearestThreat = nextSnapshot.players
                  .filter(
                    (player) =>
                      player.agentId !== selectedPlayer.agentId && player.alive,
                  )
                  .map((player) => ({
                    player,
                    distance: Math.hypot(
                      player.x - selectedPlayer.x,
                      player.y - selectedPlayer.y,
                    ),
                  }))
                  .sort((left, right) => left.distance - right.distance)[0];

                if (nearestThreat) {
                  this.guidanceGraphics.lineStyle(
                    2,
                    nearestThreat.distance <= 220 ? 0xe84a4a : 0xf4c885,
                    nearestThreat.distance <= 220 ? 0.32 : 0.18,
                  );
                  this.guidanceGraphics.beginPath();
                  this.guidanceGraphics.moveTo(
                    selectedPlayer.x,
                    selectedPlayer.y,
                  );
                  this.guidanceGraphics.lineTo(
                    nearestThreat.player.x,
                    nearestThreat.player.y,
                  );
                  this.guidanceGraphics.strokePath();
                  this.guidanceGraphics.lineStyle(
                    3,
                    nearestThreat.distance <= 220 ? 0xe84a4a : 0xf4c885,
                    0.45,
                  );
                  this.guidanceGraphics.strokeCircle(
                    nearestThreat.player.x,
                    nearestThreat.player.y,
                    30,
                  );
                }

                if (nextSnapshot.objective) {
                  this.guidanceGraphics.lineStyle(2, 0xdf6c39, 0.2);
                  this.guidanceGraphics.beginPath();
                  this.guidanceGraphics.moveTo(selectedPlayer.x, selectedPlayer.y);
                  this.guidanceGraphics.lineTo(
                    nextSnapshot.objective.x,
                    nextSnapshot.objective.y,
                  );
                  this.guidanceGraphics.strokePath();
                  this.guidanceGraphics.strokeCircle(
                    nextSnapshot.objective.x,
                    nextSnapshot.objective.y,
                    48,
                  );
                }

                if (nextSnapshot.bounty) {
                  const bountyTarget = nextSnapshot.players.find(
                    (player) =>
                      player.agentId === nextSnapshot.bounty?.targetAgentId,
                  );
                  if (bountyTarget) {
                    this.guidanceGraphics.lineStyle(
                      2,
                      nextSnapshot.bounty.targetAgentId === selectedPlayer.agentId
                        ? 0xe84a4a
                        : 0xdf6c39,
                      nextSnapshot.bounty.targetAgentId === selectedPlayer.agentId
                        ? 0.22
                        : 0.14,
                    );
                    this.guidanceGraphics.beginPath();
                    this.guidanceGraphics.moveTo(selectedPlayer.x, selectedPlayer.y);
                    this.guidanceGraphics.lineTo(bountyTarget.x, bountyTarget.y);
                    this.guidanceGraphics.strokePath();
                    this.guidanceGraphics.strokeCircle(
                      bountyTarget.x,
                      bountyTarget.y,
                      54,
                    );
                  }
                }

                if (selectedPlayer.coverLabel) {
                  const coverLandmark = frontierLandmarks.find(
                    (landmark) => landmark.label === selectedPlayer.coverLabel,
                  );
                  if (coverLandmark) {
                    this.guidanceGraphics.lineStyle(3, 0x7ed2b4, 0.42);
                    this.guidanceGraphics.strokeCircle(
                      coverLandmark.x,
                      coverLandmark.y,
                      coverLandmark.coverRadius * 0.55,
                    );
                    this.guidanceGraphics.lineStyle(1, 0x7ed2b4, 0.18);
                    this.guidanceGraphics.beginPath();
                    this.guidanceGraphics.moveTo(selectedPlayer.x, selectedPlayer.y);
                    this.guidanceGraphics.lineTo(coverLandmark.x, coverLandmark.y);
                    this.guidanceGraphics.strokePath();
                  }
                }

                if (selectedPlayer.isReloading) {
                  this.guidanceGraphics.lineStyle(4, 0x7ab7ff, 0.38);
                  this.guidanceGraphics.strokeCircle(
                    selectedPlayer.x,
                    selectedPlayer.y,
                    44,
                  );
                }

                const distanceToRing = Math.hypot(
                  selectedPlayer.x - nextSnapshot.safeZone.centerX,
                  selectedPlayer.y - nextSnapshot.safeZone.centerY,
                );
                if (distanceToRing > nextSnapshot.safeZone.radius) {
                  this.guidanceGraphics.lineStyle(8, 0xe84a4a, 0.18);
                  this.guidanceGraphics.strokeRect(10, 10, 1580, 880);
                }

                if (selectedPlayer.health <= 30) {
                  this.guidanceGraphics.fillStyle(0xe84a4a, 0.08);
                  this.guidanceGraphics.fillRect(0, 0, 1600, 24);
                  this.guidanceGraphics.fillRect(0, 876, 1600, 24);
                  this.guidanceGraphics.fillRect(0, 0, 24, 900);
                  this.guidanceGraphics.fillRect(1576, 0, 24, 900);
                }
              }
            }

            for (const player of nextSnapshot.players) {
              if (!this.sprites.has(player.agentId)) {
                const isSelected = player.agentId === selectedAgentIdRef.current;
                const baseColor = isSelected
                  ? 0x9ce9ff
                  : player.mode === "autonomous"
                    ? 0xb53c1e
                    : 0x7ed2b4;
                const glowGfx = this.add.graphics();
                glowGfx.fillStyle(baseColor, isSelected ? 0.34 : 0.12);
                glowGfx.fillCircle(0, 0, isSelected ? 52 : 32);
                glowGfx.setBlendMode(Phaser.BlendModes.ADD);
                const shadow = this.add.ellipse(
                  0,
                  18,
                  isSelected ? 50 : 40,
                  isSelected ? 18 : 14,
                  0x000000,
                  0.28,
                );
                const figure = this.add.container(0, 0);
                const mount = this.add.ellipse(
                  0,
                  6,
                  isSelected ? 42 : 34,
                  isSelected ? 24 : 20,
                  baseColor,
                  player.alive ? 0.95 : 0.25,
                );
                mount.setStrokeStyle(2, 0x21120b, 0.4);
                const riderCoat = this.add.rectangle(
                  0,
                  -4,
                  isSelected ? 18 : 14,
                  isSelected ? 22 : 18,
                  baseColor,
                  player.alive ? 0.94 : 0.25,
                );
                const riderHead = this.add.circle(
                  0,
                  -18,
                  isSelected ? 7 : 6,
                  0xf2d7b0,
                  player.alive ? 0.95 : 0.25,
                );
                const hatBrim = this.add.ellipse(
                  0,
                  -24,
                  isSelected ? 22 : 18,
                  6,
                  0x24140e,
                  player.alive ? 0.96 : 0.25,
                );
                const hatTop = this.add.rectangle(
                  0,
                  -29,
                  isSelected ? 10 : 8,
                  isSelected ? 10 : 8,
                  0x3a2218,
                  player.alive ? 0.95 : 0.25,
                );
                const weapon = this.add.rectangle(
                  isSelected ? 16 : 13,
                  -2,
                  isSelected ? 16 : 12,
                  2,
                  0xf0bf76,
                  player.alive ? 0.8 : 0.2,
                );
                figure.add([mount, riderCoat, riderHead, hatBrim, hatTop, weapon]);
                const ring = this.add
                  .circle(0, 0, isSelected ? 34 : 26, 0x000000, 0)
                  .setStrokeStyle(
                    isSelected ? 4 : 2,
                    isSelected ? 0xffe6b3 : 0xffffff,
                    isSelected ? 0.8 : 0.25,
                  );
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
                const bountyBadge = this.add
                  .text(0, -54, "BOUNTY", {
                    fontFamily: "var(--font-heading)",
                    fontSize: "11px",
                    color: "#1b0f0a",
                    backgroundColor: "#df6c39",
                    align: "center",
                    padding: { x: 8, y: 3 },
                    letterSpacing: 1,
                  })
                  .setOrigin(0.5)
                  .setVisible(false);
                const youBadge = this.add
                  .text(0, -72, "YOU", {
                    fontFamily: "var(--font-heading)",
                    fontSize: "11px",
                    color: "#09120f",
                    backgroundColor: "#9ce9ff",
                    align: "center",
                    padding: { x: 8, y: 3 },
                    letterSpacing: 1,
                  })
                  .setOrigin(0.5)
                  .setVisible(false);

                const container = this.add.container(player.x, player.y, [
                  glowGfx,
                  shadow,
                  ring,
                  figure,
                  hpBg,
                  hp,
                  youBadge,
                  bountyBadge,
                  labelBg,
                  label,
                ]);
                this.sprites.set(player.agentId, container);
                this.labels.set(player.agentId, {
                  hpBg,
                  hp,
                  ring,
                  glowGfx,
                  labelBg,
                  label,
                  shadow,
                  figure,
                  mount,
                  riderCoat,
                  riderHead,
                  hatBrim,
                  hatTop,
                  weapon,
                  youBadge,
                  bountyBadge,
                });
              }

              const sprite = this.sprites.get(player.agentId);
              const spriteData = this.labels.get(player.agentId);
              if (sprite && spriteData) {
                sprite.setPosition(player.x, player.y);
                const isSelected = player.agentId === selectedAgentIdRef.current;
                const isBounty =
                  nextSnapshot.bounty?.targetAgentId === player.agentId;
                const baseColor = isSelected ? 0x9ce9ff : player.mode === "autonomous" ? 0xb53c1e : 0x7ed2b4;

                spriteData.mount.setFillStyle(baseColor, player.alive ? 0.95 : 0.25);
                spriteData.riderCoat.setFillStyle(baseColor, player.alive ? 0.94 : 0.25);
                spriteData.riderHead.setFillStyle(0xf2d7b0, player.alive ? 0.95 : 0.25);
                spriteData.hatBrim.setFillStyle(0x24140e, player.alive ? 0.96 : 0.25);
                spriteData.hatTop.setFillStyle(0x3a2218, player.alive ? 0.95 : 0.25);
                spriteData.weapon.setFillStyle(0xf0bf76, player.alive ? 0.8 : 0.2);
                spriteData.glowGfx.clear();
                spriteData.glowGfx.fillStyle(baseColor, isSelected ? 0.34 : 0.12);
                spriteData.glowGfx.fillCircle(0, 0, isSelected ? 52 : 32);
                
                if (isSelected && player.alive) {
                    spriteData.ring.rotation += 0.05;
                }
                spriteData.ring.setStrokeStyle(
                  isSelected ? 4 : isBounty ? 4 : 2,
                  isSelected ? 0xffe6b3 : isBounty ? 0xdf6c39 : 0xffffff,
                  isSelected ? 0.8 : isBounty ? 0.78 : 0.25,
                );
                const facing =
                  player.lastCommand?.type === "move"
                    ? Math.atan2(player.lastCommand.dy, player.lastCommand.dx)
                    : player.lastCommand?.type === "fire" ||
                        player.lastCommand?.type === "dodge"
                      ? Math.atan2(
                          player.lastCommand.targetY - player.y,
                          player.lastCommand.targetX - player.x,
                        )
                      : 0;
                spriteData.figure.rotation = facing || spriteData.figure.rotation || 0;

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
                spriteData.youBadge.setVisible(isSelected && player.alive);
                spriteData.youBadge.setAlpha(player.alive ? 0.95 : 0);
                spriteData.bountyBadge.setVisible(isBounty && player.alive);
                spriteData.bountyBadge.setAlpha(player.alive ? 0.95 : 0);
              }
            }

            for (const [agentId, sprite] of this.sprites.entries()) {
              if (!nextSnapshot.players.some((player) => player.agentId === agentId)) {
                sprite.destroy(true);
                this.sprites.delete(agentId);
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

            if (nextSnapshot.objective) {
              if (!this.objectiveSprite) {
                const ring = this.add.circle(0, 0, 38, 0xdf6c39, 0.12);
                ring.setStrokeStyle(3, 0xffd0ae, 0.55);
                const core = this.add.circle(0, 0, 14, 0xdf6c39, 0.96);
                const icon = this.add.text(0, 0, "!", {
                  fontFamily: "var(--font-heading)",
                  fontSize: "22px",
                  color: "#1b0f0a",
                  fontStyle: "bold",
                }).setOrigin(0.5);
                const label = this.add.text(0, -46, nextSnapshot.objective.label, {
                  fontFamily: "var(--font-heading)",
                  fontSize: "14px",
                  color: "#ffd0ae",
                  align: "center",
                }).setOrigin(0.5);
                this.objectiveSprite = this.add.container(0, 0, [
                  ring,
                  core,
                  icon,
                  label,
                ]);
              }

              this.objectiveSprite.setPosition(
                nextSnapshot.objective.x,
                nextSnapshot.objective.y,
              );
              const [ring] = this.objectiveSprite.list as any[];
              ring.rotation += 0.04;
            } else if (this.objectiveSprite) {
              this.objectiveSprite.destroy(true);
              this.objectiveSprite = undefined;
            }

            if (nextSnapshot.caravan) {
              if (!this.caravanSprite) {
                const body = this.add.rectangle(0, 0, 54, 24, 0x6a422d, 0.96);
                body.setStrokeStyle(2, 0x1b0f0a, 0.78);
                const roof = this.add.rectangle(0, -18, 40, 10, 0x8e5b39, 0.96);
                roof.setStrokeStyle(1, 0x1b0f0a, 0.7);
                const wheelLeft = this.add.circle(-18, 14, 8, 0x24140e, 1);
                const wheelRight = this.add.circle(18, 14, 8, 0x24140e, 1);
                const lamp = this.add.circle(24, -6, 4, 0xf4c885, 0.95);
                const trail = this.add.ellipse(-28, 4, 22, 10, 0xd99a63, 0.18);
                const label = this.add.text(0, -34, "STAGECOACH", {
                  fontFamily: "var(--font-heading)",
                  fontSize: "12px",
                  color: "#f4c885",
                  align: "center",
                }).setOrigin(0.5);
                this.caravanSprite = this.add.container(0, 0, [
                  trail,
                  body,
                  roof,
                  wheelLeft,
                  wheelRight,
                  lamp,
                  label,
                ]);
              }

              this.caravanSprite.setPosition(
                nextSnapshot.caravan.x,
                nextSnapshot.caravan.y,
              );
              const movingRight =
                nextSnapshot.caravan.destinationX >= nextSnapshot.caravan.x;
              this.caravanSprite.setScale(movingRight ? 1 : -1, 1);
            } else if (this.caravanSprite) {
              this.caravanSprite.destroy(true);
              this.caravanSprite = undefined;
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

        private buildFrontierBackdrop() {
          this.add.rectangle(800, 120, 1600, 240, 0x5b392b, 1);
          this.add.rectangle(800, 215, 1600, 160, 0x8d5637, 0.42);
          this.add.ellipse(1180, 150, 440, 170, 0xd17d47, 0.18);

          const mesa = this.add.graphics();
          mesa.fillStyle(0x2c1b14, 0.92);
          mesa.fillPoints(
            [
              { x: 0, y: 250 },
              { x: 90, y: 220 },
              { x: 180, y: 230 },
              { x: 260, y: 205 },
              { x: 350, y: 240 },
              { x: 440, y: 210 },
              { x: 550, y: 255 },
              { x: 760, y: 210 },
              { x: 920, y: 255 },
              { x: 1120, y: 205 },
              { x: 1290, y: 240 },
              { x: 1450, y: 215 },
              { x: 1600, y: 248 },
              { x: 1600, y: 330 },
              { x: 0, y: 330 },
            ],
            true,
          );

          this.add.rectangle(800, 640, 1600, 520, 0x2a1710, 1);
          this.add.rectangle(800, 610, 1460, 540, 0x3a2115, 0.92);
          this.add.rectangle(800, 455, 1120, 520, 0x5a3826, 0.96);
          this.add.rectangle(800, 455, 1040, 430, 0x6f462f, 0.2);

          const arenaMarks = this.add.graphics();
          arenaMarks.lineStyle(2, 0xaa7a4d, 0.28);
          arenaMarks.strokeRoundedRect(230, 170, 1140, 570, 42);
          arenaMarks.lineStyle(1, 0x96dcc8, 0.05);
          for (let x = 260; x <= 1340; x += 90) {
            arenaMarks.moveTo(x, 170);
            arenaMarks.lineTo(x, 740);
          }
          for (let y = 200; y <= 700; y += 90) {
            arenaMarks.moveTo(230, y);
            arenaMarks.lineTo(1370, y);
          }
          arenaMarks.strokePath();

          const centerMark = this.add.graphics();
          centerMark.lineStyle(3, 0x96dcc8, 0.12);
          centerMark.strokeCircle(800, 455, 122);
          centerMark.lineStyle(1, 0xf0bf76, 0.28);
          centerMark.strokeCircle(800, 455, 36);
        }

        private buildFrontierLandmarks() {
          this.drawBuilding(150, 150, 250, 122, "SALOON");
          this.drawBuilding(1210, 140, 250, 128, "HOTEL");
          this.drawBuilding(145, 652, 260, 124, "WASH");
          this.drawBuilding(1205, 648, 260, 128, "STABLE");
          this.drawWaterTower(1035, 220);
          this.drawWagon(810, 275);
          this.drawCorral(1140, 510, 170, 96);
          this.drawFence(420, 625, 140);
          this.drawFence(1010, 615, 120);
          this.drawPropStack(555, 270);
          this.drawPropStack(640, 610);
          this.drawPropStack(955, 610);
          this.drawPropStack(720, 360);
        }

        private drawBuilding(
          x: number,
          y: number,
          width: number,
          height: number,
          label: string,
        ) {
          const group = this.add.container(x, y);
          const wall = this.add.rectangle(0, 0, width, height, 0x6a4633, 0.94);
          wall.setStrokeStyle(2, 0x22140d, 0.78);
          const roof = this.add.rectangle(
            0,
            -height / 2 - 12,
            width + 18,
            24,
            0x352016,
            0.98,
          );
          const porch = this.add.rectangle(
            0,
            height / 2 + 12,
            width + 10,
            16,
            0x291710,
            0.9,
          );
          const sign = this.add.rectangle(
            0,
            -16,
            width * 0.46,
            24,
            0x2c1a12,
            0.92,
          );
          sign.setStrokeStyle(1, 0xf0bf76, 0.24);
          const text = this.add
            .text(0, -16, label, {
              fontFamily: "var(--font-heading)",
              fontSize: "16px",
              color: "#f6ead7",
            })
            .setOrigin(0.5);
          group.add([wall, roof, porch, sign, text]);
          group.setAlpha(0.9);
        }

        private drawWaterTower(x: number, y: number) {
          const group = this.add.container(x, y);
          const tank = this.add.rectangle(0, 0, 90, 70, 0x4a3124, 0.95);
          tank.setStrokeStyle(2, 0x20120b, 0.7);
          const legs = [
            this.add.rectangle(-26, 52, 6, 90, 0x2b1a12, 0.95),
            this.add.rectangle(26, 52, 6, 90, 0x2b1a12, 0.95),
            this.add.rectangle(-10, 52, 6, 90, 0x2b1a12, 0.95),
            this.add.rectangle(10, 52, 6, 90, 0x2b1a12, 0.95),
          ];
          const sign = this.add
            .text(0, 0, "WATER", {
              fontFamily: "var(--font-heading)",
              fontSize: "14px",
              color: "#f0bf76",
            })
            .setOrigin(0.5);
          group.add([tank, sign, ...legs]);
          group.setAlpha(0.85);
        }

        private drawWagon(x: number, y: number) {
          const group = this.add.container(x, y);
          const body = this.add.rectangle(0, 0, 120, 52, 0x5f3b2b, 0.9);
          body.setStrokeStyle(2, 0x1d110a, 0.8);
          const top = this.add.rectangle(0, -24, 112, 16, 0x3e261b, 0.9);
          const wheelA = this.add
            .circle(-42, 26, 18, 0x21120b, 0)
            .setStrokeStyle(4, 0x9a734f, 0.7);
          const wheelB = this.add
            .circle(42, 26, 18, 0x21120b, 0)
            .setStrokeStyle(4, 0x9a734f, 0.7);
          group.add([body, top, wheelA, wheelB]);
          group.setAlpha(0.82);
        }

        private drawCorral(
          x: number,
          y: number,
          width: number,
          height: number,
        ) {
          const fence = this.add.graphics();
          fence.lineStyle(4, 0x654432, 0.7);
          fence.strokeRoundedRect(x, y, width, height, 10);
          for (let ix = x + 18; ix < x + width; ix += 26) {
            fence.lineBetween(ix, y, ix, y + height);
          }
          fence.setAlpha(0.55);
        }

        private drawFence(x: number, y: number, width: number) {
          const fence = this.add.graphics();
          fence.lineStyle(4, 0x66412d, 0.72);
          for (let ix = x; ix < x + width; ix += 22) {
            fence.lineBetween(ix, y - 18, ix, y + 18);
          }
          fence.lineStyle(3, 0x7c533c, 0.72);
          fence.lineBetween(x, y - 8, x + width, y - 8);
          fence.lineBetween(x, y + 10, x + width, y + 10);
          fence.setAlpha(0.58);
        }

        private drawPropStack(x: number, y: number) {
          const stack = this.add.container(x, y);
          const crate = this.add.rectangle(-14, 10, 26, 26, 0x6a4732, 0.86);
          crate.setStrokeStyle(2, 0x20120b, 0.8);
          const barrel = this.add.rectangle(14, 2, 18, 30, 0x523427, 0.9);
          barrel.setStrokeStyle(2, 0x1d120c, 0.8);
          const lid = this.add.rectangle(14, -12, 18, 4, 0x7b563d, 0.9);
          stack.add([crate, barrel, lid]);
          stack.setAlpha(0.72);
        }

        private buildAmbientDust() {
          const clouds = [
            [520, 390, 60],
            [1110, 350, 54],
            [720, 640, 48],
            [930, 540, 64],
            [360, 520, 46],
          ] as const;
          for (const [x, y, radius] of clouds) {
            const dust = this.add.ellipse(
              x,
              y,
              radius * 1.9,
              radius,
              0xe4b171,
              0.08,
            );
            this.tweens.add({
              targets: dust,
              alpha: { from: 0.04, to: 0.12 },
              scaleX: 1.08,
              scaleY: 1.03,
              duration: 3400 + radius * 10,
              yoyo: true,
              repeat: -1,
              ease: "Sine.easeInOut",
            });
          }
        }

        private buildReticle() {
          const group = this.add.container(
            pointerPositionRef.current.x,
            pointerPositionRef.current.y,
          );
          const outer = this.add
            .circle(0, 0, 16, 0x000000, 0)
            .setStrokeStyle(2, 0xf0bf76, 0.55);
          const inner = this.add.circle(0, 0, 4, 0xf0bf76, 0.85);
          const h = this.add.rectangle(0, 0, 26, 1.5, 0xf6ead7, 0.72);
          const v = this.add.rectangle(0, 0, 1.5, 26, 0xf6ead7, 0.72);
          group.add([outer, inner, h, v]);
          group.setDepth(30);
          return group;
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
            case "objective":
              if (actorPosition) {
                this.pulseAt(actorPosition.x, actorPosition.y, 0xdf6c39, 0.28, 30);
              } else {
                this.flashBanner("SUPPLY DROP");
              }
              break;
            case "caravan":
              this.flashBanner("STAGECOACH");
              break;
            case "bounty":
              if (targetPosition) {
                this.ringAt(targetPosition.x, targetPosition.y, 0xdf6c39, 48, 320);
                this.pulseAt(targetPosition.x, targetPosition.y, 0xdf6c39, 0.24, 32);
              } else {
                this.flashBanner("BOUNTY POSTED");
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
              if (event.targetAgentId === selectedAgentIdRef.current) {
                this.cameras.main.shake(70, 0.0025);
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
              if (event.targetAgentId === selectedAgentIdRef.current) {
                this.cameras.main.shake(120, 0.004);
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
        width: 1600,
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
      <div className="pointer-events-none absolute inset-0 rounded-[28px] border border-amber-200/10 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03),inset_0_0_90px_rgba(0,0,0,0.24)]" />
      <div className="pointer-events-none absolute inset-[14px] rounded-[20px] border border-white/6" />
      <div className="pointer-events-none absolute left-5 top-4 rounded-full border border-amber-200/15 bg-black/25 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-100/70">
        Dust Circuit
      </div>
      <div className="pointer-events-none absolute right-5 top-4 rounded-full border border-[#7ed2b4]/18 bg-black/25 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#c5f4e9]">
        Live Arena Feed
      </div>
    </div>
  );
}
