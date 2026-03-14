"use client";

import { io, type Socket } from "socket.io-client";

const serverUrl = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:4000";

export function connectGameSocket(token: string): Socket {
  return io(serverUrl, {
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    transports: ["websocket", "polling"],
    auth: {
      token,
    },
  });
}
