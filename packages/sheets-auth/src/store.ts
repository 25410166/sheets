// Copyright (c) 2026 CookApps
// SPDX-License-Identifier: Apache-2.0
//
// SecureAuthStore for CSheet.
// All token persistence goes through here. Components never read/write tokens directly.
//
// Storage backend priority:
//   1. Tauri IPC (token_get / token_set) → app_data/csheet/tokens/*.bin
//   2. Memory-only fallback (never persisted cross-session)
//
// localStorage is intentionally NOT used as a fallback for tokens.
// Pending PKCE state/verifier may use sessionStorage only as a last-resort
// for the duration of the pending auth flow (cleared on exchange).

import { generateRandomUrlSafeString } from './crypto';

// All keys are prefixed `csheet.` in the Rust token store.
const PREFIX = 'csheet.';

export class SecureAuthStore {
  // In-memory cache for the current app session only.
  // Cleared on reload. Not a substitute for secure persistent storage.
  private static memCache = new Map<string, string>();

  private static async getRaw(key: string): Promise<string | null> {
    const fullKey = `${PREFIX}${key}`;

    // Memory cache first (fastest, avoids repeated IPC)
    if (SecureAuthStore.memCache.has(fullKey)) {
      return SecureAuthStore.memCache.get(fullKey)!;
    }

    // Tauri IPC (persistent secure storage)
    if (typeof window !== 'undefined' && (window as unknown as DeskWindow).__deskApp__?.tokenGet) {
      try {
        const val = await (window as unknown as DeskWindow).__deskApp__!.tokenGet!(fullKey);
        if (val != null) {
          SecureAuthStore.memCache.set(fullKey, val);
          return val;
        }
      } catch {
        // IPC unavailable – continue
      }
    }

    return null;
  }

  private static async setRaw(key: string, value: string | null): Promise<void> {
    const fullKey = `${PREFIX}${key}`;

    if (value === null) {
      SecureAuthStore.memCache.delete(fullKey);
    } else {
      SecureAuthStore.memCache.set(fullKey, value);
    }

    // Persist via Tauri IPC
    if (typeof window !== 'undefined' && (window as unknown as DeskWindow).__deskApp__?.tokenSet) {
      try {
        await (window as unknown as DeskWindow).__deskApp__!.tokenSet!(fullKey, value ?? '');
      } catch {
        // IPC unavailable – value stays in memory only
      }
    }
  }

  // ─────────────────────── Device key (stable installation ID) ───────────────

  /**
   * Returns or creates a stable device key. Matches ^[A-Za-z0-9._:-]{8,160}$
   * Created once per installation; survives restarts and updates.
   */
  public static async getOrCreateDeviceKey(): Promise<string> {
    let key = await SecureAuthStore.getRaw('deviceKey');
    if (!key) {
      const uuid =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : generateRandomUrlSafeString(32);
      key = `csheet-${uuid}`;
      await SecureAuthStore.setRaw('deviceKey', key);
    }
    return key;
  }

  // ─────────────────────── Device Ed25519 key pair ───────────────────────────

  public static async getDevicePrivateKeyJwk(): Promise<JsonWebKey | null> {
    const raw = await SecureAuthStore.getRaw('devicePrivateKey');
    return raw ? (JSON.parse(raw) as JsonWebKey) : null;
  }

  public static async setDevicePrivateKeyJwk(jwk: JsonWebKey): Promise<void> {
    await SecureAuthStore.setRaw('devicePrivateKey', JSON.stringify(jwk));
  }

  public static async getDevicePublicKeySpki(): Promise<string | null> {
    return await SecureAuthStore.getRaw('devicePublicKey');
  }

  public static async setDevicePublicKeySpki(spkiBase64: string): Promise<void> {
    await SecureAuthStore.setRaw('devicePublicKey', spkiBase64);
  }

  // ─────────────────────── Pending PKCE flow ─────────────────────────────────

  public static async getPendingState(): Promise<string | null> {
    return await SecureAuthStore.getRaw('pending.state');
  }

  public static async setPendingState(state: string | null): Promise<void> {
    await SecureAuthStore.setRaw('pending.state', state);
  }

  public static async getPendingCodeVerifier(): Promise<string | null> {
    return await SecureAuthStore.getRaw('pending.codeVerifier');
  }

  public static async setPendingCodeVerifier(verifier: string | null): Promise<void> {
    await SecureAuthStore.setRaw('pending.codeVerifier', verifier);
  }

  public static async clearPendingFlow(): Promise<void> {
    await SecureAuthStore.setPendingState(null);
    await SecureAuthStore.setPendingCodeVerifier(null);
  }

  // ─────────────────────── Session tokens ────────────────────────────────────

  public static async getDesktopAccessToken(): Promise<string | null> {
    return await SecureAuthStore.getRaw('desktopAccessToken');
  }

  public static async setDesktopAccessToken(token: string | null): Promise<void> {
    await SecureAuthStore.setRaw('desktopAccessToken', token);
  }

  public static async getLeaseToken(): Promise<string | null> {
    return await SecureAuthStore.getRaw('leaseToken');
  }

  public static async setLeaseToken(token: string | null): Promise<void> {
    await SecureAuthStore.setRaw('leaseToken', token);
  }

  // ─────────────────────── Lease expiry ──────────────────────────────────────

  /** Normalise server timestamp (ms epoch, s epoch, or ISO string) to seconds. */
  public static parseTimestampToSeconds(value: string | number | null | undefined): number | null {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') {
      return value > 10_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
    }
    const str = String(value).trim();
    if (/^\d+$/.test(str)) {
      const num = parseInt(str, 10);
      return num > 10_000_000_000 ? Math.floor(num / 1000) : num;
    }
    const parsed = Date.parse(str);
    return Number.isNaN(parsed) ? null : Math.floor(parsed / 1000);
  }

  public static async getLeaseExpiresAt(): Promise<number | null> {
    return SecureAuthStore.parseTimestampToSeconds(await SecureAuthStore.getRaw('leaseExpiresAt'));
  }

  public static async setLeaseExpiresAt(value: string | number | null): Promise<void> {
    const sec = SecureAuthStore.parseTimestampToSeconds(value);
    await SecureAuthStore.setRaw('leaseExpiresAt', sec !== null ? String(sec) : null);
  }

  public static async getLeaseGraceUntil(): Promise<number | null> {
    return SecureAuthStore.parseTimestampToSeconds(await SecureAuthStore.getRaw('leaseGraceUntil'));
  }

  public static async setLeaseGraceUntil(value: string | number | null): Promise<void> {
    const sec = SecureAuthStore.parseTimestampToSeconds(value);
    await SecureAuthStore.setRaw('leaseGraceUntil', sec !== null ? String(sec) : null);
  }

  // ─────────────────────── Bulk clear ────────────────────────────────────────

  /**
   * Clears session tokens (access token, lease) but keeps device key + key pair.
   * Call on logout, DEVICE_REVOKED, IP_REAUTH_REQUIRED, USER_DISABLED.
   */
  public static async clearSessionTokens(): Promise<void> {
    await SecureAuthStore.setDesktopAccessToken(null);
    await SecureAuthStore.setLeaseToken(null);
    await SecureAuthStore.setLeaseExpiresAt(null);
    await SecureAuthStore.setLeaseGraceUntil(null);
  }
}

// Minimal typing for window.__deskApp__
interface DeskWindow {
  __deskApp__?: {
    tokenGet?: (name: string) => Promise<string | null>;
    tokenSet?: (name: string, value: string) => Promise<void>;
  };
}
