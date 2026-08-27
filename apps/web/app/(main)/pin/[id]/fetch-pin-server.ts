/**
 * FE-4 — Fetch một pin ở PHÍA SERVER cho `generateMetadata` và cho phép trang
 * `notFound()` trả HTTP 404 chuẩn.
 *
 * KHÔNG qua Apollo Client (client-only theo QĐ FE-0). Đây là một cú `fetch()`
 * thuần.
 *
 * 🔴 PHẢI GỬI TOKEN CỦA NGƯỜI ĐANG XEM (sửa 25/08/2026, luồng F2).
 *
 * Bản FE-4 cố ý gọi KHÔNG token với lý do "`pin(id)` là auth tuỳ chọn nên vẫn
 * 200". Câu đó đúng khi mọi pin đều công khai và SAI kể từ khi luồng A/F1 cho
 * đăng pin non-PUBLIC: `getVisiblePinWhere` fail-closed, thiếu viewer ⇒ chỉ
 * PUBLIC lọt lưới. Hậu quả đo được: alice mở THẲNG URL một pin CIRCLE mà chính
 * cô ấy nằm trong khán giả → `notFound()` bắn trước khi client kịp render →
 * "Pin không tồn tại"; bấm từ trong app (điều hướng client-side) thì thấy bình
 * thường. Chủ pin mở kho rồi F5 cũng mất màn theo đúng đường đó.
 *
 * Đây KHÔNG phải nới lỏng bảo mật: hàng rào vẫn nằm nguyên ở backend. Gửi token
 * chỉ làm câu hỏi ở tầng server trùng với câu hỏi ở tầng client — "pin này có
 * hiện với NGƯỜI NÀY không" — thay vì "có hiện với khách vãng lai không". Người
 * ngoài khán giả vẫn nhận đúng 404 (không phải 403, cùng chính sách backend).
 *
 * Token là `session.accessToken` của Auth.js. Nơi gọi phải tự lấy và truyền
 * vào — module này cố ý KHÔNG tự `auth()`: `generateMetadata` và `Page` chạy
 * hai lượt riêng, để mỗi lượt tự quyết định thì còn thấy được cả hai đường.
 *
 * Ba trạng thái phân biệt:
 *   • pin: null, error: null       → API 200, `data.pin === null` (pin không
 *                                    tồn tại, HOẶC ngoài khán giả của người
 *                                    xem) — page gọi `notFound()`.
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

import { graphqlUrl } from '@/lib/api-origin';

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
  // Ở server-side render, `fetch` cần URL tuyệt đối.
  //
  // 27/08/2026 — đi qua `graphqlUrl()` thay vì đọc env thẳng. Trên production
  // biến NEXT_PUBLIC_* không được đặt (xem `lib/api-origin.ts`), và nhánh
  // máy chủ của helper trả `API_INTERNAL_URL` = 127.0.0.1:4000 — API là
  // container CÙNG task, nên lời gọi này không ra internet lần nào.
  return graphqlUrl();
}

export async function fetchPinForServer(
  id: string,
  /**
   * `session.accessToken` của người đang xem, hoặc `undefined` cho khách vãng
   * lai. Thiếu nó ⇒ backend chỉ trả pin PUBLIC — xem cảnh báo đỏ đầu file.
   */
  accessToken?: string,
): Promise<{ pin: ServerPin | null; error: 'not-found' | 'network' | null }> {
  let res: Response;
  try {
    res = await fetch(apiUrl(), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify({
        query: PIN_METADATA_QUERY,
        variables: { id },
      }),
      // KHÔNG cache — pin có thể bị xoá/chặn, mỗi lần render là một lần đọc mới.
      // Kết quả nay còn phụ thuộc NGƯỜI XEM nữa, nên 'no-store' từ chỗ "cho
      // chắc" thành bắt buộc: cache một lần đọc có token rồi phục vụ lại cho
      // người khác là rò rỉ pin riêng tư.
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
