import type {
  AgentCampaignStats,
  AgentMatchRecord,
  AgentProfile,
  AutonomyPlan,
  ArenaCommand,
  FrontierRecentResult,
  FrontierRiderProfile,
  MatchSnapshot,
  OnchainReceipt,
  SkillKey,
} from "@rdr/shared";

const serverUrl = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:4000";

export type QueueUpdate = {
  status: "idle" | "queued" | "ready";
  matchId?: string;
  queuedAt?: string;
  queueKind?: "practice" | "paid";
  slotsFilled?: number;
  slotsTotal?: number;
  humansCommitted?: number;
  etaSeconds?: number;
};

export type QueueForMatchResponse = {
  status: "payment_required" | "queued";
  matchId?: string;
  entryReceipt?: OnchainReceipt | null;
};

export async function apiRequest<T>(
  path: string,
  options?: RequestInit & { token?: string },
) {
  const response = await fetch(`${serverUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers ?? {}),
      ...(options?.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    cache: "no-store",
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("Session expired. Sign in again.");
    }
    throw new Error(payload.error ?? "Request failed");
  }
  return payload as T;
}

export async function fetchNonce(address: string) {
  return apiRequest<{ nonce: string; message: string }>("/auth/nonce", {
    method: "POST",
    body: JSON.stringify({ address }),
  });
}

export async function verifySignature(
  address: string,
  nonce: string,
  signature: string,
) {
  return apiRequest<{ token: string; address: string }>("/auth/verify", {
    method: "POST",
    body: JSON.stringify({ address, nonce, signature }),
  });
}

export async function fetchAgents(token: string) {
  return apiRequest<{ agents: AgentProfile[]; contractAddress: string | null }>(
    "/agents",
    {
      token,
    },
  );
}

export async function createAgent(token: string, baseName: string) {
  return apiRequest<{ agent: AgentProfile; registrationRequired: boolean }>(
    "/agents",
    {
      method: "POST",
      token,
      body: JSON.stringify({ baseName }),
    },
  );
}

export async function registerAgentOnServer(
  token: string,
  agentId: string,
  txHash: string,
) {
  return apiRequest<{ receipt: OnchainReceipt }>(
    `/agents/${agentId}/register`,
    {
      method: "POST",
      token,
      body: JSON.stringify({ txHash }),
    },
  );
}

export async function updateAgentMode(
  token: string,
  agentId: string,
  mode: "manual" | "autonomous",
) {
  return apiRequest<{ agent: AgentProfile }>(`/agents/${agentId}/mode`, {
    method: "POST",
    token,
    body: JSON.stringify({ mode }),
  });
}

export async function fetchTransactions(token: string, agentId: string) {
  return apiRequest<{ receipts: OnchainReceipt[] }>(
    `/agents/${agentId}/transactions`,
    {
      token,
    },
  );
}

export async function fetchAutonomyPlan(token: string, agentId: string) {
  return apiRequest<{ plan: AutonomyPlan }>(`/agents/${agentId}/autonomy-plan`, {
    token,
  });
}

export async function fetchCampaignStats(token: string, agentId: string) {
  return apiRequest<{ campaign: AgentCampaignStats }>(
    `/agents/${agentId}/campaign`,
    {
      token,
    },
  );
}

export async function fetchAgentMatches(token: string, agentId: string) {
  return apiRequest<{ matches: AgentMatchRecord[] }>(`/agents/${agentId}/matches`, {
    token,
  });
}

export async function registerSkillPurchase(
  token: string,
  agentId: string,
  skill: SkillKey,
  txHash: string,
) {
  return apiRequest<{ agent: AgentProfile; receipt: OnchainReceipt }>(
    `/agents/${agentId}/skills`,
    {
      method: "POST",
      token,
      body: JSON.stringify({ skill, txHash }),
    },
  );
}

export async function queueForMatch(
  token: string,
  agentId: string,
  paid: boolean,
  matchId?: string,
  txHash?: string,
) {
  return apiRequest<QueueForMatchResponse>(`/matches/queue`, {
    method: "POST",
    token,
    body: JSON.stringify({ agentId, paid, matchId, txHash }),
  });
}

export async function sendArenaCommand(
  token: string,
  matchId: string,
  agentId: string,
  command: ArenaCommand,
) {
  return apiRequest<{ accepted: true }>(`/matches/${matchId}/command`, {
    method: "POST",
    token,
    body: JSON.stringify({ agentId, command }),
  });
}

export async function fetchQueueStatus(token: string) {
  return apiRequest<QueueUpdate>(`/matches/queue-status`, {
    token,
  });
}

export async function fetchMatchSnapshot(matchId: string) {
  return apiRequest<{ match: MatchSnapshot }>(`/matches/${matchId}`);
}

export async function fetchLiveMatches() {
  return apiRequest<{
    matches: MatchSnapshot[];
    riderProfiles: FrontierRiderProfile[];
    recentResults: FrontierRecentResult[];
  }>("/matches/live");
}

export async function requestAutonomyPass(
  token: string,
  agentId: string,
  fetchImpl: typeof fetch = fetch,
) {
  const response = await fetchImpl(`${serverUrl}/payments/x402/autonomy-pass`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ agentId }),
  });

  const payload = await response.json();
  return {
    status: response.status,
    payload,
    headers: {
      paymentRequired: response.headers.get("PAYMENT-REQUIRED"),
      paymentResponse: response.headers.get("PAYMENT-RESPONSE"),
    },
  };
}
