import { apiOrigin } from '@/lib/api-origin';

/**
 * FE-7 §6.4 — Helper upload ảnh + đo kích thước cho luồng Tạo pin (B4).
 *
 * VÌ SAO tự viết (không tái dùng Apollo/mapError):
 *   - Ảnh KHÔNG đi qua GraphQL. Đường duy nhất khả dụng là REST
 *     `POST /uploads/local` (presigned/S3 chưa cấu hình — xem brief §4.3), trả
 *     `{ url, key }` với `url` là URL tuyệt đối nhét thẳng vào `createPin.imageUrl`.
 *   - Apollo `authLink` CHỈ gắn token cho GraphQL; `fetch` thường KHÔNG được gắn
 *     ⇒ phải tự đính `Authorization: Bearer <accessToken>` (lấy từ useSession).
 *   - Lỗi REST KHÔNG phải ApolloError ⇒ `mapError` (lib/errors) không nhận đúng
 *     shape. Ở đây map theo `res.status` + `body.message` sang KIND riêng; màn
 *     (B4) ánh xạ kind → chuỗi tiếng Việt đã duyệt. Không nhúng chuỗi UI vào đây.
 *
 * 🔴 BẪY (brief §8.3, §5.2):
 *   - FormData ĐÚNG MỘT field tên `file`, KHÔNG kèm field text nào khác (multer
 *     cấu hình `fields: 0` — kèm field phụ là bị từ chối).
 *   - TUYỆT ĐỐI không tự set `Content-Type` — để trình duyệt tự sinh boundary.
 *   - 413 (quá 10MB) do multer cắt giữa chừng CÓ THỂ không kèm body JSON chuẩn
 *     ⇒ nhận diện bằng STATUS 413, đừng phụ thuộc body.
 */

/** Trần/sàn upload — nguồn sự thật là server; đây chỉ để tiền-kiểm phía client. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB
export const MIN_UPLOAD_BYTES = 1024; // 1KB
export const ALLOWED_UPLOAD_MIME: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
];

/**
 * Loại lỗi upload — màn B4 dịch sang chuỗi tiếng Việt đã duyệt (Q1). Cố ý KHÔNG
 * chứa văn bản UI ở tầng này (tách chuỗi đang chờ duyệt khỏi hạ tầng).
 */
export type UploadErrorKind =
  | 'too-large' // 413 — quá 10MB
  | 'unsupported-type' // 400 "Unsupported file type…"
  | 'too-small' // 400 "File too small (min 1024 bytes)"
  | 'no-file' // 400 "No file uploaded" (không nên xảy ra từ UI)
  | 'unauthorized' // 401 — thiếu/sai token phiên
  | 'network' // fetch ném — mất mạng / server chết
  | 'unknown'; // status/message khác

export class UploadError extends Error {
  readonly kind: UploadErrorKind;
  readonly status?: number;
  readonly serverMessage?: string;

  constructor(
    kind: UploadErrorKind,
    opts?: { status?: number; serverMessage?: string },
  ) {
    super(`UploadError(${kind})${opts?.serverMessage ? `: ${opts.serverMessage}` : ''}`);
    this.name = 'UploadError';
    this.kind = kind;
    this.status = opts?.status;
    this.serverMessage = opts?.serverMessage;
    // Giữ instanceof đúng khi transpile xuống ES5-ish.
    Object.setPrototypeOf(this, UploadError.prototype);
  }
}

export interface UploadResult {
  /** URL tuyệt đối (http://localhost:4000/uploads/<uuid>.<ext>) — nhét vào createPin.imageUrl. */
  url: string;
  /** Object key (<uuid>.<ext>). */
  key: string;
}

/**
 * Tiền-kiểm phía client (tuỳ chọn) — cho phản hồi tức thì trước khi tốn round-trip.
 * Trả kind lỗi đầu tiên gặp, hoặc null nếu ổn. Server VẪN là chốt chặn cuối.
 */
export function precheckFile(file: File): UploadErrorKind | null {
  if (file.type && !ALLOWED_UPLOAD_MIME.includes(file.type)) return 'unsupported-type';
  if (file.size > MAX_UPLOAD_BYTES) return 'too-large';
  if (file.size < MIN_UPLOAD_BYTES) return 'too-small';
  return null;
}

// ─── XH-VIDEO (26/08/2026) ───────────────────────────────────────────────────

/** Trần video — bản sao client của `MAX_VIDEO_UPLOAD_BYTES` ở API. */
export const MAX_VIDEO_UPLOAD_BYTES = 30 * 1024 * 1024; // 30MB

/**
 * Container video được nhận. KHÔNG phải lựa chọn của mình: `MediaRecorder` ghi
 * ra `video/webm` trên Chrome/Firefox và `video/mp4` trên Safari, và phương án
 * A không transcode, nên whitelist phải phủ đúng thứ trình duyệt sinh ra.
 */
export const ALLOWED_VIDEO_MIME: readonly string[] = ['video/webm', 'video/mp4'];

/**
 * Cắt tham số codec: `video/webm;codecs="vp9,opus"` → `video/webm`.
 *
 * `MediaRecorder` đặt `Blob.type` kèm codec, nên so sánh thẳng với whitelist là
 * trượt 100% — cùng cái bẫy mà `normalizeContentType` ở API xử lý cho nhánh
 * server. Hai bản sao vì hai tầng không dùng chung code được; giữ cùng tên
 * hàm để grep một phát ra cả hai.
 */
export function normalizeMime(raw: string): string {
  return (raw ?? '').split(';')[0].trim().toLowerCase();
}

/**
 * Tiền-kiểm cho VIDEO — hàm riêng, cố ý không nhét vào `precheckFile`.
 *
 * `precheckFile` đang phục vụ đường chọn ảnh từ đĩa và đường đổi avatar; nới nó
 * ra để nhận thêm video nghĩa là một file .mp4 kéo-thả vào ô chọn ảnh sẽ lọt
 * qua cửa kiểm rồi hỏng ở tận `createPin`. Đường video CHỈ đến từ màn quay, và
 * đó là chỗ duy nhất gọi hàm này.
 */
export function precheckVideoFile(file: File): UploadErrorKind | null {
  const mime = normalizeMime(file.type);
  if (mime && !ALLOWED_VIDEO_MIME.includes(mime)) return 'unsupported-type';
  if (file.size > MAX_VIDEO_UPLOAD_BYTES) return 'too-large';
  if (file.size < MIN_UPLOAD_BYTES) return 'too-small';
  return null;
}

// 27/08/2026 — gốc API suy LÚC GỌI, không đóng băng ở tầng module: trên
// production không có ALB nên địa chỉ đến từ `window.location`. Xem
// `lib/api-origin.ts` để biết vì sao nướng nó vào bundle là không hội tụ.

/**
 * 🔴 27/08/2026 — HAI CỬA UPLOAD, chọn bằng biến BUILD-TIME.
 *
 * `POST /uploads/local` ghi vào đĩa của tiến trình API. Trên ECS Fargate
 * filesystem là **ephemeral** và không chia sẻ giữa các task, nên API đã CHẶN
 * CỨNG cửa đó khi `NODE_ENV=production` (`uploads.controller.ts` — ném 403).
 * Trước bản này frontend không có cửa nào khác ⇒ đẩy lên AWS là tạo pin, đổi
 * avatar, ảnh bìa và đăng video đều chết, còn thông điệp thì nói về "local
 * upload" nên rất dễ bị đọc thành lỗi cấu hình lặt vặt.
 *
 * ⚠️ `NEXT_PUBLIC_*` bị Next **nướng vào bundle lúc build**, không đọc lúc
 * chạy — đổi biến ở task definition KHÔNG có tác dụng cho code chạy trong
 * trình duyệt. Image Web của production phải build kèm
 * `--build-arg NEXT_PUBLIC_UPLOAD_MODE=s3` (xem `apps/web/Dockerfile`).
 *
 * Mặc định `local` có chủ đích: máy dev và toàn bộ bộ verify đang chạy đường
 * đó, và một mặc định `s3` sẽ làm chúng hỏng im lặng ở máy không có AWS.
 */
const UPLOAD_MODE = process.env.NEXT_PUBLIC_UPLOAD_MODE === 's3' ? 's3' : 'local';

/** Thư mục phân loại object key — khớp `PresignedUrlDto` phía API. */
export type UploadFolder = 'pins' | 'avatars';

/** Suy content type khi `Blob.type` rỗng (một số Blob dựng tay không mang type). */
function contentTypeOf(blob: Blob, filename: string): string {
  const fromBlob = normalizeMime(blob.type);
  if (fromBlob) return fromBlob;
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  const byExt: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    webm: 'video/webm',
    mp4: 'video/mp4',
  };
  return byExt[ext] ?? '';
}

/**
 * Tải một ảnh lên `POST /uploads/local`. Ném `UploadError` với `kind` phân loại.
 * @param accessToken lấy từ `useSession().accessToken` — thiếu ⇒ ném 'unauthorized'.
 */
export async function uploadImage(
  file: File,
  accessToken: string | null | undefined,
): Promise<UploadResult> {
  return uploadBlob(file, file.name || 'upload', accessToken);
}

/**
 * XH-9b — cùng một cửa `POST /uploads/local`, nhưng nhận `Blob` để đường thu
 * nhỏ (`lib/image/resize.ts`) và đường chụp ảnh đăng được kết quả của canvas.
 *
 * `filename` là BẮT BUỘC chứ không tuỳ chọn: multer đọc phần mở rộng của tên
 * file để đặt tên object, và một `Blob` không có tên thì phần mở rộng rỗng.
 * Ba biến thể vì thế phải mang đúng đuôi của `blob.type`.
 */
export async function uploadBlob(
  blob: Blob,
  filename: string,
  accessToken: string | null | undefined,
  folder: UploadFolder = 'pins',
): Promise<UploadResult> {
  if (!accessToken) {
    throw new UploadError('unauthorized', { serverMessage: 'Thiếu accessToken phiên' });
  }

  if (UPLOAD_MODE === 's3') {
    return uploadViaPresigned(blob, filename, accessToken, folder);
  }

  const fd = new FormData();
  fd.append('file', blob, filename); // đúng 1 field 'file' — KHÔNG thêm field khác (fields:0)

  let res: Response;
  try {
    res = await fetch(`${apiOrigin()}/uploads/local`, {
      method: 'POST',
      // KHÔNG set Content-Type — trình duyệt tự gắn multipart boundary.
      headers: { Authorization: `Bearer ${accessToken}` },
      body: fd,
    });
  } catch {
    throw new UploadError('network');
  }

  if (res.ok) {
    let data: { url?: string; key?: string };
    try {
      data = (await res.json()) as { url?: string; key?: string };
    } catch {
      throw new UploadError('unknown', { status: res.status, serverMessage: 'Phản hồi không phải JSON' });
    }
    if (!data.url || !data.key) {
      throw new UploadError('unknown', {
        status: res.status,
        serverMessage: 'Phản hồi upload thiếu url/key',
      });
    }
    return { url: data.url, key: data.key };
  }

  throw mapUploadStatus(res.status, await readServerMessage(res));
}

/**
 * Nhánh production: xin phép API rồi POST THẲNG lên S3, byte ảnh không đi qua
 * API một lần nào.
 *
 * Ba bẫy của Presigned POST, cả ba đều im lặng nếu làm sai:
 *
 *  1. **Field `file` phải là field CUỐI CÙNG.** S3 đọc form theo thứ tự và bỏ
 *     qua mọi field đứng SAU phần nội dung file. Đặt `file` lên trước thì
 *     policy/signature nằm sau nó bị bỏ qua ⇒ 403 "missing fields" mà không
 *     nói field nào.
 *  2. **Không tự set `Content-Type` của request.** Đây là multipart, boundary
 *     do trình duyệt sinh. Field `Content-Type` bên TRONG form (do API trả về
 *     trong `fields`) mới là thứ khớp với điều kiện `['eq','$Content-Type',…]`
 *     — hai thứ tên giống nhau, tầng khác nhau.
 *  3. **S3 trả 204 KHÔNG CÓ BODY khi thành công.** `res.json()` sẽ ném. Điều
 *     kiện đạt là `res.ok`, không phải body.
 *
 * URL trả về lấy từ `publicUrl` của API chứ không ghép ở đây — xem docblock
 * `PresignedUrlResult` phía API để biết vì sao phía client không được tự bịa.
 */
async function uploadViaPresigned(
  blob: Blob,
  filename: string,
  accessToken: string,
  folder: UploadFolder,
): Promise<UploadResult> {
  const contentType = contentTypeOf(blob, filename);
  if (!contentType) {
    throw new UploadError('unsupported-type', { serverMessage: 'Không xác định được kiểu file' });
  }

  // Bước 1 — xin chữ ký.
  let signRes: Response;
  try {
    signRes = await fetch(`${apiOrigin()}/uploads/presigned-url`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ contentType, folder }),
    });
  } catch {
    throw new UploadError('network');
  }

  if (!signRes.ok) {
    throw mapUploadStatus(signRes.status, await readServerMessage(signRes));
  }

  let signed: { url?: string; fields?: Record<string, string>; key?: string; publicUrl?: string | null };
  try {
    signed = await signRes.json();
  } catch {
    throw new UploadError('unknown', {
      status: signRes.status,
      serverMessage: 'Phản hồi presigned không phải JSON',
    });
  }

  if (!signed.url || !signed.fields || !signed.key) {
    throw new UploadError('unknown', {
      status: signRes.status,
      serverMessage: 'Phản hồi presigned thiếu url/fields/key',
    });
  }
  if (!signed.publicUrl) {
    // Cấu hình hạ tầng thiếu đường ĐỌC (không CloudFront, không bucket+region).
    // Dừng TRƯỚC khi upload: đẩy byte lên rồi mới phát hiện không có URL để lưu
    // là để lại rác trong bucket và vẫn hỏng.
    throw new UploadError('unknown', {
      status: signRes.status,
      serverMessage: 'Máy chủ chưa cấu hình đường đọc media (publicUrl rỗng)',
    });
  }

  // Bước 2 — POST thẳng lên S3. Thứ tự field là bắt buộc (bẫy 1).
  const fd = new FormData();
  for (const [k, v] of Object.entries(signed.fields)) fd.append(k, v);
  fd.append('file', blob, filename);

  let putRes: Response;
  try {
    putRes = await fetch(signed.url, { method: 'POST', body: fd });
  } catch {
    // CORS của bucket thiếu origin cũng rơi vào đây — `fetch` ném chứ không trả
    // response. Nếu gặp "network" ở đúng bước này mà mạng vẫn tốt, nghi CORS
    // của bucket trước tiên (`infra/data.tf` → aws_s3_bucket_cors_configuration).
    throw new UploadError('network');
  }

  if (!putRes.ok) {
    // S3 trả lỗi bằng XML, không phải JSON NestJS. `EntityTooLarge` là vi phạm
    // `content-length-range` — ánh xạ về đúng kind mà màn hình đã có chuỗi.
    const body = await readServerMessage(putRes);
    if (putRes.status === 400 && (body ?? '').includes('EntityTooLarge')) {
      throw new UploadError('too-large', { status: 413, serverMessage: body });
    }
    throw new UploadError('unknown', { status: putRes.status, serverMessage: body });
  }

  return { url: signed.publicUrl, key: signed.key };
}

/** Map (status, message) → UploadError. 413 nhận theo status (body có thể rỗng). */
function mapUploadStatus(status: number, serverMessage: string | undefined): UploadError {
  const lower = (serverMessage ?? '').toLowerCase();
  if (status === 413) return new UploadError('too-large', { status, serverMessage });
  if (status === 401) return new UploadError('unauthorized', { status, serverMessage });
  if (status === 400) {
    if (lower.includes('unsupported file type')) {
      return new UploadError('unsupported-type', { status, serverMessage });
    }
    if (lower.includes('file too small')) {
      return new UploadError('too-small', { status, serverMessage });
    }
    if (lower.includes('no file uploaded')) {
      return new UploadError('no-file', { status, serverMessage });
    }
  }
  return new UploadError('unknown', { status, serverMessage });
}

/** Đọc `message` trong body NestJS; trả text thô nếu không phải JSON; undefined nếu rỗng. */
async function readServerMessage(res: Response): Promise<string | undefined> {
  let text: string;
  try {
    text = await res.text();
  } catch {
    return undefined;
  }
  if (!text) return undefined;
  try {
    const body = JSON.parse(text) as { message?: unknown };
    const m = body?.message;
    if (typeof m === 'string') return m;
    if (Array.isArray(m) && m.length > 0 && typeof m[0] === 'string') return m.join('; ');
    return text;
  } catch {
    return text;
  }
}

/**
 * Đo kích thước ảnh THẬT từ File trước khi upload — masonry cần tỉ lệ, và
 * `createPin` bắt buộc `imageWidth`/`imageHeight` (@Min(1)). Ưu tiên
 * `createImageBitmap` (nhanh, không chạm DOM); fallback `<img>` + object URL.
 * Cả hai đường đều dọn tài nguyên (bitmap.close / revokeObjectURL).
 */
export async function measureImage(file: File): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await createImageBitmap(file);
      return { width: bitmap.width, height: bitmap.height };
    } catch {
      // rơi xuống fallback <img>
    } finally {
      bitmap?.close();
    }
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const dims = { width: img.naturalWidth, height: img.naturalHeight };
      URL.revokeObjectURL(url);
      if (dims.width < 1 || dims.height < 1) {
        reject(new UploadError('unknown', { serverMessage: 'Không đọc được kích thước ảnh' }));
      } else {
        resolve(dims);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new UploadError('unknown', { serverMessage: 'Không đọc được kích thước ảnh' }));
    };
    img.src = url;
  });
}
