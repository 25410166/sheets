// Copyright (c) 2026 CookApps
// SPDX-License-Identifier: Apache-2.0
//
// CSheet desktop auth context.
// Wraps AuthService + deep-link listener + app startup auth check.
// Only active when isDesktop() is true.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AuthService } from '@csheet/auth';
import { isDesktop } from '../desk-bridge-bootstrap';
import type { UserPlanInfo, EntitlementInfo, DeviceInfo, DesktopSessionResponse } from '@csheet/auth';

// ─────────────── Auth service singleton ──────────────────────────────────────

const BASE_URL =
  (import.meta.env.VITE_COOKAPPS_BASE_URL as string | undefined) ?? 'https://cookapps.net';

const LEASE_PUBLIC_KEY =
  (import.meta.env.VITE_DESKTOP_LEASE_PUBLIC_KEY_BASE64 as string | undefined) ?? null;

export const authService = new AuthService({
  baseUrl: BASE_URL,
  leasePublicKeyBase64: LEASE_PUBLIC_KEY,
});

// ─────────────── Types ───────────────────────────────────────────────────────

export type DeskAuthState =
  | { kind: 'checking' }
  | { kind: 'unauthenticated'; reason?: string }
  | {
      kind: 'authenticated';
      user: UserPlanInfo;
      entitlement: EntitlementInfo | null;
      session: DesktopSessionResponse;
    }
  | { kind: 'upgrade_required'; entitlement: EntitlementInfo | null; checkoutUrl?: string }
  | { kind: 'device_limit'; activeDevices: DeviceInfo[] }
  | { kind: 'ip_reauth' }
  | { kind: 'device_revoked' }
  | { kind: 'user_disabled' };

interface DeskAuthCtx {
  state: DeskAuthState;
  /** Call after deep-link callback arrives. */
  handleCallback: (rawUrl: string) => Promise<void>;
  /** Start login flow (opens browser). */
  startLogin: () => Promise<{ loginUrl: string; error?: string }>;
  /** Logout – clears session tokens, keeps device identity. */
  logout: () => Promise<void>;
  /** Re-verify session online. */
  recheck: () => Promise<void>;
}

const DeskAuthContext = createContext<DeskAuthCtx | null>(null);

// ─────────────── Provider ────────────────────────────────────────────────────

export function DeskAuthProvider({ children }: { children: ReactNode }) {
  // Not running inside Tauri desktop shell – render children as-is.
  if (!isDesktop()) return <>{children}</>;
  return <DeskAuthProviderInner>{children}</DeskAuthProviderInner>;
}

function DeskAuthProviderInner({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DeskAuthState>({ kind: 'checking' });
  const pendingCallback = useRef<string | null>(null);

  // ── Startup auth check ────────────────────────────────────────────────────

  const runStartupCheck = useCallback(async () => {
    setState({ kind: 'checking' });

    // 1. Try offline lease first (no network needed)
    const leaseCheck = await authService.checkOfflineLease();

    if (leaseCheck.allowed) {
      // 2. Still try online session for fresh data
      const session = await authService.verifySession().catch(() => null);
      if (session?.authenticated && session.user) {
        setState({
          kind: 'authenticated',
          user: session.user,
          entitlement: session.entitlement ?? null,
          session,
        });
        return;
      }
      // Offline-only fallback (no network or session error)
      // We only allow this when lease is VALID (not grace period) per spec
      if (leaseCheck.reason === 'VALID' && leaseCheck.payload) {
        // Minimal user info from lease payload
        setState({
          kind: 'authenticated',
          user: {
            userId: leaseCheck.payload.user_id,
            email: '',
            name: '',
            planCode: '',
            subscriptionStatus: 'offline',
            activeDevicesCount: 0,
            maxDevicesAllowed: 0,
          },
          entitlement: {
            allowed: leaseCheck.payload.entitlement_allowed,
            isFree: false,
          },
          session: { success: false, authenticated: true },
        });
        return;
      }
    }

    // 3. Try online session directly
    const session = await authService.verifySession().catch(() => null);
    if (session?.authenticated && session.user) {
      setState({
        kind: 'authenticated',
        user: session.user,
        entitlement: session.entitlement ?? null,
        session,
      });
      return;
    }

    // 4. Map error codes to UI states
    if (session?.errorCode === 'UPGRADE_REQUIRED') {
      setState({ kind: 'upgrade_required', entitlement: session.entitlement ?? null });
      return;
    }
    if (session?.errorCode === 'DEVICE_LIMIT_REACHED') {
      setState({ kind: 'device_limit', activeDevices: [] });
      return;
    }
    if (session?.errorCode === 'IP_REAUTH_REQUIRED') {
      setState({ kind: 'ip_reauth' });
      return;
    }
    if (session?.errorCode === 'DEVICE_REVOKED') {
      setState({ kind: 'device_revoked' });
      return;
    }
    if (session?.errorCode === 'USER_DISABLED') {
      setState({ kind: 'user_disabled' });
      return;
    }

    setState({ kind: 'unauthenticated', reason: session?.error });
  }, []);

  useEffect(() => {
    void runStartupCheck();
  }, [runStartupCheck]);

  // ── Deep-link listener (app already running) ──────────────────────────────

  const handleCallback = useCallback(async (rawUrl: string) => {
    // Sanity-check scheme before any processing
    if (!rawUrl.startsWith('cookapps-csheet:')) return;

    const result = await authService.exchangeCallback(rawUrl);

    if (result.authenticated && result.user) {
      // Exchange success → verify session for full data
      const session = await authService.verifySession().catch(() => null);
      if (session?.authenticated && session.user) {
        setState({
          kind: 'authenticated',
          user: session.user,
          entitlement: session.entitlement ?? null,
          session,
        });
        // Show window now that auth succeeded
        showMainWindow();
        return;
      }
    }

    // Map exchange errors
    if (result.errorCode === 'UPGRADE_REQUIRED') {
      setState({ kind: 'upgrade_required', entitlement: result.entitlement ?? null, checkoutUrl: result.entitlement?.checkoutUrl ?? undefined });
      return;
    }
    if (result.errorCode === 'DEVICE_LIMIT_REACHED') {
      setState({ kind: 'device_limit', activeDevices: result.activeDevices ?? [] });
      return;
    }
    if (result.errorCode === 'IP_REAUTH_REQUIRED') { setState({ kind: 'ip_reauth' }); return; }
    if (result.errorCode === 'DEVICE_REVOKED') { setState({ kind: 'device_revoked' }); return; }
    if (result.errorCode === 'USER_DISABLED') { setState({ kind: 'user_disabled' }); return; }

    setState({ kind: 'unauthenticated', reason: result.error });
  }, []);

  // ── Tauri event listener for csheet:deeplink ──────────────────────────────

  useEffect(() => {
    const tauri = (window as unknown as { __TAURI__?: TauriInternal }).__TAURI__;
    if (!tauri?.event?.listen) return;

    let unlisten: (() => void) | null = null;
    void tauri.event
      .listen('csheet:deeplink', (evt: { payload: { url: string } }) => {
        void handleCallback(evt.payload.url);
      })
      .then((fn) => { unlisten = fn; });

    return () => { unlisten?.(); };
  }, [handleCallback]);

  // ── Start login ───────────────────────────────────────────────────────────

  const startLogin = useCallback(async () => {
    const platform = detectPlatform();
    const deviceName = `${platform} PC`;

    const result = await authService.startLogin({ deviceName, platform });
    if (result.success && result.loginUrl) {
      // Open in system browser via Tauri opener
      await openExternalUrl(result.loginUrl);
      return { loginUrl: result.loginUrl };
    }
    return { loginUrl: '', error: result.error };
  }, []);

  // ── Logout ────────────────────────────────────────────────────────────────

  const logout = useCallback(async () => {
    await authService.logout();
    setState({ kind: 'unauthenticated' });
  }, []);

  const recheck = useCallback(async () => {
    await runStartupCheck();
  }, [runStartupCheck]);

  const value = useMemo<DeskAuthCtx>(
    () => ({ state, handleCallback, startLogin, logout, recheck }),
    [state, handleCallback, startLogin, logout, recheck],
  );

  return <DeskAuthContext.Provider value={value}>{children}</DeskAuthContext.Provider>;
}

export function useDeskAuth(): DeskAuthCtx {
  const ctx = useContext(DeskAuthContext);
  if (!ctx) throw new Error('useDeskAuth must be used inside <DeskAuthProvider>');
  return ctx;
}

// ─────────────── Helpers ─────────────────────────────────────────────────────

function detectPlatform(): 'macOS' | 'Windows' {
  if (typeof navigator === 'undefined') return 'Windows';
  const ua = navigator.userAgent;
  if (ua.includes('Mac')) return 'macOS';
  return 'Windows';
}

async function openExternalUrl(url: string): Promise<void> {
  const tauri = (window as unknown as { __TAURI__?: TauriInternal }).__TAURI__;
  if (tauri?.opener?.openUrl) {
    await tauri.opener.openUrl(url);
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

function showMainWindow(): void {
  const tauri = (window as unknown as { __TAURI__?: TauriInternal }).__TAURI__;
  if (tauri?.window?.getCurrentWindow) {
    void tauri.window.getCurrentWindow().show?.().catch(() => null);
  }
}

interface TauriInternal {
  event?: {
    listen: (
      event: string,
      cb: (evt: { payload: unknown }) => void,
    ) => Promise<() => void>;
  };
  opener?: { openUrl: (url: string) => Promise<void> };
  window?: { getCurrentWindow: () => { show?: () => Promise<void> } };
}
