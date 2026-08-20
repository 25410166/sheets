// Copyright (c) 2026 CookApps
// SPDX-License-Identifier: Apache-2.0
//
// Crypto primitives for CSheet desktop auth.
// Identical algorithm to the CPDF auth package – same CookApps API contract.

import type { LeasePayload } from './types';

// ─────────────────────────────── Base64 / Base64URL ──────────────────────────

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlToBytes(b64url: string): Uint8Array {
  let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4 !== 0) b64 += '=';
  return base64ToBytes(b64);
}

export function base64UrlToString(b64url: string): string {
  return new TextDecoder().decode(base64UrlToBytes(b64url));
}

// ─────────────────────────────── Random strings ───────────────────────────────

/**
 * URL-safe random string. Used for PKCE verifier (43-128 chars) and state (16-256 chars).
 */
export function generateRandomUrlSafeString(length: number): string {
  const randomBytes = new Uint8Array(Math.ceil((length * 6) / 8) + 4);
  crypto.getRandomValues(randomBytes);
  return bytesToBase64Url(randomBytes).slice(0, length);
}

// ─────────────────────────────── PKCE S256 ────────────────────────────────────

/**
 * codeChallenge = base64url(SHA-256(codeVerifier))
 */
export async function createPkceChallenge(codeVerifier: string): Promise<string> {
  const data = new TextEncoder().encode(codeVerifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return bytesToBase64Url(new Uint8Array(digest));
}

// ─────────────────────────────── Device Ed25519 key pair ─────────────────────

/**
 * Generate Ed25519 key pair for device binding.
 * publicKeySpkiBase64 = Base64(DER SPKI) – sent to CookApps API as `publicKeyEd25519`.
 */
export async function generateDeviceKeyPair(): Promise<{
  publicKeySpkiBase64: string;
  privateKey: CryptoKey;
  publicKey: CryptoKey;
}> {
  const keyPair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;

  const spkiBuffer = await crypto.subtle.exportKey('spki', keyPair.publicKey);
  const publicKeySpkiBase64 = bytesToBase64(new Uint8Array(spkiBuffer));

  return { publicKeySpkiBase64, privateKey: keyPair.privateKey, publicKey: keyPair.publicKey };
}

export async function exportPrivateKeyJwk(privateKey: CryptoKey): Promise<JsonWebKey> {
  return await crypto.subtle.exportKey('jwk', privateKey);
}

export async function importPrivateKeyJwk(jwk: JsonWebKey): Promise<CryptoKey> {
  return await crypto.subtle.importKey('jwk', jwk, { name: 'Ed25519' }, true, ['sign']);
}

// ─────────────────────────────── Device proof signature ──────────────────────

/**
 * Signs device proof for GET /api/desktop/session?appSlug=csheet
 * Message (UTF-8):
 *   GET\n/api/desktop/session?appSlug=csheet\n{timestamp}\n{nonce}
 */
export async function createDeviceProofSignature(
  privateKey: CryptoKey,
  timestampSeconds: number,
  nonce: string,
  appSlug = 'csheet',
): Promise<string> {
  const message = `GET\n/api/desktop/session?appSlug=${appSlug}\n${timestampSeconds}\n${nonce}`;
  const data = new TextEncoder().encode(message);
  const sigBuf = await crypto.subtle.sign({ name: 'Ed25519' }, privateKey, data);
  return bytesToBase64Url(new Uint8Array(sigBuf));
}

// ─────────────────────────────── Offline lease verification ──────────────────

/**
 * Verifies CookApps Ed25519 lease token offline using DESKTOP_LEASE_PUBLIC_KEY_BASE64.
 * Supports 2-part (payload.sig) and 3-part JWT-style (header.payload.sig) formats.
 */
export async function verifyLeaseTokenOffline(
  leaseToken: string,
  leasePublicKeyBase64: string,
): Promise<{ valid: boolean; payload?: LeasePayload; error?: string }> {
  if (!leaseToken || !leasePublicKeyBase64) {
    return { valid: false, error: 'Missing token or public key' };
  }

  const parts = leaseToken.split('.');
  if (parts.length !== 2 && parts.length !== 3) {
    return { valid: false, error: 'Lease token must have 2 or 3 parts separated by .' };
  }

  const payloadB64Url = parts.length === 3 ? parts[1] : parts[0];
  const sigB64Url = parts.length === 3 ? parts[2] : parts[1];
  const headerB64Url = parts.length === 3 ? parts[0] : null;

  try {
    const keyBytes = base64ToBytes(leasePublicKeyBase64);
    const keyBuffer = keyBytes.buffer.slice(
      keyBytes.byteOffset,
      keyBytes.byteOffset + keyBytes.byteLength,
    ) as ArrayBuffer;

    const pubKeys: CryptoKey[] = [];
    // Attempt SPKI import
    try {
      pubKeys.push(
        await crypto.subtle.importKey('spki', keyBuffer, { name: 'Ed25519' }, true, ['verify']),
      );
    } catch { /* fallback */ }
    // Attempt RAW import
    try {
      pubKeys.push(
        await crypto.subtle.importKey('raw', keyBuffer, { name: 'Ed25519' }, true, ['verify']),
      );
    } catch { /* fallback */ }
    // Try last 32 bytes as raw Ed25519 key
    if (keyBuffer.byteLength >= 32) {
      try {
        const raw32 = keyBuffer.slice(keyBuffer.byteLength - 32);
        pubKeys.push(
          await crypto.subtle.importKey('raw', raw32, { name: 'Ed25519' }, true, ['verify']),
        );
      } catch { /* fallback */ }
    }

    if (pubKeys.length === 0) return { valid: false, error: 'Failed to import Ed25519 public key' };

    const sigBytes = base64UrlToBytes(sigB64Url);
    const sigBuffer = sigBytes.buffer.slice(
      sigBytes.byteOffset,
      sigBytes.byteOffset + sigBytes.byteLength,
    ) as ArrayBuffer;

    const messageCandidates: ArrayBuffer[] = [];
    if (headerB64Url) {
      messageCandidates.push(
        new TextEncoder().encode(`${headerB64Url}.${payloadB64Url}`).buffer as ArrayBuffer,
      );
    }
    messageCandidates.push(
      new TextEncoder().encode(payloadB64Url).buffer as ArrayBuffer,
    );
    const rawPayload = base64UrlToBytes(payloadB64Url);
    messageCandidates.push(
      rawPayload.buffer.slice(rawPayload.byteOffset, rawPayload.byteOffset + rawPayload.byteLength) as ArrayBuffer,
    );

    let isValid = false;
    outer: for (const pubKey of pubKeys) {
      for (const msgBuf of messageCandidates) {
        try {
          if (await crypto.subtle.verify({ name: 'Ed25519' }, pubKey, sigBuffer, msgBuf)) {
            isValid = true;
            break outer;
          }
        } catch { /* next candidate */ }
      }
    }

    if (!isValid) return { valid: false, error: 'Ed25519 signature verification failed' };

    const payload = JSON.parse(base64UrlToString(payloadB64Url)) as LeasePayload;
    return { valid: true, payload };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { valid: false, error: `Lease verification error: ${msg}` };
  }
}
