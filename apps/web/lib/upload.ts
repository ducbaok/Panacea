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

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

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
): Promise<UploadResult> {
  if (!accessToken) {
    throw new UploadError('unauthorized', { serverMessage: 'Thiếu accessToken phiên' });
  }

  const fd = new FormData();
  fd.append('file', blob, filename); // đúng 1 field 'file' — KHÔNG thêm field khác (fields:0)

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/uploads/local`, {
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
