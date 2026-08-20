// Copyright (c) 2026 CookApps
// SPDX-License-Identifier: Apache-2.0
//
// DeskAuthGate – full-screen auth gate for CSheet desktop.
// Renders as a blocking overlay until the CookApps auth flow succeeds.
// Only mounted when isDesktop() is true.

import { useState, type ReactNode } from 'react';
import { useDeskAuth } from './desk-auth-context';
import type { DeviceInfo } from '@csheet/auth';
import { authService } from './desk-auth-context';
import { isDesktop } from '../desk-bridge-bootstrap';
import './DeskAuthGate.css';

// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  children: ReactNode;
}

export function DeskAuthGate({ children }: Props) {
  // Not in desktop shell – render children directly (no auth gate needed).
  if (!isDesktop()) return <>{children}</>;
  return <DeskAuthGateInner>{children}</DeskAuthGateInner>;
}

function DeskAuthGateInner({ children }: Props) {
  const { state, startLogin, logout, recheck } = useDeskAuth();

  // Once authenticated, render the app behind the gate
  if (state.kind === 'authenticated') return <>{children}</>;

  return (
    <div className="da-gate" role="main">
      <div className="da-card" role="dialog" aria-modal="true" aria-label="CSheet sign in">

        {/* Logo */}
        <div className="da-logo">
          <div className="da-logo-icon" aria-hidden="true">📊</div>
          <div className="da-logo-text">C<span>Sheet</span></div>
        </div>

        {state.kind === 'checking' && (
          <CheckingState />
        )}

        {state.kind === 'unauthenticated' && (
          <UnauthenticatedState startLogin={startLogin} reason={state.reason} />
        )}

        {state.kind === 'upgrade_required' && (
          <UpgradeRequiredState
            checkoutUrl={state.checkoutUrl ?? state.entitlement?.checkoutUrl ?? undefined}
            baseUrl={authService.getBaseUrl()}
            onLogout={logout}
          />
        )}

        {state.kind === 'device_limit' && (
          <DeviceLimitState
            activeDevices={state.activeDevices}
            baseUrl={authService.getBaseUrl()}
            onRetry={recheck}
          />
        )}

        {state.kind === 'ip_reauth' && (
          <IpReauthState startLogin={startLogin} />
        )}

        {state.kind === 'device_revoked' && (
          <DeviceRevokedState startLogin={startLogin} />
        )}

        {state.kind === 'user_disabled' && (
          <UserDisabledState baseUrl={authService.getBaseUrl()} />
        )}

        <div className="da-powered" aria-label="Powered by CookApps">
          <span>Powered by</span>
          <strong>CookApps</strong>
        </div>
      </div>
    </div>
  );
}

// ─────────────── Sub-states ───────────────────────────────────────────────────

function CheckingState() {
  return (
    <>
      <h1 className="da-title">Checking your account…</h1>
      <p className="da-subtitle">Please wait while CSheet verifies your session.</p>
      <div className="da-status da-status--neutral">
        <div className="da-spinner" style={{ borderColor: 'rgba(59,130,246,0.3)', borderTopColor: '#3b82f6' }} aria-hidden="true" />
        <div className="da-status__body">
          <p className="da-status__title">Verifying session</p>
          <p className="da-status__desc">Checking credentials and entitlements…</p>
        </div>
      </div>
    </>
  );
}

function UnauthenticatedState({
  startLogin,
  reason,
}: {
  startLogin: () => Promise<{ loginUrl: string; error?: string }>;
  reason?: string;
}) {
  const [loginState, setLoginState] = useState<
    'idle' | 'opening' | 'waiting' | 'verifying' | 'error' | 'rate_limited'
  >('idle');
  const [loginUrl, setLoginUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(reason ?? null);

  const handleLogin = async () => {
    setLoginState('opening');
    setErrorMsg(null);
    const res = await startLogin();
    if (res.error) {
      const isRateLimit = res.error.toLowerCase().includes('rate') || res.error.includes('429');
      setLoginState(isRateLimit ? 'rate_limited' : 'error');
      setErrorMsg(res.error);
      return;
    }
    setLoginUrl(res.loginUrl);
    setLoginState('waiting');
  };

  const reopenBrowser = async () => {
    if (loginUrl) {
      const tauri = (window as unknown as { __TAURI__?: { opener?: { openUrl: (u: string) => Promise<void> } } }).__TAURI__;
      if (tauri?.opener?.openUrl) {
        await tauri.opener.openUrl(loginUrl);
      } else {
        window.open(loginUrl, '_blank', 'noopener,noreferrer');
      }
    }
  };

  return (
    <>
      <h1 className="da-title">Sign in to CSheet</h1>
      <p className="da-subtitle">
        Connect your CookApps account to access CSheet on this device.
      </p>

      {loginState === 'idle' && (
        <button
          id="csheet-login-btn"
          className="da-btn da-btn--primary"
          onClick={() => void handleLogin()}
          type="button"
        >
          <span>🔑</span>
          Login by CookApps Account
        </button>
      )}

      {loginState === 'opening' && (
        <button className="da-btn da-btn--primary" disabled type="button">
          <div className="da-spinner" style={{ borderColor: 'rgba(0,0,0,0.2)', borderTopColor: '#0a1608' }} aria-hidden="true" />
          Opening CookApps…
        </button>
      )}

      {loginState === 'waiting' && (
        <>
          <div className="da-status">
            <div className="da-spinner" style={{ borderColor: 'rgba(34,197,94,0.2)', borderTopColor: '#22c55e' }} aria-hidden="true" />
            <div className="da-status__body">
              <p className="da-status__title">Waiting for confirmation…</p>
              <p className="da-status__desc">Complete sign-in in your browser. This window will update automatically.</p>
            </div>
          </div>
          <button className="da-btn da-btn--ghost" onClick={() => void reopenBrowser()} type="button">
            Re-open browser login
          </button>
        </>
      )}

      {loginState === 'verifying' && (
        <div className="da-status">
          <div className="da-spinner" style={{ borderColor: 'rgba(34,197,94,0.2)', borderTopColor: '#22c55e' }} aria-hidden="true" />
          <div className="da-status__body">
            <p className="da-status__title">Verifying device…</p>
            <p className="da-status__desc">Checking your entitlement and device binding.</p>
          </div>
        </div>
      )}

      {loginState === 'error' && (
        <>
          <div className="da-status da-status--error">
            <span className="da-status__icon" aria-hidden="true">⚠️</span>
            <div className="da-status__body">
              <p className="da-status__title">Login failed</p>
              <p className="da-status__desc">{errorMsg ?? 'An unexpected error occurred. Please try again.'}</p>
            </div>
          </div>
          <button className="da-btn da-btn--primary" onClick={() => { setLoginState('idle'); setErrorMsg(null); }} type="button">
            Try again
          </button>
        </>
      )}

      {loginState === 'rate_limited' && (
        <>
          <div className="da-status da-status--warn">
            <span className="da-status__icon" aria-hidden="true">⏳</span>
            <div className="da-status__body">
              <p className="da-status__title">Too many requests</p>
              <p className="da-status__desc">Please wait before trying again. {errorMsg}</p>
            </div>
          </div>
          <button className="da-btn da-btn--ghost" onClick={() => { setLoginState('idle'); setErrorMsg(null); }} type="button">
            Retry login
          </button>
        </>
      )}
    </>
  );
}

function UpgradeRequiredState({
  checkoutUrl,
  baseUrl,
  onLogout,
}: {
  checkoutUrl?: string;
  baseUrl: string;
  onLogout: () => Promise<void>;
}) {
  return (
    <>
      <h1 className="da-title">Subscription Required</h1>
      <div className="da-status da-status--warn">
        <span className="da-status__icon" aria-hidden="true">⭐</span>
        <div className="da-status__body">
          <p className="da-status__title">CSheet requires an active subscription</p>
          <p className="da-status__desc">
            Upgrade your CookApps plan to use CSheet. Your current plan does not include access to this app.
          </p>
        </div>
      </div>
      {checkoutUrl ? (
        <a className="da-btn da-btn--amber" href={checkoutUrl} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
          ⭐ Upgrade Subscription
        </a>
      ) : (
        <a className="da-btn da-btn--amber" href={`${baseUrl}/account`} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
          Visit CookApps Account
        </a>
      )}
      <div className="da-divider" />
      <button className="da-btn da-btn--ghost" onClick={() => void onLogout()} type="button">
        Sign out
      </button>
    </>
  );
}

function DeviceLimitState({
  activeDevices,
  baseUrl,
  onRetry,
}: {
  activeDevices: DeviceInfo[];
  baseUrl: string;
  onRetry: () => Promise<void>;
}) {
  return (
    <>
      <h1 className="da-title">Device Limit Reached</h1>
      <div className="da-status da-status--error">
        <span className="da-status__icon" aria-hidden="true">💻</span>
        <div className="da-status__body">
          <p className="da-status__title">Too many active devices</p>
          <p className="da-status__desc">
            Your plan's device limit has been reached. Remove a device on the CookApps website to sign in here.
          </p>
        </div>
      </div>
      {activeDevices.length > 0 && (
        <ul className="da-device-list" aria-label="Active devices">
          {activeDevices.map((d) => (
            <li key={d.id}>
              <span aria-hidden="true">{d.platform === 'macOS' ? '🍎' : '🪟'}</span>
              {d.name} – {d.platform}
            </li>
          ))}
        </ul>
      )}
      <a className="da-btn da-btn--red" href={`${baseUrl}/account/devices`} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
        Manage Devices
      </a>
      <div style={{ marginTop: 10 }}>
        <button className="da-btn da-btn--ghost" onClick={() => void onRetry()} type="button">
          Check again
        </button>
      </div>
    </>
  );
}

function IpReauthState({
  startLogin,
}: {
  startLogin: () => Promise<{ loginUrl: string; error?: string }>;
}) {
  return (
    <>
      <h1 className="da-title">Network Changed</h1>
      <div className="da-status da-status--warn">
        <span className="da-status__icon" aria-hidden="true">🌐</span>
        <div className="da-status__body">
          <p className="da-status__title">Your network IP address has changed</p>
          <p className="da-status__desc">
            For security, CSheet requires you to sign in again after switching networks.
          </p>
        </div>
      </div>
      <button className="da-btn da-btn--primary" onClick={() => void startLogin()} type="button">
        Re-authenticate Now
      </button>
    </>
  );
}

function DeviceRevokedState({
  startLogin,
}: {
  startLogin: () => Promise<{ loginUrl: string; error?: string }>;
}) {
  return (
    <>
      <h1 className="da-title">Device Signed Out</h1>
      <div className="da-status da-status--error">
        <span className="da-status__icon" aria-hidden="true">🔒</span>
        <div className="da-status__body">
          <p className="da-status__title">This device has been removed</p>
          <p className="da-status__desc">
            Your device was signed out from your CookApps account settings. Sign in again to continue.
          </p>
        </div>
      </div>
      <button className="da-btn da-btn--primary" onClick={() => void startLogin()} type="button">
        Sign In Again
      </button>
    </>
  );
}

function UserDisabledState({ baseUrl }: { baseUrl: string }) {
  return (
    <>
      <h1 className="da-title">Account Disabled</h1>
      <div className="da-status da-status--error">
        <span className="da-status__icon" aria-hidden="true">🚫</span>
        <div className="da-status__body">
          <p className="da-status__title">Your CookApps account has been disabled</p>
          <p className="da-status__desc">
            Contact CookApps support if you believe this is an error.
          </p>
        </div>
      </div>
      <a className="da-btn da-btn--ghost" href={`${baseUrl}/support`} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
        Contact Support
      </a>
    </>
  );
}
