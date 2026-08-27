// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  media-host.util.ts — MỘT nguồn sự thật cho "media của mình nằm ở đâu"    ║
// ║                                                                           ║
// ║  Hai câu hỏi, cùng một câu trả lời, trước 27/08/2026 sống ở hai nơi và    ║
// ║  KHÔNG khớp nhau:                                                         ║
// ║    1. GHI  — upload xong thì `imageUrl` lưu vào DB là chuỗi nào?          ║
// ║       (`uploads.service.ts` trả `key`, để client tự bịa URL)              ║
// ║    2. ĐỌC  — `createPin` cho phép `imageUrl` trỏ tới host nào?            ║
// ║       (`pins.service.ts` hardcode `IMAGE_URL_WHITELIST`)                  ║
// ║                                                                           ║
// ║  🔴 Vì sao gộp: bản hardcode có `'s3.amazonaws.com'`, nhưng host THẬT của ║
// ║  bucket ở ap-southeast-1 là                                              ║
// ║      antigravity-raw-<acct>.s3.ap-southeast-1.amazonaws.com              ║
// ║  Phép so là `hostname === d || hostname.endsWith('.' + d)` ⇒ chuỗi trên   ║
// ║  kết thúc bằng `.s3.ap-southeast-1.amazonaws.com`, KHÔNG phải             ║
// ║  `.s3.amazonaws.com` ⇒ TRƯỢT. Nghĩa là ảnh do CHÍNH API mình cấp phép     ║
// ║  upload lại bị CHÍNH API mình từ chối lúc createPin — và lỗi chỉ nổ trên  ║
// ║  production, vì ở localhost mọi URL đều là `localhost` nên luôn khớp.     ║
// ║                                                                           ║
// ║  Đây là loại lỗi "xanh ở dev, chết ở prod" mà dự án đã ghi nhiều lần:     ║
// ║  một hằng số viết tay mô tả môi trường, trong khi môi trường nằm ở env.   ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

/**
 * Host luôn được phép, không phụ thuộc môi trường.
 *
 * `localhost` phải ở lại: nhánh `POST /uploads/local` (dev + toàn bộ bộ verify)
 * sinh URL `http://localhost:4000/uploads/…`. Ba host còn lại là di sản của
 * seed và của ảnh dán từ ngoài — gỡ ra là seed vỡ.
 */
export const STATIC_MEDIA_HOSTS = [
  'localhost',
  's3.amazonaws.com',
  'storage.googleapis.com',
  'res.cloudinary.com',
] as const;

/**
 * Giá trị `CLOUDFRONT_DOMAIN` coi như "chưa cấu hình". Joi khai biến này là
 * `required()`, nên không thể bỏ trống — phải có một chuỗi mang nghĩa "chưa có",
 * và Terraform từng đặt đúng chuỗi `not-configured`.
 *
 * ⚠️ CỐ Ý KHÔNG liệt kê `cdn.antigravity.app` (giá trị mẫu trong `.env.example`)
 * vào đây. Cho một domain THẬT vào danh sách "coi như chưa cấu hình" là đặt sẵn
 * một cái bẫy: ngày dự án mua được domain đó và trỏ CDN vào, mọi thứ sẽ im lặng
 * quay về dùng URL S3 trực tiếp — mà bucket thì block-public-access, nên kết quả
 * là ảnh trắng toàn sản phẩm với nguyên nhân nằm trong một `Set` ở đây.
 */
const UNSET_CLOUDFRONT = new Set(['', 'not-configured']);

export interface MediaHostConfig {
  cloudfrontDomain?: string | null;
  s3BucketName?: string | null;
  region?: string | null;
}

/**
 * Bỏ scheme và dấu `/` thừa: chấp nhận cả `https://d123.cloudfront.net/` lẫn
 * `d123.cloudfront.net`. Terraform đưa vào dạng thứ hai, nhưng người điền tay
 * gần như chắc chắn sẽ dán dạng thứ nhất, và sai lệch đó tạo ra hostname
 * `https` — một chuỗi không bao giờ khớp gì, im lặng.
 */
function bareHost(raw: string): string {
  return raw
    .trim()
    .replace(/^[a-z]+:\/\//i, '')
    .replace(/\/.*$/, '')
    .toLowerCase();
}

/** Domain CDN nếu đã cấu hình thật, ngược lại `null`. */
export function cloudfrontHost(cfg: MediaHostConfig): string | null {
  const raw = cfg.cloudfrontDomain ?? '';
  const host = bareHost(raw);
  return UNSET_CLOUDFRONT.has(host) ? null : host || null;
}

/**
 * Host virtual-hosted của bucket, ví dụ
 * `antigravity-raw-123.s3.ap-southeast-1.amazonaws.com`.
 *
 * ⚠️ PHẢI kèm region. Dạng không region (`<bucket>.s3.amazonaws.com`) chỉ còn
 * đúng với us-east-1; ở region khác nó trả 301 kèm body XML, và `fetch` phía
 * trình duyệt biểu hiện thành lỗi CORS chứ không phải lỗi redirect — triệu
 * chứng trỏ sai hoàn toàn vào nguyên nhân.
 */
export function s3PublicHost(cfg: MediaHostConfig): string | null {
  const bucket = (cfg.s3BucketName ?? '').trim();
  const region = (cfg.region ?? '').trim();
  if (!bucket || !region) return null;
  return `${bucket}.s3.${region}.amazonaws.com`;
}

/**
 * Gốc URL công khai để ghép với object key. `null` ⇒ chưa có đường đọc nào cấu
 * hình được, bên gọi phải tự quyết (nhánh local dev).
 *
 * Ưu tiên CDN trước bucket: khi CloudFront đã dựng thì bucket ở chế độ
 * block-public-access, URL S3 trực tiếp trả 403 — chọn nhầm thứ tự là ảnh
 * trắng toàn sản phẩm mà không log nào ở phía API kêu lên.
 */
export function mediaPublicBase(cfg: MediaHostConfig): string | null {
  const cdn = cloudfrontHost(cfg);
  if (cdn) return `https://${cdn}`;
  const s3 = s3PublicHost(cfg);
  return s3 ? `https://${s3}` : null;
}

/**
 * Ghép base + key thành URL tuyệt đối. Key của presigned POST không có `/` đầu.
 */
export function mediaPublicUrl(cfg: MediaHostConfig, key: string): string | null {
  const base = mediaPublicBase(cfg);
  return base ? `${base}/${key.replace(/^\/+/, '')}` : null;
}

/**
 * Whitelist host cho `createPin` — tĩnh + đúng những host mà chính API này cấp
 * phép ghi lên. Trả mảng mới mỗi lần gọi để không ai lỡ tay `push` vào hằng.
 */
export function mediaHostWhitelist(cfg: MediaHostConfig): string[] {
  const hosts: string[] = [...STATIC_MEDIA_HOSTS];
  const cdn = cloudfrontHost(cfg);
  if (cdn) hosts.push(cdn);
  const s3 = s3PublicHost(cfg);
  if (s3) hosts.push(s3);
  return hosts;
}
