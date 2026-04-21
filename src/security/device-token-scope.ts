/**
 * Device Token Scope Validation
 *
 * Security hardening for device pairing token scope validation.
 * Addresses GHSA-2pwv-x786-56f8: Device token scope overflow.
 */

export interface DeviceTokenScope {
  deviceId: string;
  approvedScopes: string[];
  issuedAt: number;
  expiresAt: number;
}

export interface DeviceToken {
  deviceId: string;
  clientId: string;
  role: string;
  scopes: string[];
  signedAtMs: number;
  expiresAt?: number;
}

const SCOPE_HIERARCHY: Record<string, string[]> = {
  read: [],
  write: ["read"],
  exec: ["read", "write"],
  admin: ["read", "write", "exec"],
};

const VALID_SCOPES = new Set([
  "read",
  "write",
  "exec",
  "admin",
  "messages",
  "tools",
  "files",
  "sessions",
]);

const MAX_SCOPE_COUNT = 20;
const DEFAULT_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function validateDeviceTokenScope(
  token: DeviceToken,
  requestedScopes: string[],
): { valid: boolean; reason?: string } {
  if (!token.scopes || token.scopes.length === 0) {
    return { valid: false, reason: "Token has no approved scopes" };
  }

  if (requestedScopes.length > MAX_SCOPE_COUNT) {
    return {
      valid: false,
      reason: `Too many scopes requested: ${requestedScopes.length} > ${MAX_SCOPE_COUNT}`,
    };
  }

  const approvedSet = new Set(expandScopes(token.scopes));

  for (const scope of requestedScopes) {
    if (!VALID_SCOPES.has(scope)) {
      return { valid: false, reason: `Invalid scope: ${scope}` };
    }

    const expandedRequested = expandScopes([scope]);
    for (const expandedScope of expandedRequested) {
      if (!approvedSet.has(expandedScope)) {
        return {
          valid: false,
          reason: `Scope '${scope}' (expanded to '${expandedScope}') not approved`,
        };
      }
    }
  }

  return { valid: true };
}

export function expandScopes(scopes: string[]): string[] {
  const expanded = new Set<string>();

  for (const scope of scopes) {
    expanded.add(scope);

    const hierarchy = SCOPE_HIERARCHY[scope];
    if (hierarchy) {
      for (const implied of hierarchy) {
        expanded.add(implied);
      }
    }
  }

  return [...expanded];
}

export function validateTokenExpiration(token: DeviceToken): { valid: boolean; reason?: string } {
  const now = Date.now();

  if (token.expiresAt) {
    if (now > token.expiresAt) {
      return { valid: false, reason: "Token has expired" };
    }
  }

  const tokenAge = now - token.signedAtMs;
  if (tokenAge > MAX_TOKEN_TTL_MS) {
    return {
      valid: false,
      reason: `Token age exceeds maximum TTL: ${tokenAge}ms > ${MAX_TOKEN_TTL_MS}ms`,
    };
  }

  return { valid: true };
}

export function validateDeviceToken(
  token: DeviceToken,
  requestedScopes: string[],
): { valid: boolean; reasons: string[] } {
  const reasons: string[] = [];

  const scopeResult = validateDeviceTokenScope(token, requestedScopes);
  if (!scopeResult.valid && scopeResult.reason) {
    reasons.push(scopeResult.reason);
  }

  const expirationResult = validateTokenExpiration(token);
  if (!expirationResult.valid && expirationResult.reason) {
    reasons.push(expirationResult.reason);
  }

  if (!token.deviceId || typeof token.deviceId !== "string") {
    reasons.push("Invalid or missing deviceId");
  }

  if (!token.clientId || typeof token.clientId !== "string") {
    reasons.push("Invalid or missing clientId");
  }

  if (!token.role || typeof token.role !== "string") {
    reasons.push("Invalid or missing role");
  }

  return {
    valid: reasons.length === 0,
    reasons,
  };
}

export function sanitizeScopes(scopes: string[]): string[] {
  return scopes
    .filter((scope) => VALID_SCOPES.has(scope))
    .filter((scope, index, arr) => arr.indexOf(scope) === index);
}

export function createDeviceTokenScope(params: {
  deviceId: string;
  scopes: string[];
  ttlMs?: number;
}): DeviceTokenScope {
  const now = Date.now();
  const ttl = Math.min(params.ttlMs ?? DEFAULT_TOKEN_TTL_MS, MAX_TOKEN_TTL_MS);

  return {
    deviceId: params.deviceId,
    approvedScopes: sanitizeScopes(params.scopes),
    issuedAt: now,
    expiresAt: now + ttl,
  };
}

export function isScopeSubset(requested: string[], approved: string[]): boolean {
  const approvedSet = new Set(expandScopes(approved));
  const expandedRequested = expandScopes(requested);

  return expandedRequested.every((scope) => approvedSet.has(scope));
}

export function getEffectiveScopes(scopes: string[]): string[] {
  return [...new Set(expandScopes(scopes))].toSorted();
}
