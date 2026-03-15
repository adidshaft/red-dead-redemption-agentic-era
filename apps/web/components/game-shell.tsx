"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Bot,
  CircleHelp,
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
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { formatEther, keccak256, stringToHex, type Address } from "viem";
import {
  arenaEconomyAbi,
  calculateSkillPurchasePrice,
  gameConfig,
  getFrontierMap,
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
  type FrontierChainActivity,
  type FrontierRecentResult,
  type FrontierRiderDossier,
  type FrontierRiderProfile,
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
  fetchFrontierRiderDossier,
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
import { xLayerMainnetChain, xLayerTestnetChain } from "../lib/wagmi";
import { XLayerExactSchemeV1 } from "../lib/x402";
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
type LiveFrontierFilter = "all" | "paid" | "practice";
type BattleTone = "neutral" | "accent" | "warning" | "danger" | "success";
type BattleDirective = {
  eyebrow: string;
  title: string;
  detail: string;
  tone: BattleTone;
};

type RecentSkillUpgrade = {
  agentId: string;
  skill: SkillKey;
  nextValue: number;
};

const skillImpactGuides: Record<
  SkillKey,
  {
    shortLabel: string;
    tooltip: string;
    impactSummary: (value: number) => string;
    nextUpgradeLabel: (value: number) => string;
  }
> = {
  quickdraw: {
    shortLabel: "More accurate shots and harder hits.",
    tooltip:
      "Quickdraw improves hit chance and base shot damage. It makes your rider win more straight-up gunfights.",
    impactSummary: (value) =>
      `+${formatSignedPercent(value * 0.2)} hit chance • +${(value * 0.12).toFixed(1)} damage`,
    nextUpgradeLabel: () => "+1.0% hit • +0.6 damage",
  },
  grit: {
    shortLabel: "Shrugs off damage and holds cover better.",
    tooltip:
      "Grit reduces incoming damage and adds more value to cover. It keeps the rider alive longer under pressure.",
    impactSummary: (value) =>
      `-${(value * 0.05).toFixed(1)} damage taken • +${formatSignedPercent(value * 0.06)} cover hold`,
    nextUpgradeLabel: () => "-0.3 damage taken • +0.3% cover",
  },
  trailcraft: {
    shortLabel: "Longer dodges and harder-to-hit movement.",
    tooltip:
      "Trailcraft increases dodge distance, lowers enemy hit chance, and makes cover positions work better.",
    impactSummary: (value) =>
      `+${Math.round(value)}px dodge • -${formatSignedPercent(value * 0.12)} enemy hit`,
    nextUpgradeLabel: () => "+5px dodge • -0.6% enemy hit",
  },
  tactics: {
    shortLabel: "Cleaner aim lines and more efficient damage.",
    tooltip:
      "Tactics improves hit chance and adds extra damage. It rewards disciplined, high-value shots.",
    impactSummary: (value) =>
      `+${formatSignedPercent(value * 0.15)} hit chance • +${(value * 0.08).toFixed(1)} damage`,
    nextUpgradeLabel: () => "+0.8% hit • +0.4 damage",
  },
  fortune: {
    shortLabel: "Turns clean hits into bigger swing moments.",
    tooltip:
      "Fortune raises critical-hit chance. It does not help every shot, but it creates higher-upside bursts.",
    impactSummary: (value) =>
      `${formatSignedPercent(8 + value * 0.1)} crit chance`,
    nextUpgradeLabel: () => "+0.5% crit chance",
  },
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
  const [liveRiderProfiles, setLiveRiderProfiles] = useState<
    FrontierRiderProfile[]
  >([]);
  const [recentFrontierResults, setRecentFrontierResults] = useState<
    FrontierRecentResult[]
  >([]);
  const [frontierLeaders, setFrontierLeaders] = useState<FrontierRiderProfile[]>([]);
  const [frontierChainActivity, setFrontierChainActivity] = useState<
    FrontierChainActivity[]
  >([]);
  const [selectedFrontierDossier, setSelectedFrontierDossier] =
    useState<FrontierRiderDossier | null>(null);
  const [frontierDossierBusyId, setFrontierDossierBusyId] = useState<string | null>(
    null,
  );
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
  const [arenaCameraMode, setArenaCameraMode] = useState<"follow" | "wide">("follow");
  const [spectatorFollowLeader, setSpectatorFollowLeader] = useState(false);
  const [matchCountdown, setMatchCountdown] = useState<number | null>(null);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [txReveals, setTxReveals] = useState<TxReveal[]>([]);
  const [activeConsoleTab, setActiveConsoleTab] = useState<ConsoleTab>("overview");
  const [liveFrontierFilter, setLiveFrontierFilter] =
    useState<LiveFrontierFilter>("all");
  const [recentSkillUpgrade, setRecentSkillUpgrade] = useState<RecentSkillUpgrade | null>(
    null,
  );
  const x402Fetch = useMemo(() => {
    if (!walletClient?.account) {
      return null;
    }

    return wrapFetchWithPaymentFromConfig(fetch, {
      schemes: [
        {
          network: `eip155:${xLayerMainnetChain.id}`,
          client: new XLayerExactSchemeV1({
            address: walletClient.account.address,
            signTypedData: walletClient.signTypedData.bind(walletClient),
          }),
          x402Version: 1,
        },
      ],
    });
  }, [walletClient]);

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
  const filteredLiveMatches = useMemo(() => {
    if (liveFrontierFilter === "all") {
      return sortedLiveMatches;
    }

    return sortedLiveMatches.filter((match) =>
      liveFrontierFilter === "paid" ? match.paid : !match.paid,
    );
  }, [liveFrontierFilter, sortedLiveMatches]);
  const spotlightMatch = filteredLiveMatches[0] ?? null;
  const liveRiderProfilesById = useMemo(
    () => new Map(liveRiderProfiles.map((profile) => [profile.agentId, profile])),
    [liveRiderProfiles],
  );
  const liveFrontierStats = useMemo(() => {
    const publicRiders = liveRiderProfiles.filter((profile) => profile.kind === "player");
    return {
      matches: sortedLiveMatches.length,
      riders: sortedLiveMatches.reduce((total, match) => total + match.players.length, 0),
      linked: publicRiders.filter((profile) => profile.onchainLinked).length,
      premium: publicRiders.filter((profile) => profile.premiumPassActive).length,
    };
  }, [liveRiderProfiles, sortedLiveMatches]);
  const selectedFrontierLiveMatch = useMemo(
    () =>
      selectedFrontierDossier
        ? sortedLiveMatches.find((match) =>
            match.players.some(
              (player) => player.agentId === selectedFrontierDossier.profile.agentId,
            ),
          ) ?? null
        : null,
    [selectedFrontierDossier, sortedLiveMatches],
  );
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
  const activeArenaMap = useMemo(
    () => getFrontierMap(snapshot?.mapId ?? "dust_circuit"),
    [snapshot?.mapId],
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
  const resultChangeCards = useMemo(() => {
    if (!selectedAgent) {
      return [];
    }

    return [
      {
        label: "Mode",
        value: selectedAgent.mode === "autonomous" ? "Autopilot" : "Manual",
        detail:
          selectedAgent.mode === "autonomous"
            ? "This rider can self-pilot the next fight."
            : "You control the next fight directly.",
      },
      {
        label: "Next skill",
        value: autonomyPlan ? skillLabels[autonomyPlan.nextSkill] : "Open planner",
        detail: autonomyPlan
          ? "Recommended upgrade before the next run."
          : "Pick a rider to unlock a plan.",
      },
      {
        label: "Next run",
        value:
          autonomyPlan?.recommendedQueue === "paid"
            ? "Paid showdown"
            : "Practice run",
        detail: autonomyPlan
          ? autonomyPlan.economyDirective
          : "Practice keeps risk low while you learn the loop.",
      },
      {
        label: "Campaign",
        value: campaignStats
          ? `${campaignStats.campaignTier.toUpperCase()} • ${campaignStats.currentStreak} streak`
          : "Rookie ledger",
        detail: campaignStats
          ? `${campaignStats.wins} wins • ${campaignStats.podiums} podiums`
          : "First runs will build this ledger.",
      },
    ];
  }, [autonomyPlan, campaignStats, selectedAgent]);
  const autonomyEvents = useMemo(
    () => recentEvents.filter((event) => event.type === "autonomy").slice(-4),
    [recentEvents],
  );
  const latestAutonomyCall = useMemo(
    () =>
      autonomyEvents.length > 0
        ? simplifyAutonomyCall(autonomyEvents[autonomyEvents.length - 1]!.message)
        : null,
    [autonomyEvents],
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
  const intelLegendCards = useMemo(
    () => [
      {
        label: "Cover",
        detail: "Hide near a named landmark to take less damage.",
        icon: <ShieldPlus className="h-3.5 w-3.5" />,
      },
      {
        label: "Signal Drop",
        detail: "Orange flare. Grab it for health, ammo, and score.",
        icon: <Gem className="h-3.5 w-3.5" />,
      },
      {
        label: "Stagecoach",
        detail: "Shoot the moving coach itself for ammo and score.",
        icon: <Landmark className="h-3.5 w-3.5" />,
      },
      {
        label: "Bounty + Ring",
        detail: "Marked rider pays bonus score. Outside the ring burns HP.",
        icon: <AlertTriangle className="h-3.5 w-3.5" />,
      },
    ],
    [],
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

    if (typeof queueState.etaSeconds === "number") {
      return Math.max(0, queueState.etaSeconds);
    }

    const readyAt =
      new Date(queueState.queuedAt).getTime() + gameConfig.humanQueueFillMs;
    const remainingMs = Math.max(0, readyAt - clockNow);
    return Math.ceil(remainingMs / 1000);
  }, [clockNow, queueState?.etaSeconds, queueState?.queuedAt, snapshot]);
  const queueWaitLabel = useMemo(() => {
    if (!queueState || queueState.status === "idle" || snapshot) {
      return null;
    }

    const slotsFilled = queueState.slotsFilled ?? 1;
    const slotsTotal = queueState.slotsTotal ?? 4;
    const slotLabel = `${slotsFilled}/${slotsTotal} riders armed`;

    if (queueState.matchId) {
      return queueWaitCountdown && queueWaitCountdown > 0
        ? `${slotLabel} • bots deploy in ${queueWaitCountdown}s`
        : `${slotLabel} • field is arming now`;
    }

    return queueWaitCountdown && queueWaitCountdown > 0
      ? `${slotLabel} • bots arrive in ${queueWaitCountdown}s`
      : `${slotLabel} • building a four-rider field`;
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
  const queueCompositionLabel = useMemo(() => {
    if (!queueState || queueState.status === "idle" || snapshot) {
      return null;
    }

    const humansCommitted = queueState.humansCommitted ?? 1;
    const slotsTotal = queueState.slotsTotal ?? 4;
    const botsExpected = Math.max(0, slotsTotal - humansCommitted);
    return `${humansCommitted} human${humansCommitted === 1 ? "" : "s"} locked • ${botsExpected} house bot${botsExpected === 1 ? "" : "s"} incoming`;
  }, [queueState, snapshot]);
  const selectedModeGuide = useMemo(() => {
    if (!selectedAgent) {
      return null;
    }

    if (selectedAgent.mode === "manual") {
      return {
        label: "Manual control",
        title: "You drive every combat action",
        detail:
          "After DRAW, movement, shots, dodge, and reload are fully yours.",
        steps: [
          "Queue the rider and stay on the arena screen for the countdown.",
          "Once DRAW hits, use WASD to move, click to shoot, Space to dodge, and R to reload.",
          "Skill upgrades still matter here because they change your damage, accuracy, dodge, and survival math.",
        ],
      };
    }

    return {
      label: "Autopilot",
      title: "The rider fights for you once DRAW starts",
      detail:
        "Queue the rider, stay on the match screen, and the agent will move, aim, dodge, reload, chase drops, and react to ring pressure on its own.",
      steps: [
        "You still choose the rider, buy skills, and approve paid queue entry.",
        "Autopilot only takes over inside the live match, not in the lobby.",
        "Watch the cyan YOU rider and the live Autopilot call to see what it is doing next.",
      ],
    };
  }, [selectedAgent]);
  const recentSkillUpgradeLabel = useMemo(() => {
    if (!selectedAgent || !recentSkillUpgrade || recentSkillUpgrade.agentId !== selectedAgent.id) {
      return null;
    }

    return `${skillLabels[recentSkillUpgrade.skill]} is now ${recentSkillUpgrade.nextValue}/100`;
  }, [recentSkillUpgrade, selectedAgent]);
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
  const aliveCount = useMemo(
    () => snapshot?.players.filter((player) => player.alive).length ?? 0,
    [snapshot],
  );
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
  const intelPrimaryFocus = useMemo(() => {
    if (!snapshot) {
      return {
        title:
          queueState?.status === "queued"
            ? "Field is arming"
            : "Queue a run to light up the map",
        detail:
          queueState?.status === "queued"
            ? queueWaitLabel ??
              "Stay here while the rider slot locks and the field fills."
            : "The minimap, live calls, and town objectives show up once a showdown is armed.",
        chips:
          queueState?.status === "queued"
            ? [queueCompositionLabel ?? "1 rider locked", "Opening bell soon"]
            : ["Practice = fast reps", "Paid = onchain pot"],
      };
    }

    if (snapshot.status === "queued") {
      return {
        title:
          matchCountdown !== null && matchCountdown > 0
            ? `Showdown in ${matchCountdown}`
            : "Stand by for the draw",
        detail:
          "Everyone is frozen until the bell. Find your cyan YOU rider, note the ring, and choose the first angle.",
        chips: [
          selectedAgent?.mode === "autonomous"
            ? "Autopilot is armed"
            : "Manual control arms at DRAW",
          safeZoneLabel,
        ],
      };
    }

    if (selectedRingState?.outside) {
      return {
        title: "Get back inside the ring",
        detail: `The storm is already burning your rider. Cut ${selectedRingState.distanceFromEdge}px back into the safe circle now.`,
        chips: ["Storm damage live", safeZoneLabel],
      };
    }

    if (snapshot.objective) {
      return {
        title: snapshot.objective.label,
        detail: `Ride into the flare to claim it. ${snapshot.objective.rewardLabel}${objectiveTimerLabel ? ` • closes in ${objectiveTimerLabel}` : ""}.`,
        chips: ["Signal drop live", "Fastest tempo swing"],
      };
    }

    if (snapshot.caravan) {
      return {
        title: snapshot.caravan.label,
        detail: `Shoot the coach itself. ${snapshot.caravan.rewardLabel}. Cut across its line instead of chasing from behind.`,
        chips: ["Moving objective", "Intercept for ammo"],
      };
    }

    if (snapshot.bounty) {
      return snapshot.bounty.targetAgentId === selectedAgent?.id
        ? {
            title: "You are marked",
            detail: `The field gets +${snapshot.bounty.bonusScore} score for dropping you. Break line-of-sight and kite bad pushes.`,
            chips: ["Bounty is on you", "Survive the collapse"],
          }
        : {
            title: `Bounty on ${snapshot.bounty.displayName}`,
            detail: `Dropping the marked rider is worth +${snapshot.bounty.bonusScore} score.`,
            chips: ["Bonus score live", "Collapse only on clean angles"],
          };
    }

    if (selectedThreat) {
      return {
        title: `Nearest threat: ${selectedThreat.player.displayName}`,
        detail:
          selectedThreat.distance <= 220
            ? "Close duel range. Strafe, dodge, and be ready to punish reloads."
            : `Open pressure at ${Math.round(selectedThreat.distance)}px. Hold cover or angle inward.`,
        chips: [
          `${Math.round(selectedThreat.distance)}px away`,
          selectedSnapshotPlayer?.coverLabel ?? "Open ground",
        ],
      };
    }

    return {
      title: "Ride the town",
      detail:
        "Watch the live calls below. The next drop, coach, or bounty will create the first real swing.",
      chips: [safeZoneLabel, snapshot.paid ? "Paid frontier" : "Practice run"],
    };
  }, [
    matchCountdown,
    objectiveTimerLabel,
    queueCompositionLabel,
    queueState?.status,
    queueWaitLabel,
    safeZoneLabel,
    selectedAgent?.id,
    selectedAgent?.mode,
    selectedRingState,
    selectedSnapshotPlayer?.coverLabel,
    selectedThreat,
    snapshot,
  ]);
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
  const townPulseCards = useMemo(() => {
    if (snapshot?.status === "in_progress") {
      return [
        {
          label: "Remaining",
          value: `${aliveCount} riders`,
          detail: aliveCount === 1 ? "Final duel" : "Still in the dust",
        },
        {
          label: "Ring",
          value: safeZoneLabel,
          detail: selectedRingState?.outside ? "You are outside" : "Inside safe zone",
        },
        {
          label: "Prize",
          value: snapshot.objective
            ? "Supply drop live"
            : snapshot.caravan
              ? "Stagecoach live"
              : snapshot.bounty
                ? "Bounty posted"
                : "No live prize",
          detail: snapshot.objective
            ? snapshot.objective.label
            : snapshot.caravan
              ? snapshot.caravan.label
              : snapshot.bounty
                ? snapshot.bounty.displayName
                : "Hold position",
        },
      ];
    }

    if (queueState?.status === "queued") {
      return [
        {
          label: "Field fill",
          value: queueWaitLabel ?? "Arming",
          detail: "Bots and rivals are being seated",
        },
        {
          label: "Mode",
          value:
            selectedAgent?.mode === "autonomous" ? "Autopilot" : "Manual",
          detail: selectedAgent?.displayName ?? "No rider",
        },
        {
          label: "Next",
          value: "Opening bell",
          detail: "Stay on screen for the draw",
        },
      ];
    }

    return [];
  }, [
    aliveCount,
    queueState?.status,
    queueWaitLabel,
    safeZoneLabel,
    selectedAgent,
    selectedRingState?.outside,
    snapshot,
  ]);
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
  const townObjectiveBanner = useMemo(() => {
    if (queueState?.status === "queued" && !snapshot) {
      return {
        eyebrow: "Field Fill",
        title: queueCompositionLabel ?? "House bots are arming",
        detail: queueWaitLabel ?? "Stay on this screen for the opening bell.",
        tone: "accent" as const,
      };
    }

    if (!snapshot) {
      return null;
    }

    if (snapshot.status === "queued") {
      return {
        eyebrow: "Opening Bell",
        title:
          matchCountdown !== null && matchCountdown > 0
            ? `Draw in ${matchCountdown}`
            : "Stand by for DRAW",
        detail:
          "Find your cyan rider, note the ring, and pick the first line before control unlocks.",
        tone: "accent" as const,
      };
    }

    if (snapshot.status !== "in_progress") {
      return null;
    }

    if (snapshot.objective) {
      return {
        eyebrow: "Signal Drop",
        title: snapshot.objective.label,
        detail: `Ride into the flare to claim it. ${snapshot.objective.rewardLabel}${objectiveTimerLabel ? ` • ${objectiveTimerLabel} left` : ""}`,
        tone: "accent" as const,
      };
    }

    if (snapshot.caravan) {
      return {
        eyebrow: "Stagecoach Run",
        title: snapshot.caravan.label,
        detail: `Shoot the moving coach itself. ${snapshot.caravan.rewardLabel}. Intercept the route instead of chasing behind it.`,
        tone: "warning" as const,
      };
    }

    if (snapshot.bounty) {
      return snapshot.bounty.targetAgentId === selectedAgent?.id
        ? {
            eyebrow: "Bounty",
            title: "You are marked",
            detail: `Survive the pressure. The field gets +${snapshot.bounty.bonusScore} score for dropping you.`,
            tone: "danger" as const,
          }
        : {
            eyebrow: "Bounty",
            title: `Drop ${snapshot.bounty.displayName}`,
            detail: `Clean elimination is worth +${snapshot.bounty.bonusScore} score.`,
            tone: "accent" as const,
          };
    }

    return {
      eyebrow: "Town Pressure",
      title: selectedThreat
        ? `${selectedThreat.player.displayName} is nearest`
        : "Hold the center lane",
      detail: selectedThreat
        ? `Threat at ${Math.round(selectedThreat.distance)}px. Use cover and keep the ring on your terms.`
        : "Stay inside the ring and be ready for the next drop or bounty call.",
      tone: "neutral" as const,
    };
  }, [
    matchCountdown,
    objectiveTimerLabel,
    queueCompositionLabel,
    queueState?.status,
    queueWaitLabel,
    selectedAgent?.id,
    selectedThreat,
    snapshot,
  ]);
  const agentIntentCards = useMemo(() => {
    if (!selectedAgent) {
      return [];
    }

    if (!snapshot || !selectedSnapshotPlayer) {
      return [
        {
          label: "Intent",
          value:
            selectedAgent.mode === "autonomous"
              ? "Waiting for a run"
              : "Waiting for your call",
          detail:
            selectedAgent.mode === "autonomous"
              ? "Queue the rider and Autopilot will take over in the arena."
              : "Queue the rider to take direct control.",
        },
      ];
    }

    const targetValue = snapshot.bounty
      ? snapshot.bounty.targetAgentId === selectedSnapshotPlayer.agentId
        ? "You are marked"
        : `Hunt ${snapshot.bounty.displayName}`
      : selectedThreat
        ? selectedThreat.player.displayName
        : "No target";

    const routeValue = selectedRingState?.outside
      ? "Return to ring"
      : snapshot.objective
        ? snapshot.objective.label
        : snapshot.caravan
          ? snapshot.caravan.label
          : selectedSnapshotPlayer.coverLabel
            ? `Hold ${selectedSnapshotPlayer.coverLabel}`
            : "Open duel";

    const rewardValue = snapshot.objective
      ? snapshot.objective.rewardLabel
      : snapshot.caravan
        ? snapshot.caravan.rewardLabel
        : snapshot.bounty
          ? `+${snapshot.bounty.bonusScore} score`
          : matchEconomy
            ? `Pot ${formatWeiToOkb(matchEconomy.totalPot)}`
            : "Placement and score";

    return [
      {
        label: "Target",
        value: targetValue,
        detail:
          selectedAgent.mode === "autonomous"
            ? "What the rider is tracking right now."
            : "The nearest live threat or active mark.",
      },
      {
        label: "Route",
        value: routeValue,
        detail:
          selectedAgent.mode === "autonomous"
            ? "Where the rider wants to move next."
            : "The cleanest path for the next few seconds.",
      },
      {
        label: "Reward",
        value: rewardValue,
        detail: "Why this move matters on the current run.",
      },
    ];
  }, [
    matchEconomy,
    selectedAgent,
    selectedRingState?.outside,
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
  const treasuryStatusCards = useMemo(() => {
    if (!selectedAgent) {
      return [];
    }

    return [
      {
        label: "OnchainOS treasury",
        value: truncateAddress(selectedAgent.walletAddress),
        detail:
          "Every rider is minted with a linked treasury wallet for payout routing and future autonomous economy actions.",
      },
      {
        label: "Career payout",
        value: campaignStats
          ? formatWeiToOkb(BigInt(campaignStats.careerPayoutWei))
          : "0 OKB",
        detail:
          transactionCounts.settlements > 0
            ? `${transactionCounts.settlements} settlement${transactionCounts.settlements === 1 ? "" : "s"} confirmed on X Layer testnet.`
            : "No settlement receipt yet. The first paid win completes the treasury loop.",
      },
      {
        label: "Premium lane",
        value: autonomyPlan?.autonomyPassActive ? "x402 active" : "Available",
        detail: autonomyPlan?.autonomyPassActive
          ? autonomyPassRemainingLabel ?? "Premium autonomy is live on X Layer mainnet."
          : "Unlock x402 premium if you want a stronger planning lane layered over the core testnet game economy.",
      },
    ];
  }, [
    autonomyPassRemainingLabel,
    autonomyPlan?.autonomyPassActive,
    campaignStats,
    selectedAgent,
    transactionCounts.settlements,
  ]);
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
  const autonomyWireFeed = useMemo(() => {
    if (autonomyEvents.length > 0) {
      return autonomyEvents
        .slice(-3)
        .reverse()
        .map((event) => simplifyAutonomyCall(event.message));
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
  const autopilotStatusCards = useMemo(() => {
    if (!selectedAgent || !autonomyPlan) {
      return [];
    }

    return [
      {
        label: "What it does",
        value:
          selectedAgent.mode === "autonomous"
            ? "Fights on its own"
            : "Available if you want it",
        detail:
          selectedAgent.mode === "autonomous"
            ? "Moves, aims, dodges, reloads, takes cover, and reacts to drops, bounty calls, and the dust ring."
            : "Switch this rider to Autopilot if you want the match played for you after DRAW.",
      },
      {
        label: "When it starts",
        value:
          selectedAgent.mode === "autonomous"
            ? "Right after DRAW"
            : "Only if you switch it on",
        detail:
          "Autopilot does not play the lobby. You still sign in, buy skills, and approve paid queue entry yourself.",
      },
      {
        label: "What happens next",
        value:
          selectedAgent.mode === "autonomous"
            ? "Watch the cyan YOU rider"
            : "Manual stays in your hands",
        detail:
          selectedAgent.mode === "autonomous"
            ? "The live call updates whenever the rider changes its immediate plan."
            : "You control movement, shots, dodge, and reload until you change modes.",
      },
    ];
  }, [autonomyPlan, operationQueue, queueLocked, selectedAgent]);
  const autopilotLoopSteps = useMemo(() => {
    if (!autonomyPlan) {
      return [];
    }

    return [
      {
        label: "Before match",
        detail:
          "You pick the rider, choose Manual or Autopilot, and approve skill buys or paid queue entry.",
      },
      {
        label: "At DRAW",
        detail:
          selectedAgent?.mode === "autonomous"
            ? "The rider takes over movement, shooting, dodge, reload, ring pressure, and pickups."
            : "You stay in control of the full fight unless you switch this rider to Autopilot.",
      },
      {
        label: "After run",
        detail: autonomyPlan.autonomyPassActive
          ? `Review the result, then decide whether to buy ${skillLabels[autonomyPlan.nextSkill]} next.`
          : `Review the result, then decide whether to buy ${skillLabels[autonomyPlan.nextSkill]} or unlock premium planning.`,
      },
    ];
  }, [autonomyPlan, selectedAgent?.mode]);
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

    void loadAgents();
  }, [authToken]);

  useEffect(() => {
    let cancelled = false;
    const syncLiveMatches = async () => {
      try {
        const response = await fetchLiveMatches();
        if (!cancelled) {
          setLiveMatches(response.matches);
          setLiveRiderProfiles(response.riderProfiles);
          setRecentFrontierResults(response.recentResults);
          setFrontierLeaders(response.leaders);
          setFrontierChainActivity(response.chainActivity);
        }
      } catch {
        // Live frontier remains best-effort in the background.
      }
    };

    void syncLiveMatches();
    const intervalId = window.setInterval(syncLiveMatches, 8_000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

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

        const shouldAttemptRecovery =
          !snapshot &&
          (nextQueueState.status === "ready" ||
            (nextQueueState.status === "queued" &&
              typeof nextQueueState.etaSeconds === "number" &&
              nextQueueState.etaSeconds <= 1));

        if (shouldAttemptRecovery) {
          try {
            const live = await fetchLiveMatches();
            if (cancelled) {
              return;
            }

            setLiveMatches(live.matches);
            setLiveRiderProfiles(live.riderProfiles);
            setRecentFrontierResults(live.recentResults);
            setFrontierLeaders(live.leaders);
            setFrontierChainActivity(live.chainActivity);

            const focusedAgentId = selectedAgentRef.current?.id;
            const recoveredMatch = live.matches.find(
              (match) =>
                (nextQueueState.matchId &&
                  match.matchId === nextQueueState.matchId) ||
                (focusedAgentId
                  ? match.players.some((player) => player.agentId === focusedAgentId)
                  : false),
            );

            if (recoveredMatch) {
              queuedMatchIdRef.current = recoveredMatch.matchId;
              socketRef.current?.emit("match:join", {
                matchId: recoveredMatch.matchId,
              });
              setSnapshot(recoveredMatch);
              setRecentEvents(recoveredMatch.events.slice(-8));
              setQueueState({
                ...nextQueueState,
                status: "ready",
                matchId: recoveredMatch.matchId,
              });
              setStatus("Match found. Showdown is about to begin.");
            }
          } catch {
            // Recovery remains best-effort.
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

  async function ensureXLayerMainnet() {
    if (chainId === xLayerMainnetChain.id) {
      return;
    }
    await switchChainAsync({ chainId: xLayerMainnetChain.id });
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
    playToneSweep(540, 210, 0.62, {
      gain: 0.04,
      type: "triangle",
    });
    playStartTone(196, 0.18, {
      delaySeconds: 0.08,
      gain: 0.04,
      type: "square",
    });
    playStartTone(294, 0.16, {
      delaySeconds: 0.22,
      gain: 0.032,
      type: "triangle",
    });
    playStartTone(392, 0.14, {
      delaySeconds: 0.36,
      gain: 0.03,
      type: "triangle",
    });
    playToneSweep(860, 520, 0.2, {
      delaySeconds: 0.22,
      gain: 0.016,
      type: "sine",
    });
  }

  function playToneSweep(
    fromFrequency: number,
    toFrequency: number,
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
      const gain = options?.gain ?? 0.04;
      const startAt = audioContext.currentTime + delaySeconds;
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      oscillator.type = options?.type ?? "sine";
      oscillator.frequency.setValueAtTime(fromFrequency, startAt);
      oscillator.frequency.exponentialRampToValueAtTime(
        Math.max(40, toFrequency),
        startAt + durationSeconds,
      );
      gainNode.gain.setValueAtTime(0.0001, startAt);
      gainNode.gain.exponentialRampToValueAtTime(gain, startAt + 0.04);
      gainNode.gain.exponentialRampToValueAtTime(
        0.0001,
        startAt + durationSeconds,
      );
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      oscillator.start(startAt);
      oscillator.stop(startAt + durationSeconds + 0.04);
    } catch {
      // Ignore audio errors; the visual countdown remains the primary cue.
    }
  }

  function getAudioContext() {
    if (audioContextRef.current) {
      if (audioContextRef.current.state === "suspended") {
        void audioContextRef.current.resume().catch(() => undefined);
      }
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
      if (audioContextRef.current.state === "suspended") {
        void audioContextRef.current.resume().catch(() => undefined);
      }
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
      setRecentSkillUpgrade({
        agentId: response.agent.id,
        skill,
        nextValue: response.agent.skills[skill],
      });
      setAgents((current) =>
        current.map((agent) =>
          agent.id === response.agent.id ? response.agent : agent,
        ),
      );
      await loadTransactions(selectedAgent.id);
      await loadAutonomyPlan(selectedAgent.id);
      setStatus(
        `${skillLabels[skill]} improved for ${selectedAgent.displayName}. ${skillImpactGuides[skill].impactSummary(
          response.agent.skills[skill],
        )}.`,
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
    setMatchCountdown(null);
    queuedMatchIdRef.current = null;
    startedMatchIdRef.current = null;
    frontierCueMatchIdRef.current = null;
    lastCountdownValueRef.current = null;
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
          queueKind: "paid",
          slotsFilled: 1,
          slotsTotal: 4,
          humansCommitted: 1,
          etaSeconds: Math.ceil(gameConfig.humanQueueFillMs / 1000),
        });
        setStatus("Paid queue confirmed onchain. Waiting for other agents...");
      } else {
        await queueForMatch(authToken, selectedAgent.id, false);
        setQueueState({
          status: "queued",
          queuedAt: new Date().toISOString(),
          queueKind: "practice",
          slotsFilled: 1,
          slotsTotal: 4,
          humansCommitted: 1,
          etaSeconds: Math.ceil(gameConfig.humanQueueFillMs / 1000),
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
      if (!walletClient?.account || !x402Fetch) {
        throw new Error(
          "Connect a wallet before unlocking premium autonomy.",
        );
      }

      await ensureXLayerMainnet();
      const response = await requestAutonomyPass(
        authToken,
        selectedAgent.id,
        x402Fetch,
      );
      if (response.status === 402) {
        setAutonomyQuote({
          amount: response.payload?.amount,
          asset: response.payload?.asset,
          chainId: response.payload?.chainId,
          payTo: response.payload?.payTo,
          scheme: response.payload?.scheme,
        });
        setAutonomyHint(
          "Premium autonomy uses an x402 payment on X Layer mainnet. Review the quote below, approve the signature, and the facilitator will settle the USDC payment onchain.",
        );
        setStatus(
          "x402 payment challenge is ready on X Layer mainnet for the autonomy pass.",
        );
      } else {
        setAutonomyQuote(null);
        setAutonomyHint(
          "Premium autonomy is active. The planner can now route upgrades and paid queue timing with tighter discipline while the game economy stays on X Layer testnet.",
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
        setStatus("Autonomy pass activated over x402.");
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
    setSpectatorFollowLeader(Boolean(options?.followLeader));
    if (authToken && socketRef.current) {
      socketRef.current.emit("match:join", { matchId: match.matchId });
    }
    setSnapshot(match);
    setRecentEvents(match.events.slice(-8));
    setQueueState(null);
    setStatus(
      options?.followLeader
        ? `Leader cam active for match ${match.matchId.slice(-6)}.`
        : authToken
          ? `Spectating live match ${match.matchId.slice(-6)}.`
          : `Public spectate active for match ${match.matchId.slice(-6)}.`,
    );
  }

  async function handleOpenFrontierDossier(agentId: string) {
    try {
      setFrontierDossierBusyId(agentId);
      const response = await fetchFrontierRiderDossier(agentId);
      setSelectedFrontierDossier(response.dossier);
    } catch (error) {
      setStatus(normalizeUiError(error, "Could not load that rider dossier."));
    } finally {
      setFrontierDossierBusyId(null);
    }
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
                    <div className="mt-1 text-sm font-semibold text-[#f6ead7]">
                      {selectedModeGuide.title}
                    </div>
                    <div className="mt-1 text-sm text-stone-200/72">
                      {selectedModeGuide.detail}
                    </div>
                    <div className="mt-3 grid gap-2">
                      {selectedModeGuide.steps.map((step) => (
                        <div
                          key={step}
                          className="rounded-[14px] border border-white/8 bg-black/14 px-3 py-2 text-xs leading-relaxed text-stone-200/68"
                        >
                          {step}
                        </div>
                      ))}
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
                        These stats directly change combat math in the arena.
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
                  {recentSkillUpgradeLabel && (
                    <div className="mb-3 rounded-[18px] border border-[#7ed2b4]/18 bg-[#7ed2b4]/8 px-4 py-3 text-sm text-[#d8f7ee]">
                      Last upgrade landed onchain:{" "}
                      <span className="font-semibold text-[#f6ead7]">
                        {recentSkillUpgradeLabel}
                      </span>
                    </div>
                  )}
                  <div className="space-y-3">
                    {skillKeys.map((skill) => {
                      const skillValue = selectedAgent.skills[skill];
                      const guide = skillImpactGuides[skill];
                      const isRecentUpgrade =
                        recentSkillUpgrade?.agentId === selectedAgent.id &&
                        recentSkillUpgrade.skill === skill;
                      return (
                        <div
                          key={skill}
                          className="rounded-[18px] border border-white/8 bg-black/14 px-4 py-3"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="text-sm font-semibold text-[#f6ead7]">
                                  {skillLabels[skill]}
                                </div>
                                <SkillInfoTooltip
                                  label={skillLabels[skill]}
                                  detail={guide.tooltip}
                                />
                                {isRecentUpgrade && (
                                  <span className="rounded-full border border-[#7ed2b4]/20 bg-[#7ed2b4]/10 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-[#d8f7ee]">
                                    Just upgraded
                                  </span>
                                )}
                              </div>
                              <div className="mt-1 text-xs text-stone-200/60">
                                {skillValue} / 100 • {guide.shortLabel}
                              </div>
                              <div className="mt-2 text-sm text-[#f6ead7]">
                                {guide.impactSummary(skillValue)}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleBuySkill(skill)}
                              disabled={buyDisabled}
                              className="shrink-0 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80 transition hover:border-white/20 hover:bg-white/10 disabled:opacity-45"
                            >
                              +5 • {formatWeiToOkb(calculateSkillPurchasePrice(skillValue))}
                            </button>
                          </div>
                          <div className="mt-3 h-2 overflow-hidden rounded-full bg-black/35">
                            <div
                              className="h-full rounded-full bg-[linear-gradient(90deg,#d5752d,#f0bf76)]"
                              style={{ width: `${Math.max(6, skillValue)}%` }}
                            />
                          </div>
                          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-stone-300/60">
                            <span>Next buy: {guide.nextUpgradeLabel(skillValue)}</span>
                            <span>{Math.max(0, 100 - skillValue)} points to max</span>
                          </div>
                        </div>
                      );
                    })}
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
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
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
                                ? "This rider is set to fight for you"
                                : "Autopilot is available for this rider"}
                            </h3>
                            <p className="mt-2 max-w-2xl text-sm text-stone-200/72">
                              {selectedAgent?.mode === "autonomous"
                                ? "Stay on the match screen, watch the cyan YOU marker, and the rider will take over right after DRAW."
                                : "Manual keeps you in control. Switch this rider to Autopilot if you want the fight handled automatically after DRAW."}
                            </p>
                          </div>
                          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-stone-200/72">
                            {autonomyPlan.readinessScore}% confidence
                          </span>
                        </div>
                        <div className="mt-4 grid gap-3 md:grid-cols-3">
                          {autopilotStatusCards.map((card) => (
                            <div
                              key={card.label}
                              className="rounded-[18px] border border-white/8 bg-black/16 px-4 py-3 text-sm text-stone-200/72"
                            >
                              <div className="text-[10px] uppercase tracking-[0.18em] text-stone-300/56">
                                {card.label}
                              </div>
                              <div className="mt-2 font-semibold text-[#f6ead7]">
                                {card.value}
                              </div>
                              <div className="mt-1 text-xs leading-relaxed text-stone-300/60">
                                {card.detail}
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="mt-4 grid gap-2 md:grid-cols-3">
                          {autopilotLoopSteps.map((step) => (
                            <div
                              key={step.label}
                              className="rounded-[16px] border border-[#7ed2b4]/16 bg-[#7ed2b4]/[0.05] px-3 py-3"
                            >
                              <div className="text-[10px] uppercase tracking-[0.18em] text-[#bfeee0]/70">
                                {step.label}
                              </div>
                              <div className="mt-1 text-[12px] leading-relaxed text-stone-200/74">
                                {step.detail}
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="mt-4 rounded-[18px] border border-white/8 bg-black/14 px-4 py-4">
                          <div className="text-[10px] uppercase tracking-[0.18em] text-stone-300/56">
                            Live calls from the rider
                          </div>
                          <div className="mt-3 grid gap-2">
                            {autonomyWireFeed.length > 0 ? (
                              autonomyWireFeed.slice(0, 3).map((message) => (
                                <div
                                  key={message}
                                  className="rounded-[16px] border border-white/8 bg-black/12 px-3 py-3 text-sm text-stone-200/72"
                                >
                                  {message}
                                </div>
                              ))
                            ) : (
                              <EmptyState label="No live autopilot calls yet." compact />
                            )}
                          </div>
                        </div>
                      </>
                    ) : (
                      <EmptyState label="Select a rider to see the simplified autopilot plan." compact />
                    )}
                  </div>
                </div>
                <div className="space-y-4">
                  <div className="rounded-[24px] border border-white/8 bg-black/12 p-4">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-stone-300/56">
                      What this means
                    </div>
                    <div className="mt-3 space-y-2 text-sm text-stone-200/72">
                      <div className="rounded-[18px] border border-white/8 bg-black/14 px-4 py-3">
                        Autopilot starts only after DRAW. It does not play the lobby or spend money by itself.
                      </div>
                      <div className="rounded-[18px] border border-white/8 bg-black/14 px-4 py-3">
                        In the fight, it moves, shoots, dodges, reloads, reacts to the dust ring, and chases drops on its own.
                      </div>
                      <div className="rounded-[18px] border border-white/8 bg-black/14 px-4 py-3">
                        The live Autopilot call under the arena tells you what the rider is trying to do right now.
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
                    <div className="mt-3 grid gap-2">
                      {premiumLaneSteps.slice(0, 2).map((step) => (
                        <div
                          key={step.label}
                          className={`rounded-[14px] border px-3 py-2 ${
                            step.done
                              ? "border-[#7ed2b4]/18 bg-[#7ed2b4]/10 text-[#daf8ef]"
                              : "border-white/8 bg-black/14 text-stone-200/72"
                          }`}
                        >
                          <div className="text-xs font-semibold uppercase tracking-[0.14em]">
                            {step.label}
                          </div>
                          <div className="mt-1 text-[11px] normal-case tracking-normal opacity-80">
                            {step.detail}
                          </div>
                        </div>
                      ))}
                    </div>
	                    {autonomyQuote && (
	                      <div className="mt-3 rounded-[18px] border border-white/8 bg-black/14 px-4 py-3 text-sm text-stone-200/72">
	                        <div className="text-[10px] uppercase tracking-[0.18em] text-stone-300/58">
	                          X Layer Mainnet x402
	                        </div>
	                        <div className="mt-1 font-semibold text-[#f6ead7]">
	                          Premium autonomy quote is ready
	                        </div>
	                        <div className="mt-2 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.16em] text-stone-300/58">
	                          {autonomyQuote.amount && (
	                            <span className="rounded-full border border-white/8 px-2.5 py-1">
	                              {formatUsdcAmount(autonomyQuote.amount)} {autonomyQuote.asset ?? ""}
	                            </span>
	                          )}
	                          {autonomyQuote.chainId && (
	                            <span className="rounded-full border border-white/8 px-2.5 py-1">
	                              Chain #{autonomyQuote.chainId}
	                            </span>
	                          )}
	                          {autonomyQuote.payTo && (
	                            <span className="rounded-full border border-white/8 px-2.5 py-1">
	                              Pay {truncateAddress(autonomyQuote.payTo)}
	                            </span>
	                          )}
	                        </div>
	                        <div className="mt-2 text-xs text-stone-300/62">
	                          This premium lane settles on X Layer mainnet through x402. Skill buys, paid queue entry, and match settlement stay on X Layer testnet.
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
                      Recommended click
                    </div>
                    <div className="mt-3 grid gap-2">
                      {operationQueue.length > 0 ? (
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
	                      <div className="mt-1 text-[10px] uppercase tracking-[0.16em] text-stone-300/50">
	                        {formatReceiptLaneLabel(lastConfirmedReceipt)}
	                      </div>
	                      <div className="mt-1 text-xs text-stone-300/58">
	                        {truncateHash(lastConfirmedReceipt.txHash)}
	                      </div>
                    </div>
                  ) : (
                    <EmptyState label="No confirmed receipts yet." compact />
                  )}
                  <div className="mt-4 grid gap-2">
                    {treasuryStatusCards.map((card) => (
                      <ObserverPulseCard
                        key={card.label}
                        label={card.label}
                        value={card.value}
                        detail={card.detail}
                      />
                    ))}
                  </div>
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
	                            {formatReceiptLaneLabel(receipt)} • {truncateHash(receipt.txHash)}
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
	                  {activeArenaMap.name}
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
                {queueCompositionLabel && (
                  <div className="mt-3 rounded-[16px] border border-[#7ed2b4]/14 bg-[#7ed2b4]/8 px-3 py-2 text-[11px] text-[#d9f7ee]">
                    {queueCompositionLabel}
                  </div>
                )}
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
              {townPulseCards.length > 0 && (
                <div className="pointer-events-none absolute right-4 top-4 z-10 hidden w-[300px] xl:block">
                  <div className="rounded-[24px] border border-white/10 bg-black/45 px-4 py-4 shadow-[0_18px_60px_rgba(0,0,0,0.38)] backdrop-blur-md">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-[#f0bf76]/70">
                        Town Pulse
                      </div>
                      <div className="text-[10px] uppercase tracking-[0.18em] text-stone-300/56">
                        Live
                      </div>
                    </div>
                    <div className="mt-3 grid gap-2">
                      {townPulseCards.map((card) => (
                        <div
                          key={card.label}
                          className="rounded-[18px] border border-white/8 bg-white/[0.04] px-3 py-3"
                        >
                          <div className="text-[10px] uppercase tracking-[0.18em] text-stone-300/56">
                            {card.label}
                          </div>
                          <div className="mt-1 font-semibold text-[#f6ead7]">
                            {card.value}
                          </div>
                          <div className="mt-1 text-xs text-stone-200/68">
                            {card.detail}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              {townObjectiveBanner && (
                <div className="pointer-events-none absolute left-1/2 top-4 z-10 w-[min(520px,calc(100%-10rem))] -translate-x-1/2">
                  <div
                    className={`rounded-[22px] border px-4 py-3 text-center shadow-[0_18px_60px_rgba(0,0,0,0.36)] backdrop-blur-md ${getDirectiveToneClasses(
                      townObjectiveBanner.tone,
                    )}`}
                  >
                    <div className="text-[10px] font-bold uppercase tracking-[0.22em] opacity-70">
                      {townObjectiveBanner.eyebrow}
                    </div>
                    <div className="mt-1 font-semibold text-[#f6ead7]">
                      {townObjectiveBanner.title}
                    </div>
                    <div className="mt-1 text-xs text-stone-100/76">
                      {townObjectiveBanner.detail}
                    </div>
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

                      {selectedResultPlayer && (
                        <div className="mx-auto mt-2 mb-8 grid max-w-4xl gap-3 sm:grid-cols-2 xl:grid-cols-4">
                          <ResultStatCard
                            label="Finish"
                            value={selectedPlacement ? ordinal(selectedPlacement) : "Spectating"}
                          />
                          <ResultStatCard
                            label="Score"
                            value={`${selectedResultPlayer.score} pts`}
                          />
                          <ResultStatCard
                            label="Damage"
                            value={`${selectedResultPlayer.damageDealt}`}
                          />
                          <ResultStatCard
                            label="Payout"
                            value={
                              matchEconomy
                                ? formatWeiToOkb(
                                    selectedPlacement === 1
                                      ? matchEconomy.winnerPayout
                                      : 0n,
                                  )
                                : "Practice"
                            }
                          />
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
                              What changed
                            </div>
                            <div className="mt-3 grid gap-2 sm:grid-cols-2">
                              {resultChangeCards.map((card) => (
                                <div
                                  key={card.label}
                                  className="rounded-[14px] border border-white/6 bg-white/[0.03] px-3 py-3"
                                >
                                  <div className="text-[10px] uppercase tracking-[0.16em] text-stone-300/56">
                                    {card.label}
                                  </div>
                                  <div className="mt-1 font-semibold text-[#f6ead7]">
                                    {card.value}
                                  </div>
                                  <div className="mt-1 text-xs text-stone-200/66">
                                    {card.detail}
                                  </div>
                                </div>
                              ))}
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
                          <div className="rounded-[22px] border border-white/8 bg-black/20 px-4 py-4">
                            <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--accent-soft)]/70">
                              Frontier Tape
                            </div>
                            <div className="mt-3 grid gap-2">
                              {matchHistory.slice(0, 3).length > 0 ? (
                                matchHistory.slice(0, 3).map((match) => (
                                  <div
                                    key={match.matchId}
                                    className="rounded-[14px] border border-white/6 bg-white/[0.03] px-3 py-3"
                                  >
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <div className="text-sm font-semibold text-[#f6ead7]">
                                        {match.paid ? "Paid Showdown" : "Practice Run"} • Finish #{match.placement}
                                      </div>
                                      <div className="text-[10px] uppercase tracking-[0.16em] text-stone-300/58">
                                        {match.won ? "Won" : "Logged"}
                                      </div>
                                    </div>
                                    <div className="mt-1 text-xs text-stone-200/66">
                                      {match.score} pts • {match.kills} kills • {formatWeiToOkb(BigInt(match.payoutWei))} payout
                                    </div>
                                  </div>
                                ))
                              ) : (
                                <EmptyState label="This was the first logged run for this rider." compact />
                              )}
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
                
                <div className="pointer-events-auto flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setArenaCameraMode((current) =>
                        current === "follow" ? "wide" : "follow",
                      )
                    }
                    className="flex items-center gap-2 rounded-full border border-[#7ed2b4]/18 bg-[var(--panel)] px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-[#d5f5ec] backdrop-blur-md transition hover:border-[#7ed2b4]/34 hover:text-[#f1fff9]"
                  >
                    {arenaCameraMode === "follow" ? "Rider Cam" : "Town Cam"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleArenaFullscreenToggle()}
                    className="flex items-center gap-2 rounded-full border border-[var(--panel-border)] bg-[var(--panel)] px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-[var(--foreground)] backdrop-blur-md transition hover:border-[var(--accent-soft)] hover:text-[var(--accent-soft)]"
                  >
                    {arenaFullscreen ? (
                      <Minimize className="h-4 w-4" />
                    ) : (
                      <Expand className="h-4 w-4" />
                    )}
                    {arenaFullscreen ? "Exit" : "Expand"}
                  </button>
                </div>
              </div>
              <ArenaCanvas
                snapshot={snapshot}
                selectedAgentId={arenaFocusAgentId}
                cameraMode={arenaCameraMode}
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
                    <div className="grid gap-2 md:grid-cols-3">
                      {agentIntentCards.map((card) => (
                        <div
                          key={card.label}
                          className="rounded-[16px] border border-white/8 bg-black/14 px-3 py-3"
                        >
                          <div className="text-[10px] uppercase tracking-[0.16em] text-stone-300/56">
                            {card.label}
                          </div>
                          <div className="mt-1 font-semibold text-[#f6ead7]">
                            {card.value}
                          </div>
                          <div className="mt-1 text-[11px] leading-relaxed text-stone-200/68">
                            {card.detail}
                          </div>
                        </div>
                      ))}
                    </div>
                    {selectedAgent?.mode === "autonomous" && (
                      <div className="rounded-[16px] border border-[#7ed2b4]/16 bg-[#7ed2b4]/8 px-3 py-3">
                        <div className="text-[10px] uppercase tracking-[0.16em] text-[#c8f6ea]/72">
                          Autopilot call
                        </div>
                        <div className="mt-1 font-semibold text-[#f6ead7]">
                          {latestAutonomyCall ?? "Waiting for the first live decision."}
                        </div>
                        <div className="mt-1 text-[11px] leading-relaxed text-stone-200/66">
                          Watch the cyan rider and the minimap. This line updates when the agent changes its immediate plan.
                        </div>
                      </div>
                    )}
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
	                  <div>
	                    <p className="font-[var(--font-heading)] text-base font-bold text-[var(--foreground)]">
	                      Field Intel
	                    </p>
	                    <div className="mt-1 text-[10px] uppercase tracking-[0.16em] text-stone-300/52">
	                      {activeArenaMap.name} • solid props block movement
	                    </div>
	                  </div>
	                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--circuit-line)]">
	                    Live
	                  </span>
	                </div>
                <ArenaMinimap
                  snapshot={snapshot}
                  selectedAgentId={arenaFocusAgentId}
                />
                <div className="mt-3 rounded-[18px] border border-[#7ed2b4]/12 bg-[#7ed2b4]/8 px-3 py-3">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-[#bfeee0]/70">
                    What matters now
                  </div>
                  <div className="mt-1 font-semibold text-[#f6ead7]">
                    {intelPrimaryFocus.title}
                  </div>
                  <div className="mt-1 text-xs leading-relaxed text-stone-200/72">
                    {intelPrimaryFocus.detail}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {intelPrimaryFocus.chips.map((chip) => (
                      <span
                        key={chip}
                        className="rounded-full border border-white/10 bg-black/14 px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-stone-200/70"
                      >
                        {chip}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="mt-3 rounded-[18px] border border-white/8 bg-black/14 px-3 py-3">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-stone-300/56">
                    What these systems do
                  </div>
                  <div className="mt-2 space-y-2">
                  {intelLegendCards.map((card) => (
                    <IntelLegendRow
                      key={card.label}
                      icon={card.icon}
                      label={card.label}
                      detail={card.detail}
                      compact
                    />
                  ))}
                  </div>
                </div>
                <div className="mt-3 space-y-2">
                  {criticalEvents.length === 0 ? (
                    <EmptyState label="Live calls land here when the first drop, bounty, coach, or elimination hits." compact />
                  ) : (
                    criticalEvents.slice(-2).map((event) => (
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
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-amber-100/55">
              Observer
            </p>
            <h2 className="mt-1 text-2xl font-semibold text-[#f6ead7]">
              Live Frontier
            </h2>
            <p className="mt-1 text-sm text-stone-200/68">
              Public frontier board with live rounds, rider history, and linked onchain footing.
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.16em] text-stone-300/58">
              <span className="rounded-full border border-white/10 px-2.5 py-1">
                {liveFrontierStats.matches} matches
              </span>
              <span className="rounded-full border border-white/10 px-2.5 py-1">
                {liveFrontierStats.riders} riders live
              </span>
              <span className="rounded-full border border-white/10 px-2.5 py-1">
                {liveFrontierStats.linked} linked treasuries
              </span>
              <span className="rounded-full border border-white/10 px-2.5 py-1">
                {liveFrontierStats.premium} premium riders
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(["all", "paid", "practice"] as const).map((filter) => (
              <button
                key={filter}
                type="button"
                onClick={() => setLiveFrontierFilter(filter)}
                className={`rounded-full border px-3 py-2 text-[10px] uppercase tracking-[0.18em] transition ${
                  liveFrontierFilter === filter
                    ? "border-[#7ed2b4]/24 bg-[#7ed2b4]/10 text-[#d9f7ee]"
                    : "border-white/10 bg-black/12 text-stone-200/68 hover:border-white/20 hover:text-white"
                }`}
              >
                {filter}
              </button>
            ))}
            <button
              type="button"
              onClick={async () => {
                const response = await fetchLiveMatches();
                setLiveMatches(response.matches);
                setLiveRiderProfiles(response.riderProfiles);
                setRecentFrontierResults(response.recentResults);
                setFrontierLeaders(response.leaders);
                setFrontierChainActivity(response.chainActivity);
              }}
              className="rounded-full border border-white/12 px-4 py-2 text-sm text-white/75 transition hover:border-white/22 hover:text-white"
            >
              Refresh
            </button>
          </div>
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
                  {(() => {
                    const leader = [...spotlightMatch.players].sort(
                      (left, right) => right.score - left.score,
                    )[0];
                    return leader
                      ? `${leader.displayName} leads on ${getFrontierMap(spotlightMatch.mapId ?? "dust_circuit").name}. Watch the field, the live prize, and the onchain riders underneath.`
                      : "A live frontier round is available to spectate.";
                  })()}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => handleSpectateMatch(spotlightMatch)}
                  disabled={!canSpectateLiveMatch}
                  className="rounded-full border border-white/12 px-4 py-2 text-xs uppercase tracking-[0.18em] text-white/80 transition hover:border-white/24 hover:text-white disabled:opacity-50"
                >
                  Watch Spotlight
                </button>
                <button
                  type="button"
                  onClick={() => handleSpectateMatch(spotlightMatch, { followLeader: true })}
                  disabled={!canSpectateLiveMatch}
                  className="rounded-full border border-[#7ed2b4]/25 bg-[#7ed2b4]/10 px-4 py-2 text-xs uppercase tracking-[0.18em] text-[#c5f4e9] transition hover:bg-[#7ed2b4]/16 disabled:opacity-50"
                >
                  Leader Cam
                </button>
              </div>
            </div>
          </div>
        )}
        <div className="mb-4 grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
          <div className="rounded-[24px] border border-white/8 bg-black/12 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-[0.18em] text-stone-300/56">
                  Frontier leaders
                </div>
                <div className="mt-1 text-sm text-stone-200/70">
                  The riders currently setting the pace across wins, streaks, and treasury pressure.
                </div>
              </div>
              <span className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-stone-200/60">
                Top {frontierLeaders.length}
              </span>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-3">
              {frontierLeaders.length === 0 ? (
                <div className="md:col-span-3">
                  <EmptyState label="Leaders show up once riders start closing runs." compact />
                </div>
              ) : (
                frontierLeaders.slice(0, 3).map((profile, index) => (
                  <FrontierLeaderCard
                    key={profile.agentId}
                    profile={profile}
                    rank={index + 1}
                    busy={frontierDossierBusyId === profile.agentId}
                    onOpen={() => handleOpenFrontierDossier(profile.agentId)}
                  />
                ))
              )}
            </div>
          </div>
          <div className="rounded-[24px] border border-white/8 bg-black/12 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-[0.18em] text-stone-300/56">
                  Chain pulse
                </div>
                <div className="mt-1 text-sm text-stone-200/70">
                  Recent X Layer and x402 activity from riders currently shaping the frontier.
                </div>
              </div>
              <span className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-stone-200/60">
                {frontierChainActivity.length} moves
              </span>
            </div>
            <div className="mt-3 space-y-2">
              {frontierChainActivity.length === 0 ? (
                <EmptyState label="New chain confirmations land here." compact />
              ) : (
                frontierChainActivity.slice(0, 4).map((activity) => (
                  <ChainPulseRow key={activity.txHash} activity={activity} />
                ))
              )}
            </div>
          </div>
        </div>
        {selectedFrontierDossier && (
          <div className="mb-4 rounded-[24px] border border-[#7ed2b4]/14 bg-[#7ed2b4]/6 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-[0.18em] text-[#c8f6ea]/72">
                  Rider dossier
                </div>
                <div className="mt-1 text-lg font-semibold text-[#f6ead7]">
                  {selectedFrontierDossier.profile.displayName}
                </div>
                <div className="mt-1 text-sm text-stone-200/72">
                  {selectedFrontierDossier.profile.campaignTierLabel} tier •{" "}
                  {selectedFrontierDossier.profile.wins} wins •{" "}
                  {selectedFrontierDossier.profile.currentStreak} streak •{" "}
                  {selectedFrontierDossier.profile.latestResultLabel}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {selectedFrontierLiveMatch && (
                  <button
                    type="button"
                    onClick={() => handleSpectateMatch(selectedFrontierLiveMatch, { followLeader: true })}
                    disabled={!canSpectateLiveMatch}
                    className="rounded-full border border-[#7ed2b4]/22 bg-[#7ed2b4]/10 px-4 py-2 text-xs uppercase tracking-[0.18em] text-[#d9f7ee] transition hover:bg-[#7ed2b4]/16 disabled:opacity-50"
                  >
                    Watch live rider
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedFrontierDossier(null)}
                  className="rounded-full border border-white/12 px-4 py-2 text-xs uppercase tracking-[0.18em] text-white/78 transition hover:border-white/24 hover:text-white"
                >
                  Close dossier
                </button>
              </div>
            </div>
            <div className="mt-4 grid gap-4 xl:grid-cols-[0.92fr_1.08fr]">
              <div className="grid gap-2 sm:grid-cols-2">
                <ObserverPulseCard
                  label="Treasury"
                  value={
                    selectedFrontierDossier.profile.onchainLinked
                      ? truncateAddress(selectedFrontierDossier.profile.walletAddress ?? "0x0000")
                      : "Pending"
                  }
                  detail={
                    selectedFrontierDossier.profile.onchainLinked
                      ? `${formatWeiToOkb(BigInt(selectedFrontierDossier.profile.careerPayoutWei))} career payout routed`
                      : "This rider has not completed the onchain loop yet."
                  }
                />
                <ObserverPulseCard
                  label="Premium lane"
                  value={
                    selectedFrontierDossier.profile.premiumPassActive
                      ? "x402 live"
                      : "Core loop only"
                  }
                  detail={
                    selectedFrontierDossier.profile.premiumPassActive
                      ? "Premium autonomy is active right now."
                      : "This rider is still operating on the base frontier loop."
                  }
                />
                <ObserverPulseCard
                  label="Best score"
                  value={`${selectedFrontierDossier.profile.bestScore} pts`}
                  detail={`${selectedFrontierDossier.profile.matchesPlayed} logged runs`}
                />
                <ObserverPulseCard
                  label="Chain history"
                  value={`${selectedFrontierDossier.profile.settlements} settles`}
                  detail={`${selectedFrontierDossier.profile.skillPurchases} upgrades • ${selectedFrontierDossier.profile.paidEntries} paid entries`}
                />
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                <div className="rounded-[18px] border border-white/8 bg-black/14 px-3 py-3">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-stone-300/56">
                    Recent frontier tape
                  </div>
                  <div className="mt-3 space-y-2">
                    {selectedFrontierDossier.recentMatches.length === 0 ? (
                      <EmptyState label="No closed runs are logged for this rider yet." compact />
                    ) : (
                      selectedFrontierDossier.recentMatches.map((record) => (
                        <FrontierTapeRow key={record.matchId} record={record} />
                      ))
                    )}
                  </div>
                </div>
                <div className="rounded-[18px] border border-white/8 bg-black/14 px-3 py-3">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-stone-300/56">
                    Recent chain receipts
                  </div>
                  <div className="mt-3 space-y-2">
                    {selectedFrontierDossier.recentReceipts.length === 0 ? (
                      <EmptyState label="This rider has no confirmed receipts yet." compact />
                    ) : (
                      selectedFrontierDossier.recentReceipts.map((receipt) => (
                        <DossierReceiptRow key={receipt.txHash} receipt={receipt} />
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        {recentFrontierResults.length > 0 && (
          <div className="mb-4 rounded-[24px] border border-white/8 bg-black/12 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-[0.18em] text-stone-300/56">
                  Recent winners
                </div>
                <div className="mt-1 text-sm text-stone-200/70">
                  Closed frontier runs with map, payout, and settlement proof.
                </div>
              </div>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              {recentFrontierResults.slice(0, 4).map((result) => (
                <FrontierResultCard
                  key={result.matchId}
                  result={result}
                  busy={
                    Boolean(result.winnerAgentId) &&
                    frontierDossierBusyId === result.winnerAgentId
                  }
                  onOpen={
                    result.winnerAgentId
                      ? () => handleOpenFrontierDossier(result.winnerAgentId!)
                      : undefined
                  }
                />
              ))}
            </div>
          </div>
        )}
        <div className="space-y-3">
          {filteredLiveMatches.length === 0 && (
            <EmptyState label="No public matches are live right now." />
          )}
          {filteredLiveMatches.map((match, index) => (
            <div
              key={match.matchId}
              className={`rounded-[22px] border p-4 ${
                snapshot?.matchId === match.matchId
                  ? "border-[#7ed2b4]/22 bg-[#7ed2b4]/8"
                  : "border-white/8 bg-black/10"
              }`}
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
	                      Map{" "}
	                      <span className="text-[#f6ead7]">
	                        {getFrontierMap(match.mapId ?? "dust_circuit").name}
	                      </span>
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
                  <div className="mt-3 grid gap-2 md:grid-cols-3">
                    <ObserverPulseCard
                      label="Hot rider"
                      value={
                        [...match.players].sort(
                          (left, right) => right.score - left.score,
                        )[0]?.displayName ?? "—"
                      }
                      detail={`${
                        [...match.players].sort(
                          (left, right) => right.score - left.score,
                        )[0]?.score ?? 0
                      } score on the ledger`}
                    />
                    <ObserverPulseCard
                      label="Live prize"
                      value={
                        match.objective
                          ? match.objective.label
                          : match.caravan
                            ? match.caravan.label
                            : match.bounty
                              ? `Bounty ${match.bounty.displayName}`
                              : "Open duel"
                      }
                      detail={
                        match.objective
                          ? match.objective.rewardLabel
                          : match.caravan
                            ? match.caravan.rewardLabel
                            : match.bounty
                              ? `Worth +${match.bounty.bonusScore} score`
                              : "No live side prize right now"
                      }
                    />
                    <ObserverPulseCard
                      label="Field state"
                      value={`${match.players.filter((player) => player.alive).length} alive`}
                      detail={
                        match.status === "queued"
                          ? "Waiting for the draw"
                          : `${Math.round(match.safeZone.radius)}px ring`
                      }
                    />
                  </div>
                  <div className="mt-3">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-stone-300/56">
                      Frontier riders
                    </div>
                    <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                      {[...match.players]
                        .sort((left, right) => right.score - left.score)
                        .map((player) => (
                          <FrontierRiderCard
                            key={player.agentId}
                            player={player}
                            profile={liveRiderProfilesById.get(player.agentId)}
                            active={snapshot?.matchId === match.matchId && selectedAgent?.id === player.agentId}
                            busy={frontierDossierBusyId === player.agentId}
                            onOpen={
                              player.agentId.toLowerCase().startsWith("house-bot-")
                                ? undefined
                                : () => handleOpenFrontierDossier(player.agentId)
                            }
                          />
                        ))}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => handleSpectateMatch(match)}
                    disabled={!canSpectateLiveMatch}
                    className="rounded-full border border-white/12 px-4 py-2 text-xs uppercase tracking-[0.18em] text-white/80 transition hover:border-white/24 hover:text-white disabled:opacity-50"
                  >
                    Watch
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSpectateMatch(match, { followLeader: true })}
                    disabled={!canSpectateLiveMatch}
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
	                    {formatReceiptLaneLabel(item.receipt)}
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

  const map = getFrontierMap(snapshot.mapId ?? "dust_circuit");

  return (
    <div className="rounded-[22px] border border-white/8 bg-[#170f0b] p-3">
      <div className="relative aspect-[16/9] overflow-hidden rounded-[18px] border border-amber-300/10 bg-[radial-gradient(circle_at_top,_rgba(236,183,102,0.12),_transparent_48%),linear-gradient(180deg,_rgba(52,32,22,0.95),_rgba(19,11,8,0.98))]">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(244,227,199,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(244,227,199,0.06)_1px,transparent_1px)] bg-[size:32px_32px]" />
        {map.obstacles.map((obstacle) => (
          <div
            key={obstacle.id}
            className="absolute -translate-x-1/2 -translate-y-1/2 border border-white/8 bg-black/28 shadow-[0_0_12px_rgba(0,0,0,0.22)]"
            style={{
              left: `${(obstacle.x / 1600) * 100}%`,
              top: `${(obstacle.y / 900) * 100}%`,
              width:
                obstacle.solid.shape === "rect"
                  ? `${(obstacle.solid.width / 1600) * 100}%`
                  : `${(obstacle.solid.radius * 2 / 1600) * 100}%`,
              height:
                obstacle.solid.shape === "rect"
                  ? `${(obstacle.solid.height / 900) * 100}%`
                  : `${(obstacle.solid.radius * 2 / 900) * 100}%`,
              borderRadius:
                obstacle.solid.shape === "rect" ? "0.6rem" : "9999px",
            }}
          />
        ))}
        {map.landmarks.slice(0, 6).map((landmark) => (
          <div
            key={landmark.id}
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/8 bg-black/18 px-2 py-1 text-[9px] uppercase tracking-[0.12em] text-stone-200/58"
            style={{
              left: `${(landmark.x / 1600) * 100}%`,
              top: `${(landmark.y / 900) * 100}%`,
            }}
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
                    ? "h-4.5 w-4.5 border-[#dff9ff] bg-[#9ce9ff] shadow-[0_0_18px_rgba(156,233,255,0.45)]"
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

function ResultStatCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[18px] border border-white/8 bg-black/18 px-4 py-3 text-left">
      <div className="text-[10px] uppercase tracking-[0.18em] text-stone-300/56">
        {label}
      </div>
      <div className="mt-1 font-semibold text-[#f6ead7]">{value}</div>
    </div>
  );
}

function ObserverPulseCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-[16px] border border-white/8 bg-white/[0.03] px-3 py-3">
      <div className="text-[10px] uppercase tracking-[0.16em] text-stone-300/56">
        {label}
      </div>
      <div className="mt-1 font-semibold text-[#f6ead7]">{value}</div>
      <div className="mt-1 text-xs text-stone-200/66">{detail}</div>
    </div>
  );
}

function FrontierResultCard({
  result,
  onOpen,
  busy = false,
}: {
  result: FrontierRecentResult;
  onOpen?: () => void;
  busy?: boolean;
}) {
  return (
    <div className="rounded-[18px] border border-white/8 bg-black/14 px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-[0.16em] text-stone-300/56">
          {result.paid ? "Paid showdown" : "Practice run"}
        </div>
        <div className="rounded-full border border-white/10 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-stone-200/62">
          {getFrontierMap(result.mapId).name}
        </div>
      </div>
      <div className="mt-2 text-sm font-semibold text-[#f6ead7]">
        {result.winnerDisplayName}
      </div>
      <div className="mt-1 text-xs text-stone-200/68">
        Match {result.matchId.slice(-6)} • {result.players} riders
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5 text-[10px] uppercase tracking-[0.14em] text-stone-300/58">
        <span className="rounded-full border border-white/10 px-2 py-1">
          Winner {formatWeiToOkb(BigInt(result.payoutWei))}
        </span>
        <span className="rounded-full border border-white/10 px-2 py-1">
          {result.settlementTxHash ? "settled" : "no settle"}
        </span>
      </div>
      {onOpen && (
        <button
          type="button"
          onClick={onOpen}
          disabled={busy}
          className="mt-3 inline-flex items-center gap-2 rounded-full border border-white/12 px-3 py-1.5 text-[10px] uppercase tracking-[0.16em] text-white/76 transition hover:border-white/22 hover:text-white disabled:opacity-60"
        >
          {busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}
          Open dossier
        </button>
      )}
    </div>
  );
}

function FrontierRiderCard({
  player,
  profile,
  active = false,
  onOpen,
  busy = false,
}: {
  player: MatchSnapshot["players"][number];
  profile?: FrontierRiderProfile;
  active?: boolean;
  onOpen?: () => void;
  busy?: boolean;
}) {
  const isHouseBot = profile?.kind === "house_bot" || !profile;

  return (
    <div
      className={`rounded-[18px] border px-3 py-3 ${
        active
          ? "border-[#7ed2b4]/22 bg-[#7ed2b4]/10"
          : "border-white/8 bg-black/14"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-[#f6ead7]">
            {player.displayName}
          </div>
          <div className="mt-1 text-[10px] uppercase tracking-[0.16em] text-stone-300/56">
            {profile?.campaignTierLabel ?? "LIVE"}
          </div>
        </div>
        <div className="rounded-full border border-white/10 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-stone-200/65">
          {player.mode === "autonomous" ? "auto" : "manual"}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-[11px] uppercase tracking-[0.14em] text-stone-300/56">
        <div>
          <div>Score</div>
          <div className="mt-1 text-sm font-semibold text-[#f0bf76]">
            {player.score}
          </div>
        </div>
        <div>
          <div>HP</div>
          <div className="mt-1 text-sm font-semibold text-[#f6ead7]">
            {player.health}
          </div>
        </div>
        <div>
          <div>Wins</div>
          <div className="mt-1 text-sm font-semibold text-[#f6ead7]">
            {profile?.wins ?? 0}
          </div>
        </div>
      </div>
      <div className="mt-3 text-xs leading-relaxed text-stone-200/70">
        {profile?.latestResultLabel ??
          "Live round in progress. Frontier record will show up after the first closed run."}
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5 text-[10px] uppercase tracking-[0.14em] text-stone-300/58">
        <span className="rounded-full border border-white/10 px-2 py-1">
          {profile?.currentStreak ?? 0} streak
        </span>
        <span className="rounded-full border border-white/10 px-2 py-1">
          {profile?.settlements ?? 0} settles
        </span>
        <span className="rounded-full border border-white/10 px-2 py-1">
          {profile?.skillPurchases ?? 0} upgrades
        </span>
        <span className="rounded-full border border-white/10 px-2 py-1">
          {isHouseBot
            ? "bot"
            : profile?.premiumPassActive
              ? "premium on"
              : "premium off"}
        </span>
      </div>
      {!isHouseBot && (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-stone-300/56">
            <span className="rounded-full border border-[#7ed2b4]/18 bg-[#7ed2b4]/8 px-2 py-1 text-[#d9f7ee]">
              {profile?.onchainLinked ? "treasury linked" : "treasury pending"}
            </span>
            {profile?.lastReceiptPurpose && (
              <span className="rounded-full border border-white/10 px-2 py-1">
                {formatReceiptPurpose(profile.lastReceiptPurpose)}
              </span>
            )}
            {profile?.walletAddress && (
              <span className="rounded-full border border-white/10 px-2 py-1">
                {truncateAddress(profile.walletAddress)}
              </span>
            )}
          </div>
          {onOpen && (
            <button
              type="button"
              onClick={onOpen}
              disabled={busy}
              className="mt-3 inline-flex items-center gap-2 rounded-full border border-white/12 px-3 py-1.5 text-[10px] uppercase tracking-[0.16em] text-white/76 transition hover:border-white/22 hover:text-white disabled:opacity-60"
            >
              {busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}
              Rider dossier
            </button>
          )}
        </>
      )}
    </div>
  );
}

function FrontierLeaderCard({
  profile,
  rank,
  onOpen,
  busy = false,
}: {
  profile: FrontierRiderProfile;
  rank: number;
  onOpen: () => void;
  busy?: boolean;
}) {
  return (
    <div className="rounded-[18px] border border-white/8 bg-black/14 px-3 py-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-[0.16em] text-stone-300/56">
            Rank {rank}
          </div>
          <div className="mt-1 text-sm font-semibold text-[#f6ead7]">
            {profile.displayName}
          </div>
          <div className="mt-1 text-[11px] uppercase tracking-[0.14em] text-stone-300/56">
            {profile.campaignTierLabel}
          </div>
        </div>
        <span className="rounded-full border border-white/10 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-stone-200/62">
          {profile.premiumPassActive ? "premium" : "core"}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-[11px] uppercase tracking-[0.14em] text-stone-300/56">
        <div>
          <div>Wins</div>
          <div className="mt-1 text-sm font-semibold text-[#f6ead7]">{profile.wins}</div>
        </div>
        <div>
          <div>Streak</div>
          <div className="mt-1 text-sm font-semibold text-[#f6ead7]">
            {profile.currentStreak}
          </div>
        </div>
        <div>
          <div>Payout</div>
          <div className="mt-1 text-sm font-semibold text-[#f0bf76]">
            {formatWeiToOkb(BigInt(profile.careerPayoutWei))}
          </div>
        </div>
      </div>
      <div className="mt-3 text-xs leading-relaxed text-stone-200/68">
        {profile.latestResultLabel}
      </div>
      <button
        type="button"
        onClick={onOpen}
        disabled={busy}
        className="mt-3 inline-flex items-center gap-2 rounded-full border border-[#7ed2b4]/18 bg-[#7ed2b4]/8 px-3 py-1.5 text-[10px] uppercase tracking-[0.16em] text-[#d9f7ee] transition hover:bg-[#7ed2b4]/14 disabled:opacity-60"
      >
        {busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}
        Open dossier
      </button>
    </div>
  );
}

function ChainPulseRow({
  activity,
}: {
  activity: FrontierChainActivity;
}) {
  return (
    <div className="rounded-[16px] border border-white/8 bg-black/14 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.16em] text-stone-300/56">
            {activity.laneLabel}
          </div>
          <div className="mt-1 text-sm font-semibold text-[#f6ead7]">
            {activity.agentDisplayName ?? formatReceiptPurpose(activity.purpose)}
          </div>
        </div>
        {activity.explorerUrl ? (
          <a
            href={activity.explorerUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.16em] text-[#d9f7ee] transition hover:text-white"
          >
            Explorer
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : null}
      </div>
      <div className="mt-2 text-xs leading-relaxed text-stone-200/70">
        {activity.summary}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] uppercase tracking-[0.14em] text-stone-300/56">
        <span className="rounded-full border border-white/10 px-2 py-1">
          {formatReceiptPurpose(activity.purpose)}
        </span>
        {activity.matchId && (
          <span className="rounded-full border border-white/10 px-2 py-1">
            Match {activity.matchId.slice(-6)}
          </span>
        )}
      </div>
    </div>
  );
}

function FrontierTapeRow({
  record,
}: {
  record: AgentMatchRecord;
}) {
  return (
    <div className="rounded-[14px] border border-white/8 bg-black/16 px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[10px] uppercase tracking-[0.16em] text-stone-300/56">
          Match {record.matchId.slice(-6)}
        </div>
        <span className="rounded-full border border-white/10 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-stone-200/62">
          {record.paid ? "paid" : "practice"}
        </span>
      </div>
      <div className="mt-1 text-sm font-semibold text-[#f6ead7]">
        {record.won ? "Showdown win" : `Placed ${ordinal(record.placement)}`}
      </div>
      <div className="mt-1 text-xs text-stone-200/68">
        {record.kills} kills • {record.damageDealt} damage • {record.score} score
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] uppercase tracking-[0.14em] text-stone-300/56">
        <span className="rounded-full border border-white/10 px-2 py-1">
          {formatWeiToOkb(BigInt(record.payoutWei))} payout
        </span>
        {record.settlementTxHash && (
          <span className="rounded-full border border-white/10 px-2 py-1">
            settled
          </span>
        )}
      </div>
    </div>
  );
}

function DossierReceiptRow({
  receipt,
}: {
  receipt: OnchainReceipt;
}) {
  return (
    <div className="rounded-[14px] border border-white/8 bg-black/16 px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[10px] uppercase tracking-[0.16em] text-stone-300/56">
          {formatReceiptLaneLabel(receipt)}
        </div>
        {receipt.explorerUrl ? (
          <a
            href={receipt.explorerUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.16em] text-[#d9f7ee] transition hover:text-white"
          >
            Explorer
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : null}
      </div>
      <div className="mt-1 text-sm font-semibold text-[#f6ead7]">
        {formatReceiptPurpose(receipt.purpose)}
      </div>
      <div className="mt-1 text-xs text-stone-200/68">
        {formatReceiptRevealDetail(receipt)}
      </div>
      <div className="mt-2 text-[10px] uppercase tracking-[0.14em] text-stone-300/56">
        {truncateHash(receipt.txHash)}
      </div>
    </div>
  );
}

function SkillInfoTooltip({
  label,
  detail,
}: {
  label: string;
  detail: string;
}) {
  return (
    <div className="group relative">
      <button
        type="button"
        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-white/12 bg-white/6 text-stone-200/68 transition hover:border-white/22 hover:text-white"
        aria-label={`What ${label} does`}
      >
        <CircleHelp className="h-3.5 w-3.5" />
      </button>
      <div className="pointer-events-none absolute left-0 top-full z-20 mt-2 w-64 rounded-[16px] border border-white/10 bg-[#140d0a]/95 px-3 py-3 text-xs leading-relaxed text-stone-100/84 opacity-0 shadow-[0_16px_40px_rgba(0,0,0,0.45)] transition duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
        {detail}
      </div>
    </div>
  );
}

function IntelLegendRow({
  icon,
  label,
  detail,
  compact = false,
}: {
  icon: React.ReactNode;
  label: string;
  detail: string;
  compact?: boolean;
}) {
  return (
    <div
      className={`flex items-start gap-3 rounded-[16px] border border-white/8 bg-black/14 ${
        compact ? "px-3 py-2.5" : "px-3 py-3"
      }`}
    >
      <div
        className={`mt-0.5 rounded-full border border-white/10 bg-white/6 text-[var(--accent-soft)] ${
          compact ? "p-1.5" : "p-2"
        }`}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-300/58">
          {label}
        </div>
        <div
          className={`mt-1 text-stone-200/74 ${compact ? "text-[11px] leading-snug" : "text-xs leading-relaxed"}`}
        >
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
      return "x402 Premium Pass";
  }
}

function formatReceiptLaneLabel(receipt: OnchainReceipt) {
  return receipt.purpose === "autonomy_pass"
    ? "X Layer Mainnet x402"
    : "X Layer Testnet";
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
      return "Premium autonomy has been unlocked over x402 on X Layer mainnet.";
  }
}

function formatUsdcAmount(raw?: string) {
  if (!raw) {
    return "0";
  }

  const normalized = Number(raw) / 1_000_000;
  if (!Number.isFinite(normalized)) {
    return raw;
  }

  return normalized.toFixed(normalized >= 10 ? 0 : 2);
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

function simplifyAutonomyCall(message: string) {
  return message.replace(/^[^:]+ directive:\s*/i, "");
}

function formatWeiToOkb(value: bigint) {
  return `${formatEther(value)} OKB`;
}

function formatSignedPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

function agentIdToBytes32(agentId: string) {
  return keccak256(stringToHex(agentId));
}

function matchIdToBytes32(matchId: string) {
  return keccak256(stringToHex(matchId));
}
