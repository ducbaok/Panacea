/**
 * Cầu nối server-only sang REST endpoint của NestJS (apps/api).
 * Chỉ được gọi từ Route Handler / server callback của Auth.js — không bao giờ
 * import từ Client Component vì:
 *   - AUTH_SECRET là biến server-only (không có tiền tố NEXT_PUBLIC_).
 *   - Nếu bị bundle vào client, thao tác so sánh `crypto.timingSafeEqual` bên
 *     apps/api sẽ mất ý nghĩa.
 *
 * Hợp đồng backend (đã kiểm 2026-08-12):
 *   POST /auth/exchange  header x-auth-secret  → TokenPair
 *   POST /auth/login     body { email, password }  → TokenPair
 *   POST /auth/refresh   body { refreshToken }     → { accessToken } (KHÔNG rotate refresh)
 *
 * Access token TTL = 15m (apps/api/src/config/configuration.ts:73).
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const EXCHANGE_URL = process.env.EXCHANGE_ENDPOINT ?? `${API_URL}/auth/exchange`;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface OAuthExchangeInput {
  email: string;
  provider: string;
  providerAccountId: string;
  name?: string;
  avatarUrl?: string;
}

/**
 * Chuẩn hoá email trước MỌI request auth:
 * - trim khoảng trắng
 * - hạ chữ thường
 *
 * ⚠️ Backend cố tình phân biệt hoa/thường (auth.service.ts:296-318 — quyết định
 * có chủ đích, đọc kỹ khối chú thích S8 trước khi đảo). Nếu web KHÔNG lowercase
 * trước khi gửi, cùng một người đăng nhập Google (email `bao@x.com` do provider
 * trả về) rồi đăng ký password (email `Bao@X.com` do user gõ) sẽ ra HAI tài
 * khoản khác nhau ở backend.
 */
export function normalizeEmail(raw: string | null | undefined): string {
  return String(raw ?? '').trim().toLowerCase();
}

export async function exchangeOAuth(input: OAuthExchangeInput): Promise<TokenPair> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error(
      'AUTH_SECRET chưa được đặt trong apps/web/.env — Auth.js không thể gọi /auth/exchange.',
    );
  }
  const res = await fetch(EXCHANGE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-auth-secret': secret,
    },
    body: JSON.stringify({ ...input, email: normalizeEmail(input.email) }),
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`/auth/exchange ${res.status}: ${body}`);
  }
  return (await res.json()) as TokenPair;
}

export async function loginWithPassword(email: string, password: string): Promise<TokenPair> {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: normalizeEmail(email), password }),
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`/auth/login ${res.status}: ${body}`);
  }
  return (await res.json()) as TokenPair;
}

export async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string }> {
  const res = await fetch(`${API_URL}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`/auth/refresh ${res.status}: ${body}`);
  }
  return (await res.json()) as { accessToken: string };
}
