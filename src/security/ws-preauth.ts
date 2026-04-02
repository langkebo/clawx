/**
 * WebSocket Pre-authentication Security Guards
 *
 * Security hardening for WebSocket connections before authentication.
 * Addresses GHSA-jv4g-m82p-2j93: Oversized frame attack before auth.
 */

import type { WebSocket } from "ws";

const PREAUTH_MAX_FRAME_SIZE = 64 * 1024; // 64KB
const PREAUTH_HANDSHAKE_TIMEOUT_MS = 10_000; // 10 seconds
const PREAUTH_MAX_MESSAGE_RATE = 100; // messages per second
const PREAUTH_MAX_BUFFERED_AMOUNT = 1024 * 1024; // 1MB

export interface PreauthGuardsConfig {
  maxFrameSize?: number;
  handshakeTimeoutMs?: number;
  maxMessageRate?: number;
  maxBufferedAmount?: number;
}

export interface PreauthState {
  isAuthenticated: boolean;
  messageCount: number;
  firstMessageAt: number | null;
  lastMessageAt: number | null;
  totalBytesReceived: number;
  rejectedAt: number | null;
  rejectionReason: string | null;
}

export function createPreauthState(): PreauthState {
  return {
    isAuthenticated: false,
    messageCount: 0,
    firstMessageAt: null,
    lastMessageAt: null,
    totalBytesReceived: 0,
    rejectedAt: null,
    rejectionReason: null,
  };
}

export function installPreauthGuards(
  ws: WebSocket,
  config: PreauthGuardsConfig = {}
): PreauthState {
  const state = createPreauthState();
  const maxFrameSize = config.maxFrameSize ?? PREAUTH_MAX_FRAME_SIZE;
  const handshakeTimeoutMs = config.handshakeTimeoutMs ?? PREAUTH_HANDSHAKE_TIMEOUT_MS;
  const maxMessageRate = config.maxMessageRate ?? PREAUTH_MAX_MESSAGE_RATE;
  const maxBufferedAmount = config.maxBufferedAmount ?? PREAUTH_MAX_BUFFERED_AMOUNT;

  const authTimeout = setTimeout(() => {
    if (!state.isAuthenticated) {
      state.rejectedAt = Date.now();
      state.rejectionReason = "auth-timeout";
      ws.close(1008, "Authentication timeout");
    }
  }, handshakeTimeoutMs);

  ws.on("message", (data, isBinary) => {
    if (state.isAuthenticated) {
      return;
    }

    state.messageCount++;
    state.totalBytesReceived += data.length;
    const now = Date.now();

    if (state.firstMessageAt === null) {
      state.firstMessageAt = now;
    }
    state.lastMessageAt = now;

    if (data.length > maxFrameSize) {
      state.rejectedAt = now;
      state.rejectionReason = "frame-too-large";
      ws.close(1009, `Frame too large: ${data.length} > ${maxFrameSize}`);
      clearTimeout(authTimeout);
      return;
    }

    if (state.firstMessageAt !== null) {
      const elapsedSec = (now - state.firstMessageAt) / 1000;
      if (elapsedSec > 0 && state.messageCount / elapsedSec > maxMessageRate) {
        state.rejectedAt = now;
        state.rejectionReason = "rate-limit-exceeded";
        ws.close(1008, "Rate limit exceeded");
        clearTimeout(authTimeout);
        return;
      }
    }

    if (ws.bufferedAmount > maxBufferedAmount) {
      state.rejectedAt = now;
      state.rejectionReason = "buffer-overflow";
      ws.close(1009, "Buffer overflow");
      clearTimeout(authTimeout);
      return;
    }
  });

  ws.once("close", () => {
    clearTimeout(authTimeout);
  });

  return state;
}

export function markAuthenticated(state: PreauthState): void {
  state.isAuthenticated = true;
}

export function getPreauthStats(state: PreauthState): {
  messageCount: number;
  totalBytesReceived: number;
  durationMs: number | null;
  rejected: boolean;
  rejectionReason: string | null;
} {
  return {
    messageCount: state.messageCount,
    totalBytesReceived: state.totalBytesReceived,
    durationMs:
      state.firstMessageAt !== null && state.lastMessageAt !== null
        ? state.lastMessageAt - state.firstMessageAt
        : null,
    rejected: state.rejectedAt !== null,
    rejectionReason: state.rejectionReason,
  };
}

export function validatePreauthFrame(
  data: Buffer | ArrayBuffer | Buffer[],
  maxSize: number = PREAUTH_MAX_FRAME_SIZE
): { valid: boolean; size: number; reason?: string } {
  const size = Array.isArray(data) ? data.reduce((sum, buf) => sum + buf.length, 0) : data.byteLength;

  if (size > maxSize) {
    return { valid: false, size, reason: `Frame size ${size} exceeds limit ${maxSize}` };
  }

  return { valid: true, size };
}

export const PREAUTH_CONSTANTS = {
  MAX_FRAME_SIZE: PREAUTH_MAX_FRAME_SIZE,
  HANDSHAKE_TIMEOUT_MS: PREAUTH_HANDSHAKE_TIMEOUT_MS,
  MAX_MESSAGE_RATE: PREAUTH_MAX_MESSAGE_RATE,
  MAX_BUFFERED_AMOUNT: PREAUTH_MAX_BUFFERED_AMOUNT,
} as const;
