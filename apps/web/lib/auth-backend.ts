/**
 * Cầu nối server-only sang REST endpoint của NestJS (apps/api).
 * Chỉ được gọi từ Route Handler / server callback của Auth.js — không bao giờ
 * import từ Client Component vì:
 *   - AUTH_SECRET là biến server-only (không có tiền tố NEXT_PUBLIC_).
 *   - Nếu bị bundle vào client, thao tác so sánh `crypto.timingSafeEqual` bên
 *     apps/api sẽ mất ý nghĩa.
 *
 * Hợp đồng backend (kiểm lại 2026-08-15, FE-5):
 *   POST /auth/exchange             header x-auth-secret        → TokenPair
 *   POST /auth/login                { email, password }         → TokenPair
 *   POST /auth/refresh              { refreshToken }            → { accessToken } (KHÔNG rotate)
 *   POST /auth/register            { email, password, name }   → 201 TokenPair · 409 email trùng
 *   POST /auth/forgot-password     { email }                   → 204 (kể cả email không tồn tại)
 *   POST /auth/reset-password      { token, password(8..72) }  → 204 · 400 token sai/hết hạn
 *   POST /auth/verify-email        { token }                   → 200 · 404/400 token sai/hết hạn
 *   POST /auth/resend-verification { token? } [+ Bearer]       → 204 · 429 quá nhanh
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
 * Lỗi HTTP từ backend MANG THEO status + body — không phải một `Error` chuỗi
 * phẳng. Đây là điều kiện tiên quyết của FE-5 §4.2: nếu ném `new Error("...403...")`
 * thì `mapError` không phân biệt được 401/403/khoá, và 3 trong 4 trạng thái lỗi
 * đăng nhập không bao giờ hiện đúng.
 *
 * Đặt tên field `statusCode` + `bodyText` ĐÚNG như `ServerError` của Apollo v4 để
 * nhánh duck-typing `extractServerError` trong map-error.ts nhận diện được ngay,
 * không phải thêm nhánh mới.
 */
export class BackendHttpError extends Error {
  readonly statusCode: number;
  readonly bodyText: string;
  constructor(statusCode: number, bodyText: string) {
    super(`backend ${statusCode}: ${bodyText}`);
    this.name = 'BackendHttpError';
    this.statusCode = statusCode;
    this.bodyText = bodyText;
  }
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

/**
 * POST JSON tới API. `bearer` tuỳ chọn (đường resend theo phiên). Ném
 * `BackendHttpError` khi non-2xx (mang status + body). Lỗi mạng ném `TypeError`
 * nguyên bản (map-error.ts nhận diện thành `{ kind: 'network' }`).
 */
async function postJson(path: string, body: unknown, bearer?: string): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new BackendHttpError(res.status, text);
  }
  return res;
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
    throw new BackendHttpError(res.status, body);
  }
  return (await res.json()) as TokenPair;
}

export async function loginWithPassword(email: string, password: string): Promise<TokenPair> {
  const res = await postJson('/auth/login', { email: normalizeEmail(email), password });
  return (await res.json()) as TokenPair;
}

export async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string }> {
  const res = await postJson('/auth/refresh', { refreshToken });
  return (await res.json()) as { accessToken: string };
}

/** Đăng ký. 201 → TokenPair (backend tự cấp phiên). 409 → BackendHttpError. */
export async function registerAccount(
  email: string,
  password: string,
  name: string,
): Promise<TokenPair> {
  const res = await postJson('/auth/register', { email: normalizeEmail(email), password, name });
  return (await res.json()) as TokenPair;
}

/** Quên mật khẩu. LUÔN 204 kể cả email không tồn tại (không tiết lộ). */
export async function forgotPassword(email: string): Promise<void> {
  await postJson('/auth/forgot-password', { email: normalizeEmail(email) });
}

/** Đặt lại mật khẩu bằng token. 204 → xong. 400 → token sai/hết hạn. */
export async function resetPassword(token: string, password: string): Promise<void> {
  await postJson('/auth/reset-password', { token, password });
}

/** Xác thực email bằng token. 200 → xong. 404/400 → token sai/hết hạn/hỏng. */
export async function verifyEmail(token: string): Promise<void> {
  await postJson('/auth/verify-email', { token });
}

/**
 * Gửi lại email xác thực. Nhận diện bằng token cũ (a) HOẶC phiên đăng nhập (c)
 * — truyền `accessToken` để forward thành Bearer. 204 → gửi. 429 → quá nhanh.
 */
export async function resendVerification(
  token?: string,
  accessToken?: string,
): Promise<void> {
  await postJson('/auth/resend-verification', token ? { token } : {}, accessToken);
}
