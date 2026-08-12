import { NextResponse } from 'next/server';
import { loginWithPassword } from '@/lib/auth-backend';

/**
 * FE-0 §8 phép 4 — bằng chứng chuỗi: web env → /auth/login → GraphQL /me.
 *
 * TEMPORARY probe. Xoá sau khi FE-5 dựng UI login thật.
 *
 * Cách chạy (API + Postgres cần đang lên):
 *   1) pnpm --filter api start:dev
 *   2) pnpm --filter web dev
 *   3) curl http://localhost:3000/api/probe/me
 *      → { ok: true, user: { id, username, email }, tokenPreview: "eyJ..." }
 *
 * Chỉ chấp GET, chỉ trong development.
 */

const SEED_EMAIL = 'bao@example.com';
const SEED_PASSWORD = 'password123';

export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ ok: false, error: 'probe disabled in production' }, { status: 404 });
  }

  try {
    const { accessToken } = await loginWithPassword(SEED_EMAIL, SEED_PASSWORD);

    const graphqlUrl = process.env.NEXT_PUBLIC_GRAPHQL_URL ?? 'http://localhost:4000/graphql';
    const gqlRes = await fetch(graphqlUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        query: 'query Me { me { id username email name } }',
      }),
      cache: 'no-store',
    });

    if (!gqlRes.ok) {
      const body = await gqlRes.text().catch(() => '');
      return NextResponse.json(
        { ok: false, stage: 'graphql', status: gqlRes.status, body },
        { status: 502 },
      );
    }

    const payload = (await gqlRes.json()) as {
      data?: { me?: { id: string; username?: string; email?: string; name?: string } | null };
      errors?: Array<{ message: string }>;
    };

    if (payload.errors?.length) {
      return NextResponse.json({ ok: false, stage: 'graphql-errors', errors: payload.errors }, { status: 502 });
    }

    return NextResponse.json({
      ok: true,
      user: payload.data?.me ?? null,
      tokenPreview: `${accessToken.slice(0, 12)}...${accessToken.slice(-6)}`,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, stage: 'login', error: (err as Error).message },
      { status: 500 },
    );
  }
}
