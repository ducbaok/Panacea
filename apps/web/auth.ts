import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import GitHub from 'next-auth/providers/github';
import Credentials from 'next-auth/providers/credentials';
import {
  exchangeOAuth,
  loginWithPassword,
  refreshAccessToken,
  normalizeEmail,
  type TokenPair,
} from '@/lib/auth-backend';

/**
 * FE-0 QĐ-A — Auth.js v5 (Decouple Sessions).
 *
 * WHY decouple: Auth.js v5 dùng JWE (mã hoá), `passport-jwt` của NestJS KHÔNG
 * decrypt được JWE ⇒ hai hệ phiên phải chồng nhau. Auth.js giữ session của nó
 * (cookie JWE), backend giữ accessToken/refreshToken của nó — cầu nối là
 * /auth/exchange gọi 1 lần ngay sau OAuth thành công.
 *
 * Chỗ TỐN THỜI GIAN NHẤT của FE-0 không phải OAuth mà là LÀM MỚI TOKEN — vì
 * xử lý hết hạn nằm bên trong callback `jwt` này. Sơ đồ vòng đời:
 *
 *   OAuth signIn  ─┐
 *                  ├─▶ callback jwt (first)  ─▶ exchange     ─▶ TokenPair vào JWT
 *   Credentials  ──┤                                                       │
 *                                                                          ▼
 *                                          callback jwt (subsequent) — kiểm hạn
 *                                                                          │
 *                                              hạn còn ──yes──▶ trả token nguyên
 *                                                          no
 *                                                          ▼
 *                                          refreshAccessToken (KHÔNG rotate refresh)
 *                                                          │
 *                                              thành công ─▶ set accessToken mới
 *                                                  thất bại
 *                                                  ▼
 *                                              token.error = 'RefreshAccessTokenError'
 *                                              → Apollo link sẽ signOut()
 */

// Access token TTL của backend = 15m (apps/api/src/config/configuration.ts:73).
// Refresh sớm 30s để tránh window race với network latency.
const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;
const REFRESH_LEEWAY_MS = 30 * 1000;

type OAuthProvider = 'google' | 'github';
const OAUTH_PROVIDERS = new Set<OAuthProvider>(['google', 'github']);

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID!,
      clientSecret: process.env.AUTH_GOOGLE_SECRET!,
    }),
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID!,
      clientSecret: process.env.AUTH_GITHUB_SECRET!,
    }),
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const email = normalizeEmail(credentials?.email as string | undefined);
        const password = String(credentials?.password ?? '');
        if (!email || password.length < 8) return null;
        try {
          const pair = await loginWithPassword(email, password);
          // `user` của Auth.js không được phép mang field lạ theo type; cast để pass
          // sang callback jwt qua tham số `user`.
          return {
            id: email,
            email,
            accessToken: pair.accessToken,
            refreshToken: pair.refreshToken,
          } as unknown as { id: string; email: string };
        } catch (err) {
          console.error('[auth] credentials /auth/login failed:', err);
          return null;
        }
      },
    }),
  ],
  session: { strategy: 'jwt' },
  callbacks: {
    async jwt({ token, user, account, profile }) {
      // ── NHÁNH 1: OAuth lần đầu ────────────────────────────────────────────────
      if (account && OAUTH_PROVIDERS.has(account.provider as OAuthProvider) && profile) {
        const email = normalizeEmail(profile.email);
        try {
          const pair: TokenPair = await exchangeOAuth({
            email,
            provider: account.provider,
            providerAccountId: account.providerAccountId,
            name: (profile.name as string | undefined) ?? undefined,
            avatarUrl:
              ((profile as { picture?: string }).picture as string | undefined) ??
              ((profile as { avatar_url?: string }).avatar_url as string | undefined),
          });
          token.accessToken = pair.accessToken;
          token.refreshToken = pair.refreshToken;
          token.accessTokenExpires = Date.now() + ACCESS_TOKEN_TTL_MS;
          token.email = email;
          token.error = undefined;
        } catch (err) {
          console.error('[auth] /auth/exchange failed:', err);
          token.error = 'ExchangeError';
        }
        return token;
      }

      // ── NHÁNH 2: Credentials lần đầu — user do authorize() trả về ─────────────
      if (user) {
        const u = user as unknown as { accessToken?: string; refreshToken?: string; email?: string };
        if (u.accessToken && u.refreshToken) {
          token.accessToken = u.accessToken;
          token.refreshToken = u.refreshToken;
          token.accessTokenExpires = Date.now() + ACCESS_TOKEN_TTL_MS;
          token.email = u.email;
          token.error = undefined;
        }
        return token;
      }

      // ── NHÁNH 3: Lần gọi sau — còn hạn thì trả nguyên, hết hạn thì refresh ────
      const exp = typeof token.accessTokenExpires === 'number' ? token.accessTokenExpires : 0;
      if (Date.now() < exp - REFRESH_LEEWAY_MS) {
        return token;
      }
      if (!token.refreshToken) {
        // Không có refresh (ví dụ exchange trước đó lỗi) — để nguyên, error đã set.
        return token;
      }
      try {
        const { accessToken } = await refreshAccessToken(String(token.refreshToken));
        token.accessToken = accessToken;
        token.accessTokenExpires = Date.now() + ACCESS_TOKEN_TTL_MS;
        token.error = undefined;
      } catch (err) {
        console.error('[auth] /auth/refresh failed:', err);
        token.error = 'RefreshAccessTokenError';
      }
      return token;
    },
    async session({ session, token }) {
      // Auth.js v5 khai `JWT extends Record<string, unknown>` ⇒ mọi field
      // augment vẫn bị suy `unknown` khi đọc. Cast runtime-safe qua typeof.
      session.accessToken = typeof token.accessToken === 'string' ? token.accessToken : undefined;
      session.error =
        token.error === 'RefreshAccessTokenError' || token.error === 'ExchangeError'
          ? token.error
          : undefined;
      if (typeof token.email === 'string' && session.user) {
        session.user.email = token.email;
      }
      return session;
    },
  },
  // Dev/CI: AUTH_URL không luôn được đặt; trustHost cho phép Auth.js suy ra host
  // từ header X-Forwarded-* (an toàn ở localhost, prod nên set AUTH_URL rõ ràng).
  trustHost: true,
});
