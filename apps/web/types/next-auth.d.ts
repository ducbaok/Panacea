import type { DefaultSession } from 'next-auth';

/**
 * Bổ sung field cho Session/JWT của Auth.js v5:
 *   - accessToken/refreshToken/accessTokenExpires: cặp token của backend NestJS
 *     giữ trong JWT của Auth.js (KHÔNG lộ ra client qua session vì refresh cần
 *     server-only).
 *   - error: mã lỗi cuối trong chuỗi exchange/refresh để Apollo link biết khi
 *     nào phải signOut().
 *
 * ⚠️ Chỉ accessToken được nhả ra Session — refreshToken giữ trong JWT thôi để
 * không đi qua wire tới Client Component. Nếu cần refresh ở client, đi qua
 * Route Handler.
 */

type AuthErrorCode = 'RefreshAccessTokenError' | 'ExchangeError';

declare module 'next-auth' {
  interface Session {
    accessToken?: string;
    error?: AuthErrorCode;
    user?: DefaultSession['user'];
  }

  interface User {
    accessToken?: string;
    refreshToken?: string;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    accessToken?: string;
    refreshToken?: string;
    accessTokenExpires?: number;
    error?: AuthErrorCode;
    email?: string;
  }
}

export {};
