/**
 * FE-4 — Fetch một pin ở PHÍA SERVER cho `generateMetadata` và cho phép trang
 * `notFound()` trả HTTP 404 chuẩn.
 *
 * KHÔNG qua Apollo Client (client-only theo QĐ FE-0). Đây là một cú `fetch()`
 * thuần, không token — `pin(id)` là auth tuỳ chọn nên vẫn 200. Vẫn lấy được
 * public data (title/description/imageUrl) để dựng thẻ chia sẻ.
 *
 * Ba trạng thái phân biệt:
 *   • pin: null, error: null       → API 200, `data.pin === null` (pin không
 *                                    tồn tại) — page gọi `notFound()`.
 *   • pin: null, error: 'not-found'→ API 200 + `errors[]` chứa "Pin not found"
 *                                    (pin của người bị chặn, hoặc soft-deleted
 *                                    trong một số nhánh) — page gọi `notFound()`.
 *   • pin: null, error: 'network'  → HTTP xấu hoặc fetch throw. KHÔNG notFound,
 *                                    để client PinDetail xử lý (có thể recover).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

export type ServerPin = {
  id: string;
  title: string | null;
  description: string | null;
  imageUrl: string;
  thumbnailUrl: string | null;
  mediumUrl: string | null;
  largeUrl: string | null;
  creator: {
    name: string | null;
    username: string | null;
  };
};

const PIN_METADATA_QUERY = /* GraphQL */ `
  query PinForMetadata($id: ID!) {
    pin(id: $id) {
      id
      title
      description
      imageUrl
      thumbnailUrl
      mediumUrl
      largeUrl
      creator {
        name
        username
      }
    }
  }
`;

function apiUrl(): string {
  // Trong dev: NEXT_PUBLIC_GRAPHQL_URL thường là http://localhost:4000/graphql.
  // Ở server-side render, `fetch` cần URL tuyệt đối; process.env đã có.
  return process.env.NEXT_PUBLIC_GRAPHQL_URL ?? 'http://localhost:4000/graphql';
}

export async function fetchPinForServer(
  id: string,
): Promise<{ pin: ServerPin | null; error: 'not-found' | 'network' | null }> {
  let res: Response;
  try {
    res = await fetch(apiUrl(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: PIN_METADATA_QUERY,
        variables: { id },
      }),
      // KHÔNG cache — pin có thể bị xoá/chặn, mỗi lần render là một lần đọc mới.
      cache: 'no-store',
    });
  } catch {
    return { pin: null, error: 'network' };
  }

  if (!res.ok) {
    return { pin: null, error: 'network' };
  }

  let payload: Json;
  try {
    payload = await res.json();
  } catch {
    return { pin: null, error: 'network' };
  }

  // Có errors[] — thường là "Pin not found" (pin bị chặn / soft-deleted).
  if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
    const messages = payload.errors
      .map((e: Json) => (typeof e?.message === 'string' ? e.message.toLowerCase() : ''))
      .join(' | ');
    if (messages.includes('not found')) {
      return { pin: null, error: 'not-found' };
    }
    return { pin: null, error: 'network' };
  }

  const pin = payload?.data?.pin as ServerPin | null | undefined;
  if (!pin) {
    return { pin: null, error: null };
  }
  return { pin, error: null };
}
