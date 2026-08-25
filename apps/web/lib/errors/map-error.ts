import type { GraphQLFormattedError } from 'graphql';

/**
 * FE-0b — Module MAP lỗi → trạng thái. Một chỗ duy nhất trong toàn app.
 *
 * VÌ SAO tồn tại module này:
 *   Backend không dùng HTTP status để phân loại lỗi query GraphQL. Query bắt
 *   buộc auth NHƯNG KHÔNG có token trả về HTTP 200 + `errors[]` chứa
 *   "Unauthorized" — không phải 401. Nếu mỗi màn tự quy đổi, sẽ có 22 kiểu
 *   quy đổi khác nhau và không ai bắt được sai sót giữa chúng.
 *
 * CHÍNH SÁCH: không đoán ở màn. Màn nhận `LoadState` union, switch trên `kind`.
 *
 * ⚠️ Apollo Client v4 ĐÃ ĐỔI shape của error object:
 *   - `ApolloError` bị GỠ (xem node_modules/@apollo/client/v4-migration.d.ts).
 *   - `useQuery.error` giờ là một `Error` subclass tuỳ nguồn:
 *     • Server trả `errors[]` trong response GraphQL → `CombinedGraphQLErrors`
 *       (field: `errors: ReadonlyArray<GraphQLFormattedError>`; `message` là
 *       chuỗi join sẵn).
 *     • WS subscription lỗi protocol → `CombinedProtocolErrors` (cùng shape
 *       `errors`).
 *     • Server trả HTTP xấu (non-2xx) → `ServerError` (fields: `statusCode`,
 *       `bodyText`, `response`).
 *     • Không kết nối được (fetch failed) → `Error`/`TypeError` chuẩn.
 *   Module này dùng duck typing — không import class trực tiếp để đỡ lệ thuộc
 *   phiên bản.
 *
 * Đối chiếu tối thiểu (đã kiểm ở PROMPT_FE0B-1A.md §6, apps/api/src/…):
 *   - "Unauthorized"                     → { kind: 'unauthenticated' }
 *   - "Pin not found" / "not found"      → { kind: 'not-found' }
 *   - "Account temporarily locked"       → { kind: 'locked', retryAfterSec }
 *   - "Too many failed attempts"         → { kind: 'locked', retryAfterSec: 900 }
 *   - "Invalid credentials"              → { kind: 'invalid-credentials' }
 *   - "Too many pins created…"           → { kind: 'rate-limit', retryAfterSec }
 *   - "Daily pin limit exceeded"         → { kind: 'rate-limit' }  (trần NGÀY, đã bỏ 24/08)
 *   - "must be … character(s)"           → { kind: 'validation', hint }
 *   - Bad Request 400 (validation input) → { kind: 'validation' }
 *   - Network / fetch failed / TypeError → { kind: 'network' }
 *   - còn lại                            → { kind: 'unknown', raw }
 *
 * ⚠️ KHÔNG map "Not a member of this conversation" thành 'not-found' — thông
 * điệp này chạy qua WebSocket subscription của D4 (chat), phải hiện dạng
 * "kênh chat bị từ chối", khác hoàn toàn với 404 "pin không tồn tại". Trả về
 * 'forbidden' cho các thông điệp truy cập bị từ chối tương tự.
 */

export type LoadState =
  | { kind: 'unauthenticated' }
  | { kind: 'not-found' }
  | { kind: 'locked'; retryAfterSec: number }
  | { kind: 'invalid-credentials' }
  | { kind: 'rate-limit'; message: string; retryAfterSec?: number | null }
  | { kind: 'validation'; message: string }
  | { kind: 'forbidden'; message: string }
  | { kind: 'network' }
  | { kind: 'unknown'; message: string };

/**
 * Parse số giây khoá còn lại từ thông điệp "Try again in 900s.".
 * Trả null nếu không tìm được.
 */
function parseRetryAfter(message: string): number | null {
  const m = message.match(/(\d+)\s*s/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Map một string message (đã lower-case) → LoadState.
 * Trả null nếu không có phép nào khớp.
 */
function classifyMessage(rawMessage: string): LoadState | null {
  const message = rawMessage.trim();
  if (!message) return null;
  const lower = message.toLowerCase();

  if (lower.includes('unauthorized') || lower.includes('unauthenticated')) {
    return { kind: 'unauthenticated' };
  }

  if (lower.includes('not a member')) {
    // Subscription/query từ chối vì user KHÔNG thuộc conversation/board — dạng
    // 'forbidden', không phải 'not-found'.
    return { kind: 'forbidden', message };
  }

  if (lower.includes('not found')) {
    return { kind: 'not-found' };
  }

  if (lower.includes('too many failed attempts')) {
    return { kind: 'locked', retryAfterSec: 900 };
  }

  if (lower.includes('account temporarily locked')) {
    const retry = parseRetryAfter(message);
    return { kind: 'locked', retryAfterSec: retry ?? 900 };
  }

  if (lower.includes('invalid credentials')) {
    return { kind: 'invalid-credentials' };
  }

  // `too many pins created` = trần 10 pin/PHÚT (XH-4b, backend trả 403 kèm số
  // giây). `daily pin limit exceeded` là trần NGÀY đã bị bỏ từ 24/08 — giữ lại
  // vế đó vì một API cũ hơn đang chạy ở đâu đó vẫn có thể trả nó, và nhận nhầm
  // thành lỗi lạ thì người dùng mất câu "chờ bao lâu".
  if (
    lower.includes('too many pins created') ||
    lower.includes('daily pin limit exceeded') ||
    lower.includes('rate limit')
  ) {
    return { kind: 'rate-limit', message, retryAfterSec: parseRetryAfter(message) };
  }

  // NestJS Bad Request payload có shape { statusCode: 400, error: 'Bad Request',
  // message: string[] }. Khi qua GraphQL, message thường được stringify.
  if (
    lower.includes('bad request') ||
    lower.includes('validation') ||
    lower.includes('must be') ||
    lower.includes('must not be')
  ) {
    return { kind: 'validation', message };
  }

  return null;
}

/**
 * Duck-typed extractor cho CombinedGraphQLErrors / CombinedProtocolErrors.
 * Cả hai lộ field `errors: ReadonlyArray<GraphQLFormattedError>`.
 */
function extractGraphQLErrors(
  error: unknown,
): ReadonlyArray<GraphQLFormattedError> | null {
  if (!error || typeof error !== 'object') return null;
  const errs = (error as { errors?: unknown }).errors;
  if (!Array.isArray(errs) || errs.length === 0) return null;
  return errs as ReadonlyArray<GraphQLFormattedError>;
}

/**
 * Duck-typed extractor cho ServerError (Apollo v4). Có `statusCode`, `bodyText`.
 */
function extractServerError(
  error: unknown,
): { statusCode: number; bodyText: string; message: string } | null {
  if (!error || typeof error !== 'object') return null;
  const e = error as { statusCode?: unknown; bodyText?: unknown; message?: unknown };
  if (typeof e.statusCode !== 'number') return null;
  return {
    statusCode: e.statusCode,
    bodyText: typeof e.bodyText === 'string' ? e.bodyText : '',
    message: typeof e.message === 'string' ? e.message : '',
  };
}

/**
 * Map error từ useQuery/useMutation → trạng thái để render.
 */
export function mapError(error: unknown): LoadState {
  if (!error) return { kind: 'unknown', message: '' };

  // 1) CombinedGraphQLErrors / CombinedProtocolErrors — có `errors[]`.
  const gqlErrors = extractGraphQLErrors(error);
  if (gqlErrors) {
    for (const err of gqlErrors) {
      const cls = classifyMessage(err.message ?? '');
      if (cls) return cls;
    }
    // Có errors nhưng không phép nào khớp — dùng message đầu để log.
    return { kind: 'unknown', message: gqlErrors[0]?.message ?? '' };
  }

  // 2) ServerError — HTTP non-2xx từ endpoint.
  const server = extractServerError(error);
  if (server) {
    const { statusCode, bodyText, message } = server;

    // Cố gắng đọc message thật trong body (NestJS response body).
    const bodyMessage = extractBodyMessage(bodyText);
    if (bodyMessage) {
      const cls = classifyMessage(bodyMessage);
      if (cls) return cls;
    }

    if (statusCode === 401) return { kind: 'unauthenticated' };
    if (statusCode === 403) return { kind: 'forbidden', message: bodyMessage ?? message };
    if (statusCode === 404) return { kind: 'not-found' };
    if (statusCode === 429) return { kind: 'rate-limit', message: bodyMessage ?? message };
    if (statusCode >= 400 && statusCode < 500) {
      return { kind: 'validation', message: bodyMessage ?? message };
    }
    return { kind: 'network' };
  }

  // 3) TypeError: Failed to fetch → thật sự network.
  if (error instanceof TypeError) return { kind: 'network' };

  // 4) Fallback — thử classify chính `.message`. CombinedGraphQLErrors join
  //    messages bằng '\n' vào `.message` sẵn nên classifyMessage vẫn tìm được
  //    "Unauthorized" ở đây (đây là đường thoát khi bước 1 miss vì lý do lạ).
  const message =
    (typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message?: unknown }).message ?? '')
      : typeof error === 'string'
        ? error
        : '');
  const cls = classifyMessage(message);
  if (cls) return cls;

  return { kind: 'unknown', message };
}

function extractBodyMessage(bodyText: string): string | null {
  if (!bodyText) return null;
  try {
    const body = JSON.parse(bodyText) as unknown;
    if (body && typeof body === 'object') {
      const m = (body as Record<string, unknown>).message;
      if (typeof m === 'string') return m;
      if (Array.isArray(m) && m.length > 0 && typeof m[0] === 'string') return m.join('; ');
    }
  } catch {
    // body không phải JSON — trả nguyên text.
    return bodyText;
  }
  return bodyText;
}

/**
 * Tiện dụng cho render: `toReadState({data, loading, error})` → nhóm hiện có.
 * Không thay thế mapError; chỉ gói lại pattern hay dùng.
 */
export type ReadState<T> =
  | { phase: 'loading' }
  | { phase: 'ready'; data: T }
  | { phase: 'error'; state: LoadState };

export function toReadState<T>(input: {
  data: T | undefined | null;
  loading: boolean;
  error: unknown;
}): ReadState<T> {
  if (input.error) return { phase: 'error', state: mapError(input.error) };
  if (input.loading) return { phase: 'loading' };
  if (input.data === undefined || input.data === null) return { phase: 'loading' };
  return { phase: 'ready', data: input.data };
}
