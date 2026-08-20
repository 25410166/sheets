// Copyright (c) 2026 CookApps
// SPDX-License-Identifier: Apache-2.0

export type AuthErrorCode =
  | 'APP_NOT_AVAILABLE'
  | 'INVALID_APP_SLUG'
  | 'INVALID_DEVICE_KEY'
  | 'INVALID_PLATFORM'
  | 'INVALID_STATE'
  | 'INVALID_CODE_CHALLENGE'
  | 'INVALID_PUBLIC_KEY'
  | 'RATE_LIMITED'
  | 'REQUEST_EXPIRED'
  | 'LOGIN_REQUIRED'
  | 'UPGRADE_REQUIRED'
  | 'DEVICE_LIMIT_REACHED'
  | 'INVALID_REPLACEMENT_DEVICE'
  | 'INVALID_EXCHANGE_CODE'
  | 'EXCHANGE_ALREADY_CONSUMED'
  | 'DEVICE_BINDING_MISMATCH'
  | 'PKCE_VERIFICATION_FAILED'
  | 'DEVICE_REVOKED'
  | 'DEVICE_PROOF_REQUIRED'
  | 'DEVICE_PROOF_INVALID'
  | 'IP_REAUTH_REQUIRED'
  | 'USER_DISABLED'
  | 'LEASE_SIGNING_NOT_CONFIGURED';

export interface UserPlanInfo {
  userId: string;
  email: string;
  name: string;
  planCode: string;
  subscriptionStatus: string;
  activeDevicesCount: number;
  maxDevicesAllowed: number;
}

export interface DeviceInfo {
  id: string;
  deviceKey: string;
  name: string;
  platform: 'macOS' | 'Windows';
  ipAddress?: string;
  lastActiveAt?: string;
}

export interface EntitlementInfo {
  allowed: boolean;
  isFree: boolean;
  reason?: string;
  planRequired?: string;
  appName?: string;
  checkoutUrl?: string | null;
}

export interface DesktopAuthStartResponse {
  success: boolean;
  loginUrl: string;
  callbackScheme: string;
  expiresAt: string;
  errorCode?: AuthErrorCode;
  error?: string;
}

export interface DesktopAuthExchangeResponse {
  success: boolean;
  authenticated: boolean;
  accessToken?: string;
  leaseToken?: string;
  leaseExpiresAt?: number;
  leaseGraceUntil?: number;
  ipChanged?: boolean;
  user?: UserPlanInfo;
  device?: DeviceInfo;
  entitlement?: EntitlementInfo;
  activeDevices?: DeviceInfo[];
  errorCode?: AuthErrorCode;
  error?: string;
}

export interface DesktopSessionResponse {
  success: boolean;
  authenticated: boolean;
  user?: UserPlanInfo;
  device?: DeviceInfo;
  entitlement?: EntitlementInfo;
  leaseToken?: string;
  leaseExpiresAt?: number;
  leaseGraceUntil?: number;
  errorCode?: AuthErrorCode;
  error?: string;
}

export interface LeasePayload {
  version: number;
  user_id: string;
  device_id: string;
  app_entitlements: string[];
  entitlement_allowed: boolean;
  issued_at: number;
  expires_at: number;
  grace_until: number;
}

export interface DeviceKeyPair {
  /** Base64 of DER SPKI Ed25519 public key */
  publicKeySpkiBase64: string;
  /** Exported JWK for persistent storage – NEVER log or expose */
  privateKeyJwk: JsonWebKey;
}
