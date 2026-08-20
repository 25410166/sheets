// Copyright (c) 2026 CookApps
// SPDX-License-Identifier: Apache-2.0
//
// CSheet CookApps desktop auth service.
// Implements: start → browser → deep-link callback → exchange → session verify → offline lease.
//
// APP_SLUG is always 'csheet'. It is never overridable from the UI.

import {
  createPkceChallenge,
  createDeviceProofSignature,
  exportPrivateKeyJwk,
  generateDeviceKeyPair,
  generateRandomUrlSafeString,
  importPrivateKeyJwk,
  verifyLeaseTokenOffline,
} from './crypto';
import { SecureAuthStore } from './store';
import type {
  DesktopAuthExchangeResponse,
  DesktopAuthStartResponse,
  DesktopSessionResponse,
  LeasePayload,
} from './types';

// ─────────────── HTTP fetch via Tauri native_fetch or browser fetch ───────────

type HttpFetcher = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Route HTTP calls through Tauri native_fetch when running inside the shell.
 * This avoids webview CORS restrictions and ensures the request is always
 * sent with the correct base URL without forwarding website cookies.
 */
function makeTauriFetcher(): HttpFetcher {
  return async (url: string, init: RequestInit): Promise<Response> => {
    const w = window as unknown as {
      __deskApp__?: { nativeFetch?: (opts: unknown) => Promise<{ status: number; body: string }> };
    };
    const nativeFetch = w.__deskApp__?.nativeFetch;
    if (!nativeFetch) return fetch(url, init);

    const headers: Record<string, string> = {};
    if (init.headers) {
      for (const [k, v] of Object.entries(init.headers as Record<string, string>)) {
        headers[k] = v;
      }
    }
    const result = await nativeFetch({
      url,
      method: (init.method ?? 'GET').toUpperCase(),
      headers,
      body: typeof init.body === 'string' ? init.body : undefined,
    });
    return new Response(result.body, { status: result.status });
  };
}

// ─────────────────────── AuthService ──────────────────────────────────────────

export class AuthService {
  /** Never change this. CSheet's CMS slug is always 'csheet'. */
  public static readonly APP_SLUG = 'csheet';

  private readonly baseUrl: string;
  private readonly leasePublicKeyBase64: string | null;
  private readonly httpFetch: HttpFetcher;

  /** Set of code values currently being exchanged to prevent double-exchange. */
  private processingCodes = new Set<string>();

  constructor(opts: {
    /**
     * CookApps base URL.
     * Production: https://cookapps.net
     * Local: http://localhost:3000 (via VITE_COOKAPPS_BASE_URL)
     */
    baseUrl: string;
    /**
     * Base64 of DER SPKI CookApps Ed25519 lease public key.
     * Set via VITE_DESKTOP_LEASE_PUBLIC_KEY_BASE64 at build time.
     * Only the public key goes here. NEVER the private key.
     */
    leasePublicKeyBase64?: string | null;
    /** Override HTTP fetcher (for testing). */
    httpFetch?: HttpFetcher;
  }) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.leasePublicKeyBase64 = opts.leasePublicKeyBase64 ?? null;
    this.httpFetch = opts.httpFetch ?? makeTauriFetcher();
  }

  public hasPublicKey(): boolean {
    return Boolean(this.leasePublicKeyBase64);
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  // ─────────────── Step 0: Device key pair (load or create) ──────────────────

  private async getOrCreateDeviceKeyPair(): Promise<{ privateKey: CryptoKey; publicKeySpkiBase64: string }> {
    const storedJwk = await SecureAuthStore.getDevicePrivateKeyJwk();
    const storedSpki = await SecureAuthStore.getDevicePublicKeySpki();

    if (storedJwk && storedSpki) {
      try {
        const privateKey = await importPrivateKeyJwk(storedJwk);
        return { privateKey, publicKeySpkiBase64: storedSpki };
      } catch {
        // JWK corrupt – regenerate
      }
    }

    const { privateKey, publicKeySpkiBase64 } = await generateDeviceKeyPair();
    const jwk = await exportPrivateKeyJwk(privateKey);
    await SecureAuthStore.setDevicePrivateKeyJwk(jwk);
    await SecureAuthStore.setDevicePublicKeySpki(publicKeySpkiBase64);
    return { privateKey, publicKeySpkiBase64 };
  }

  // ─────────────── Step 1: Start login ───────────────────────────────────────

  /**
   * POST /api/desktop/auth/start
   * Returns loginUrl to open in system browser.
   */
  public async startLogin(opts: {
    deviceName: string;
    platform: 'macOS' | 'Windows';
  }): Promise<DesktopAuthStartResponse> {
    const deviceKey = await SecureAuthStore.getOrCreateDeviceKey();
    const { publicKeySpkiBase64 } = await this.getOrCreateDeviceKeyPair();

    // PKCE verifier: 96 url-safe chars (within 43-128 range)
    const codeVerifier = generateRandomUrlSafeString(96);
    const codeChallenge = await createPkceChallenge(codeVerifier);

    // State: 32 url-safe chars (within 16-256 range)
    const state = generateRandomUrlSafeString(32);

    // Persist pending state/verifier BEFORE opening browser.
    await SecureAuthStore.setPendingState(state);
    await SecureAuthStore.setPendingCodeVerifier(codeVerifier);

    const body = {
      appSlug: AuthService.APP_SLUG,
      deviceKey,
      deviceName: opts.deviceName,
      platform: opts.platform,
      state,
      codeChallenge,
      publicKeyEd25519: publicKeySpkiBase64,
    };

    try {
      const res = await this.httpFetch(`${this.baseUrl}/api/desktop/auth/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
        body: JSON.stringify(body),
      });

      const data = (await res.json().catch(() => ({}))) as DesktopAuthStartResponse;

      if (!res.ok || !data.loginUrl) {
        return {
          success: false,
          loginUrl: '',
          callbackScheme: 'cookapps-csheet',
          expiresAt: '',
          errorCode: data.errorCode,
          error: data.error ?? `Start failed with HTTP ${res.status}`,
        };
      }

      return data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await SecureAuthStore.clearPendingFlow();
      return {
        success: false,
        loginUrl: '',
        callbackScheme: 'cookapps-csheet',
        expiresAt: '',
        error: `Network error: ${msg}`,
      };
    }
  }

  // ─────────────── Step 2: Handle deep-link callback ─────────────────────────

  /**
   * Parse and validate a cookapps-csheet://auth?code=...&state=... callback URL.
   * Returns { code, state } or throws on invalid input.
   * Does NOT do the exchange – caller must call exchangeCallback().
   */
  public parseCallback(rawUrl: string): { code: string; state: string } {
    // Only accept our scheme
    if (!rawUrl.startsWith('cookapps-csheet:')) {
      throw new Error(`Invalid scheme in callback URL`);
    }
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new Error('Malformed callback URL');
    }
    // Host must be 'auth'
    if (url.host !== 'auth') throw new Error(`Unexpected callback host: ${url.host}`);

    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!code || !state) throw new Error('Missing code or state in callback');

    return { code, state };
  }

  /**
   * Full callback processing: parse → state check → exchange.
   * Clears pending flow atomically before exchange.
   */
  public async exchangeCallback(rawUrl: string): Promise<DesktopAuthExchangeResponse> {
    let parsed: { code: string; state: string };
    try {
      parsed = this.parseCallback(rawUrl);
    } catch (err) {
      return {
        success: false,
        authenticated: false,
        errorCode: 'INVALID_STATE',
        error: err instanceof Error ? err.message : 'Invalid callback URL',
      };
    }

    const { code, state } = parsed;

    // Guard against double-exchange
    if (this.processingCodes.has(code)) {
      return {
        success: false,
        authenticated: false,
        errorCode: 'EXCHANGE_ALREADY_CONSUMED',
        error: 'Exchange already in progress for this code',
      };
    }
    this.processingCodes.add(code);

    try {
      const storedState = await SecureAuthStore.getPendingState();
      const codeVerifier = await SecureAuthStore.getPendingCodeVerifier();

      // Clear pending state atomically before exchange to prevent replay
      await SecureAuthStore.clearPendingFlow();

      if (!storedState || !this.constantTimeCompare(state, storedState)) {
        return {
          success: false,
          authenticated: false,
          errorCode: 'INVALID_STATE',
          error: 'State mismatch – possible CSRF attack',
        };
      }
      if (!codeVerifier) {
        return {
          success: false,
          authenticated: false,
          errorCode: 'PKCE_VERIFICATION_FAILED',
          error: 'Missing pending PKCE code verifier',
        };
      }

      const deviceKey = await SecureAuthStore.getOrCreateDeviceKey();
      return await this.exchangeCode(code, codeVerifier, deviceKey);
    } catch (err) {
      await SecureAuthStore.clearPendingFlow();
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        authenticated: false,
        errorCode: 'INVALID_STATE',
        error: `Callback processing error: ${msg}`,
      };
    } finally {
      this.processingCodes.delete(code);
    }
  }

  // ─────────────── Step 3: Exchange one-time code ─────────────────────────────

  /** POST /api/desktop/auth/exchange */
  public async exchangeCode(
    code: string,
    codeVerifier: string,
    deviceKey: string,
  ): Promise<DesktopAuthExchangeResponse> {
    try {
      const res = await this.httpFetch(`${this.baseUrl}/api/desktop/auth/exchange`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
        body: JSON.stringify({ code, codeVerifier, deviceKey }),
      });

      const data = (await res.json().catch(() => ({}))) as DesktopAuthExchangeResponse;

      if (!res.ok || !data.authenticated || !data.accessToken) {
        return {
          success: false,
          authenticated: false,
          errorCode: data.errorCode ?? 'INVALID_EXCHANGE_CODE',
          error: data.error ?? `Exchange failed with HTTP ${res.status}`,
          entitlement: data.entitlement,
          activeDevices: data.activeDevices,
        };
      }

      // Atomically store tokens
      await SecureAuthStore.setDesktopAccessToken(data.accessToken);
      if (data.leaseToken) await SecureAuthStore.setLeaseToken(data.leaseToken);
      if (data.leaseExpiresAt != null) await SecureAuthStore.setLeaseExpiresAt(data.leaseExpiresAt);
      if (data.leaseGraceUntil != null) await SecureAuthStore.setLeaseGraceUntil(data.leaseGraceUntil);

      // Verify lease signature immediately after store
      if (data.leaseToken && this.leasePublicKeyBase64) {
        const check = await verifyLeaseTokenOffline(data.leaseToken, this.leasePublicKeyBase64);
        if (!check.valid) {
          // Log only warning-level, never log the token itself
          console.warn('[CSheet auth] Offline lease signature check failed:', check.error);
        }
      }

      return data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        authenticated: false,
        errorCode: 'INVALID_EXCHANGE_CODE',
        error: `Network error during exchange: ${msg}`,
      };
    }
  }

  // ─────────────── Session verify (GET /api/desktop/session) ─────────────────

  /** GET /api/desktop/session?appSlug=csheet with Ed25519 device proof */
  public async verifySession(): Promise<DesktopSessionResponse> {
    const accessToken = await SecureAuthStore.getDesktopAccessToken();
    const deviceKey = await SecureAuthStore.getOrCreateDeviceKey();

    if (!accessToken) {
      return { success: false, authenticated: false, errorCode: 'LOGIN_REQUIRED' };
    }

    const { privateKey } = await this.getOrCreateDeviceKeyPair();
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = generateRandomUrlSafeString(24);
    const signature = await createDeviceProofSignature(
      privateKey,
      timestamp,
      nonce,
      AuthService.APP_SLUG,
    );

    try {
      const res = await this.httpFetch(
        `${this.baseUrl}/api/desktop/session?appSlug=${AuthService.APP_SLUG}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'X-CookApps-Device-Key': deviceKey,
            'X-CookApps-Timestamp': String(timestamp),
            'X-CookApps-Nonce': nonce,
            'X-CookApps-Signature': signature,
          },
        },
      );

      const data = (await res.json().catch(() => ({}))) as DesktopSessionResponse;

      if (data.errorCode === 'IP_REAUTH_REQUIRED') {
        await SecureAuthStore.clearSessionTokens();
        return {
          success: false,
          authenticated: false,
          errorCode: 'IP_REAUTH_REQUIRED',
          error: 'Public IP changed. Re-authentication required.',
        };
      }

      if (data.errorCode === 'DEVICE_REVOKED') {
        await SecureAuthStore.clearSessionTokens();
        return {
          success: false,
          authenticated: false,
          errorCode: 'DEVICE_REVOKED',
          error: 'Device has been revoked.',
        };
      }

      if (!res.ok || !data.authenticated) {
        return {
          success: false,
          authenticated: false,
          errorCode: data.errorCode ?? 'LOGIN_REQUIRED',
          error: data.error ?? `Session check failed with HTTP ${res.status}`,
        };
      }

      // Refresh lease if server returned a new one
      if (data.leaseToken) await SecureAuthStore.setLeaseToken(data.leaseToken);
      if (data.leaseExpiresAt != null) await SecureAuthStore.setLeaseExpiresAt(data.leaseExpiresAt);
      if (data.leaseGraceUntil != null) await SecureAuthStore.setLeaseGraceUntil(data.leaseGraceUntil);

      return data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        authenticated: false,
        errorCode: 'LOGIN_REQUIRED',
        error: `Network error verifying session: ${msg}`,
      };
    }
  }

  // ─────────────── Offline lease check ───────────────────────────────────────

  public async checkOfflineLease(): Promise<{
    allowed: boolean;
    reason: 'VALID' | 'GRACE_PERIOD' | 'EXPIRED' | 'NO_LEASE' | 'INVALID_SIGNATURE';
    payload?: LeasePayload;
  }> {
    const leaseToken = await SecureAuthStore.getLeaseToken();
    const expiresAt = await SecureAuthStore.getLeaseExpiresAt();
    const graceUntil = await SecureAuthStore.getLeaseGraceUntil();

    if (!leaseToken) return { allowed: false, reason: 'NO_LEASE' };

    if (this.leasePublicKeyBase64) {
      const verifyRes = await verifyLeaseTokenOffline(leaseToken, this.leasePublicKeyBase64);
      if (!verifyRes.valid || !verifyRes.payload) {
        return { allowed: false, reason: 'INVALID_SIGNATURE' };
      }
      if (
        !verifyRes.payload.app_entitlements.includes(AuthService.APP_SLUG) ||
        !verifyRes.payload.entitlement_allowed
      ) {
        return { allowed: false, reason: 'EXPIRED', payload: verifyRes.payload };
      }

      const nowSec = Math.floor(Date.now() / 1000);
      const effectiveExpires = expiresAt ?? verifyRes.payload.expires_at;
      const effectiveGrace = graceUntil ?? verifyRes.payload.grace_until;

      if (!effectiveExpires || nowSec <= effectiveExpires) {
        return { allowed: true, reason: 'VALID', payload: verifyRes.payload };
      }
      if (effectiveGrace && nowSec <= effectiveGrace) {
        return { allowed: true, reason: 'GRACE_PERIOD', payload: verifyRes.payload };
      }
      return { allowed: false, reason: 'EXPIRED', payload: verifyRes.payload };
    }

    // No lease public key – check timestamps only
    const nowSec = Math.floor(Date.now() / 1000);
    if (!expiresAt || nowSec <= expiresAt) return { allowed: true, reason: 'VALID' };
    if (graceUntil && nowSec <= graceUntil) return { allowed: true, reason: 'GRACE_PERIOD' };
    return { allowed: false, reason: 'EXPIRED' };
  }

  // ─────────────── Logout ─────────────────────────────────────────────────────

  /** Clears session credentials. Keeps device key + key pair. */
  public async logout(): Promise<void> {
    await SecureAuthStore.clearSessionTokens();
    await SecureAuthStore.clearPendingFlow();
  }

  // ─────────────── Helpers ───────────────────────────────────────────────────

  /** Constant-time string comparison to prevent timing attacks on state values. */
  private constantTimeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
  }
}
