"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  Crosshair,
  Expand,
  Gem,
  LoaderCircle,
  Minimize,
  PlugZap,
  RadioTower,
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
  mapSkillToId,
  matchEntryFeeWei,
  skillKeys,
  skillLabels,
  type AgentProfile,
  type ArenaCommand,
  type MatchEvent,
  type MatchSnapshot,
  type OnchainReceipt,
  type SkillKey,
} from "@rdr/shared";

import {
  createAgent,
  fetchAgents,
  fetchTransactions,
  fetchLiveMatches,
  fetchNonce,
  queueForMatch,
  registerAgentOnServer,
  registerSkillPurchase,
  requestAutonomyPass,
  updateAgentMode,
  verifySignature,
  type QueueUpdate,
} from "../lib/api";
import { connectGameSocket } from "../lib/socket";
import { xLayerTestnetChain } from "../lib/wagmi";
import { ArenaCanvas } from "./arena-canvas";

const authStorageKey = "rdr-auth-token";

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
  const [baseName, setBaseName] = useState("Marshal");
  const [status, setStatus] = useState<string>(
    "Connect a wallet on X Layer testnet to enter the frontier.",
  );
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [autonomyHint, setAutonomyHint] = useState<string | null>(null);
  const [arenaReadyForControls, setArenaReadyForControls] = useState(false);
  const [arenaFullscreen, setArenaFullscreen] = useState(false);

  const socketRef = useRef<ReturnType<typeof connectGameSocket> | null>(null);
  const arenaFrameRef = useRef<HTMLDivElement | null>(null);

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
  const deployedContractAddress =
    contractAddress ?? process.env.NEXT_PUBLIC_ARENA_ECONOMY_ADDRESS ?? null;

  useEffect(() => {
    const existing = window.localStorage.getItem(authStorageKey);
    if (existing) {
      setAuthToken(existing);
    }
  }, []);

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
      setQueueState(payload);
      if (payload.matchId) {
        socket.emit("match:join", { matchId: payload.matchId });
        setStatus(
          payload.status === "ready"
            ? "Match found. Ride in."
            : "Searching for rivals.",
        );
      }
    });
    socket.on("match:snapshot", (nextSnapshot: MatchSnapshot) => {
      setSnapshot(nextSnapshot);
      setRecentEvents(nextSnapshot.events.slice(-8));
    });
    socket.on("match:event", (events: MatchEvent[]) => {
      setRecentEvents((current) => [...current, ...events].slice(-8));
    });
    socket.on("match:result", (result: MatchSnapshot) => {
      setSnapshot(result);
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
    });

    socketRef.current = socket;
    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [authToken]);

  useEffect(() => {
    if (!authToken || !selectedAgent) {
      return;
    }
    void loadTransactions(selectedAgent.id);
  }, [authToken, selectedAgent?.id]);

  useEffect(() => {
    function syncFullscreenState() {
      setArenaFullscreen(document.fullscreenElement === arenaFrameRef.current);
    }

    document.addEventListener("fullscreenchange", syncFullscreenState);
    return () => {
      document.removeEventListener("fullscreenchange", syncFullscreenState);
    };
  }, []);

  async function ensureXLayer() {
    if (chainId === xLayerTestnetChain.id) {
      return;
    }
    await switchChainAsync({ chainId: xLayerTestnetChain.id });
  }

  async function handleArenaFullscreenToggle() {
    if (!arenaFrameRef.current) {
      return;
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

  async function loadTransactions(agentId: string) {
    if (!authToken) {
      return;
    }
    const response = await fetchTransactions(authToken, agentId);
    setTransactions(response.receipts);
  }

  async function handleSignIn() {
    if (!address) {
      return;
    }

    setBusyAction("sign-in");
    try {
      await ensureXLayer();
      const noncePayload = await fetchNonce(address);
      const signature = await signMessageAsync({
        message: noncePayload.message,
      });
      const verified = await verifySignature(
        address,
        noncePayload.nonce,
        signature,
      );
      window.localStorage.setItem(authStorageKey, verified.token);
      setAuthToken(verified.token);
      setStatus("Signed in. Create or command your agents.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Sign in failed.");
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
        await ensureAgentRegisteredOnchain(response.agent);
      }
      setAgents((current) => [...current, response.agent]);
      setSelectedAgentId(response.agent.id);
      await loadTransactions(response.agent.id);
      setBaseName("Gunslinger");
      setStatus(`${response.agent.displayName} is ready for the frontier.`);
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Agent creation failed.",
      );
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
      setStatus(`${response.agent.displayName} is now ${mode}.`);
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Unable to switch mode.",
      );
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
      setAgents((current) =>
        current.map((agent) =>
          agent.id === response.agent.id ? response.agent : agent,
        ),
      );
      await loadTransactions(selectedAgent.id);
      setStatus(
        `${skillLabels[skill]} improved for ${selectedAgent.displayName}.`,
      );
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Skill purchase failed.",
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function handleQueue(paid: boolean) {
    if (!selectedAgent || !authToken) {
      return;
    }

    setBusyAction(paid ? "paid-queue" : "practice-queue");
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
        setQueueState({
          status: "queued",
          matchId: queued.matchId ?? preparation.matchId,
        });
        setStatus("Paid queue confirmed onchain.");
      } else {
        await queueForMatch(authToken, selectedAgent.id, false);
        setQueueState({ status: "queued" });
        setStatus("Practice queue started.");
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Queueing failed.");
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
        setAutonomyHint(JSON.stringify(response.payload, null, 2));
        setStatus("x402 payment is required for the autonomy pass.");
      } else {
        setAutonomyHint(JSON.stringify(response.payload, null, 2));
        setStatus("Autonomy pass activated.");
      }
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Autonomy pass request failed.",
      );
    } finally {
      setBusyAction(null);
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
      return;
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
    await registerAgentOnServer(authToken, agent.id, registrationTx);
  }

  function handleArenaCommand(command: ArenaCommand) {
    if (!snapshot || !selectedAgent || selectedAgent.mode !== "manual") {
      return;
    }

    socketRef.current?.emit("match:command", {
      matchId: snapshot.matchId,
      agentId: selectedAgent.id,
      command,
    });
  }

  function startDirectionalMove(dx: number, dy: number) {
    handleArenaCommand({ type: "move", dx, dy });
  }

  function stopDirectionalMove() {
    handleArenaCommand({ type: "idle" });
  }

  const buyDisabled =
    !deployedContractAddress || !walletClient || busyAction !== null;
  const liveAgentStats = selectedAgent?.skills ?? null;

  return (
    <main className="min-h-screen px-4 py-6 md:px-8">
      <section className="mx-auto flex max-w-[1600px] flex-col gap-6">
        <div className="western-card relative overflow-hidden rounded-[32px] border px-6 py-6 md:px-10 md:py-8">
          <div className="absolute inset-0 dust-grid opacity-40" />
          <div className="relative grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
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
                        window.localStorage.removeItem(authStorageKey);
                        setAuthToken(null);
                        setAgents([]);
                        setSelectedAgentId(undefined);
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
            <div className="grid gap-4 rounded-[28px] border border-amber-200/10 bg-black/15 p-5 backdrop-blur">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.26em] text-amber-100/60">
                    Operator Notes
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold text-[#f6ead7]">
                    Build Your Crew
                  </h2>
                </div>
                <Bot className="h-8 w-8 text-[#f0bf76]" />
              </div>
              <label className="space-y-2">
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
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-amber-200/20 bg-amber-100/10 px-4 py-3 text-sm font-medium text-[#f6ead7] transition hover:bg-amber-100/15 disabled:opacity-50"
              >
                {busyAction === "create-agent" ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <Gem className="h-4 w-4" />
                )}
                {authToken ? "Mint a New Agent Profile" : "Sign In to Mint an Agent"}
              </button>
              <p className="text-sm text-stone-300/68">
                Every agent is named as{" "}
                <span className="font-semibold text-[#f6dfb7]">
                  BaseName-ULIDSuffix
                </span>
                , starts with five core stats, and gets a linked subwallet for
                settlement.
              </p>
              {!authToken ? (
                <p className="text-xs text-amber-100/75">
                  Next step: click <span className="font-semibold">Sign In</span> above, approve the wallet signature, then mint the agent.
                </p>
              ) : null}
            </div>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)_360px]">
          <section className="western-card rounded-[30px] border p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-amber-100/55">
                  Roster
                </p>
                <h2 className="mt-1 text-2xl font-semibold text-[#f6ead7]">
                  Your Agents
                </h2>
              </div>
              <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-stone-200/70">
                {agents.length}/3
              </span>
            </div>
            <div className="scrollbar-thin flex max-h-[740px] flex-col gap-3 overflow-auto pr-1">
              {agents.map((agent) => {
                const active = agent.id === selectedAgent?.id;
                return (
                  <button
                    type="button"
                    key={agent.id}
                    onClick={() => setSelectedAgentId(agent.id)}
                    className={`rounded-[24px] border p-4 text-left transition ${active ? "border-amber-300/35 bg-amber-100/10" : "border-white/8 bg-white/3 hover:border-white/16"}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-semibold text-[#f6ead7]">
                          {agent.displayName}
                        </h3>
                        <p className="mt-1 text-xs uppercase tracking-[0.18em] text-stone-200/60">
                          {agent.mode} •{" "}
                          {agent.isStarter ? "starter" : "secondary"}
                        </p>
                      </div>
                      <div
                        className={`rounded-full px-3 py-1 text-xs ${agent.mode === "autonomous" ? "bg-[#df6c39]/20 text-[#ffd0ae]" : "bg-[#7ed2b4]/15 text-[#bdece0]"}`}
                      >
                        {agent.mode}
                      </div>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-stone-200/72">
                      {skillKeys.map((skill) => (
                        <div
                          key={skill}
                          className="rounded-2xl border border-white/8 bg-black/12 px-3 py-2"
                        >
                          <div className="text-stone-300/60">
                            {skillLabels[skill]}
                          </div>
                          <div className="mt-1 text-base font-semibold text-[#f6ead7]">
                            {agent.skills[skill]}
                          </div>
                        </div>
                      ))}
                    </div>
                  </button>
                );
              })}
              {agents.length === 0 && (
                <EmptyState label="No agents yet. Sign in and create your first outlaw." />
              )}
            </div>
          </section>

          <section className="western-card rounded-[30px] border p-5">
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
                  disabled={!selectedAgent || busyAction !== null}
                  className="inline-flex items-center gap-2 rounded-full bg-[#d5752d] px-4 py-2 text-sm font-medium text-black transition hover:bg-[#eb9150] disabled:opacity-50"
                >
                  {busyAction === "paid-queue" ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sword className="h-4 w-4" />
                  )}
                  Paid Queue
                </button>
                <button
                  type="button"
                  onClick={() => handleQueue(false)}
                  disabled={!selectedAgent || busyAction !== null}
                  className="rounded-full border border-white/14 px-4 py-2 text-sm text-white/80 transition hover:border-white/28 disabled:opacity-50"
                >
                  Practice Queue
                </button>
              </div>
            </div>
            <div
              ref={arenaFrameRef}
              className={`relative overflow-hidden rounded-[28px] border border-white/8 bg-[#120b08] ${
                arenaFullscreen ? "h-screen w-screen rounded-none border-0" : "aspect-[16/9]"
              }`}
            >
              <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-3 p-4">
                <div className="rounded-2xl border border-white/10 bg-black/45 px-4 py-3 text-xs text-stone-100/88 shadow-[0_10px_40px_rgba(0,0,0,0.28)] backdrop-blur">
                  <div className="font-semibold uppercase tracking-[0.18em] text-[#f0bf76]">
                    Arena Controls
                  </div>
                  <div className="mt-1">
                    {selectedAgent?.mode === "manual"
                      ? "WASD move • Click fire • Space dodge"
                      : "Switch the selected agent to manual mode to take control."}
                  </div>
                  <div className="mt-1 text-stone-300/75">
                    {selectedSnapshotPlayer?.alive
                      ? `${selectedSnapshotPlayer.displayName} is live in the arena.`
                      : snapshot?.status === "in_progress"
                        ? "Your selected rider is not active in this showdown."
                        : "Queue a match to take control."}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void handleArenaFullscreenToggle()}
                  className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-white/12 bg-black/45 px-4 py-2 text-sm text-stone-100/88 backdrop-blur transition hover:border-white/25 hover:bg-black/60"
                >
                  {arenaFullscreen ? (
                    <Minimize className="h-4 w-4" />
                  ) : (
                    <Expand className="h-4 w-4" />
                  )}
                  {arenaFullscreen ? "Exit Fullscreen" : "Fullscreen"}
                </button>
              </div>
              <ArenaCanvas
                snapshot={snapshot}
                selectedAgentId={selectedAgent?.id}
                canControl={
                  selectedAgent?.mode === "manual" &&
                  snapshot?.status === "in_progress" &&
                  Boolean(selectedSnapshotPlayer?.alive)
                }
                onCommand={handleArenaCommand}
                onControlReadyChange={setArenaReadyForControls}
              />
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
              <div className="rounded-[24px] border border-white/8 bg-black/10 p-4">
                <div className="mb-3 flex items-center gap-2 text-sm text-stone-200/72">
                  <Crosshair className="h-4 w-4 text-[#f0bf76]" />
                  <span>
                    Manual controls: WASD move, mouse to aim, click to fire,
                    space to dodge.
                  </span>
                </div>
                <div className="space-y-2 text-sm text-stone-200/72">
                  <div>Queue: {queueState?.status ?? "idle"}</div>
                  <div>
                    Current match: {snapshot?.matchId ?? "No active showdown"}
                  </div>
                  <div>Winner: {winnerDisplayName ?? "TBD"}</div>
                  <div>
                    Arena input:{" "}
                    {arenaReadyForControls
                      ? "armed"
                      : "loading renderer"}
                  </div>
                  <div>
                    Selected rider:{" "}
                    {selectedSnapshotPlayer
                      ? selectedSnapshotPlayer.alive
                        ? `${selectedSnapshotPlayer.displayName} in the fight`
                        : `${selectedSnapshotPlayer.displayName} was eliminated`
                      : "Not in the current showdown"}
                  </div>
                </div>
                <div className="mt-4">
                  <div className="mb-2 text-xs uppercase tracking-[0.18em] text-stone-300/55">
                    Backup controls
                  </div>
                  <div className="grid w-[144px] grid-cols-3 gap-2">
                    <span />
                    <button
                      type="button"
                      onMouseDown={() => startDirectionalMove(0, -1)}
                      onMouseUp={stopDirectionalMove}
                      onMouseLeave={stopDirectionalMove}
                      onTouchStart={() => startDirectionalMove(0, -1)}
                      onTouchEnd={stopDirectionalMove}
                      className="rounded-2xl border border-white/10 bg-white/6 px-3 py-3 text-sm text-white/80 transition hover:border-white/25 hover:bg-white/10"
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
                      className="rounded-2xl border border-white/10 bg-white/6 px-3 py-3 text-sm text-white/80 transition hover:border-white/25 hover:bg-white/10"
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
                      className="rounded-2xl border border-white/10 bg-white/6 px-3 py-3 text-sm text-white/80 transition hover:border-white/25 hover:bg-white/10"
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
                      className="rounded-2xl border border-white/10 bg-white/6 px-3 py-3 text-sm text-white/80 transition hover:border-white/25 hover:bg-white/10"
                    >
                      D
                    </button>
                  </div>
                </div>
              </div>
              <div className="rounded-[24px] border border-white/8 bg-black/10 p-4">
                <p className="mb-3 text-sm font-semibold text-[#f6ead7]">
                  Event Feed
                </p>
                <div className="scrollbar-thin max-h-44 space-y-2 overflow-auto pr-1 text-sm text-stone-200/72">
                  {recentEvents.length === 0 && (
                    <EmptyState
                      label="No events yet. Queue a match to start the duel."
                      compact
                    />
                  )}
                  {recentEvents.map((event) => (
                    <div
                      key={event.id}
                      className="rounded-2xl border border-white/7 bg-white/4 px-3 py-2"
                    >
                      {event.message}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="western-card rounded-[30px] border p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-amber-100/55">
                  Loadout
                </p>
                <h2 className="mt-1 text-2xl font-semibold text-[#f6ead7]">
                  Skill Shop
                </h2>
              </div>
              <button
                type="button"
                onClick={handleAutonomyPass}
                disabled={!selectedAgent || busyAction !== null}
                className="rounded-full border border-[#df6c39]/40 bg-[#df6c39]/10 px-3 py-2 text-xs text-[#ffd0ae] transition hover:bg-[#df6c39]/18 disabled:opacity-50"
              >
                x402 Autonomy Pass
              </button>
            </div>

            {selectedAgent && liveAgentStats ? (
              <div className="space-y-4">
                <div className="rounded-[24px] border border-white/8 bg-black/12 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-semibold text-[#f6ead7]">
                        {selectedAgent.displayName}
                      </h3>
                      <p className="mt-1 text-xs uppercase tracking-[0.18em] text-stone-200/60">
                        {selectedAgent.walletAddress}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleModeChange("manual")}
                        disabled={busyAction !== null}
                        className={`rounded-full px-3 py-2 text-xs ${selectedAgent.mode === "manual" ? "bg-[#7ed2b4]/18 text-[#c5f4e9]" : "border border-white/12 text-white/70"}`}
                      >
                        Manual
                      </button>
                      <button
                        type="button"
                        onClick={() => handleModeChange("autonomous")}
                        disabled={busyAction !== null}
                        className={`rounded-full px-3 py-2 text-xs ${selectedAgent.mode === "autonomous" ? "bg-[#df6c39]/18 text-[#ffd0ae]" : "border border-white/12 text-white/70"}`}
                      >
                        Autonomous
                      </button>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  {skillKeys.map((skill) => (
                    <div
                      key={skill}
                      className="rounded-[24px] border border-white/8 bg-black/12 p-4"
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <div className="text-sm font-semibold text-[#f6ead7]">
                            {skillLabels[skill]}
                          </div>
                          <div className="mt-1 text-xs text-stone-200/60">
                            Current: {selectedAgent.skills[skill]} / 100
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleBuySkill(skill)}
                          disabled={buyDisabled}
                          className="rounded-full border border-amber-300/25 bg-amber-100/10 px-3 py-2 text-xs text-[#f6ead7] transition hover:bg-amber-100/15 disabled:opacity-45"
                        >
                          Buy +5 •{" "}
                          {formatWeiToOkb(
                            calculateSkillPurchasePrice(
                              selectedAgent.skills[skill],
                            ),
                          )}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="rounded-[24px] border border-white/8 bg-black/12 p-4">
                  <p className="mb-3 text-sm font-semibold text-[#f6ead7]">
                    Onchain History
                  </p>
                  <div className="scrollbar-thin max-h-56 space-y-2 overflow-auto pr-1 text-sm text-stone-200/72">
                    {transactions.length === 0 && (
                      <EmptyState
                        label="No confirmed X Layer receipts yet."
                        compact
                      />
                    )}
                    {transactions.map((receipt) => (
                      <a
                        key={receipt.txHash}
                        href={receipt.explorerUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="block rounded-2xl border border-white/8 bg-white/4 px-3 py-3 transition hover:border-white/14"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-medium text-[#f6ead7]">
                            {receipt.purpose.replaceAll("_", " ")}
                          </span>
                          <span
                            className={`rounded-full px-2 py-1 text-[11px] uppercase ${receipt.status === "confirmed" ? "bg-emerald-200/12 text-emerald-200" : "bg-stone-200/10 text-stone-200/70"}`}
                          >
                            {receipt.status}
                          </span>
                        </div>
                        <div className="mt-2 text-xs text-stone-200/62">
                          {truncateHash(receipt.txHash)}
                        </div>
                      </a>
                    ))}
                  </div>
                </div>

                {autonomyHint && (
                  <pre className="scrollbar-thin max-h-64 overflow-auto rounded-[24px] border border-white/8 bg-black/14 p-4 text-xs text-stone-200/70">
                    {autonomyHint}
                  </pre>
                )}
              </div>
            ) : (
              <EmptyState label="Select or create an agent to inspect skills, queue matches, and review receipts." />
            )}
          </section>
        </div>

        <section className="western-card rounded-[30px] border p-5">
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
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {liveMatches.length === 0 && (
              <EmptyState label="No public matches are live right now." />
            )}
            {liveMatches.map((match) => (
              <div
                key={match.matchId}
                className="rounded-[24px] border border-white/8 bg-black/10 p-4"
              >
                <div className="text-xs uppercase tracking-[0.18em] text-stone-200/60">
                  {match.status}
                </div>
                <div className="mt-2 text-lg font-semibold text-[#f6ead7]">
                  {match.matchId}
                </div>
                <div className="mt-3 space-y-2 text-sm text-stone-200/68">
                  {match.players.map((player) => (
                    <div
                      key={player.agentId}
                      className="flex items-center justify-between gap-3 rounded-2xl border border-white/7 bg-white/4 px-3 py-2"
                    >
                      <span>{player.displayName}</span>
                      <span>{player.health} HP</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
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
      <div className="text-sm text-[#f6ead7]">{value}</div>
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

function formatWeiToOkb(value: bigint) {
  return `${formatEther(value)} OKB`;
}

function agentIdToBytes32(agentId: string) {
  return keccak256(stringToHex(agentId));
}

function matchIdToBytes32(matchId: string) {
  return keccak256(stringToHex(matchId));
}
