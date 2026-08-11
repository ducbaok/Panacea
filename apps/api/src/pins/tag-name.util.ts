// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  Chuẩn hoá tên tag — điều kiện SỐNG CÒN của tính năng tag                ║
// ║                                                                          ║
// ║  VÌ SAO BẮT BUỘC: `Tag.name` có `@unique`, mà Postgres so sánh chuỗi      ║
// ║  PHÂN BIỆT HOA THƯỜNG. Không chuẩn hoá thì `Design`, `design`, `DESIGN`   ║
// ║  và `design ` là BỐN bản ghi Tag khác nhau — mỗi cái gom một nhóm pin     ║
// ║  rời rạc. Tính năng vẫn "chạy" (không lỗi, không 500, `tsc` xanh) nhưng   ║
// ║  vô dụng ngay tuần đầu, và lúc đó dữ liệu đã bẩn thì không dọn lại được   ║
// ║  mà không mất quan hệ. Đây là loại hỏng phải chặn TRƯỚC khi có dữ liệu    ║
// ║  thật, không phải sửa sau.                                                ║
// ║                                                                          ║
// ║  Chuẩn hoá LÀ MỘT HỢP ĐỒNG API, không phải chi tiết cài đặt: client gửi   ║
// ║  `"  Design  "` và đọc lại được `"design"`. Vì vậy nó nằm ở tầng service  ║
// ║  (luôn chạy) chứ không phải ở class-validator của DTO (chỉ chạy khi       ║
// ║  request đi qua ValidationPipe).                                          ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

import { BadRequestException } from '@nestjs/common';

/** Trần số tag mỗi pin. Đồng bộ với `@ArrayMaxSize` ở 2 DTO. */
export const MAX_TAGS_PER_PIN = 10;

/** Trần số category mỗi pin. Đồng bộ với `@ArrayMaxSize` ở 2 DTO. */
export const MAX_CATEGORIES_PER_PIN = 3;

export const TAG_NAME_MIN_LENGTH = 1;
export const TAG_NAME_MAX_LENGTH = 30;

/**
 * Ký tự cho phép SAU khi chuẩn hoá: chữ (mọi bảng chữ cái, kể cả tiếng Việt có
 * dấu), số, khoảng trắng, gạch dưới, gạch nối.
 *
 * `\p{L}` chứ không phải `[a-z]` là có chủ đích — `\p{L}` khớp cả `à`, `ế`,
 * `日`. Cờ `u` là BẮT BUỘC để `\p{…}` có nghĩa; thiếu nó regex vẫn biên dịch
 * được ở một số engine nhưng đổi nghĩa hoàn toàn.
 *
 * Loại ra: dấu chấm/phẩy, `#`, emoji, ký tự điều khiển — thứ khiến hai tag
 * trông giống hệt nhau trên màn hình mà khác nhau trong DB.
 */
const ALLOWED_TAG_NAME = /^[\p{L}\p{N} _-]+$/u;

/**
 * Chuẩn hoá MỘT tên tag. Không kiểm tra tính hợp lệ — xem `normalizeTagNames`.
 *
 * Thứ tự các bước có ý nghĩa: gộp khoảng trắng TRƯỚC khi trim thì `"  a  b  "`
 * ra `" a b "` rồi mới trim; làm ngược lại cũng ra `"a b"`. Ở đây trim trước
 * cho dễ đọc, kết quả như nhau.
 */
function normalizeOne(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' '); // gộp mọi loại khoảng trắng (tab, xuống dòng) thành 1 dấu cách
}

/**
 * Chuẩn hoá + khử trùng + kiểm tra hợp lệ một mảng tên tag.
 *
 * QUY ƯỚC BA TRẠNG THÁI (giống `updatePin`, xem `pins.service.ts`):
 *   `undefined` ⇒ trả `undefined`  — "không đụng tới tag"
 *   `[]`        ⇒ trả `[]`         — "xoá hết tag"
 *   `[…]`       ⇒ trả danh sách đã chuẩn hoá, KHÔNG TRÙNG, giữ nguyên thứ tự
 *                                    xuất hiện đầu tiên
 *
 * Phân biệt được `undefined` với `[]` là toàn bộ lý do hàm này không nhận
 * `names: string[] = []`. Gán mặc định sẽ biến "không gửi field" thành "gửi
 * mảng rỗng", tức mọi `updatePin` chỉ đổi title sẽ lặng lẽ xoá sạch tag.
 *
 * @throws BadRequestException nếu một tên sau chuẩn hoá vẫn không hợp lệ.
 */
export function normalizeTagNames(names: string[] | undefined | null): string[] | undefined {
  if (names == null) return undefined;

  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of names) {
    const name = normalizeOne(raw);

    // Chuỗi rỗng sau khi trim (client gửi `"   "`) là lỗi của client, không phải
    // thứ để im lặng bỏ qua: bỏ qua thì họ không bao giờ biết tag đã biến mất.
    if (name.length < TAG_NAME_MIN_LENGTH) {
      throw new BadRequestException(`Tag name cannot be empty (received ${JSON.stringify(raw)})`);
    }
    if (name.length > TAG_NAME_MAX_LENGTH) {
      throw new BadRequestException(
        `Tag name too long (max ${TAG_NAME_MAX_LENGTH} chars): ${JSON.stringify(name)}`,
      );
    }
    if (!ALLOWED_TAG_NAME.test(name)) {
      throw new BadRequestException(
        `Tag name contains invalid characters (allowed: letters, digits, space, _ and -): ${JSON.stringify(name)}`,
      );
    }

    // Khử trùng SAU chuẩn hoá — đây là chỗ `["Design", " design ", "DESIGN"]`
    // co lại thành đúng một phần tử `design`. Khử trùng trước chuẩn hoá thì cả
    // ba đều "khác nhau" và ta connect cùng một Tag ba lần (Prisma chịu được,
    // nhưng số tag trả về sẽ khác số client gửi mà không rõ vì sao).
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }

  // Trần được kiểm ở DTO bằng `@ArrayMaxSize` trên MẢNG GỐC (client gửi bao
  // nhiêu thì đếm bấy nhiêu). Kiểm lại ở đây trên mảng ĐÃ khử trùng là belt-
  // and-suspenders cho các call-site không đi qua ValidationPipe (seed, script).
  if (out.length > MAX_TAGS_PER_PIN) {
    throw new BadRequestException(`Too many tags (max ${MAX_TAGS_PER_PIN}, received ${out.length} distinct)`);
  }

  return out;
}

/**
 * Khử trùng danh sách categoryId, giữ nguyên quy ước ba trạng thái ở trên.
 *
 * Không chuẩn hoá gì thêm: `Category.id` là cuid do server sinh, client chỉ
 * việc gửi lại đúng chuỗi đọc được từ query `categories`. Trùng lặp thì khử —
 * `connect` cùng một id hai lần không lỗi nhưng làm số category trả về khác số
 * client gửi.
 */
export function dedupeCategoryIds(ids: string[] | undefined | null): string[] | undefined {
  if (ids == null) return undefined;
  const out = [...new Set(ids.map((id) => id.trim()))];
  if (out.some((id) => id.length === 0)) {
    throw new BadRequestException('categoryIds cannot contain empty values');
  }
  if (out.length > MAX_CATEGORIES_PER_PIN) {
    throw new BadRequestException(
      `Too many categories (max ${MAX_CATEGORIES_PER_PIN}, received ${out.length} distinct)`,
    );
  }
  return out;
}
