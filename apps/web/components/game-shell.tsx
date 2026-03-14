"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Bot,
  Crosshair,
  Expand,
  ExternalLink,
  Gem,
  Landmark,
  LoaderCircle,
  Minimize,
  PlugZap,
  RadioTower,
  RotateCcw,
  ShieldPlus,
  Sword,
  Wallet,
} from "lucide-react";
import {
  useAccount,
  useConnect,
  useDisconnect,
  usePublicClient,
  useSignMessage,
  useSwitchChain,
  useWalletClient,
} from "wagmi";
import { formatEther, keccak256, stringToHex, type Address } from "viem";
import {
  arenaEconomyAbi,
  calculateSkillPurchasePrice,
  gameConfig,
  mapSkillToId,
  matchEntryFeeWei,
  skillKeys,
  skillLabels,
  toExplorerTxUrl,
  winnerShareBasisPoints,
  type AgentCampaignStats,
  type AgentMatchRecord,
  type AgentProfile,
  type AutonomyPlan,
  type ArenaCommand,
  type MatchEvent,
  type MatchSnapshot,
  type OnchainReceipt,
  type SkillKey,
} from "@rdr/shared";

import {
  createAgent,
  fetchAgents,
  fetchAgentMatches,
  fetchAutonomyPlan,
  fetchCampaignStats,
  fetchMatchSnapshot,
  fetchQueueStatus,
  fetchTransactions,
  fetchLiveMatches,
  fetchNonce,
  queueForMatch,
  registerAgentOnServer,
  registerSkillPurchase,
  requestAutonomyPass,
  sendArenaCommand,
  updateAgentMode,
  verifySignature,
  type QueueUpdate,
} from "../lib/api";
import { connectGameSocket } from "../lib/socket";
import { xLayerTestnetChain } from "../lib/wagmi";
import { ArenaCanvas } from "./arena-canvas";

const authStorageKey = "rdr-auth-token";
const authAddressStorageKey = "rdr-auth-address";

type TxReveal = {
  id: string;
  receipt: OnchainReceipt;
  headline: string;
  detail: string;
};

type AutonomyPassQuote = {
  amount?: string;
  asset?: string;
  chainId?: number;
  payTo?: string;
  scheme?: string;
};

type AgentOperation = {
  id: string;
  label: string;
  detail: string;
  status: "ready" | "queued" | "locked";
  action: "buy_skill" | "queue_paid" | "queue_practice" | "buy_autonomy_pass";
};

type ConsoleTab = "overview" | "autonomy" | "onchain";
type BattleTone = "neutral" | "accent" | "warning" | "danger" | "success";
type BattleDirective = {
  eyebrow: string;
  title: string;
  detail: string;
  tone: BattleTone;
};

export function GameShell() {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const { switchChainAsync } = useSwitchChain();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient({ chainId: xLayerTestnetChain.id });

  const [authToken, setAuthToken] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>();
  const [contractAddress, setContractAddress] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<OnchainReceipt[]>([]);
  const [queueState, setQueueState] = useState<QueueUpdate | null>(null);
  const [snapshot, setSnapshot] = useState<MatchSnapshot | null>(null);
  const [recentEvents, setRecentEvents] = useState<MatchEvent[]>([]);
  const [liveMatches, setLiveMatches] = useState<MatchSnapshot[]>([]);
  const [autonomyPlan, setAutonomyPlan] = useState<AutonomyPlan | null>(null);
  const [campaignStats, setCampaignStats] = useState<AgentCampaignStats | null>(null);
  const [matchHistory, setMatchHistory] = useState<AgentMatchRecord[]>([]);
  const [baseName, setBaseName] = useState("Marshal");
  const [status, setStatus] = useState<string>(
    "Connect a wallet on X Layer testnet to enter the frontier.",
  );
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [autonomyHint, setAutonomyHint] = useState<string | null>(null);
  const [autonomyQuote, setAutonomyQuote] = useState<AutonomyPassQuote | null>(null);
  const [arenaReadyForControls, setArenaReadyForControls] = useState(false);
  const [arenaFullscreen, setArenaFullscreen] = useState(false);
  const [spectatorFollowLeader, setSpectatorFollowLeader] = useState(false);
  const [matchCountdown, setMatchCountdown] = useState<number | null>(null);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [txReveals, setTxReveals] = useState<TxReveal[]>([]);
  const [activeConsoleTab, setActiveConsoleTab] = useState<ConsoleTab>("overview");

  const socketRef = useRef<ReturnType<typeof connectGameSocket> | null>(null);
  const arenaFrameRef = useRef<HTMLDivElement | null>(null);
  const startedMatchIdRef = useRef<string | null>(null);
  const queuedMatchIdRef = useRef<string | null>(null);
  const lastCountdownValueRef = useRef<number | null>(null);
  const lastQueueStatusRef = useRef<QueueUpdate["status"]>("idle");
  const frontierCueMatchIdRef = useRef<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const selectedAgentRef = useRef<AgentProfile | null>(null);
  const seenTxHashesRef = useRef<Set<string>>(new Set());
  const txRevealTimersRef = useRef<Map<string, number>>(new Map());

  const selectedAgent = useMemo(
    () =>
      agents.find((agent) => agent.id === selectedAgentId) ?? agents[0] ?? null,
    [agents, selectedAgentId],
  );
  const selectedSnapshotPlayer = useMemo(
    () =>
      snapshot && selectedAgent
        ? snapshot.players.find((player) => player.agentId === selectedAgent.id) ??
          null
        : null,
    [snapshot, selectedAgent],
  );
  const winnerDisplayName = useMemo(() => {
    if (!snapshot?.winnerAgentId) {
      return null;
    }

    return (
      snapshot.players.find((player) => player.agentId === snapshot.winnerAgentId)
        ?.displayName ?? snapshot.winnerAgentId
    );
  }, [snapshot]);
  const scoreboardPlayers = useMemo(() => {
    if (!snapshot) {
      return [];
    }

    return [...snapshot.players].sort(
      (left, right) =>
        right.score - left.score ||
        right.kills - left.kills ||
        right.damageDealt - left.damageDealt ||
        right.health - left.health,
    );
  }, [snapshot]);
  const sortedLiveMatches = useMemo(
    () =>
      [...liveMatches].sort((left, right) => {
        const leftRank =
          (left.status === "in_progress" ? 3 : left.status === "queued" ? 2 : 1) +
          (left.paid ? 1 : 0);
        const rightRank =
          (right.status === "in_progress" ? 3 : right.status === "queued" ? 2 : 1) +
          (right.paid ? 1 : 0);
        return rightRank - leftRank;
      }),
    [liveMatches],
  );
  const spotlightMatch = sortedLiveMatches[0] ?? null;
  const arenaFocusAgentId =
    selectedSnapshotPlayer?.alive
      ? selectedAgent?.id
      : spectatorFollowLeader
        ? scoreboardPlayers[0]?.agentId ?? selectedAgent?.id
        : selectedAgent?.id;
  const arenaFocusPlayer = useMemo(
    () =>
      snapshot && arenaFocusAgentId
        ? snapshot.players.find((player) => player.agentId === arenaFocusAgentId) ?? null
        : null,
    [arenaFocusAgentId, snapshot],
  );
  const selectedPlacement = useMemo(() => {
    if (!selectedAgent) {
      return null;
    }

    const placement =
      scoreboardPlayers.findIndex((player) => player.agentId === selectedAgent.id) + 1;
    return placement > 0 ? placement : null;
  }, [scoreboardPlayers, selectedAgent]);
  const selectedResultPlayer = useMemo(
    () =>
      selectedAgent
        ? scoreboardPlayers.find((player) => player.agentId === selectedAgent.id) ?? null
        : null,
    [scoreboardPlayers, selectedAgent],
  );
  const selectedResultAccuracy = useMemo(() => {
    if (!selectedResultPlayer || selectedResultPlayer.shotsFired === 0) {
      return null;
    }

    return Math.round(
      (selectedResultPlayer.shotsHit / selectedResultPlayer.shotsFired) * 100,
    );
  }, [selectedResultPlayer]);
  const resultNextAction = useMemo(() => {
    if (!autonomyPlan) {
      return "Queue another run or move into the next approved upgrade.";
    }

    switch (autonomyPlan.campaignPriority) {
      case "buy_skill":
        return `Approve ${skillLabels[autonomyPlan.nextSkill]} next and sharpen the doctrine before the next run.`;
      case "queue_paid":
        return "Momentum is good enough for another paid showdown if you want to compound the treasury.";
      case "buy_autonomy_pass":
        return "The premium autonomy lane is the next leverage move for this rider.";
      case "run_practice":
        return "Stay in practice one more round to tighten the doctrine before taking more economic risk.";
    }
  }, [autonomyPlan]);
  const resultDebrief = useMemo(() => {
    if (!snapshot || snapshot.status !== "finished") {
      return null;
    }

    if (!selectedPlacement) {
      return {
        headline: "Spectator result logged",
        detail:
          "This round settled without your rider on the field. Use the rider deck to send a fighter into the next showdown.",
        nextAction: "Select a rider and queue the next frontier run.",
      };
    }

    if (!selectedResultPlayer) {
      return {
        headline: `Finished ${ordinal(selectedPlacement)}`,
        detail:
          "Your placement is recorded, but detailed rider telemetry was unavailable for this round.",
        nextAction: resultNextAction,
      };
    }

    if (selectedPlacement === 1) {
      return {
        headline: "You converted the showdown",
        detail: `The rider finished on top with ${selectedResultPlayer.kills} eliminations, ${selectedResultPlayer.damageDealt} damage, and ${selectedResultPlayer.score} score.`,
        nextAction: resultNextAction,
      };
    }

    if (!selectedResultPlayer.alive) {
      return {
        headline: `Down at ${ordinal(selectedPlacement)}`,
        detail: `The rider was eliminated after dealing ${selectedResultPlayer.damageDealt} damage and landing ${selectedResultPlayer.kills} eliminations.`,
        nextAction: resultNextAction,
      };
    }

    return {
      headline: `Finished ${ordinal(selectedPlacement)} on the clock`,
      detail: `The rider survived to time with ${selectedResultPlayer.health} health remaining and ${selectedResultPlayer.score} score on the ledger.`,
      nextAction: resultNextAction,
    };
  }, [
    resultNextAction,
    selectedPlacement,
    selectedResultPlayer,
    snapshot,
  ]);
  const resultMedals = useMemo(() => {
    if (scoreboardPlayers.length === 0) {
      return [];
    }

    const topKills = [...scoreboardPlayers].sort((left, right) => right.kills - left.kills)[0];
    const topDamage = [...scoreboardPlayers].sort((left, right) => right.damageDealt - left.damageDealt)[0];
    const topScore = scoreboardPlayers[0];
    const survivor = [...scoreboardPlayers].sort((left, right) => right.health - left.health)[0];

    return [
      {
        label: "Deadeye",
        detail: `${topKills?.displayName ?? "—"} • ${topKills?.kills ?? 0} eliminations`,
      },
      {
        label: "Pressure",
        detail: `${topDamage?.displayName ?? "—"} • ${topDamage?.damageDealt ?? 0} damage`,
      },
      {
        label: "Ledger Lead",
        detail: `${topScore?.displayName ?? "—"} • ${topScore?.score ?? 0} score`,
      },
      {
        label: "Last Grit",
        detail: `${survivor?.displayName ?? "—"} • ${survivor?.health ?? 0} health`,
      },
    ];
  }, [scoreboardPlayers]);
  const resultCareerPulse = useMemo(() => {
    if (!campaignStats) {
      return {
        eyebrow: "Career Pulse",
        title: "First finished run logged",
        detail:
          "This rider has now opened a real frontier ledger. Keep chaining runs to build tier, payout history, and streak pressure.",
        chips: ["Tier Rookie", "Streak 0", "Career payout 0 OKB"],
      };
    }

    const nextTier =
      campaignStats.campaignTier === "rookie"
        ? "Contender"
        : campaignStats.campaignTier === "contender"
          ? "Marshal"
          : campaignStats.campaignTier === "marshal"
            ? "Legend"
            : null;
    const pressureLine =
      campaignStats.currentStreak >= 3
        ? "The rider is hot. Another clean finish compounds the campaign fast."
        : campaignStats.wins === 0
          ? "The next win matters more than grinding safe placements."
          : campaignStats.paidMatches === 0
            ? "The next big lever is converting this form into a paid run."
            : "Keep the treasury cycling and the rider tier climbing.";

    return {
      eyebrow: "Career Pulse",
      title: `${campaignStats.campaignTier.toUpperCase()} tier • ${campaignStats.currentStreak} streak`,
      detail: nextTier
        ? `${pressureLine} The next tier on deck is ${nextTier}.`
        : `${pressureLine} This rider is already operating at legend pace.`,
      chips: [
        `${campaignStats.wins} wins`,
        `${campaignStats.podiums} podiums`,
        `${formatWeiToOkb(BigInt(campaignStats.careerPayoutWei))} career payout`,
      ],
    };
  }, [campaignStats]);
  const autonomyEvents = useMemo(
    () => recentEvents.filter((event) => event.type === "autonomy").slice(-4),
    [recentEvents],
  );
  const criticalEvents = useMemo(
    () =>
      recentEvents
        .filter((event) =>
          [
            "announcement",
            "objective",
            "bounty",
            "caravan",
            "elimination",
            "timeout",
            "settled",
          ].includes(event.type),
        )
        .slice(-4),
    [recentEvents],
  );
  const arenaPhaseLabel = useMemo(() => {
    if (snapshot?.status === "queued") {
      return "Waiting for showdown";
    }
    if (snapshot?.status === "in_progress") {
      return "Live firefight";
    }
    if (snapshot?.status === "settling") {
      return "Settling rewards";
    }
    if (snapshot?.status === "finished") {
      return "Round complete";
    }
    if (queueState?.status === "queued") {
      return "Waiting for other agents";
    }
    return "Idle";
  }, [queueState?.status, snapshot?.status]);
  const queueWaitCountdown = useMemo(() => {
    if (!queueState?.queuedAt || snapshot) {
      return null;
    }

    const readyAt =
      new Date(queueState.queuedAt).getTime() + gameConfig.humanQueueFillMs;
    const remainingMs = Math.max(0, readyAt - clockNow);
    return Math.ceil(remainingMs / 1000);
  }, [clockNow, queueState?.queuedAt, snapshot]);
  const queueWaitLabel = useMemo(() => {
    if (!queueState || queueState.status === "idle" || snapshot) {
      return null;
    }

    if (queueState.matchId) {
      return queueWaitCountdown && queueWaitCountdown > 0
        ? `House bots deploy in ${queueWaitCountdown}s`
        : "Field is arming now";
    }

    return queueWaitCountdown && queueWaitCountdown > 0
      ? `House bots arrive in ${queueWaitCountdown}s`
      : "Building a four-rider field";
  }, [queueState, queueWaitCountdown, snapshot]);
  const queueProgressRatio = useMemo(() => {
    if (!queueState?.queuedAt || snapshot) {
      return 0;
    }

    const queuedAt = new Date(queueState.queuedAt).getTime();
    const elapsed = Math.max(0, clockNow - queuedAt);
    return Math.max(
      0,
      Math.min(1, elapsed / gameConfig.humanQueueFillMs),
    );
  }, [clockNow, queueState?.queuedAt, snapshot]);
  const selectedModeGuide = useMemo(() => {
    if (!selectedAgent) {
      return null;
    }

    if (selectedAgent.mode === "manual") {
      return {
        label: "Manual mode",
        detail:
          "You control movement, shots, dodge, and reload once the match starts.",
      };
    }

    return {
      label: "Autopilot mode",
      detail:
        "The rider handles the full fight on its own while you watch the cyan YOU marker and live calls.",
    };
  }, [selectedAgent]);
  const queueLocked =
    busyAction !== null ||
    queueState?.status === "queued" ||
    queueState?.status === "ready" ||
    snapshot?.status === "queued" ||
    snapshot?.status === "in_progress" ||
    snapshot?.status === "settling";
  const canSpectateLiveMatch =
    !queueLocked &&
    !(snapshot?.status === "in_progress" && Boolean(selectedSnapshotPlayer?.alive));
  const roundClockLabel = useMemo(() => {
    if (!snapshot?.endsAt) {
      return "03:00";
    }

    const remainingMs = Math.max(
      0,
      new Date(snapshot.endsAt).getTime() - clockNow,
    );
    const totalSeconds = Math.ceil(remainingMs / 1000);
    const minutes = Math.floor(totalSeconds / 60)
      .toString()
      .padStart(2, "0");
    const seconds = (totalSeconds % 60).toString().padStart(2, "0");
    return `${minutes}:${seconds}`;
  }, [clockNow, snapshot?.endsAt]);
  const safeZoneLabel = useMemo(() => {
    if (!snapshot) {
      return "Dormant";
    }

    if (snapshot.status === "queued") {
      return "Dust ring forms at showdown start";
    }

    const radius = Math.round(snapshot.safeZone.radius);
    return `${radius}px safe zone`;
  }, [snapshot]);
  const objectiveTimerLabel = useMemo(() => {
    if (!snapshot?.objective?.expiresAt) {
      return null;
    }

    const remainingMs = Math.max(
      0,
      new Date(snapshot.objective.expiresAt).getTime() - clockNow,
    );
    const totalSeconds = Math.ceil(remainingMs / 1000);
    const minutes = Math.floor(totalSeconds / 60)
      .toString()
      .padStart(2, "0");
    const seconds = (totalSeconds % 60).toString().padStart(2, "0");
    return `${minutes}:${seconds}`;
  }, [clockNow, snapshot?.objective?.expiresAt]);
  const matchEconomy = useMemo(() => {
    if (!snapshot?.paid) {
      return null;
    }

    const totalPot = matchEntryFeeWei * BigInt(snapshot.players.length);
    const winnerPayout = (totalPot * winnerShareBasisPoints) / 10_000n;
    const treasuryCut = totalPot - winnerPayout;
    return {
      totalPot,
      winnerPayout,
      treasuryCut,
    };
  }, [snapshot]);
  const selectedRingState = useMemo(() => {
    if (!snapshot || !selectedSnapshotPlayer) {
      return null;
    }

    const distance = Math.hypot(
      selectedSnapshotPlayer.x - snapshot.safeZone.centerX,
      selectedSnapshotPlayer.y - snapshot.safeZone.centerY,
    );
    const delta = distance - snapshot.safeZone.radius;

    return {
      outside: delta > 0,
      distanceFromEdge: Math.round(Math.abs(delta)),
      distanceToCenter: Math.round(distance),
    };
  }, [selectedSnapshotPlayer, snapshot]);
  const selectedThreat = useMemo(() => {
    if (!snapshot || !selectedSnapshotPlayer?.alive) {
      return null;
    }

    const nearest = snapshot.players
      .filter(
        (player) =>
          player.agentId !== selectedSnapshotPlayer.agentId && player.alive,
      )
      .map((player) => ({
        player,
        distance: Math.hypot(
          player.x - selectedSnapshotPlayer.x,
          player.y - selectedSnapshotPlayer.y,
        ),
      }))
      .sort((left, right) => left.distance - right.distance)[0];

    return nearest ?? null;
  }, [selectedSnapshotPlayer, snapshot]);
  const selectedPlayerEvent = useMemo(() => {
    if (!selectedAgent?.id) {
      return null;
    }

    return (
      [...recentEvents]
        .reverse()
        .find(
          (event) =>
            event.actorAgentId === selectedAgent.id ||
            event.targetAgentId === selectedAgent.id,
        ) ?? null
    );
  }, [recentEvents, selectedAgent?.id]);
  const battleDirective = useMemo<BattleDirective>(() => {
    if (!authToken) {
      return {
        eyebrow: "Entry",
        title: "Sign in to unlock the frontier",
        detail: "Connect and sign once so the arena can load your riders, wallet-linked history, and live frontier actions.",
        tone: "neutral",
      };
    }

    if (!selectedAgent) {
      return {
        eyebrow: "Crew",
        title: "Mint a rider to start your first run",
        detail: "Each rider enters with five starter skills and can level on X Layer after every good round.",
        tone: "neutral",
      };
    }

    if (queueState?.status === "queued" && !snapshot) {
      return {
        eyebrow: "Queue",
        title: "Waiting for other agents...",
        detail: queueWaitLabel
          ? `${queueWaitLabel}. Stay on this screen so the field can arm cleanly.`
          : "Stay on this screen while the field fills and the showdown clock arms.",
        tone: "accent",
      };
    }

    if (snapshot?.status === "queued") {
      return {
        eyebrow: "Showdown",
        title:
          matchCountdown !== null && matchCountdown > 0
            ? `Showdown in ${matchCountdown}`
            : "Hold for the opening bell",
        detail: "Riders are frozen until the draw. Use the countdown to orient yourself before the dust ring activates.",
        tone: "accent",
      };
    }

    if (snapshot?.status === "settling") {
      return {
        eyebrow: "Settlement",
        title: "Closing the ledger on X Layer",
        detail: "The match result is being written onchain. Hold here for the payout summary and explorer receipt.",
        tone: "success" as const,
      };
    }

    if (snapshot?.status === "finished") {
      return {
        eyebrow: "Result",
        title: winnerDisplayName
          ? `${winnerDisplayName} took the showdown`
          : "The dust settled without a winner",
        detail: selectedPlacement
          ? `You finished ${ordinal(selectedPlacement)}. Review the dossier, treasury outcome, and next campaign action below.`
          : "Review the final standings and use the rider deck to send another agent into the frontier.",
        tone: winnerDisplayName === selectedAgent.displayName ? "success" : "neutral",
      };
    }

    if (snapshot?.status === "in_progress") {
      if (!selectedSnapshotPlayer) {
        return {
          eyebrow: "Spectate",
          title: "You’re watching this fight",
          detail: arenaFocusPlayer
            ? `Follow ${arenaFocusPlayer.displayName} or switch to a rider who is in the current showdown.`
            : "Follow the leader cam or queue your active rider into the next round.",
          tone: "neutral",
        };
      }

      if (!selectedSnapshotPlayer.alive) {
        return {
          eyebrow: "Down",
          title: `${selectedSnapshotPlayer.displayName} is out of this round`,
          detail: "Stay on the result feed to see who survives the ring and how the settlement lands.",
          tone: "danger",
        };
      }

      if (selectedRingState?.outside) {
        return {
          eyebrow: "Danger",
          title: "Ride back into the dust ring",
          detail: `You’re ${selectedRingState.distanceFromEdge}px outside the safe zone and taking burn damage every tick.`,
          tone: "danger",
        };
      }

      if (selectedSnapshotPlayer.isReloading) {
        return {
          eyebrow: "Reloading",
          title: "Create space while the chamber resets",
          detail: selectedThreat
            ? `${selectedThreat.player.displayName} is ${Math.round(selectedThreat.distance)}px away. Dodge or kite until the reload completes.`
            : "Keep moving until the chamber is full again.",
          tone: "warning",
        };
      }

      if (selectedSnapshotPlayer.health <= 30) {
        return {
          eyebrow: "Critical",
          title: "Low health. Break line and take a tonic",
          detail: "Cut across the ring edge, dodge incoming fire, and grab the nearest health cache before re-engaging.",
          tone: "danger",
        };
      }

      if (selectedSnapshotPlayer.ammo <= 1) {
        return {
          eyebrow: "Pressure",
          title: "Ammo is nearly dry",
          detail: snapshot.objective
            ? "Contest the supply drop or reload now. Don’t get caught empty when the next duel opens."
            : "Reload or rotate onto a cartridge pickup before you take the next shot.",
          tone: "warning",
        };
      }

      if (selectedAgent.mode === "autonomous") {
        return {
          eyebrow: "Autopilot",
          title: "Your rider is handling the fight",
          detail:
            "Watch the bright cyan YOU marker. Autopilot is moving, aiming, dodging, and reloading on its own.",
          tone: "neutral",
        };
      }

      if (selectedSnapshotPlayer.coverLabel) {
        return {
          eyebrow: "Cover",
          title: `Hold ${selectedSnapshotPlayer.coverLabel}`,
          detail: `You’re protected by ${selectedSnapshotPlayer.coverBonus ?? 0}% cover. Use the angle to reload, bait a peek, or break toward the next objective.`,
          tone: "success",
        };
      }

      if (snapshot.objective) {
        const objectiveDistance = Math.round(
          Math.hypot(
            selectedSnapshotPlayer.x - snapshot.objective.x,
            selectedSnapshotPlayer.y - snapshot.objective.y,
          ),
        );
        return {
          eyebrow: "Objective",
          title: `Contest ${snapshot.objective.label}`,
          detail: `${snapshot.objective.rewardLabel}. It’s ${objectiveDistance}px away${objectiveTimerLabel ? ` and expires in ${objectiveTimerLabel}` : ""}.`,
          tone: "accent",
        };
      }

      if (snapshot.caravan) {
        const caravanDistance = Math.round(
          Math.hypot(
            selectedSnapshotPlayer.x - snapshot.caravan.x,
            selectedSnapshotPlayer.y - snapshot.caravan.y,
          ),
        );
        return {
          eyebrow: "Caravan",
          title: `Intercept ${snapshot.caravan.label}`,
          detail: `${snapshot.caravan.rewardLabel}. It’s ${caravanDistance}px away and moving through town now.`,
          tone: "accent",
        };
      }

      if (snapshot.bounty) {
        if (snapshot.bounty.targetAgentId === selectedSnapshotPlayer.agentId) {
          return {
            eyebrow: "Bounty",
            title: "You are the marked rider",
            detail: `The field gets +${snapshot.bounty.bonusScore} score for dropping you. Break sight lines, stay healthy, and force bad chases.`,
            tone: "danger",
          };
        }

        return {
          eyebrow: "Bounty",
          title: `Bring down ${snapshot.bounty.displayName}`,
          detail: `A live bounty is worth +${snapshot.bounty.bonusScore} score. Collapse when the mark is exposed and don’t waste ammo on bad angles.`,
          tone: "accent",
        };
      }

      if (selectedThreat) {
        return {
          eyebrow: "Pressure",
          title: `Track ${selectedThreat.player.displayName}`,
          detail:
            selectedThreat.distance <= 220
              ? "They’re inside close-duel range. Strafe, pressure with quick shots, and be ready to dodge."
              : `Nearest threat is ${Math.round(selectedThreat.distance)}px away. Hold center and close the angle on your terms.`,
          tone: "neutral",
        };
      }
    }

    return {
      eyebrow: "Frontier",
      title: "Choose a rider and enter the dust",
      detail: "The cleanest next move is to select your rider, check the mode, and queue into a practice or paid round.",
      tone: "neutral",
    };
  }, [
    arenaFocusPlayer,
    authToken,
    matchCountdown,
    objectiveTimerLabel,
    queueState?.status,
    queueWaitLabel,
    selectedAgent,
    selectedPlacement,
    selectedRingState,
    selectedSnapshotPlayer,
    selectedThreat,
    snapshot,
    winnerDisplayName,
  ]);
  const battleSignals = useMemo(() => {
    if (!snapshot) {
      return [];
    }

    const signals: Array<{
      label: string;
      tone: "neutral" | "accent" | "warning" | "danger" | "success";
      icon: React.ReactNode;
    }> = [];

    if (selectedSnapshotPlayer?.alive) {
      if (selectedRingState?.outside) {
        signals.push({
          label: `Outside ring • ${selectedRingState.distanceFromEdge}px`,
          tone: "danger",
          icon: <AlertTriangle className="h-3.5 w-3.5" />,
        });
      }

      if (selectedSnapshotPlayer.isReloading) {
        signals.push({
          label: "Reloading",
          tone: "warning",
          icon: <RotateCcw className="h-3.5 w-3.5" />,
        });
      }

      if (selectedSnapshotPlayer.health <= 35) {
        signals.push({
          label: `Low health • ${selectedSnapshotPlayer.health} HP`,
          tone: "danger",
          icon: <ShieldPlus className="h-3.5 w-3.5" />,
        });
      }

      if (selectedSnapshotPlayer.ammo <= 1) {
        signals.push({
          label:
            selectedSnapshotPlayer.ammo === 0
              ? "Empty chamber"
              : "Last round loaded",
          tone: "warning",
          icon: <Crosshair className="h-3.5 w-3.5" />,
        });
      }

      if (selectedThreat) {
        signals.push({
          label: `${selectedThreat.player.displayName} • ${Math.round(selectedThreat.distance)}px`,
          tone: selectedThreat.distance <= 220 ? "danger" : "neutral",
          icon: <RadioTower className="h-3.5 w-3.5" />,
        });
      }

      if (selectedSnapshotPlayer.coverLabel) {
        signals.push({
          label: `${selectedSnapshotPlayer.coverLabel} cover • ${selectedSnapshotPlayer.coverBonus ?? 0}%`,
          tone: "success",
          icon: <ShieldPlus className="h-3.5 w-3.5" />,
        });
      }
    }

    if (snapshot.objective) {
      signals.push({
        label: `${snapshot.objective.label}${objectiveTimerLabel ? ` • ${objectiveTimerLabel}` : ""}`,
        tone: "accent",
        icon: <Gem className="h-3.5 w-3.5" />,
      });
    }

    if (snapshot.caravan) {
      signals.push({
        label: `${snapshot.caravan.label} • moving`,
        tone: "accent",
        icon: <Landmark className="h-3.5 w-3.5" />,
      });
    }

    if (snapshot.bounty) {
      signals.push({
        label:
          snapshot.bounty.targetAgentId === selectedAgent?.id
            ? `Marked bounty • +${snapshot.bounty.bonusScore}`
            : `Bounty ${snapshot.bounty.displayName}`,
        tone:
          snapshot.bounty.targetAgentId === selectedAgent?.id
            ? "danger"
            : "accent",
        icon: <Sword className="h-3.5 w-3.5" />,
      });
    }

    if (matchEconomy) {
      signals.push({
        label: `Pot ${formatWeiToOkb(matchEconomy.totalPot)}`,
        tone: "success",
        icon: <Wallet className="h-3.5 w-3.5" />,
      });
    }

    return signals.slice(0, 4);
  }, [
    matchEconomy,
    objectiveTimerLabel,
    selectedAgent?.id,
    selectedRingState,
    selectedSnapshotPlayer,
    selectedThreat,
    snapshot,
  ]);
  const selectedHealthBarTone = useMemo(() => {
    if (!selectedSnapshotPlayer) {
      return "#7ed2b4";
    }

    if (selectedSnapshotPlayer.health <= 30) {
      return "#df6c39";
    }

    if (selectedSnapshotPlayer.health <= 55) {
      return "#f0bf76";
    }

    return "#7ed2b4";
  }, [selectedSnapshotPlayer]);
  const autonomyPassRemainingLabel = useMemo(() => {
    if (!autonomyPlan?.autonomyPassValidUntil) {
      return null;
    }

    const remainingMs = Math.max(
      0,
      new Date(autonomyPlan.autonomyPassValidUntil).getTime() - clockNow,
    );
    const totalMinutes = Math.ceil(remainingMs / 60_000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    if (hours <= 0) {
      return `${minutes}m remaining`;
    }

    return `${hours}h ${minutes.toString().padStart(2, "0")}m remaining`;
  }, [autonomyPlan?.autonomyPassValidUntil, clockNow]);
  const premiumLaneSteps = useMemo(
    () => [
      {
        label: "Upgrade loop",
        done: transactions.some((receipt) => receipt.purpose === "skill_purchase"),
        detail: "Compound at least one skill upgrade.",
      },
      {
        label: "Paid queue",
        done: transactions.some((receipt) => receipt.purpose === "match_entry"),
        detail: "Prove the agent can run the paid frontier.",
      },
      {
        label: "x402 unlock",
        done: Boolean(autonomyPlan?.autonomyPassActive),
        detail: "Activate the premium planning lane.",
      },
      {
        label: "Settlement loop",
        done: transactions.some((receipt) => receipt.purpose === "match_settlement"),
        detail: "Recycle a confirmed win back into the treasury.",
      },
    ],
    [autonomyPlan?.autonomyPassActive, transactions],
  );
  const premiumLaneSummary = useMemo(() => {
    if (autonomyPlan?.autonomyPassActive) {
      return {
        title: "Premium autonomy active",
        detail:
          autonomyPassRemainingLabel ??
          "The premium lane is active and the planner is running with tighter queue discipline.",
      };
    }

    if (autonomyQuote) {
      return {
        title: "x402 payment challenge ready",
        detail:
          autonomyHint ??
          "The premium autonomy lane is waiting on payment verification.",
      };
    }

    return {
      title: "Premium autonomy available",
      detail:
        "Unlock the x402 lane for stronger planning, tighter paid-run timing, and clearer autonomous economy routing.",
    };
  }, [
    autonomyHint,
    autonomyPassRemainingLabel,
    autonomyPlan?.autonomyPassActive,
    autonomyQuote,
  ]);
  const transactionCounts = useMemo(
    () => ({
      registrations: transactions.filter((receipt) => receipt.purpose === "agent_registration").length,
      upgrades: transactions.filter((receipt) => receipt.purpose === "skill_purchase").length,
      entries: transactions.filter((receipt) => receipt.purpose === "match_entry").length,
      settlements: transactions.filter((receipt) => receipt.purpose === "match_settlement").length,
      premium: transactions.filter((receipt) => receipt.purpose === "autonomy_pass").length,
    }),
    [transactions],
  );
  const campaignLoopSummary = useMemo(() => {
    if (!selectedAgent) {
      return null;
    }

    if (!campaignStats || campaignStats.matchesPlayed === 0) {
      return {
        title: "Log the first frontier finish",
        detail:
          "The rider needs one completed run before the campaign ledger has enough history to steer upgrades with confidence.",
      };
    }

    if (transactionCounts.settlements === 0) {
      return {
        title: "Close the first paid settlement",
        detail:
          "You have campaign history, but the treasury loop is still waiting on its first paid win and settlement receipt.",
      };
    }

    if (!autonomyPlan?.autonomyPassActive) {
      return {
        title: "Unlock premium autonomy",
        detail:
          "The next leverage move is x402 premium so the rider can route paid runs and upgrades with tighter discipline.",
      };
    }

    return {
      title: "Compound the treasury loop",
      detail:
        "The rider has enough history to keep cycling settlements into upgrades and higher-confidence paid queues.",
    };
  }, [autonomyPlan?.autonomyPassActive, campaignStats, selectedAgent, transactionCounts.settlements]);
  const chainLoopSummary = useMemo(() => {
    if (transactionCounts.registrations === 0) {
      return {
        title: "Register the rider on X Layer",
        detail:
          "The chain loop starts once the rider identity is registered and treasury-linked onchain.",
      };
    }

    if (transactionCounts.upgrades === 0) {
      return {
        title: "Record the first skill upgrade",
        detail:
          "The next onchain proof should be a skill purchase so the rider’s growth starts compounding on X Layer.",
      };
    }

    if (transactionCounts.entries === 0) {
      return {
        title: "Enter a paid frontier run",
        detail:
          "The rider has growth proof, but still needs a paid match entry receipt to complete the economic loop.",
      };
    }

    if (transactionCounts.settlements === 0) {
      return {
        title: "Finish with a settlement receipt",
        detail:
          "The remaining proof step is a confirmed match settlement that shows the treasury payout on X Layer.",
      };
    }

    return {
      title: "The onchain loop is active",
      detail:
        "Registration, upgrades, paid entry, and settlement are all proven. The next job is compounding that loop cleanly.",
    };
  }, [transactionCounts]);
  const bountyTrail = useMemo(() => {
    if (!selectedAgent) {
      return null;
    }

    if (!campaignStats || campaignStats.matchesPlayed === 0) {
      return {
        title: "Close the first frontier tape",
        detail:
          "One finished run unlocks the rider’s real campaign history, placement record, and streak pressure.",
      };
    }

    if (campaignStats.currentStreak > 0 && campaignStats.currentStreak < 3) {
      return {
        title: `Hot streak at ${campaignStats.currentStreak}`,
        detail:
          "One more strong finish keeps the streak alive and makes the next paid run feel worth the risk.",
      };
    }

    if (transactionCounts.settlements === 0) {
      return {
        title: "Hunt the first real payout",
        detail:
          "The rider has momentum, but the addictive loop starts when a paid match closes with a live settlement receipt.",
      };
    }

    if (!autonomyPlan?.autonomyPassActive) {
      return {
        title: "Upgrade the rider’s brain",
        detail:
          "The next bait is premium autonomy so this rider can chain upgrades and paid entries with better timing.",
      };
    }

    return {
      title: "Press the compounding loop",
      detail:
        "This rider is ready to keep cycling wins into upgrades, premium planning, and more expensive frontier runs.",
    };
  }, [autonomyPlan?.autonomyPassActive, campaignStats, selectedAgent, transactionCounts.settlements]);
  const lastConfirmedReceipt = transactions[0] ?? null;
  const operationQueue = useMemo<AgentOperation[]>(() => {
    if (!selectedAgent || !autonomyPlan) {
      return [];
    }

    const canBuyNextSkill = Boolean(
      selectedAgent &&
        !busyAction &&
        (contractAddress ?? process.env.NEXT_PUBLIC_ARENA_ECONOMY_ADDRESS) &&
        walletClient &&
        publicClient,
    );

    const items: AgentOperation[] = [
      {
        id: "skill",
        label: `Approve ${skillLabels[autonomyPlan.nextSkill]}`,
        detail: autonomyPlan.nextSkillReason,
        status: canBuyNextSkill ? "ready" : "locked",
        action: "buy_skill",
      },
    ];

    if (!autonomyPlan.autonomyPassActive) {
      items.push({
        id: "premium",
        label: "Unlock x402 premium",
        detail:
          "Open the premium planning lane so the agent can route paid runs with stronger discipline.",
        status: busyAction === "autonomy-pass" ? "queued" : "ready",
        action: "buy_autonomy_pass",
      });
    }

    items.push({
      id: autonomyPlan.recommendedQueue === "paid" ? "paid-run" : "practice-run",
      label:
        autonomyPlan.recommendedQueue === "paid"
          ? "Deploy paid frontier run"
          : "Run a practice frontier cycle",
      detail:
        autonomyPlan.recommendedQueue === "paid"
          ? `Current readiness is ${autonomyPlan.readinessScore}%. Use the queue when the frontier is clear.`
          : "Build another finish before risking more treasury cadence.",
      status: queueLocked ? "queued" : "ready",
      action:
        autonomyPlan.recommendedQueue === "paid" ? "queue_paid" : "queue_practice",
    });

    if (campaignStats && campaignStats.matchesPlayed === 0) {
      items.push({
        id: "first-finish",
        label: "Log the first finished frontier run",
        detail:
          "The campaign ledger needs one closed match before the doctrine can compound from real history.",
        status: queueLocked ? "queued" : "ready",
        action: "queue_practice",
      });
    }

    return items.slice(0, 4);
  }, [
    autonomyPlan,
    busyAction,
    campaignStats,
    contractAddress,
    publicClient,
    queueLocked,
    selectedAgent,
    walletClient,
  ]);
  const autonomySignals = useMemo(() => {
    if (!autonomyPlan) {
      return [];
    }

    return [
      `Readiness ${autonomyPlan.readinessScore}%`,
      `${formatConfidenceBand(autonomyPlan.confidenceBand)} confidence`,
      `${formatObjectivePosture(autonomyPlan.objectivePosture)} objective posture`,
      `${formatEconomyPosture(autonomyPlan.economyPosture)} economy`,
      `${autonomyPlan.recommendedQueue === "paid" ? "Paid" : "Practice"} queue next`,
    ];
  }, [autonomyPlan]);
  const autonomyWireFeed = useMemo(() => {
    if (autonomyEvents.length > 0) {
      return autonomyEvents.slice(-3).reverse().map((event) => event.message);
    }

    if (!autonomyPlan) {
      return [];
    }

    return [
      autonomyPlan.summary,
      autonomyPlan.combatDirective,
      autonomyPlan.objectiveDirective,
    ];
  }, [autonomyEvents, autonomyPlan]);
  const settlementExplorerUrl = useMemo(() => {
    if (!snapshot?.settlementTxHash) {
      return null;
    }

    return toExplorerTxUrl(
      snapshot.settlementTxHash,
      process.env.NEXT_PUBLIC_XLAYER_EXPLORER_URL,
    );
  }, [snapshot?.settlementTxHash]);
  const deployedContractAddress =
    contractAddress ?? process.env.NEXT_PUBLIC_ARENA_ECONOMY_ADDRESS ?? null;

  useEffect(() => {
    selectedAgentRef.current = selectedAgent;
  }, [selectedAgent]);

  useEffect(() => {
    const existing = window.localStorage.getItem(authStorageKey);
    if (existing) {
      setAuthToken(existing);
    }

    return () => {
      txRevealTimersRef.current.forEach((timeoutId) => {
        window.clearTimeout(timeoutId);
      });
      txRevealTimersRef.current.clear();
      if (audioContextRef.current) {
        void audioContextRef.current.close().catch(() => undefined);
        audioContextRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!isConnected || !address || !authToken) {
      return;
    }

    const storedAddress = window.localStorage.getItem(authAddressStorageKey);
    if (
      storedAddress &&
      storedAddress.toLowerCase() !== address.toLowerCase()
    ) {
      clearSession("Wallet changed. Sign in again to continue.");
    }
  }, [address, authToken, isConnected]);

  useEffect(() => {
    if (isConnected && !authToken) {
      setStatus("Wallet connected. Sign in with a wallet signature to mint an agent.");
    }
  }, [isConnected, authToken]);

  useEffect(() => {
    if (!selectedAgent && agents[0]) {
      setSelectedAgentId(agents[0].id);
    }
  }, [agents, selectedAgent]);

  useEffect(() => {
    if (!authToken) {
      return;
    }

    let cancelled = false;
    void loadAgents();
    void fetchLiveMatches().then((response) => {
      if (!cancelled) {
        setLiveMatches(response.matches);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [authToken]);

  useEffect(() => {
    if (!authToken) {
      socketRef.current?.disconnect();
      socketRef.current = null;
      return;
    }

    const socket = connectGameSocket(authToken);
    socket.on("queue:update", (payload: QueueUpdate) => {
      setQueueState(payload.status === "idle" ? null : payload);
      lastQueueStatusRef.current = payload.status;
      if (payload.matchId) {
        queuedMatchIdRef.current = payload.matchId;
        socket.emit("match:join", { matchId: payload.matchId });
        setStatus(
          payload.status === "ready"
            ? "Match found. Showdown is about to begin."
            : "Waiting for other agents...",
        );
      } else if (payload.status === "queued") {
        setStatus("Waiting for other agents...");
      } else if (payload.status === "idle") {
        queuedMatchIdRef.current = null;
        setStatus("Queue cleared. Select a rider and queue again.");
      }
    });
    socket.on("match:snapshot", (nextSnapshot: MatchSnapshot) => {
      queuedMatchIdRef.current = nextSnapshot.matchId;
      setSnapshot(nextSnapshot);
      setRecentEvents(nextSnapshot.events.slice(-8));
    });
    socket.on("match:event", (events: MatchEvent[]) => {
      events.forEach((event) => {
        playMatchEventTone(event);
      });
      setRecentEvents((current) => [...current, ...events].slice(-8));
    });
    socket.on("match:result", (result: MatchSnapshot) => {
      queuedMatchIdRef.current = result.matchId;
      setSnapshot(result);
      setQueueState(null);
      const winnerName =
        result.players.find((player) => player.agentId === result.winnerAgentId)
          ?.displayName ?? result.winnerAgentId;
      setStatus(
        result.winnerAgentId === selectedAgent?.id
          ? "You won the showdown."
          : winnerName
            ? `${winnerName} won the showdown.`
            : "The showdown is over.",
      );
      if (selectedAgentRef.current) {
        void loadTransactions(selectedAgentRef.current.id, { revealNew: true });
        void loadAutonomyPlan(selectedAgentRef.current.id);
        void loadCampaignStats(selectedAgentRef.current.id);
        void loadMatchHistory(selectedAgentRef.current.id);
      }
    });

    socketRef.current = socket;
    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [authToken]);

  useEffect(() => {
    if (!authToken || (!queueState && !snapshot)) {
      return;
    }

    let cancelled = false;

    const syncQueueStatus = async () => {
      try {
        const nextQueueState = await fetchQueueStatus(authToken);
        if (cancelled) {
          return;
        }

        if (nextQueueState.status === "idle") {
          queuedMatchIdRef.current = null;
          if (!snapshot || snapshot.status === "finished") {
            setQueueState(null);
          }
          if (
            lastQueueStatusRef.current !== "idle" &&
            !snapshot
          ) {
            setStatus(
              "Queue cleared before the match armed. Queue again and keep this tab open.",
            );
          }
        } else {
          setQueueState(nextQueueState);
          if (
            nextQueueState.matchId &&
            queuedMatchIdRef.current !== nextQueueState.matchId
          ) {
            queuedMatchIdRef.current = nextQueueState.matchId;
            socketRef.current?.emit("match:join", {
              matchId: nextQueueState.matchId,
            });
          }
        }

        lastQueueStatusRef.current = nextQueueState.status;
      } catch {
        // Socket updates continue to drive the live arena; polling is just a safety net.
      }
    };

    void syncQueueStatus();
    const intervalId = window.setInterval(syncQueueStatus, 1_000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [
    authToken,
    queueState?.status,
    queueState?.matchId,
    queueState?.queuedAt,
    snapshot?.matchId,
    snapshot?.status,
  ]);

  useEffect(() => {
    const matchId = snapshot?.matchId ?? queueState?.matchId;
    if (!matchId || snapshot?.status === "finished") {
      return;
    }

    let cancelled = false;

    const syncMatchSnapshot = async () => {
      try {
        const response = await fetchMatchSnapshot(matchId);
        if (cancelled) {
          return;
        }

        setSnapshot(response.match);
        setRecentEvents(response.match.events.slice(-8));
        if (response.match.status === "finished") {
          setQueueState(null);
        }
      } catch {
        // The websocket remains the primary source of truth for live ticks.
      }
    };

    void syncMatchSnapshot();
    const intervalId = window.setInterval(syncMatchSnapshot, 1_500);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [queueState?.matchId, snapshot?.matchId]);

  useEffect(() => {
    if (!authToken || !selectedAgent) {
      setAutonomyPlan(null);
      setCampaignStats(null);
      setMatchHistory([]);
      return;
    }
    void loadTransactions(selectedAgent.id);
    void loadAutonomyPlan(selectedAgent.id);
    void loadCampaignStats(selectedAgent.id);
    void loadMatchHistory(selectedAgent.id);
  }, [authToken, selectedAgent?.id]);

  useEffect(() => {
    if (
      (!snapshot || snapshot.status === "finished") &&
      queueState?.status !== "queued"
    ) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setClockNow(Date.now());
    }, 250);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [queueState?.status, snapshot?.matchId, snapshot?.status]);

  useEffect(() => {
    function syncFullscreenState() {
      setArenaFullscreen(document.fullscreenElement === arenaFrameRef.current);
    }

    document.addEventListener("fullscreenchange", syncFullscreenState);
    return () => {
      document.removeEventListener("fullscreenchange", syncFullscreenState);
    };
  }, []);

  useEffect(() => {
    if (!snapshot) {
      setMatchCountdown(null);
      return;
    }

    if (snapshot.status === "queued" && snapshot.startedAt) {
      const updateCountdown = () => {
        const remainingMs = new Date(snapshot.startedAt!).getTime() - Date.now();
        if (remainingMs <= 0) {
          setMatchCountdown(0);
          return;
        }

        setMatchCountdown(Math.ceil(remainingMs / 1000));
      };

      updateCountdown();
      const intervalId = window.setInterval(updateCountdown, 100);
      return () => {
        window.clearInterval(intervalId);
      };
    }

    if (
      snapshot.status === "in_progress" &&
      startedMatchIdRef.current !== snapshot.matchId
    ) {
      startedMatchIdRef.current = snapshot.matchId;
      setMatchCountdown(0);
      const timeoutId = window.setTimeout(() => {
        setMatchCountdown(null);
      }, 800);
      return () => {
        window.clearTimeout(timeoutId);
      };
    }

    if (snapshot.status === "finished") {
      setMatchCountdown(null);
    }
  }, [snapshot?.matchId, snapshot?.startedAt, snapshot?.status]);

  useEffect(() => {
    if (
      matchCountdown === null ||
      matchCountdown === lastCountdownValueRef.current
    ) {
      return;
    }

    if (
      matchCountdown === 3 &&
      snapshot?.matchId &&
      snapshot.status === "queued"
    ) {
      playFrontierCountdownCue(snapshot.matchId);
    }

    const frequencyMap: Record<number, number> = {
      2: 520,
      1: 620,
      0: 760,
    };
    const frequency = frequencyMap[matchCountdown];
    if (frequency) {
      playStartTone(frequency, matchCountdown === 0 ? 0.18 : 0.12);
    }
    lastCountdownValueRef.current = matchCountdown;
  }, [matchCountdown, snapshot?.matchId, snapshot?.status]);

  async function ensureXLayer() {
    if (chainId === xLayerTestnetChain.id) {
      return;
    }
    await switchChainAsync({ chainId: xLayerTestnetChain.id });
  }

  function clearSession(nextStatus?: string) {
    window.localStorage.removeItem(authStorageKey);
    window.localStorage.removeItem(authAddressStorageKey);
    setAuthToken(null);
    setAgents([]);
    setSelectedAgentId(undefined);
    setTransactions([]);
    setQueueState(null);
    setSnapshot(null);
    setRecentEvents([]);
    setSpectatorFollowLeader(false);
    setAutonomyPlan(null);
    setCampaignStats(null);
    setMatchHistory([]);
    setAutonomyQuote(null);
    setTxReveals([]);
    queuedMatchIdRef.current = null;
    lastQueueStatusRef.current = "idle";
    frontierCueMatchIdRef.current = null;
    seenTxHashesRef.current = new Set();
    txRevealTimersRef.current.forEach((timeoutId) => {
      window.clearTimeout(timeoutId);
    });
    txRevealTimersRef.current.clear();
    if (nextStatus) {
      setStatus(nextStatus);
    }
  }

  function dismissTxReveal(id: string) {
    const timeoutId = txRevealTimersRef.current.get(id);
    if (timeoutId) {
      window.clearTimeout(timeoutId);
      txRevealTimersRef.current.delete(id);
    }
    setTxReveals((current) => current.filter((item) => item.id !== id));
  }

  function pushTxReveal(
    receipt: OnchainReceipt,
    headline = `${formatReceiptPurpose(receipt.purpose)} confirmed`,
    detail = formatReceiptRevealDetail(receipt),
  ) {
    const id = receipt.txHash;
    seenTxHashesRef.current.add(receipt.txHash);
    setTxReveals((current) => {
      if (current.some((item) => item.receipt.txHash === receipt.txHash)) {
        return current;
      }

      return [{ id, receipt, headline, detail }, ...current].slice(0, 3);
    });

    const existingTimeout = txRevealTimersRef.current.get(id);
    if (existingTimeout) {
      window.clearTimeout(existingTimeout);
    }
    const timeoutId = window.setTimeout(() => {
      dismissTxReveal(id);
    }, 7_500);
    txRevealTimersRef.current.set(id, timeoutId);
  }

  function playStartTone(
    frequency: number,
    durationSeconds: number,
    options?: {
      delaySeconds?: number;
      gain?: number;
      type?: OscillatorType;
    },
  ) {
    if (typeof window === "undefined") {
      return;
    }

    const audioContext = getAudioContext();
    if (!audioContext) {
      return;
    }

    try {
      const delaySeconds = options?.delaySeconds ?? 0;
      const gain = options?.gain ?? 0.05;
      const startAt = audioContext.currentTime + delaySeconds;
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      oscillator.type = options?.type ?? "triangle";
      oscillator.frequency.value = frequency;
      gainNode.gain.setValueAtTime(0.0001, startAt);
      gainNode.gain.exponentialRampToValueAtTime(
        gain,
        startAt + 0.01,
      );
      gainNode.gain.exponentialRampToValueAtTime(
        0.0001,
        startAt + durationSeconds,
      );
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      oscillator.start(startAt);
      oscillator.stop(startAt + durationSeconds + 0.02);
    } catch {
      // Ignore audio errors; countdown text still provides a start cue.
    }
  }

  function playFrontierCountdownCue(matchId: string) {
    if (frontierCueMatchIdRef.current === matchId) {
      return;
    }

    frontierCueMatchIdRef.current = matchId;
    playStartTone(392, 0.18, { gain: 0.06, type: "triangle" });
    playStartTone(494, 0.18, {
      delaySeconds: 0.18,
      gain: 0.055,
      type: "triangle",
    });
    playStartTone(622, 0.54, {
      delaySeconds: 0.38,
      gain: 0.032,
      type: "sine",
    });
  }

  function getAudioContext() {
    if (audioContextRef.current) {
      return audioContextRef.current;
    }

    const AudioContextCtor =
      window.AudioContext ||
      (
        window as Window & {
          webkitAudioContext?: typeof AudioContext;
        }
      ).webkitAudioContext;
    if (!AudioContextCtor) {
      return null;
    }

    try {
      audioContextRef.current = new AudioContextCtor();
      return audioContextRef.current;
    } catch {
      return null;
    }
  }

  function playMatchEventTone(event: MatchEvent) {
    switch (event.type) {
      case "autonomy":
        playStartTone(580, 0.07);
        break;
      case "fire":
        playStartTone(350, 0.06);
        break;
      case "reload":
        playStartTone(280, 0.1);
        break;
      case "hit":
        playStartTone(210, 0.08);
        break;
      case "dodge":
        playStartTone(520, 0.07);
        break;
      case "pickup":
        playStartTone(640, 0.08);
        break;
      case "elimination":
        playStartTone(160, 0.18);
        break;
      case "settled":
        playStartTone(700, 0.12);
        break;
      case "announcement":
        playStartTone(760, 0.12);
        break;
      default:
        break;
    }
  }

  function normalizeUiError(error: unknown, fallback: string) {
    const message =
      error instanceof Error ? error.message : String(error ?? fallback);
    const lower = message.toLowerCase();

    if (
      lower.includes("user rejected") ||
      lower.includes("user denied") ||
      lower.includes("rejected request") ||
      lower.includes("request rejected") ||
      lower.includes("cancelled")
    ) {
      return "Request cancelled in wallet.";
    }

    if (lower.includes("invalid nonce")) {
      return "Signature expired. Please sign in again.";
    }

    if (
      lower.includes("insufficient funds") ||
      lower.includes("exceeds balance")
    ) {
      return "Wallet balance is too low for this X Layer testnet action.";
    }

    return message || fallback;
  }

  async function handleArenaFullscreenToggle() {
    if (!arenaFrameRef.current) {
      return;
    }

    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    if (document.fullscreenElement === arenaFrameRef.current) {
      await document.exitFullscreen();
      return;
    }

    await arenaFrameRef.current.requestFullscreen();
  }

  async function loadAgents() {
    if (!authToken) {
      return;
    }
    const response = await fetchAgents(authToken);
    setAgents(response.agents);
    setContractAddress(response.contractAddress);
    if (response.agents[0] && !selectedAgentId) {
      setSelectedAgentId(response.agents[0].id);
    }
  }

  async function loadTransactions(
    agentId: string,
    options?: { revealNew?: boolean },
  ) {
    if (!authToken) {
      return;
    }
    const response = await fetchTransactions(authToken, agentId);
    setTransactions(response.receipts);
    for (const receipt of response.receipts) {
      if (options?.revealNew && !seenTxHashesRef.current.has(receipt.txHash)) {
        pushTxReveal(receipt);
      }
      seenTxHashesRef.current.add(receipt.txHash);
    }
  }

  async function loadAutonomyPlan(agentId: string) {
    if (!authToken) {
      return;
    }
    const response = await fetchAutonomyPlan(authToken, agentId);
    setAutonomyPlan(response.plan);
  }

  async function loadCampaignStats(agentId: string) {
    if (!authToken) {
      return;
    }
    const response = await fetchCampaignStats(authToken, agentId);
    setCampaignStats(response.campaign);
  }

  async function loadMatchHistory(agentId: string) {
    if (!authToken) {
      return;
    }
    const response = await fetchAgentMatches(authToken, agentId);
    setMatchHistory(response.matches);
  }

  async function handleSignIn() {
    if (!address) {
      return;
    }

    setBusyAction("sign-in");
    try {
      await ensureXLayer();
      let noncePayload = await fetchNonce(address);
      let signature = await signMessageAsync({
        message: noncePayload.message,
      });
      let verified;
      try {
        verified = await verifySignature(address, noncePayload.nonce, signature);
      } catch (error) {
        if (!normalizeUiError(error, "").includes("Signature expired")) {
          throw error;
        }
        noncePayload = await fetchNonce(address);
        signature = await signMessageAsync({
          message: noncePayload.message,
        });
        verified = await verifySignature(address, noncePayload.nonce, signature);
      }
      window.localStorage.setItem(authStorageKey, verified.token);
      window.localStorage.setItem(authAddressStorageKey, verified.address);
      setAuthToken(verified.token);
      setStatus("Signed in. Create or command your agents.");
    } catch (error) {
      setStatus(normalizeUiError(error, "Sign in failed."));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleCreateAgent() {
    if (!authToken) {
      return;
    }

    setBusyAction("create-agent");
    try {
      const response = await createAgent(authToken, baseName);
      if (response.registrationRequired) {
        const receipt = await ensureAgentRegisteredOnchain(response.agent);
        if (receipt) {
          pushTxReveal(
            receipt,
            "Agent registered on X Layer",
            `${response.agent.displayName} is now treasury-linked and ready for frontier actions.`,
          );
        }
      }
      setAgents((current) => [...current, response.agent]);
      setSelectedAgentId(response.agent.id);
      await loadTransactions(response.agent.id);
      await loadCampaignStats(response.agent.id);
      await loadMatchHistory(response.agent.id);
      setBaseName("Gunslinger");
      setStatus(`${response.agent.displayName} is ready for the frontier.`);
    } catch (error) {
      setStatus(normalizeUiError(error, "Agent creation failed."));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleModeChange(mode: "manual" | "autonomous") {
    if (!authToken || !selectedAgent) {
      return;
    }

    setBusyAction(`mode-${mode}`);
    try {
      const response = await updateAgentMode(authToken, selectedAgent.id, mode);
      setAgents((current) =>
        current.map((agent) =>
          agent.id === response.agent.id ? response.agent : agent,
        ),
      );
      await loadAutonomyPlan(response.agent.id);
      setStatus(
        mode === "autonomous"
          ? `${response.agent.displayName} is now on Autopilot. It will move, aim, dodge, and reload on its own in live matches.`
          : `${response.agent.displayName} is now in manual mode.`,
      );
    } catch (error) {
      setStatus(normalizeUiError(error, "Unable to switch mode."));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleBuySkill(skill: SkillKey) {
    if (
      !selectedAgent ||
      !authToken ||
      !walletClient ||
      !publicClient ||
      !deployedContractAddress
    ) {
      return;
    }

    setBusyAction(`skill-${skill}`);
    try {
      await ensureAgentRegisteredOnchain(selectedAgent);
      await ensureXLayer();
      const hash = await walletClient.writeContract({
        account: walletClient.account!,
        chain: xLayerTestnetChain,
        address: deployedContractAddress as Address,
        abi: arenaEconomyAbi,
        functionName: "purchaseSkill",
        args: [agentIdToBytes32(selectedAgent.id), mapSkillToId(skill)],
        value: calculateSkillPurchasePrice(selectedAgent.skills[skill]),
      });
      await publicClient.waitForTransactionReceipt({ hash });
      const response = await registerSkillPurchase(
        authToken,
        selectedAgent.id,
        skill,
        hash,
      );
      pushTxReveal(
        response.receipt,
        `${skillLabels[skill]} upgrade confirmed`,
        `${selectedAgent.displayName} gained +5 ${skillLabels[skill]} on X Layer.`,
      );
      setAgents((current) =>
        current.map((agent) =>
          agent.id === response.agent.id ? response.agent : agent,
        ),
      );
      await loadTransactions(selectedAgent.id);
      await loadAutonomyPlan(selectedAgent.id);
      setStatus(
        `${skillLabels[skill]} improved for ${selectedAgent.displayName}.`,
      );
    } catch (error) {
      setStatus(normalizeUiError(error, "Skill purchase failed."));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleQueue(paid: boolean) {
    if (!selectedAgent || !authToken) {
      return;
    }

    setBusyAction(paid ? "paid-queue" : "practice-queue");
    setSnapshot(null);
    setRecentEvents([]);
    setSpectatorFollowLeader(false);
    try {
      if (paid) {
        await ensureAgentRegisteredOnchain(selectedAgent);
        if (!walletClient || !publicClient || !deployedContractAddress) {
          throw new Error(
            "Deploy the ArenaEconomy contract before paid queueing.",
          );
        }

        const preparation = await queueForMatch(
          authToken,
          selectedAgent.id,
          true,
        );
        if (preparation.status !== "payment_required" || !preparation.matchId) {
          throw new Error("The server did not return a paid match ticket.");
        }

        await ensureXLayer();
        const txHash = await walletClient.writeContract({
          account: walletClient.account!,
          chain: xLayerTestnetChain,
          address: deployedContractAddress as Address,
          abi: arenaEconomyAbi,
          functionName: "enterMatch",
          args: [
            matchIdToBytes32(preparation.matchId),
            agentIdToBytes32(selectedAgent.id),
          ],
          value: matchEntryFeeWei,
        });
        await publicClient.waitForTransactionReceipt({ hash: txHash });

        const queued = await queueForMatch(
          authToken,
          selectedAgent.id,
          true,
          preparation.matchId,
          txHash,
        );
        if (queued.entryReceipt) {
          pushTxReveal(
            queued.entryReceipt,
            "Paid queue locked onchain",
            `${selectedAgent.displayName} secured a paid showdown slot on X Layer.`,
          );
        }
        setQueueState({
          status: "queued",
          matchId: queued.matchId ?? preparation.matchId,
          queuedAt: new Date().toISOString(),
        });
        setStatus("Paid queue confirmed onchain. Waiting for other agents...");
      } else {
        await queueForMatch(authToken, selectedAgent.id, false);
        setQueueState({
          status: "queued",
          queuedAt: new Date().toISOString(),
        });
        setStatus("Practice queue started. Waiting for other agents...");
      }
    } catch (error) {
      setStatus(normalizeUiError(error, "Queueing failed."));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleAutonomyPass() {
    if (!authToken || !selectedAgent) {
      return;
    }

    setBusyAction("autonomy-pass");
    try {
      const response = await requestAutonomyPass(authToken, selectedAgent.id);
      if (response.status === 402) {
        setAutonomyQuote({
          amount: response.payload?.amount,
          asset: response.payload?.asset,
          chainId: response.payload?.chainId,
          payTo: response.payload?.payTo,
          scheme: response.payload?.scheme,
        });
        setAutonomyHint(
          "Premium autonomy is waiting on an x402 payment challenge. Review the quote below and complete the payment through your configured flow.",
        );
        setStatus("x402 payment is required for the autonomy pass.");
      } else {
        setAutonomyQuote(null);
        setAutonomyHint(
          "Premium autonomy is active. The planner can now route upgrades and paid queue timing with tighter discipline.",
        );
        if (response.payload?.receipt) {
          pushTxReveal(
            response.payload.receipt as OnchainReceipt,
            "x402 autonomy pass confirmed",
            "Premium autonomy routing is active for the next 24 hours.",
          );
        }
        await loadTransactions(selectedAgent.id, { revealNew: true });
        await loadAutonomyPlan(selectedAgent.id);
        setStatus("Autonomy pass activated.");
      }
    } catch (error) {
      setStatus(normalizeUiError(error, "Autonomy pass request failed."));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleOperationExecute(operation: AgentOperation) {
    switch (operation.action) {
      case "buy_skill":
        if (autonomyPlan) {
          await handleBuySkill(autonomyPlan.nextSkill);
        }
        break;
      case "queue_paid":
        await handleQueue(true);
        break;
      case "queue_practice":
        await handleQueue(false);
        break;
      case "buy_autonomy_pass":
        await handleAutonomyPass();
        break;
    }
  }

  function handleSpectateMatch(match: MatchSnapshot, options?: { followLeader?: boolean }) {
    if (!authToken || !socketRef.current) {
      setStatus("Sign in first to spectate a live frontier match.");
      return;
    }

    setSpectatorFollowLeader(Boolean(options?.followLeader));
    socketRef.current.emit("match:join", { matchId: match.matchId });
    setSnapshot(match);
    setRecentEvents(match.events.slice(-8));
    setQueueState(null);
    setStatus(
      options?.followLeader
        ? `Leader cam active for match ${match.matchId.slice(-6)}.`
        : `Spectating live match ${match.matchId.slice(-6)}.`,
    );
  }

  async function ensureAgentRegisteredOnchain(agent: AgentProfile) {
    if (!authToken || !walletClient || !publicClient || !deployedContractAddress) {
      throw new Error(
        "Wallet connection and contract deployment are required to register this agent onchain.",
      );
    }

    await ensureXLayer();
    const registrationState = await publicClient.readContract({
      address: deployedContractAddress as Address,
      abi: arenaEconomyAbi,
      functionName: "agents",
      args: [agentIdToBytes32(agent.id)],
    });

    if (registrationState[2]) {
      return null;
    }

    setStatus(`Registering ${agent.displayName} on X Layer...`);
    const registrationTx = await walletClient.writeContract({
      account: walletClient.account!,
      chain: xLayerTestnetChain,
      address: deployedContractAddress as Address,
      abi: arenaEconomyAbi,
      functionName: "registerAgent",
      args: [agentIdToBytes32(agent.id), agent.walletAddress as Address],
    });
    await publicClient.waitForTransactionReceipt({ hash: registrationTx });
    const response = await registerAgentOnServer(
      authToken,
      agent.id,
      registrationTx,
    );
    return response.receipt;
  }

  function handleArenaCommand(command: ArenaCommand) {
    if (
      !snapshot ||
      !authToken ||
      !selectedAgent ||
      selectedAgent.mode !== "manual"
    ) {
      return;
    }

    void sendArenaCommand(
      authToken,
      snapshot.matchId,
      selectedAgent.id,
      command,
    ).catch((error) => {
      setStatus(normalizeUiError(error, "Arena command failed."));
    });
  }

  function startDirectionalMove(dx: number, dy: number) {
    handleArenaCommand({ type: "move", dx, dy });
  }

  function stopDirectionalMove() {
    handleArenaCommand({ type: "idle" });
  }

  function handleReloadAction() {
    handleArenaCommand({ type: "reload" });
  }

  const buyDisabled =
    !deployedContractAddress || !walletClient || busyAction !== null;
  const liveAgentStats = selectedAgent?.skills ?? null;

  return (
    <main className="min-h-screen px-4 py-6 md:px-8">
      <section className="mx-auto flex max-w-[1600px] flex-col gap-6">
        <div className="western-card relative overflow-hidden rounded-[32px] border px-6 py-6 md:px-10 md:py-8">
          <div className="absolute inset-0 dust-grid opacity-40" />
          <div className="relative grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="space-y-5">
              <p className="inline-flex rounded-full border border-amber-300/20 bg-amber-200/8 px-4 py-1 text-xs uppercase tracking-[0.28em] text-amber-100/80">
                X Layer • OnchainOS • Agent Arena
              </p>
              <div className="space-y-3">
                <h1 className="font-[var(--font-heading)] text-4xl leading-none text-[#f6dfb7] md:text-6xl">
                  Red Dead Redemption: Agentic Era
                </h1>
                <p className="max-w-2xl text-base text-stone-200/78 md:text-lg">
                  Name your outlaw, forge a treasury-backed subwallet, buy skill
                  upgrades on X Layer, then fight manual or fully autonomous
                  duels in a live western arena.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                {!isConnected ? (
                  <button
                    type="button"
                    onClick={() => {
                      const connector = connectors[0];
                      if (connector) {
                        connect({ connector });
                      }
                    }}
                    className="inline-flex items-center gap-2 rounded-full bg-[#d5752d] px-5 py-3 font-medium text-black transition hover:bg-[#eb9150]"
                  >
                    {isConnecting ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : (
                      <Wallet className="h-4 w-4" />
                    )}
                    Connect Wallet
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={handleSignIn}
                      disabled={busyAction === "sign-in"}
                      className="inline-flex items-center gap-2 rounded-full bg-[#d5752d] px-5 py-3 font-medium text-black transition hover:bg-[#eb9150] disabled:opacity-60"
                    >
                      {busyAction === "sign-in" ? (
                        <LoaderCircle className="h-4 w-4 animate-spin" />
                      ) : (
                        <PlugZap className="h-4 w-4" />
                      )}
                      {authToken ? "Refresh Session" : "Sign In"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        disconnect();
                        clearSession("Wallet disconnected.");
                      }}
                      className="rounded-full border border-white/15 px-5 py-3 text-sm text-white/80 transition hover:border-white/30 hover:text-white"
                    >
                      Disconnect
                    </button>
                  </>
                )}
              </div>
              <div className="grid gap-3 text-sm text-stone-200/72 md:grid-cols-3">
                <StatCard
                  icon={<Wallet className="h-4 w-4" />}
                  label="Wallet"
                  value={address ? truncateAddress(address) : "Disconnected"}
                />
                <StatCard
                  icon={<RadioTower className="h-4 w-4" />}
                  label="Chain"
                  value={chainId ? `#${chainId}` : "Not ready"}
                />
                <StatCard
                  icon={<ShieldPlus className="h-4 w-4" />}
                  label="Status"
                  value={status}
                />
              </div>
            </div>
            <div className="rounded-[28px] border border-amber-200/10 bg-black/15 p-5 backdrop-blur">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.26em] text-amber-100/60">
                    Frontier Briefing
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold text-[#f6ead7]">
                    Start here
                  </h2>
                </div>
                <Bot className="h-8 w-8 text-[#f0bf76]" />
              </div>
              {isConnected ? (
                <div className="mt-4 grid gap-2 text-sm text-stone-200/72">
                  <QuickBriefRow
                    step={authToken ? "Ready" : "1"}
                    title={authToken ? "Session active" : "Sign the session"}
                    body={
                      authToken
                        ? "You are ready. Pick a rider below, choose a mode, and queue a run."
                        : "Approve one wallet signature to unlock riders, queueing, and onchain receipts."
                    }
                  />
                  <QuickBriefRow
                    step={selectedAgent ? "Ready" : "2"}
                    title={selectedAgent ? "Rider selected" : "Choose a rider"}
                    body={
                      selectedAgent
                        ? `${selectedAgent.displayName} is active. Choose manual or Autopilot before you queue.`
                        : "Select a rider or mint one below. Each rider gets five core skills and a linked treasury."
                    }
                  />
                  <QuickBriefRow
                    step="3"
                    title="Win and settle"
                    body="Stay inside the dust ring, grab supplies, outlast the field, and collect the X Layer payout."
                  />
                </div>
              ) : (
                <p className="mt-4 text-sm text-stone-200/72">
                  Connect a wallet first. The game will then show the shortest path from sign-in to your first showdown.
                </p>
              )}
              {selectedAgent && (
                <div className="mt-4 rounded-[22px] border border-white/8 bg-white/5 px-4 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.18em] text-stone-300/58">
                        Active rider
                      </div>
                      <div className="mt-1 text-lg font-semibold text-[#f6ead7]">
                        {selectedAgent.displayName}
                      </div>
                    </div>
                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-stone-200/72">
                      {selectedAgent.mode}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <section className="western-card rounded-[30px] border p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-amber-100/55">
                Rider Deck
              </p>
              <h2 className="mt-1 text-2xl font-semibold text-[#f6ead7]">
                Pick your rider
              </h2>
            </div>
            {selectedAgent && (
              <div className="flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.16em] text-stone-300/58">
                <span className="rounded-full border border-white/8 px-2.5 py-1">
                  {selectedAgent.displayName}
                </span>
                {autonomyPlan && (
                  <span className="rounded-full border border-white/8 px-2.5 py-1">
                    Readiness {autonomyPlan.readinessScore}%
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
            <div className="grid gap-2 md:grid-cols-2">
              {agents.length === 0 ? (
                <EmptyState label="No riders yet. Mint your first frontier rider from the card on the right." />
              ) : (
                agents.map((agent) => {
                  const active = agent.id === selectedAgent?.id;
                  return (
                    <button
                      type="button"
                      key={agent.id}
                      onClick={() => setSelectedAgentId(agent.id)}
                      className={`rounded-[20px] border px-4 py-3 text-left transition ${
                        active
                          ? "border-[var(--accent-soft)]/35 bg-[var(--accent)]/10"
                          : "border-white/8 bg-white/3 hover:border-white/20 hover:bg-white/5"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-[#f6ead7]">
                            {agent.displayName}
                          </div>
                          <div className="mt-1 text-[10px] uppercase tracking-[0.18em] text-stone-300/58">
                            {truncateAddress(agent.walletAddress)}
                          </div>
                        </div>
                        <span
                          className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] ${
                            agent.mode === "manual"
                              ? "border-[#7ed2b4]/25 bg-[#7ed2b4]/10 text-[#c5f4e9]"
                              : "border-[#df6c39]/25 bg-[#df6c39]/10 text-[#ffd0ae]"
                          }`}
                        >
                          {agent.mode}
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
            <div className="space-y-4">
              <div className="rounded-[24px] border border-white/8 bg-black/12 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.18em] text-stone-300/58">
                      Active rider
                    </p>
                    <h3 className="mt-1 text-lg font-semibold text-[#f6ead7]">
                      {selectedAgent ? selectedAgent.displayName : "No rider selected"}
                    </h3>
                  </div>
                  {selectedAgent && (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleModeChange("manual")}
                        disabled={busyAction !== null}
                        className={`rounded-full px-3 py-2 text-xs ${
                          selectedAgent.mode === "manual"
                            ? "bg-[#7ed2b4]/18 text-[#c5f4e9]"
                            : "border border-white/12 text-white/70"
                        }`}
                      >
                        Manual
                      </button>
                      <button
                        type="button"
                        onClick={() => handleModeChange("autonomous")}
                        disabled={busyAction !== null}
                        className={`rounded-full px-3 py-2 text-xs ${
                          selectedAgent.mode === "autonomous"
                            ? "bg-[#df6c39]/18 text-[#ffd0ae]"
                            : "border border-white/12 text-white/70"
                        }`}
                      >
                        Autopilot
                      </button>
                    </div>
                  )}
                </div>
                <div className="mt-3 text-sm text-stone-200/72">
                  {selectedAgent
                    ? "Pick the rider you want in the next showdown. Queue buttons are in the arena section below."
                    : "Select a rider from the list or mint a new one to continue."}
                </div>
                {selectedModeGuide && (
                  <div className="mt-3 rounded-[18px] border border-white/8 bg-white/[0.04] px-3 py-3">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-stone-300/56">
                      {selectedModeGuide.label}
                    </div>
                    <div className="mt-1 text-sm text-stone-200/72">
                      {selectedModeGuide.detail}
                    </div>
                  </div>
                )}
              </div>
              <div className="rounded-[24px] border border-amber-200/10 bg-black/12 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.26em] text-amber-100/60">
                      Mint a rider
                    </p>
                    <h3 className="mt-2 text-lg font-semibold text-[#f6ead7]">
                      Build your crew
                    </h3>
                  </div>
                  <Gem className="h-6 w-6 text-[#f0bf76]" />
                </div>
                <label className="mt-4 block space-y-2">
                  <span className="text-sm text-stone-200/70">Base name</span>
                  <input
                    value={baseName}
                    onChange={(event) => setBaseName(event.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-white/6 px-4 py-3 text-sm outline-none ring-0 placeholder:text-stone-400 focus:border-amber-300/35"
                    placeholder="Marshal"
                  />
                </label>
                <button
                  type="button"
                  onClick={handleCreateAgent}
                  disabled={!authToken || busyAction === "create-agent"}
                  className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-amber-200/20 bg-amber-100/10 px-4 py-3 text-sm font-medium text-[#f6ead7] transition hover:bg-amber-100/15 disabled:opacity-50"
                >
                  {busyAction === "create-agent" ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <Gem className="h-4 w-4" />
                  )}
                  {authToken ? "Mint New Agent Profile" : "Sign In to Mint an Agent"}
                </button>
              </div>
            </div>
          </div>
        </section>


        <section className="western-card order-2 rounded-[30px] border p-5">
          <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[var(--accent-soft)]/60">
                Agent Ops
              </p>
              <h2 className="mt-1 font-[var(--font-heading)] text-3xl font-bold text-[var(--foreground)]">
                Plan the next move
              </h2>
              <p className="mt-2 max-w-2xl text-sm text-stone-200/68">
                Check the rider loop, autopilot plan, and X Layer receipts when you want the next simple action.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <ConsoleTabButton
                label="Rider"
                active={activeConsoleTab === "overview"}
                onClick={() => setActiveConsoleTab("overview")}
              />
              <ConsoleTabButton
                label="Autopilot"
                active={activeConsoleTab === "autonomy"}
                onClick={() => setActiveConsoleTab("autonomy")}
              />
              <ConsoleTabButton
                label="Chain"
                active={activeConsoleTab === "onchain"}
                onClick={() => setActiveConsoleTab("onchain")}
              />
            </div>
          </div>

          {selectedAgent && liveAgentStats ? (
            activeConsoleTab === "overview" ? (
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
                <div className="rounded-[24px] border border-white/8 bg-black/12 p-4">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-[#f6ead7]">
                        Skill Network
                      </p>
                      <p className="mt-1 text-xs text-stone-300/58">
                        Upgrade only what helps the next run.
                      </p>
                    </div>
                    {autonomyPlan && (
                      <button
                        type="button"
                        onClick={() => handleBuySkill(autonomyPlan.nextSkill)}
                        disabled={buyDisabled}
                        className="rounded-full border border-amber-300/25 bg-amber-100/10 px-3 py-2 text-xs text-[#f6ead7] transition hover:bg-amber-100/15 disabled:opacity-45"
                      >
                        Buy {skillLabels[autonomyPlan.nextSkill]}
                      </button>
                    )}
                  </div>
                  <div className="space-y-3">
                    {skillKeys.map((skill) => (
                      <div
                        key={skill}
                        className="flex items-center justify-between gap-4 rounded-[18px] border border-white/8 bg-black/14 px-4 py-3"
                      >
                        <div>
                          <div className="text-sm font-semibold text-[#f6ead7]">
                            {skillLabels[skill]}
                          </div>
                          <div className="mt-1 text-xs text-stone-200/60">
                            {selectedAgent.skills[skill]} / 100
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleBuySkill(skill)}
                          disabled={buyDisabled}
                          className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80 transition hover:border-white/20 hover:bg-white/10 disabled:opacity-45"
                        >
                          +5 • {formatWeiToOkb(calculateSkillPurchasePrice(selectedAgent.skills[skill]))}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="space-y-4">
                  {bountyTrail && (
                    <div className="rounded-[24px] border border-[#df6c39]/18 bg-[linear-gradient(180deg,rgba(52,24,14,0.92),rgba(16,9,7,0.96))] p-4">
                      <div className="text-[10px] uppercase tracking-[0.24em] text-[#ffd0ae]/68">
                        Bounty Trail
                      </div>
                      <div className="mt-2 text-lg font-semibold text-[#f6ead7]">
                        {bountyTrail.title}
                      </div>
                      <div className="mt-2 text-sm text-stone-200/72">
                        {bountyTrail.detail}
                      </div>
                    </div>
                  )}
                  {campaignLoopSummary && (
                    <div className="rounded-[24px] border border-[#7ed2b4]/14 bg-[linear-gradient(180deg,rgba(14,24,20,0.92),rgba(10,12,11,0.96))] p-4">
                      <div className="text-[10px] uppercase tracking-[0.24em] text-[#7ed2b4]/60">
                        Campaign Loop
                      </div>
                      <div className="mt-2 text-lg font-semibold text-[#f6ead7]">
                        {campaignLoopSummary.title}
                      </div>
                      <div className="mt-2 text-sm text-stone-200/72">
                        {campaignLoopSummary.detail}
                      </div>
                    </div>
                  )}
                  {campaignStats ? (
                    <div className="rounded-[24px] border border-amber-200/12 bg-[linear-gradient(180deg,rgba(26,18,12,0.92),rgba(14,10,8,0.96))] p-4">
                      <div className="text-[10px] uppercase tracking-[0.24em] text-amber-200/58">
                        Campaign Snapshot
                      </div>
                      <div className="mt-2 text-lg font-semibold text-[#f6ead7]">
                        {formatCampaignTier(campaignStats.campaignTier)}
                      </div>
                      <div className="mt-3 grid gap-2 text-sm text-stone-200/72">
                        <div>{campaignStats.wins} wins from {campaignStats.matchesPlayed} runs</div>
                        <div>{campaignStats.totalKills} eliminations total</div>
                        <div>{formatWeiToOkb(BigInt(campaignStats.careerPayoutWei))} career payout</div>
                      </div>
                    </div>
                  ) : (
                    <EmptyState label="Campaign stats appear after the first finished run." compact />
                  )}
                  <div className="rounded-[24px] border border-white/8 bg-black/12 p-4">
                    <div className="text-[10px] uppercase tracking-[0.2em] text-stone-300/56">
                      Latest Run
                    </div>
                    {matchHistory[0] ? (
                      <div className="mt-3 space-y-2 text-sm text-stone-200/72">
                        <div className="font-semibold text-[#f6ead7]">
                          {matchHistory[0].paid ? "Paid Showdown" : "Practice Run"} • Finish #{matchHistory[0].placement}
                        </div>
                        <div>Score {matchHistory[0].score} • Kills {matchHistory[0].kills}</div>
                        <div>Payout {formatWeiToOkb(BigInt(matchHistory[0].payoutWei))}</div>
                      </div>
                    ) : (
                      <EmptyState label="No finished run logged yet." compact />
                    )}
                  </div>
                </div>
              </div>
            ) : activeConsoleTab === "autonomy" ? (
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
                <div className="space-y-4">
                  <div className="rounded-[24px] border border-[#7ed2b4]/14 bg-[linear-gradient(180deg,rgba(13,18,16,0.92),rgba(8,10,9,0.96))] p-4">
                    {autonomyPlan ? (
                      <>
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-[10px] uppercase tracking-[0.24em] text-[#7ed2b4]/60">
                              Autopilot
                            </p>
                            <h3 className="mt-1 text-lg font-semibold text-[#f6ead7]">
                              {selectedAgent?.mode === "autonomous"
                                ? "Autopilot is live"
                                : "Autopilot is available"}
                            </h3>
                            <p className="mt-2 max-w-2xl text-sm text-stone-200/72">
                              {selectedAgent?.mode === "autonomous"
                                ? "This rider will move, aim, dodge, and reload on its own. You can stay in the arena and watch the cyan YOU marker."
                                : "Switch this rider to Autopilot if you want the fight handled automatically. The planner below only shows the next simple move."}
                            </p>
                          </div>
                          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-stone-200/72">
                            {autonomyPlan.readinessScore}% ready
                          </span>
                        </div>
                        <div className="mt-4 grid gap-3 md:grid-cols-2">
                          <div className="rounded-[18px] border border-white/8 bg-black/16 px-4 py-3 text-sm text-stone-200/72">
                            <div className="text-[10px] uppercase tracking-[0.18em] text-stone-300/56">
                              What it will do next
                            </div>
                            <div className="mt-2 font-semibold text-[#f6ead7]">
                              {operationQueue[0]?.label ?? autonomyPlan.missionTitle}
                            </div>
                            <div className="mt-1 text-xs text-stone-300/60">
                              {operationQueue[0]?.detail ?? autonomyPlan.missionDetail}
                            </div>
                          </div>
                          <div className="rounded-[18px] border border-white/8 bg-black/16 px-4 py-3 text-sm text-stone-200/72">
                            <div className="text-[10px] uppercase tracking-[0.18em] text-stone-300/56">
                              Queue choice
                            </div>
                            <div className="mt-2 font-semibold text-[#f6ead7]">
                              {autonomyPlan.recommendedQueue === "paid"
                                ? "Paid showdown"
                                : "Practice run"}
                            </div>
                            <div className="mt-1 text-xs text-stone-300/60">
                              {autonomyPlan.economyDirective}
                            </div>
                          </div>
                          <div className="rounded-[18px] border border-white/8 bg-black/16 px-4 py-3 text-sm text-stone-200/72">
                            <div className="text-[10px] uppercase tracking-[0.18em] text-stone-300/56">
                              Fight style
                            </div>
                            <div className="mt-2 text-[#f6ead7]">{autonomyPlan.combatDirective}</div>
                          </div>
                          <div className="rounded-[18px] border border-white/8 bg-black/16 px-4 py-3 text-sm text-stone-200/72">
                            <div className="text-[10px] uppercase tracking-[0.18em] text-stone-300/56">
                              Objective focus
                            </div>
                            <div className="mt-2 text-[#f6ead7]">{autonomyPlan.objectiveDirective}</div>
                          </div>
                        </div>
                        <div className="mt-4 rounded-[18px] border border-[#7ed2b4]/16 bg-[#7ed2b4]/[0.06] px-4 py-4">
                          <div className="text-[10px] uppercase tracking-[0.18em] text-[#7ed2b4]/58">
                            Plain-English read
                          </div>
                          <div className="mt-2 text-sm text-stone-200/72">
                            {autonomyPlan.summary}
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.16em]">
                            {autonomySignals.slice(0, 4).map((signal) => (
                              <span
                                key={signal}
                                className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-stone-200/72"
                              >
                                {signal}
                              </span>
                            ))}
                          </div>
                        </div>
                      </>
                    ) : (
                      <EmptyState label="Select a rider to see the simplified autopilot plan." compact />
                    )}
                  </div>
                  <div className="rounded-[24px] border border-white/8 bg-black/12 p-4">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-stone-300/56">
                      Latest autopilot calls
                    </div>
                    <div className="mt-3 grid gap-2">
                      {autonomyWireFeed.length > 0 ? (
                        autonomyWireFeed.slice(0, 3).map((message) => (
                          <div
                            key={message}
                            className="rounded-[18px] border border-white/8 bg-black/14 px-4 py-3 text-sm text-stone-200/72"
                          >
                            {message}
                          </div>
                        ))
                      ) : (
                        <EmptyState label="No live autopilot calls yet." compact />
                      )}
                    </div>
                  </div>
                </div>
                <div className="space-y-4">
                  <div className="rounded-[24px] border border-white/8 bg-black/12 p-4">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-stone-300/56">
                      What autopilot means
                    </div>
                    <div className="mt-3 space-y-2 text-sm text-stone-200/72">
                      <div className="rounded-[18px] border border-white/8 bg-black/14 px-4 py-3">
                        It only takes over during a live match. Outside the arena, you still choose upgrades and queue runs.
                      </div>
                      <div className="rounded-[18px] border border-white/8 bg-black/14 px-4 py-3">
                        In a match, it handles movement, shots, dodges, reloads, and pickup routes automatically.
                      </div>
                      <div className="rounded-[18px] border border-white/8 bg-black/14 px-4 py-3">
                        Premium x402 unlocks a tighter planning loop for paid runs and upgrade timing.
                      </div>
                    </div>
                  </div>
                  <div className="rounded-[24px] border border-[#df6c39]/18 bg-[#df6c39]/6 p-4">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-[#ffd0ae]/76">
                      Premium autopilot
                    </div>
                    <div className="mt-2 text-lg font-semibold text-[#f6ead7]">
                      {premiumLaneSummary.title}
                    </div>
                    <div className="mt-2 text-sm text-stone-200/72">
                      {premiumLaneSummary.detail}
                    </div>
                    <div className="mt-3 grid gap-2 text-[10px] uppercase tracking-[0.16em] text-stone-300/56">
                      {premiumLaneSteps.slice(0, 2).map((step) => (
                        <div
                          key={step.label}
                          className={`rounded-[14px] border px-3 py-2 ${
                            step.done
                              ? "border-[#7ed2b4]/18 bg-[#7ed2b4]/10 text-[#daf8ef]"
                              : "border-white/8 bg-black/14 text-stone-200/72"
                          }`}
                        >
                          <div className="font-semibold">{step.label}</div>
                          <div className="mt-1 text-[10px] normal-case tracking-normal opacity-80">
                            {step.detail}
                          </div>
                        </div>
                      ))}
                    </div>
                    {autonomyQuote && (
                      <div className="mt-3 rounded-[18px] border border-white/8 bg-black/14 px-4 py-3 text-sm text-stone-200/72">
                        x402 challenge ready
                        <div className="mt-2 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.16em] text-stone-300/58">
                          {autonomyQuote.amount && (
                            <span className="rounded-full border border-white/8 px-2.5 py-1">
                              {autonomyQuote.amount} {autonomyQuote.asset ?? ""}
                            </span>
                          )}
                          {autonomyQuote.chainId && (
                            <span className="rounded-full border border-white/8 px-2.5 py-1">
                              Chain #{autonomyQuote.chainId}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                    {autonomyHint && (
                      <div className="mt-3 rounded-[18px] border border-white/8 bg-black/14 px-4 py-3 text-sm text-stone-200/72">
                        {autonomyHint}
                      </div>
                    )}
                    {!autonomyPlan?.autonomyPassActive && (
                      <button
                        type="button"
                        onClick={handleAutonomyPass}
                        disabled={busyAction !== null}
                        className="mt-3 rounded-full border border-[#df6c39]/30 bg-[#df6c39]/10 px-3 py-2 text-xs text-[#ffd0ae] transition hover:bg-[#df6c39]/16 disabled:opacity-50"
                      >
                        {autonomyQuote ? "Refresh x402 Challenge" : "Unlock x402 Premium"}
                      </button>
                    )}
                  </div>
                  <div className="rounded-[24px] border border-white/8 bg-black/12 p-4">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-stone-300/56">
                      Next actions
                    </div>
                    <div className="mt-3 grid gap-2">
                      {operationQueue.slice(0, 2).length > 0 ? (
                        operationQueue.slice(0, 2).map((operation) => (
                          <button
                            type="button"
                            key={operation.id}
                            onClick={() => void handleOperationExecute(operation)}
                            disabled={operation.status !== "ready"}
                            className="rounded-[18px] border border-white/8 bg-black/14 px-4 py-3 text-left text-sm text-stone-200/72 transition hover:border-white/18 disabled:opacity-45"
                          >
                            <div className="font-semibold text-[#f6ead7]">{operation.label}</div>
                            <div className="mt-1 text-xs text-stone-300/58">{operation.detail}</div>
                          </button>
                        ))
                      ) : (
                        <EmptyState label="No autopilot actions queued right now." compact />
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
                <div className="rounded-[24px] border border-white/8 bg-black/12 p-4">
                  <div className="text-[10px] uppercase tracking-[0.2em] text-[#7ed2b4]/68">
                    Onchain Loop
                  </div>
                  <div className="mt-2 text-lg font-semibold text-[#f6ead7]">
                    {chainLoopSummary.title}
                  </div>
                  <div className="mt-2 text-sm text-stone-200/72">
                    {chainLoopSummary.detail}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.16em] text-stone-300/58">
                    <span className="rounded-full border border-white/8 px-2.5 py-1">
                      Registrations {transactionCounts.registrations}
                    </span>
                    <span className="rounded-full border border-white/8 px-2.5 py-1">
                      Upgrades {transactionCounts.upgrades}
                    </span>
                    <span className="rounded-full border border-white/8 px-2.5 py-1">
                      Entries {transactionCounts.entries}
                    </span>
                    <span className="rounded-full border border-white/8 px-2.5 py-1">
                      Settlements {transactionCounts.settlements}
                    </span>
                  </div>
                  {deployedContractAddress && (
                    <div className="mt-3 text-xs text-stone-300/58">
                      Contract {truncateAddress(deployedContractAddress)}
                    </div>
                  )}
                  {lastConfirmedReceipt ? (
                    <div className="mt-4 rounded-[18px] border border-white/8 bg-black/16 px-4 py-3 text-sm text-stone-200/72">
                      <div className="font-semibold text-[#f6ead7]">
                        {formatReceiptPurpose(lastConfirmedReceipt.purpose)}
                      </div>
                      <div className="mt-1 text-xs text-stone-300/58">
                        {truncateHash(lastConfirmedReceipt.txHash)}
                      </div>
                    </div>
                  ) : (
                    <EmptyState label="No confirmed receipts yet." compact />
                  )}
                </div>
                <div className="rounded-[24px] border border-white/8 bg-black/12 p-4">
                  <div className="mb-3 text-sm font-semibold text-[#f6ead7]">
                    Recent Onchain History
                  </div>
                  <div className="grid gap-2">
                    {transactions.length === 0 ? (
                      <EmptyState label="No confirmed X Layer receipts yet." compact />
                    ) : (
                      transactions.slice(0, 6).map((receipt) => (
                        <a
                          key={receipt.txHash}
                          href={receipt.explorerUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-[18px] border border-white/8 bg-black/16 px-4 py-3 text-sm text-stone-200/72 transition hover:border-white/18"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="font-semibold text-[#f6ead7]">
                              {formatReceiptPurpose(receipt.purpose)}
                            </span>
                            <span className="text-[10px] uppercase tracking-[0.16em] text-stone-300/56">
                              {receipt.status}
                            </span>
                          </div>
                          <div className="mt-1 text-xs text-stone-300/58">
                            {truncateHash(receipt.txHash)}
                          </div>
                        </a>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )
          ) : (
            <EmptyState label="Select or create a rider to inspect upgrades, autonomy, and chain activity." />
          )}
        </section>

          <section className="western-card order-1 rounded-[30px] border p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-amber-100/55">
                  Arena
                </p>
                <h2 className="mt-1 text-2xl font-semibold text-[#f6ead7]">
                  The Dust Circuit
                </h2>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => handleQueue(true)}
                  disabled={!selectedAgent || queueLocked}
                  className="inline-flex items-center gap-2 rounded-full bg-[#d5752d] px-4 py-2 text-sm font-medium text-black transition hover:bg-[#eb9150] disabled:opacity-50"
                >
                  {busyAction === "paid-queue" ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : queueLocked ? (
                    <RadioTower className="h-4 w-4" />
                  ) : (
                    <Sword className="h-4 w-4" />
                  )}
                  {queueLocked ? "Run Active" : "Deploy Paid Run"}
                </button>
                <button
                  type="button"
                  onClick={() => handleQueue(false)}
                  disabled={!selectedAgent || queueLocked}
                  className="rounded-full border border-white/14 px-4 py-2 text-sm text-white/80 transition hover:border-white/28 disabled:opacity-50"
                >
                  {queueLocked ? "Run Locked" : "Open Practice Run"}
                </button>
              </div>
            </div>
            {queueState?.status === "queued" && (
              <div className="mb-4 rounded-[24px] border border-amber-200/14 bg-amber-100/6 px-4 py-4 text-sm text-stone-200/76">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.18em] text-amber-100/58">
                      Showdown prep
                    </div>
                    <div className="mt-1 font-semibold text-[#f6ead7]">
                      {queueWaitLabel ?? "Your slot is locked. Waiting for the field to fill."}
                    </div>
                  </div>
                  <div className="rounded-full border border-white/10 px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-stone-200/70">
                    {selectedAgent?.mode === "autonomous" ? "Autopilot queued" : "Manual queued"}
                  </div>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-black/30">
                  <div
                    className="h-full rounded-full bg-[linear-gradient(90deg,#d5752d,#f0bf76)] transition-all duration-300"
                    style={{ width: `${Math.max(8, queueProgressRatio * 100)}%` }}
                  />
                </div>
                <div className="mt-3 grid gap-2 text-[11px] text-stone-200/70 md:grid-cols-3">
                  <div className="rounded-[16px] border border-white/8 bg-black/14 px-3 py-2">
                    <div className="text-[9px] uppercase tracking-[0.18em] text-stone-300/56">
                      1. Slot
                    </div>
                    <div className="mt-1 text-[#f6ead7]">Locked for {selectedAgent?.displayName ?? "your rider"}</div>
                  </div>
                  <div className="rounded-[16px] border border-white/8 bg-black/14 px-3 py-2">
                    <div className="text-[9px] uppercase tracking-[0.18em] text-stone-300/56">
                      2. Field fill
                    </div>
                    <div className="mt-1 text-[#f6ead7]">
                      {queueWaitCountdown && queueWaitCountdown > 0
                        ? `House bots arrive in about ${queueWaitCountdown}s`
                        : "Bots are arming now"}
                    </div>
                  </div>
                  <div className="rounded-[16px] border border-white/8 bg-black/14 px-3 py-2">
                    <div className="text-[9px] uppercase tracking-[0.18em] text-stone-300/56">
                      3. Opening bell
                    </div>
                    <div className="mt-1 text-[#f6ead7]">
                      Stay on this screen for the countdown and spawn cue.
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div
              ref={arenaFrameRef}
              className={`relative overflow-hidden rounded-[28px] border border-white/8 bg-[#120b08] ${
                arenaFullscreen ? "h-screen w-screen rounded-none border-0" : "aspect-[16/9]"
              }`}
            >
              {matchCountdown !== null && (
                <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/18">
                  <div className="rounded-[32px] border border-amber-200/20 bg-black/55 px-8 py-6 text-center shadow-[0_20px_80px_rgba(0,0,0,0.38)] backdrop-blur">
                    <div className="text-xs uppercase tracking-[0.3em] text-amber-100/65">
                      Showdown Start
                    </div>
                    <div className="mt-3 font-[var(--font-heading)] text-6xl text-[#f6dfb7]">
                      {matchCountdown === 0 ? "DRAW" : matchCountdown}
                    </div>
                  </div>
                </div>
              )}
              {(snapshot || queueState?.status === "queued" || selectedAgent || authToken) && (
                <div className="pointer-events-none absolute left-4 top-4 z-10 max-w-[min(380px,calc(100%-2rem))]">
                  <div
                    className={`rounded-[24px] border px-4 py-4 shadow-[0_18px_60px_rgba(0,0,0,0.38)] backdrop-blur-md ${getDirectiveToneClasses(
                      battleDirective.tone,
                    )}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[10px] font-bold uppercase tracking-[0.24em] opacity-70">
                          {battleDirective.eyebrow}
                        </div>
                        <div className="mt-1 text-lg font-semibold text-[#f6ead7]">
                          {battleDirective.title}
                        </div>
                        <div className="mt-2 text-sm text-stone-100/78">
                          {battleDirective.detail}
                        </div>
                      </div>
                      {snapshot?.status === "in_progress" && selectedPlacement && (
                        <div className="shrink-0 rounded-full border border-white/12 px-3 py-2 text-center">
                          <div className="text-[9px] uppercase tracking-[0.18em] text-stone-300/60">
                            Standing
                          </div>
                          <div className="mt-1 text-sm font-semibold text-[#f6ead7]">
                            {ordinal(selectedPlacement)}
                          </div>
                        </div>
                      )}
                    </div>
                    {battleSignals.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {battleSignals.map((signal) => (
                          <div
                            key={signal.label}
                            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${getSignalToneClasses(
                              signal.tone,
                            )}`}
                          >
                            {signal.icon}
                            <span>{signal.label}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
              {snapshot?.status === "finished" && (
                <div className="pointer-events-auto absolute inset-0 z-30 overflow-y-auto bg-[#0d0a08]/85 p-4 backdrop-blur-md sm:p-6">
                  <div className="flex min-h-full items-start justify-center">
                  <div className="relative w-[min(1120px,100%)] max-h-[calc(100dvh-3rem)] overflow-y-auto rounded-[32px] border border-[var(--panel-border)] bg-[var(--panel)] px-6 py-8 text-center shadow-[0_40px_100px_rgba(0,0,0,0.8)] sm:px-8 sm:py-10">
                    <div className="absolute inset-0 circuit-bg opacity-10" />
                    <div className="relative">
                      <div className="flex items-center justify-center gap-4 text-[10px] font-bold uppercase tracking-[0.4em] text-[var(--accent)]/80">
                        <span className="h-px w-8 bg-[var(--accent)]/30" />
                        Showdown Concluded
                        <span className="h-px w-8 bg-[var(--accent)]/30" />
                      </div>
                      
                      {winnerDisplayName ? (
                        <div className="mt-6 mb-8">
                          <div className="font-[var(--font-heading)] text-7xl font-bold tracking-tight text-[var(--accent-soft)] drop-shadow-[0_0_24px_rgba(244,200,133,0.3)]">
                            {winnerDisplayName}
                          </div>
                          <div className="mt-2 text-sm uppercase tracking-[0.2em] text-[var(--foreground)]/60">Wins the Frontier</div>
                        </div>
                      ) : (
                        <div className="mt-6 mb-8 font-[var(--font-heading)] text-6xl font-bold tracking-tight text-[var(--foreground)]/80">
                          DRAW
                        </div>
                      )}

                      <div className="mt-8 grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
                        <div className="space-y-2 text-left">
                          {scoreboardPlayers.map((player, i) => (
                            <div
                              key={player.agentId}
                              className={`flex items-center gap-4 rounded-[18px] px-5 py-3 transition-colors ${
                                player.agentId === snapshot.winnerAgentId
                                  ? "bg-[var(--accent)]/15 border border-[var(--accent-soft)]/30"
                                  : player.agentId === selectedAgent?.id
                                    ? "bg-[#9ce9ff]/10 border border-[#9ce9ff]/28"
                                    : "bg-white/5 border border-transparent"
                              }`}
                            >
                              <span className="w-6 text-center text-xs font-bold text-[var(--foreground)]/40">{i + 1}</span>
                              <span className={`flex-1 truncate text-base font-medium ${
                                 player.agentId === snapshot.winnerAgentId ? "text-[var(--accent-soft)]" : "text-[var(--foreground)]"
                              }`}>{player.displayName}</span>
                              <span className="text-xs uppercase tracking-wider text-[var(--foreground)]/50">{player.kills} K</span>
                              <span className="text-xs uppercase tracking-wider text-[var(--foreground)]/50">{player.damageDealt} DMG</span>
                              <span className="text-sm font-bold text-[var(--accent-soft)]">{player.score} PTS</span>
                            </div>
                          ))}
                        </div>
                        <div className="space-y-3 text-left">
                          <div className="rounded-[22px] border border-white/8 bg-black/20 px-4 py-4">
                            <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--accent-soft)]/70">
                              Your Dossier
                            </div>
                            <div className="mt-2 text-lg font-semibold text-[#f6ead7]">
                              {resultDebrief?.headline ??
                                (selectedPlacement ? `Finish #${selectedPlacement}` : "Spectator result")}
                            </div>
                            <div className="mt-2 text-sm text-stone-200/72">
                              {resultDebrief?.detail ??
                                (selectedPlacement === 1
                                  ? "You converted the frontier run and locked the settlement."
                                  : selectedPlacement
                                    ? "The agent ledger updates with this finish, score, and treasury result."
                                    : "You were not fielded in this showdown, but the result is now archived.")}
                            </div>
                            {selectedResultPlayer && (
                              <div className="mt-3 grid gap-2 text-[10px] uppercase tracking-[0.16em] text-stone-300/58 sm:grid-cols-2">
                                <span className="rounded-full border border-white/8 px-2.5 py-1">
                                  {selectedResultPlayer.kills} kills
                                </span>
                                <span className="rounded-full border border-white/8 px-2.5 py-1">
                                  {selectedResultPlayer.damageDealt} damage
                                </span>
                                <span className="rounded-full border border-white/8 px-2.5 py-1">
                                  {selectedResultAccuracy !== null
                                    ? `${selectedResultAccuracy}% accuracy`
                                    : "No shot data"}
                                </span>
                                <span className="rounded-full border border-white/8 px-2.5 py-1">
                                  {selectedResultPlayer.alive
                                    ? `${selectedResultPlayer.health} health left`
                                    : "Eliminated"}
                                </span>
                              </div>
                            )}
                            {matchEconomy && (
                              <div className="mt-3 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.16em] text-stone-300/58">
                                <span className="rounded-full border border-white/8 px-2.5 py-1">
                                  Pot {formatWeiToOkb(matchEconomy.totalPot)}
                                </span>
                                <span className="rounded-full border border-white/8 px-2.5 py-1">
                                  Winner {formatWeiToOkb(matchEconomy.winnerPayout)}
                                </span>
                                <span className="rounded-full border border-white/8 px-2.5 py-1">
                                  Treasury {formatWeiToOkb(matchEconomy.treasuryCut)}
                                </span>
                              </div>
                            )}
                            <div className="mt-3 rounded-[16px] border border-white/8 bg-white/[0.03] px-3 py-3 text-sm text-stone-200/74">
                              <div className="text-[10px] uppercase tracking-[0.18em] text-stone-300/52">
                                Next approved action
                              </div>
                              <div className="mt-1 font-medium text-[#f6ead7]">
                                {resultDebrief?.nextAction ??
                                  "Queue another run or compound the next skill purchase."}
                              </div>
                            </div>
                          </div>
                          <div className="rounded-[22px] border border-white/8 bg-black/20 px-4 py-4">
                            <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--accent-soft)]/70">
                              {resultCareerPulse.eyebrow}
                            </div>
                            <div className="mt-2 text-lg font-semibold text-[#f6ead7]">
                              {resultCareerPulse.title}
                            </div>
                            <div className="mt-2 text-sm text-stone-200/72">
                              {resultCareerPulse.detail}
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.16em] text-stone-300/58">
                              {resultCareerPulse.chips.map((chip) => (
                                <span
                                  key={chip}
                                  className="rounded-full border border-white/8 px-2.5 py-1"
                                >
                                  {chip}
                                </span>
                              ))}
                            </div>
                          </div>
                          <div className="rounded-[22px] border border-white/8 bg-black/20 px-4 py-4">
                            <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--accent-soft)]/70">
                              Match Medals
                            </div>
                            <div className="mt-3 grid gap-2">
                              {resultMedals.map((medal) => (
                                <div
                                  key={medal.label}
                                  className="rounded-[14px] border border-white/6 bg-white/[0.03] px-3 py-2"
                                >
                                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#f0bf76]">
                                    {medal.label}
                                  </div>
                                  <div className="mt-1 text-sm text-stone-200/72">
                                    {medal.detail}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>

                      {matchEconomy && (
                        <div className="mt-8 rounded-[22px] border border-[var(--panel-border)] bg-black/20 px-5 py-4 text-left">
                          <div className="text-[10px] uppercase tracking-[0.24em] text-[var(--accent-soft)]/65">
                            X Layer Settlement
                          </div>
                          <div className="mt-3 grid gap-2 text-sm text-[var(--foreground)]/78 md:grid-cols-3">
                            <div>
                              Pot:{" "}
                              <span className="font-semibold text-[var(--foreground)]">
                                {formatWeiToOkb(matchEconomy.totalPot)}
                              </span>
                            </div>
                            <div>
                              Winner:{" "}
                              <span className="font-semibold text-[var(--accent-soft)]">
                                {formatWeiToOkb(matchEconomy.winnerPayout)}
                              </span>
                            </div>
                            <div>
                              Treasury:{" "}
                              <span className="font-semibold text-[var(--foreground)]">
                                {formatWeiToOkb(matchEconomy.treasuryCut)}
                              </span>
                            </div>
                          </div>
                          {settlementExplorerUrl && snapshot.settlementTxHash && (
                            <a
                              href={settlementExplorerUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="pointer-events-auto mt-4 inline-flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-[var(--accent-soft)] transition hover:text-[var(--foreground)]"
                            >
                              Settlement {truncateHash(snapshot.settlementTxHash)}
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          )}
                        </div>
                      )}
                      <div className="pointer-events-auto mt-6 flex flex-wrap justify-center gap-3">
                        {selectedAgent && (
                          <button
                            type="button"
                            onClick={() =>
                              void handleQueue(
                                autonomyPlan?.recommendedQueue === "paid",
                              )
                            }
                            disabled={busyAction !== null || queueLocked}
                            className="rounded-full border border-amber-300/25 bg-amber-100/10 px-4 py-2 text-xs uppercase tracking-[0.16em] text-[#f6ead7] transition hover:bg-amber-100/16 disabled:opacity-45"
                          >
                            {autonomyPlan?.recommendedQueue === "paid"
                              ? "Run Paid Again"
                              : "Run Practice Again"}
                          </button>
                        )}
                        {autonomyPlan && (
                          <button
                            type="button"
                            onClick={() => void handleBuySkill(autonomyPlan.nextSkill)}
                            disabled={buyDisabled}
                            className="rounded-full border border-white/12 bg-white/6 px-4 py-2 text-xs uppercase tracking-[0.16em] text-white/80 transition hover:border-white/20 hover:bg-white/10 disabled:opacity-45"
                          >
                            Buy {skillLabels[autonomyPlan.nextSkill]}
                          </button>
                        )}
                        {!autonomyPlan?.autonomyPassActive && selectedAgent && (
                          <button
                            type="button"
                            onClick={handleAutonomyPass}
                            disabled={busyAction !== null}
                            className="rounded-full border border-[#df6c39]/25 bg-[#df6c39]/10 px-4 py-2 text-xs uppercase tracking-[0.16em] text-[#ffd0ae] transition hover:bg-[#df6c39]/16 disabled:opacity-45"
                          >
                            Unlock Premium
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                  </div>
                </div>
              )}
              {snapshot?.status === "in_progress" && scoreboardPlayers.length > 0 && (
                <div className="pointer-events-none absolute bottom-3 right-3 z-10 w-48">
                  <div className="rounded-2xl border border-white/10 bg-black/55 p-3 backdrop-blur">
                    <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-[0.22em] text-amber-100/55">
                      <span>Standings</span>
                      <span className="text-stone-300/50">{roundClockLabel}</span>
                    </div>
                    {scoreboardPlayers.map((player, i) => (
                      <div key={player.agentId} className="flex items-center gap-2 py-[3px]">
                        <span className="w-4 shrink-0 text-[10px] text-stone-400/50">{i + 1}</span>
                        <div
                          className={`h-2 w-2 shrink-0 rounded-full ${
                            player.agentId === selectedAgent?.id
                              ? "bg-[#9ce9ff]"
                              : player.alive
                                ? "bg-[#7ed2b4]"
                                : "bg-white/18"
                          }`}
                        />
                        <span className="flex-1 truncate text-[11px] text-[#f6ead7]">{player.displayName}</span>
                        <span className="shrink-0 text-[10px] text-stone-300/55">{player.health}hp</span>
                        <span className="shrink-0 text-[10px] font-semibold text-[#f0bf76]">{player.score}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-end justify-between gap-3 p-6 bg-gradient-to-t from-black/80 via-black/20 to-transparent">
                {selectedSnapshotPlayer?.alive ? (
                  <div className="flex items-end gap-6">
                    {/* HUD Portrait */}
                    <div className="relative h-24 w-24 overflow-hidden rounded-[16px] border-2 border-[var(--panel-border)] bg-[#0d0a08] shadow-[0_0_24px_rgba(0,0,0,0.6)]">
                      <img src="/agents/placeholder.png" alt="Agent" className="h-full w-full object-cover" />
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black to-transparent p-2 text-center text-[10px] font-bold uppercase tracking-widest text-[var(--accent-soft)]">
                        {selectedSnapshotPlayer.displayName}
                      </div>
                    </div>
                    {/* HUD Bars */}
                    <div className="flex flex-col gap-3 pb-1">
                      <div className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.24em] text-[var(--accent-soft)]/75">
                        Dust Ring
                        <span className="rounded-full border border-[var(--panel-border)] px-2 py-1 text-[9px] text-[var(--foreground)]/72">
                          {safeZoneLabel}
                        </span>
                      </div>
                      {snapshot?.objective && (
                        <div className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.22em] text-[#df6c39]/78">
                          {snapshot.objective.label}
                          <span className="rounded-full border border-[#df6c39]/25 px-2 py-1 text-[9px] text-[#ffd0ae]">
                            {objectiveTimerLabel ?? "Live"}
                          </span>
                        </div>
                      )}
                      <div className="flex items-center gap-3">
                        <span className="w-10 text-[10px] font-bold uppercase tracking-widest text-[#7ed2b4]/70">Health</span>
                        <div className="relative h-3 w-48 overflow-hidden rounded bg-black/60 shadow-inner">
                          <div className="absolute inset-0 bg-[var(--circuit-line)] opacity-20" />
                          <div
                            className="h-full transition-all ease-out"
                            style={{
                              width: `${Math.max(0, selectedSnapshotPlayer.health)}%`,
                              backgroundColor: selectedHealthBarTone,
                              boxShadow: `0 0 8px ${selectedHealthBarTone}`,
                            }}
                          />
                        </div>
                        <span
                          className="w-8 text-sm font-black drop-shadow-[0_0_4px_rgba(126,210,180,0.5)]"
                          style={{ color: selectedHealthBarTone }}
                        >
                          {selectedSnapshotPlayer.health}
                        </span>
                      </div>
                      
                      <div className="flex items-center gap-3">
                        <span className="w-10 text-[10px] font-bold uppercase tracking-widest text-[var(--accent-soft)]/70">Ammo</span>
                        <div className="flex h-3 w-48 gap-1 rounded bg-black/60 p-0.5">
                           {[...Array(6)].map((_, i) => (
                             <div 
                               key={i} 
                               className={`flex-1 rounded-sm transition-colors ${i < selectedSnapshotPlayer.ammo ? "bg-[var(--accent-soft)] shadow-[0_0_8px_rgba(244,200,133,0.4)]" : "bg-transparent border border-white/10"}`} 
                             />
                           ))}
                        </div>
                        <span className="w-20 text-right text-sm font-black text-[var(--accent-soft)] drop-shadow-[0_0_4px_rgba(244,200,133,0.5)]">
                          {selectedSnapshotPlayer.isReloading ? "Reload" : selectedSnapshotPlayer.ammo}
                        </span>
                      </div>
                      {selectedThreat && (
                        <div className="text-xs text-stone-200/76">
                          Nearest threat:{" "}
                          <span className="font-semibold text-[#f6ead7]">
                            {selectedThreat.player.displayName}
                          </span>{" "}
                          • {Math.round(selectedThreat.distance)}px
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="pointer-events-auto rounded-2xl border border-[var(--panel-border)]/50 bg-[var(--panel)] px-5 py-4 text-xs shadow-[0_10px_40px_rgba(0,0,0,0.5)] backdrop-blur-md">
                    <div className="font-bold uppercase tracking-[0.2em] text-[var(--accent-soft)]">
                      {snapshot?.status === "in_progress" ? "Spectating Module Active" : "Arena Systems Offline"}
                    </div>
                    <div className="mt-1.5 text-[var(--foreground)]/70">
                      {selectedAgent?.mode === "manual"
                        ? snapshot?.status === "in_progress"
                          ? "Your rider is not in this showdown."
                          : "Awaiting valid operational status."
                        : "Switch to manual mode to engage controls."}
                    </div>
                    {snapshot?.status === "in_progress" && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setSpectatorFollowLeader((current) => !current)}
                          className="rounded-full border border-white/12 px-3 py-2 text-[10px] uppercase tracking-[0.18em] text-white/80 transition hover:border-white/24 hover:text-white"
                        >
                          {spectatorFollowLeader ? "Leader Cam On" : "Leader Cam"}
                        </button>
                        {arenaFocusPlayer && (
                          <span className="rounded-full border border-[#7ed2b4]/18 bg-[#7ed2b4]/10 px-3 py-2 text-[10px] uppercase tracking-[0.18em] text-[#c5f4e9]">
                            Focus {arenaFocusPlayer.displayName}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}
                
                <button
                  type="button"
                  onClick={() => void handleArenaFullscreenToggle()}
                  className="pointer-events-auto flex items-center gap-2 rounded-full border border-[var(--panel-border)] bg-[var(--panel)] px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-[var(--foreground)] backdrop-blur-md transition hover:border-[var(--accent-soft)] hover:text-[var(--accent-soft)]"
                >
                  {arenaFullscreen ? (
                    <Minimize className="h-4 w-4" />
                  ) : (
                    <Expand className="h-4 w-4" />
                  )}
                  {arenaFullscreen ? "Exit" : "Expand"}
                </button>
              </div>
              <ArenaCanvas
                snapshot={snapshot}
                selectedAgentId={arenaFocusAgentId}
                canControl={
                  selectedAgent?.mode === "manual" &&
                  snapshot?.status === "in_progress" &&
                  Boolean(selectedSnapshotPlayer?.alive)
                }
                onCommand={handleArenaCommand}
                onControlReadyChange={setArenaReadyForControls}
              />
            </div>
            <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
              <div className="rounded-[24px] border border-white/8 bg-black/10 p-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.16em] text-stone-300/58">
                      <span className="rounded-full border border-white/8 px-2.5 py-1">
                        {arenaPhaseLabel}
                      </span>
                      <span className="rounded-full border border-white/8 px-2.5 py-1">
                        {roundClockLabel}
                      </span>
                      <span className="rounded-full border border-white/8 px-2.5 py-1">
                        {safeZoneLabel}
                      </span>
                      <span className="rounded-full border border-white/8 px-2.5 py-1">
                        {matchEconomy ? formatWeiToOkb(matchEconomy.totalPot) : "Practice"}
                      </span>
                    </div>
                    <div className="grid gap-2 text-xs text-stone-200/72 sm:grid-cols-2 xl:grid-cols-4">
                      <div className="rounded-[16px] border border-white/8 bg-black/14 px-3 py-2">
                        Next call:{" "}
                        <span className="text-[#f6ead7]">{battleDirective.title}</span>
                      </div>
                      <div className="rounded-[16px] border border-white/8 bg-black/14 px-3 py-2">
                        Pressure:{" "}
                        <span className="text-[#f6ead7]">
                          {selectedRingState?.outside
                            ? `Outside ring • ${selectedRingState.distanceFromEdge}px`
                            : selectedThreat
                              ? `${selectedThreat.player.displayName} • ${Math.round(selectedThreat.distance)}px`
                              : snapshot?.objective
                                ? `${snapshot.objective.label}${objectiveTimerLabel ? ` • ${objectiveTimerLabel}` : ""}`
                                : snapshot?.caravan
                                  ? `${snapshot.caravan.label} • moving target`
                                : "No live threat tagged"}
                        </span>
                      </div>
                      <div className="rounded-[16px] border border-white/8 bg-black/14 px-3 py-2">
                        Position:{" "}
                        <span className="text-[#f6ead7]">
                          {selectedSnapshotPlayer?.coverLabel
                            ? `${selectedSnapshotPlayer.coverLabel} • ${selectedSnapshotPlayer.coverBonus ?? 0}% cover`
                            : "Open ground"}
                        </span>
                      </div>
                      <div className="rounded-[16px] border border-white/8 bg-black/14 px-3 py-2">
                        Last impact:{" "}
                        <span className="text-[#f6ead7]">
                          {selectedPlayerEvent?.message ?? "No direct contact yet."}
                        </span>
                      </div>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                      {selectedAgent?.mode === "manual" ? (
                        <>
                          <BattleChip
                            icon={<Crosshair className="h-3.5 w-3.5" />}
                            label="Aim"
                            detail="Cursor sets the shot target."
                          />
                          <BattleChip
                            icon={<Sword className="h-3.5 w-3.5" />}
                            label="Fire"
                            detail="Click to take the shot."
                          />
                          <BattleChip
                            icon={<RadioTower className="h-3.5 w-3.5" />}
                            label="Dodge"
                            detail="Space for an escape burst."
                          />
                          <BattleChip
                            icon={<RotateCcw className="h-3.5 w-3.5" />}
                            label="Reload"
                            detail="Press R before the chamber goes dry."
                          />
                        </>
                      ) : (
                        <div className="sm:col-span-2 xl:col-span-4">
                          <BattleChip
                            icon={<Bot className="h-3.5 w-3.5" />}
                            label="Autopilot"
                            detail="This rider is fighting on its own. Watch the cyan YOU marker and the live calls; switch to manual if you want direct control."
                          />
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 rounded-[18px] border border-white/8 bg-black/20 p-3">
                    <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-stone-300/50">
                      Quick controls
                    </div>
                    <div className="mb-3 text-[11px] leading-relaxed text-stone-200/68">
                      Your rider is the bright cyan marker tagged <span className="font-semibold text-[#9ce9ff]">YOU</span>.
                    </div>
                    <div className="grid w-[96px] grid-cols-3 gap-1">
                      <span />
                      <button
                        type="button"
                        onMouseDown={() => startDirectionalMove(0, -1)}
                        onMouseUp={stopDirectionalMove}
                        onMouseLeave={stopDirectionalMove}
                        onTouchStart={() => startDirectionalMove(0, -1)}
                        onTouchEnd={stopDirectionalMove}
                        className="rounded-lg border border-white/10 bg-white/6 px-2 py-1.5 text-[11px] text-white/80 transition hover:border-white/25 hover:bg-white/10 active:bg-white/15"
                      >
                        W
                      </button>
                      <span />
                      <button
                        type="button"
                        onMouseDown={() => startDirectionalMove(-1, 0)}
                        onMouseUp={stopDirectionalMove}
                        onMouseLeave={stopDirectionalMove}
                        onTouchStart={() => startDirectionalMove(-1, 0)}
                        onTouchEnd={stopDirectionalMove}
                        className="rounded-lg border border-white/10 bg-white/6 px-2 py-1.5 text-[11px] text-white/80 transition hover:border-white/25 hover:bg-white/10 active:bg-white/15"
                      >
                        A
                      </button>
                      <button
                        type="button"
                        onMouseDown={() => startDirectionalMove(0, 1)}
                        onMouseUp={stopDirectionalMove}
                        onMouseLeave={stopDirectionalMove}
                        onTouchStart={() => startDirectionalMove(0, 1)}
                        onTouchEnd={stopDirectionalMove}
                        className="rounded-lg border border-white/10 bg-white/6 px-2 py-1.5 text-[11px] text-white/80 transition hover:border-white/25 hover:bg-white/10 active:bg-white/15"
                      >
                        S
                      </button>
                      <button
                        type="button"
                        onMouseDown={() => startDirectionalMove(1, 0)}
                        onMouseUp={stopDirectionalMove}
                        onMouseLeave={stopDirectionalMove}
                        onTouchStart={() => startDirectionalMove(1, 0)}
                        onTouchEnd={stopDirectionalMove}
                        className="rounded-lg border border-white/10 bg-white/6 px-2 py-1.5 text-[11px] text-white/80 transition hover:border-white/25 hover:bg-white/10 active:bg-white/15"
                      >
                        D
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={handleReloadAction}
                      className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-amber-300/20 bg-amber-100/8 px-2 py-1.5 text-[11px] text-[#f6ead7] transition hover:bg-amber-100/14"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Reload
                    </button>
                  </div>
                </div>
              </div>
              <div className="rounded-[24px] border border-[var(--panel-border)] bg-black/20 p-4 shadow-[inset_0_2px_20px_rgba(0,0,0,0.5)]">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="font-[var(--font-heading)] text-base font-bold text-[var(--foreground)]">
                    Field Intel
                  </p>
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--circuit-line)]">
                    Live
                  </span>
                </div>
                <ArenaMinimap
                  snapshot={snapshot}
                  selectedAgentId={arenaFocusAgentId}
                />
                <div className="mt-3 grid gap-2">
                  <IntelLegendRow
                    icon={<Gem className="h-3.5 w-3.5" />}
                    label="Supply Drop"
                    detail="Orange flare. Ride through it for health, ammo, and score."
                  />
                  <IntelLegendRow
                    icon={<Landmark className="h-3.5 w-3.5" />}
                    label="Stagecoach"
                    detail="Moving coach. Cut across its path for ammo and bonus score."
                  />
                  <IntelLegendRow
                    icon={<Sword className="h-3.5 w-3.5" />}
                    label="Bounty"
                    detail="Marked rider. Drop them for bonus score, or kite if the mark is on you."
                  />
                  <IntelLegendRow
                    icon={<ShieldPlus className="h-3.5 w-3.5" />}
                    label="Dust Ring"
                    detail="Stay inside the circle. Outside it, the storm burns health every tick."
                  />
                </div>
                <div className="mt-3 space-y-2">
                  {criticalEvents.length === 0 ? (
                    <EmptyState
                      label="The next supply drop, stagecoach run, bounty call, or elimination will show up here."
                      compact
                    />
                  ) : (
                    criticalEvents.slice(-3).map((event) => (
                      <div
                        key={event.id}
                        className={`rounded-[16px] border px-3 py-2 ${getEventToneClasses(event.type)}`}
                      >
                        <div className="text-[10px] uppercase tracking-[0.18em] opacity-70">
                          {formatEventTypeLabel(event.type)}
                        </div>
                        <div className="mt-1 text-xs">
                          {event.message}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </section>


      <section className="western-card order-3 rounded-[30px] border p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-amber-100/55">
              Observer
            </p>
            <h2 className="mt-1 text-2xl font-semibold text-[#f6ead7]">
              Live Frontier
            </h2>
          </div>
          <button
            type="button"
            onClick={async () => {
              const response = await fetchLiveMatches();
              setLiveMatches(response.matches);
            }}
            className="rounded-full border border-white/12 px-4 py-2 text-sm text-white/75 transition hover:border-white/22 hover:text-white"
          >
            Refresh
          </button>
        </div>
        {spotlightMatch && (
          <div className="mb-4 rounded-[24px] border border-[#7ed2b4]/14 bg-[#7ed2b4]/6 px-4 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-[0.2em] text-[#7ed2b4]/70">
                  Live Spotlight
                </div>
                <div className="mt-1 text-lg font-semibold text-[#f6ead7]">
                  Match {spotlightMatch.matchId.slice(-6)} • {spotlightMatch.paid ? "Paid" : "Practice"}
                </div>
                <div className="mt-1 text-sm text-stone-200/72">
                  {spotlightMatch.players[0]
                    ? `${spotlightMatch.players[0].displayName} and the field are active in the dust circuit.`
                    : "A live frontier round is available to spectate."}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => handleSpectateMatch(spotlightMatch)}
                  disabled={!canSpectateLiveMatch || !authToken}
                  className="rounded-full border border-white/12 px-4 py-2 text-xs uppercase tracking-[0.18em] text-white/80 transition hover:border-white/24 hover:text-white disabled:opacity-50"
                >
                  Watch Spotlight
                </button>
                <button
                  type="button"
                  onClick={() => handleSpectateMatch(spotlightMatch, { followLeader: true })}
                  disabled={!canSpectateLiveMatch || !authToken}
                  className="rounded-full border border-[#7ed2b4]/25 bg-[#7ed2b4]/10 px-4 py-2 text-xs uppercase tracking-[0.18em] text-[#c5f4e9] transition hover:bg-[#7ed2b4]/16 disabled:opacity-50"
                >
                  Leader Cam
                </button>
              </div>
            </div>
          </div>
        )}
        <div className="space-y-3">
          {sortedLiveMatches.length === 0 && (
            <EmptyState label="No public matches are live right now." />
          )}
          {sortedLiveMatches.map((match, index) => (
            <div
              key={match.matchId}
              className="rounded-[22px] border border-white/8 bg-black/10 p-4"
            >
              <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-sm font-semibold text-[#f6ead7]">
                      Match {match.matchId.slice(-6)}
                    </div>
                    <span className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-stone-200/65">
                      {match.paid ? "paid" : "practice"}
                    </span>
                    <span className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-stone-200/65">
                      {index === 0 ? "spotlight" : match.status}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-3 text-[11px] uppercase tracking-[0.16em] text-stone-300/55">
                    <span>
                      Riders{" "}
                      <span className="text-[#f6ead7]">{match.players.length}</span>
                    </span>
                    <span>
                      Auto{" "}
                      <span className="text-[#f6ead7]">
                        {match.players.filter((player) => player.mode === "autonomous").length}
                      </span>
                    </span>
                    <span>
                      Ring <span className="text-[#f6ead7]">{Math.round(match.safeZone.radius)}px</span>
                    </span>
                    <span>
                      Pot{" "}
                      <span className="text-[#f6ead7]">
                        {match.paid
                          ? formatWeiToOkb(matchEntryFeeWei * BigInt(match.players.length))
                          : "Practice"}
                      </span>
                    </span>
                    <span>
                      Leader{" "}
                      <span className="text-[#f6ead7]">
                        {(() => {
                          const leader = [...match.players].sort(
                            (left, right) => right.score - left.score,
                          )[0];
                          return leader?.displayName ?? "—";
                        })()}
                      </span>
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => handleSpectateMatch(match)}
                    disabled={!canSpectateLiveMatch || !authToken}
                    className="rounded-full border border-white/12 px-4 py-2 text-xs uppercase tracking-[0.18em] text-white/80 transition hover:border-white/24 hover:text-white disabled:opacity-50"
                  >
                    Watch
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSpectateMatch(match, { followLeader: true })}
                    disabled={!canSpectateLiveMatch || !authToken}
                    className="rounded-full border border-[#7ed2b4]/20 bg-[#7ed2b4]/8 px-4 py-2 text-xs uppercase tracking-[0.18em] text-[#c5f4e9] transition hover:bg-[#7ed2b4]/14 disabled:opacity-50"
                  >
                    Leader Cam
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
      {txReveals.length > 0 && (
        <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[min(360px,calc(100vw-2rem))] flex-col gap-3">
          {txReveals.map((item) => (
            <div
              key={item.id}
              className="pointer-events-auto overflow-hidden rounded-[22px] border border-emerald-200/18 bg-[linear-gradient(180deg,rgba(16,24,20,0.96),rgba(8,10,9,0.98))] shadow-[0_24px_80px_rgba(0,0,0,0.55)] backdrop-blur"
            >
              <div className="flex items-start justify-between gap-3 border-b border-white/6 px-4 py-3">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.24em] text-emerald-200/65">
                    X Layer Confirmed
                  </div>
                  <div className="mt-1 text-sm font-semibold text-[#f6ead7]">
                    {item.headline}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => dismissTxReveal(item.id)}
                  className="rounded-full border border-white/10 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-stone-200/60 transition hover:border-white/20 hover:text-white"
                >
                  Dismiss
                </button>
              </div>
              <div className="space-y-3 px-4 py-3 text-sm text-stone-200/74">
                <p>{item.detail}</p>
                <div className="flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.18em] text-stone-300/52">
                  <span>{truncateHash(item.receipt.txHash)}</span>
                  {item.receipt.explorerUrl ? (
                    <a
                      href={item.receipt.explorerUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-emerald-200 transition hover:text-white"
                    >
                      Explorer
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : (
                    <span>Recorded</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  </main>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[22px] border border-white/8 bg-black/10 px-4 py-3">
      <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-stone-300/58">
        {icon}
        {label}
      </div>
      <div className="line-clamp-2 text-xs leading-relaxed text-[#f6ead7]">{value}</div>
    </div>
  );
}

function ArenaMinimap({
  snapshot,
  selectedAgentId,
}: {
  snapshot: MatchSnapshot | null;
  selectedAgentId?: string;
}) {
  if (!snapshot) {
    return <EmptyState label="Queue a match to view the live arena map." compact />;
  }

  return (
    <div className="rounded-[22px] border border-white/8 bg-[#170f0b] p-3">
      <div className="relative aspect-[16/9] overflow-hidden rounded-[18px] border border-amber-300/10 bg-[radial-gradient(circle_at_top,_rgba(236,183,102,0.12),_transparent_48%),linear-gradient(180deg,_rgba(52,32,22,0.95),_rgba(19,11,8,0.98))]">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(244,227,199,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(244,227,199,0.06)_1px,transparent_1px)] bg-[size:32px_32px]" />
        {[
          { left: "17%", top: "18%", label: "Saloon" },
          { left: "81%", top: "18%", label: "Hotel" },
          { left: "16%", top: "81%", label: "Wash" },
          { left: "82%", top: "80%", label: "Stable" },
          { left: "65%", top: "25%", label: "Water" },
        ].map((landmark) => (
          <div
            key={landmark.label}
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/8 bg-black/18 px-2 py-1 text-[9px] uppercase tracking-[0.12em] text-stone-200/58"
            style={{ left: landmark.left, top: landmark.top }}
          >
            {landmark.label}
          </div>
        ))}
        <div
          className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-[var(--accent-soft)]/45 bg-[radial-gradient(circle,_rgba(244,200,133,0.08)_0%,_rgba(244,200,133,0.02)_55%,_transparent_72%)] shadow-[0_0_24px_rgba(244,200,133,0.12)]"
          style={{
            left: `${(snapshot.safeZone.centerX / 1600) * 100}%`,
            top: `${(snapshot.safeZone.centerY / 900) * 100}%`,
            width: `${(snapshot.safeZone.radius * 2 / 1600) * 100}%`,
            height: `${(snapshot.safeZone.radius * 2 / 900) * 100}%`,
          }}
        />
        {snapshot.pickups.map((pickup) => {
          const left = `${(pickup.x / 1600) * 100}%`;
          const top = `${(pickup.y / 900) * 100}%`;
          return (
            <div
              key={pickup.id}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left, top }}
            >
              <div
                className={`flex h-3.5 w-3.5 items-center justify-center rounded-sm border text-[8px] font-bold ${
                  pickup.type === "health"
                    ? "border-[#f8e3b4]/60 bg-[#f0bf76]/70 text-[#20120b]"
                    : "border-amber-200/40 bg-[#df6c39]/75 text-white"
                }`}
              >
                {pickup.type === "health" ? "+" : "A"}
              </div>
            </div>
          );
        })}
        {snapshot.objective && (
          <div
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{
              left: `${(snapshot.objective.x / 1600) * 100}%`,
              top: `${(snapshot.objective.y / 900) * 100}%`,
            }}
          >
            <div className="flex h-5 w-5 items-center justify-center rounded-full border border-[#ffd0ae]/80 bg-[#df6c39]/85 text-[9px] font-black text-[#1b0f0a] shadow-[0_0_18px_rgba(223,108,57,0.45)]">
              !
            </div>
          </div>
        )}
        {snapshot.caravan && (
          <div
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{
              left: `${(snapshot.caravan.x / 1600) * 100}%`,
              top: `${(snapshot.caravan.y / 900) * 100}%`,
            }}
          >
            <div className="flex h-5.5 w-5.5 items-center justify-center rounded-md border border-[#f6c27a]/80 bg-[#5a3826]/92 text-[9px] font-black text-[#f6ead7] shadow-[0_0_14px_rgba(240,191,118,0.28)]">
              $
            </div>
          </div>
        )}
        {snapshot.players.map((player) => {
          const left = `${(player.x / 1600) * 100}%`;
          const top = `${(player.y / 900) * 100}%`;
          const isSelected = player.agentId === selectedAgentId;
          const isBounty = snapshot.bounty?.targetAgentId === player.agentId;
          return (
            <div
              key={player.agentId}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left, top }}
            >
              <div
                className={`rounded-full border ${
                  isSelected
                    ? "h-4 w-4 border-[#f8e3b4] bg-[#f0bf76] shadow-[0_0_18px_rgba(240,191,118,0.45)]"
                    : isBounty
                      ? "h-4 w-4 border-[#ffd0ae] bg-[#df6c39] shadow-[0_0_16px_rgba(223,108,57,0.4)]"
                    : player.alive
                      ? "h-3 w-3 border-white/30 bg-[#7ed2b4]"
                    : "h-3 w-3 border-white/10 bg-white/20"
                }`}
              />
              {isSelected && (
                <div className="absolute left-1/2 top-full mt-1 -translate-x-1/2 rounded-full border border-[#9ce9ff]/40 bg-[#9ce9ff]/16 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.14em] text-[#dff9ff]">
                  You
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function QuickBriefRow({
  step,
  title,
  body,
}: {
  step: string;
  title: string;
  body: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-[18px] border border-white/8 bg-black/14 px-3 py-3">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-amber-300/20 bg-amber-100/10 text-[10px] font-bold uppercase tracking-[0.18em] text-[#f0bf76]">
        {step}
      </div>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-[#f6ead7]">{title}</div>
        <div className="mt-1 text-sm text-stone-200/72">{body}</div>
      </div>
    </div>
  );
}

function BattleChip({
  icon,
  label,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  detail: string;
}) {
  return (
    <div className="rounded-[16px] border border-white/8 bg-black/14 px-3 py-2.5 text-stone-200/72">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-stone-300/60">
        <span className="text-[#f0bf76]">{icon}</span>
        {label}
      </div>
      <div className="mt-1 text-xs">{detail}</div>
    </div>
  );
}

function ConsoleTabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-2 text-xs uppercase tracking-[0.18em] transition ${
        active
          ? "border-amber-300/28 bg-amber-100/12 text-[#f6ead7]"
          : "border-white/10 bg-white/4 text-stone-200/68 hover:border-white/20 hover:text-white"
      }`}
    >
      {label}
    </button>
  );
}

function ScoreboardTable({
  players,
  selectedAgentId,
  winnerAgentId,
}: {
  players: MatchSnapshot["players"];
  selectedAgentId?: string;
  winnerAgentId: string | null;
}) {
  if (players.length === 0) {
    return <EmptyState label="No riders in the current scoreboard yet." compact />;
  }

  return (
    <div className="overflow-hidden rounded-[20px] border border-white/8">
      <div className="grid grid-cols-[28px_minmax(0,1fr)_44px_40px_56px] gap-x-2 bg-white/6 px-3 py-2.5 text-[10px] uppercase tracking-[0.16em] text-stone-300/55">
        <span>#</span>
        <span>Rider</span>
        <span>HP</span>
        <span>K</span>
        <span>Score</span>
      </div>
      <div className="divide-y divide-white/6">
        {players.map((player, index) => (
          <div
            key={player.agentId}
            className={`grid grid-cols-[28px_minmax(0,1fr)_44px_40px_56px] gap-x-2 px-3 py-2.5 text-sm ${
              player.agentId === winnerAgentId
                ? "bg-amber-100/8"
                : player.agentId === selectedAgentId
                  ? "bg-[#7ed2b4]/8"
                  : "bg-black/10"
            }`}
          >
            <span className="text-xs text-stone-300/60">{index + 1}</span>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-[#f6ead7]">
                {player.displayName}
              </div>
              <div className="text-[10px] text-stone-300/50">
                {player.agentId === winnerAgentId
                  ? "Winner"
                  : player.alive
                    ? "alive"
                    : "out"}
              </div>
            </div>
            <span className="self-center text-xs text-stone-200/70">{player.health}</span>
            <span className="self-center text-xs text-stone-200/70">{player.kills}</span>
            <span className="self-center text-sm font-semibold text-[#f0bf76]">{player.score}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function IntelLegendRow({
  icon,
  label,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  detail: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-[16px] border border-white/8 bg-black/14 px-3 py-3">
      <div className="mt-0.5 rounded-full border border-white/10 bg-white/6 p-2 text-[var(--accent-soft)]">
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-300/58">
          {label}
        </div>
        <div className="mt-1 text-xs leading-relaxed text-stone-200/74">
          {detail}
        </div>
      </div>
    </div>
  );
}

function EmptyState({
  label,
  compact = false,
}: {
  label: string;
  compact?: boolean;
}) {
  return (
    <div
      className={`rounded-[24px] border border-dashed border-white/10 bg-white/4 text-center text-stone-300/66 ${compact ? "px-3 py-4 text-sm" : "px-5 py-8 text-sm"}`}
    >
      {label}
    </div>
  );
}

function truncateAddress(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function truncateHash(value: string) {
  return `${value.slice(0, 10)}…${value.slice(-8)}`;
}

function formatReceiptPurpose(value: OnchainReceipt["purpose"]) {
  switch (value) {
    case "agent_registration":
      return "Agent Registration";
    case "skill_purchase":
      return "Skill Purchase";
    case "match_entry":
      return "Match Entry";
    case "match_settlement":
      return "Match Settlement";
    case "autonomy_pass":
      return "Autonomy Pass";
  }
}

function formatReceiptRevealDetail(receipt: OnchainReceipt) {
  switch (receipt.purpose) {
    case "agent_registration":
      return "Your agent identity is live on X Layer and ready for paid frontier actions.";
    case "skill_purchase":
      return "The skill upgrade has been recorded onchain and synced into the loadout.";
    case "match_entry":
      return receipt.matchId
        ? `Paid entry for match ${receipt.matchId.slice(-6)} is confirmed onchain.`
        : "Paid showdown entry is confirmed onchain.";
    case "match_settlement":
      return "Match rewards were settled on X Layer and the final ledger is locked.";
    case "autonomy_pass":
      return "Autonomous premium access has been confirmed.";
  }
}

function ordinal(value: number) {
  const remainder = value % 100;
  if (remainder >= 11 && remainder <= 13) {
    return `${value}th`;
  }

  switch (value % 10) {
    case 1:
      return `${value}st`;
    case 2:
      return `${value}nd`;
    case 3:
      return `${value}rd`;
    default:
      return `${value}th`;
  }
}

function formatEventTypeLabel(value: MatchEvent["type"]) {
  switch (value) {
    case "announcement":
      return "Arena Call";
    case "autonomy":
      return "Directive";
    case "objective":
      return "Objective";
    case "bounty":
      return "Bounty";
    case "caravan":
      return "Stagecoach";
    case "elimination":
      return "Elimination";
    case "timeout":
      return "Time Call";
    case "settled":
      return "Settlement";
    case "pickup":
      return "Supply";
    case "fire":
      return "Shot";
    case "hit":
      return "Hit";
    case "reload":
      return "Reload";
    case "dodge":
      return "Dodge";
    case "spawn":
      return "Spawn";
    case "move":
      return "Move";
  }
}

function getEventToneClasses(value: MatchEvent["type"]) {
  switch (value) {
    case "announcement":
    case "objective":
      return "border-[#df6c39]/20 bg-[#df6c39]/8 text-[#ffd9c8]";
    case "bounty":
      return "border-[#f0bf76]/20 bg-[#f0bf76]/8 text-[#ffe6c7]";
    case "caravan":
      return "border-[#9ce9ff]/20 bg-[#9ce9ff]/8 text-[#dcf7ff]";
    case "elimination":
    case "timeout":
      return "border-amber-300/20 bg-amber-100/8 text-[#f6ead7]";
    case "settled":
      return "border-[#7ed2b4]/20 bg-[#7ed2b4]/8 text-[#d7f5ec]";
    case "autonomy":
      return "border-sky-300/18 bg-sky-100/8 text-sky-50";
    default:
      return "border-white/7 bg-white/4 text-stone-200/72";
  }
}

function getDirectiveToneClasses(tone: BattleTone) {
  switch (tone) {
    case "accent":
      return "border-[#f0bf76]/24 bg-[linear-gradient(180deg,rgba(61,38,23,0.88),rgba(20,13,9,0.92))]";
    case "warning":
      return "border-[#df6c39]/24 bg-[linear-gradient(180deg,rgba(68,31,17,0.88),rgba(21,10,8,0.92))]";
    case "danger":
      return "border-[#e06a4c]/28 bg-[linear-gradient(180deg,rgba(72,21,17,0.9),rgba(24,8,8,0.94))]";
    case "success":
      return "border-[#7ed2b4]/22 bg-[linear-gradient(180deg,rgba(16,39,33,0.9),rgba(8,16,14,0.94))]";
    default:
      return "border-white/10 bg-[linear-gradient(180deg,rgba(14,10,8,0.84),rgba(10,8,7,0.9))]";
  }
}

function getSignalToneClasses(tone: BattleTone) {
  switch (tone) {
    case "accent":
      return "border-[#f0bf76]/24 bg-[#f0bf76]/10 text-[#f7e4bf]";
    case "warning":
      return "border-[#df6c39]/24 bg-[#df6c39]/10 text-[#ffd5bf]";
    case "danger":
      return "border-[#e06a4c]/28 bg-[#e06a4c]/12 text-[#ffe0d8]";
    case "success":
      return "border-[#7ed2b4]/24 bg-[#7ed2b4]/10 text-[#daf8ef]";
    default:
      return "border-white/10 bg-white/6 text-stone-100/84";
  }
}

function formatCampaignPriority(
  value: AutonomyPlan["campaignPriority"],
) {
  switch (value) {
    case "buy_skill":
      return "Approve next skill upgrade";
    case "queue_paid":
      return "Deploy a paid showdown run";
    case "buy_autonomy_pass":
      return "Unlock premium autonomy";
    case "run_practice":
      return "Run a practice frontier cycle";
  }
}

function formatCampaignPriorityDetail(plan: AutonomyPlan) {
  switch (plan.campaignPriority) {
    case "buy_skill":
      return `The next approved upgrade should be ${skillLabels[plan.nextSkill]}. ${plan.nextSkillReason}`;
    case "queue_paid":
      return "The agent has enough momentum to push into the paid queue and try to compound settlements.";
    case "buy_autonomy_pass":
      return "Premium autonomy is now the highest-leverage upgrade for this agent's planning and queue discipline.";
    case "run_practice":
      return "Stay in practice until the current doctrine is sharper, then move back into higher-risk economy actions.";
  }
}

function formatConfidenceBand(value: AutonomyPlan["confidenceBand"]) {
  switch (value) {
    case "high":
      return "High";
    case "medium":
      return "Medium";
    case "low":
      return "Low";
  }
}

function formatObjectivePosture(value: AutonomyPlan["objectivePosture"]) {
  switch (value) {
    case "contest":
      return "Contest";
    case "flank":
      return "Flank";
    case "hold":
      return "Hold";
  }
}

function formatEconomyPosture(value: AutonomyPlan["economyPosture"]) {
  switch (value) {
    case "bootstrap":
      return "Bootstrap";
    case "compounding":
      return "Compounding";
    case "aggressive":
      return "Aggressive";
  }
}

function formatCampaignTier(value: AgentCampaignStats["campaignTier"]) {
  switch (value) {
    case "rookie":
      return "Rookie Trail Ledger";
    case "contender":
      return "Contender Circuit";
    case "marshal":
      return "Marshal of the Ring";
    case "legend":
      return "Legend of X Layer";
  }
}

function formatShortDateTime(value: string) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatWeiToOkb(value: bigint) {
  return `${formatEther(value)} OKB`;
}

function agentIdToBytes32(agentId: string) {
  return keccak256(stringToHex(agentId));
}

function matchIdToBytes32(matchId: string) {
  return keccak256(stringToHex(matchId));
}
