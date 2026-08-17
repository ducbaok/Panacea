// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  KeysetSpec — cursor pagination n-thành-phần khai báo một lần               ║
// ║                                                                            ║
// ║  Vì sao tồn tại (P1 Đợt 1a):                                              ║
// ║  `buildCursorFilter`/`buildCursorOrderBy` cũ chỉ diễn đạt được keyset      ║
// ║  2-thành-phần `(createdAt, id)` với hướng duy nhất. `getBoardPins` sort    ║
// ║  `(sortOrder asc, createdAt desc, id desc)` — HƯỚNG TRỘN, row-value        ║
// ║  `(a,b,c) < (x,y,z)` không diễn đạt được ⇒ phải khai triển từ điển:        ║
// ║      (f1 OP1 v1) OR (f1=v1 AND f2 OP2 v2) OR (f1=v1 AND f2=v2 AND f3 OP3 v3)
// ║      OPi = gt nếu asc, lt nếu desc                                         ║
// ║                                                                            ║
// ║  Gói thành MỘT `KeysetSpec` khai báo một lần, dùng chung cho các consumer  ║
// ║  — bug cũ của `getConversations` (orderBy `updatedAt` nhưng encode         ║
// ║  `createdAt`) chính là drift giữa 3 chỗ; spec dùng chung làm nó bất khả    ║
// ║  thi.                                                                      ║
// ║                                                                            ║
// ║  BẤT BIẾN (viết thành assert trong `defineKeyset`):                        ║
// ║  • Field cuối PHẢI duy nhất trong tập đã lọc (id hoặc phần còn lại của     ║
// ║    PK) — không thì lặp/nhảy vô hạn.                                        ║
// ║  • KHÔNG được có field NULLable — `lt`/`gt` không khớp NULL, Postgres      ║
// ║    xếp NULL LAST khi ASC ⇒ hàng NULL biến mất hoặc lặp mãi. Cám dỗ kế      ║
// ║    tiếp là keyset theo `SavedPin.sectionId` (nullable) — ĐỪNG.             ║
// ║                                                                            ║
// ║  WIRE FORMAT — giữ byte-identical với `encodeCursor` 2-phần cũ:            ║
// ║    base64(part1|part2|…), date → `toISOString()`, join `|`                 ║
// ║  Nhờ đó CREATED_DESC sinh ra ĐÚNG chuỗi cũ ⇒ Comments/Search/              ║
// ║  Notifications/Pins không đổi một chữ. Đó chính là điều kiện để            ║
// ║  Đợt 2 gọi là "không breaking" cho các module ngoài phạm vi.               ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

import { BadRequestException } from '@nestjs/common';

export type KeysetDirection = 'asc' | 'desc';
export type KeysetFieldType = 'date' | 'string' | 'number';

export interface KeysetField<T> {
  /** Tên field trên row (và trong Prisma where/orderBy). */
  name: keyof T & string;
  type: KeysetFieldType;
  direction: KeysetDirection;
}

export interface KeysetSpec<T> {
  readonly fields: ReadonlyArray<KeysetField<T>>;
}

/**
 * Khai báo một spec. Chạy 2 phép kiểm cấu trúc lúc khởi tạo — cả hai đều là
 * BẤT BIẾN chứ không phải khuyến nghị, và sai chúng thì bug sẽ im lặng nên
 * đắt hơn nhiều so với ngoại lệ ném ngay lúc app khởi động.
 */
export function defineKeyset<T>(fields: ReadonlyArray<KeysetField<T>>): KeysetSpec<T> {
  if (!fields.length) {
    throw new Error('KeysetSpec must have at least one field');
  }
  // Lỗ hổng #1: nếu field cuối trùng giá trị giữa 2 row, thứ tự không xác định
  // ⇒ trang sau có thể lặp/nhảy. Cách chống DUY NHẤT là để field cuối là
  // KHÔNG THỂ TRÙNG trong tập đã lọc — thực tế là PK `id`. Assert cứng ở đây
  // để không ai vô ý spec kết thúc bằng `createdAt` hay `sortOrder`.
  const last = fields[fields.length - 1];
  if (last.name !== 'id') {
    throw new Error(
      `KeysetSpec last field must be 'id' (tie-breaker duy nhất). Got '${last.name}'.`,
    );
  }
  // Lỗ hổng #7 (từng gặp khi ai đó thêm `select` hẹp): cùng field lặp lại
  // trong spec chắc chắn là lỗi khai báo.
  const seen = new Set<string>();
  for (const f of fields) {
    if (seen.has(f.name)) {
      throw new Error(`KeysetSpec field '${f.name}' declared twice`);
    }
    seen.add(f.name);
  }
  return { fields };
}

// ─── Encode / decode ────────────────────────────────────────────────────────

function encodePart(value: unknown, type: KeysetFieldType, name: string): string {
  if (value === undefined || value === null) {
    // Bất biến "field không NULLable" đã ghi ở header; nhưng runtime vẫn có
    // thể lệch nếu ai đó `select` hẹp bỏ mất field. Ném ngay hơn là để cursor
    // chứa chuỗi "undefined" đi xuyên hệ thống.
    throw new Error(`Cannot encode cursor: field '${name}' is null/undefined`);
  }
  let str: string;
  if (type === 'date') {
    if (!(value instanceof Date)) {
      // `keysetPage` ở dưới đã cho phép cả Date lẫn ISO string vào; vì raw SQL
      // trả string. Bọc thành Date rồi mới toISOString để một chỗ định dạng.
      const d = new Date(value as any);
      if (isNaN(d.getTime())) {
        throw new Error(`Cannot encode cursor: field '${name}' invalid date`);
      }
      str = d.toISOString();
    } else {
      str = value.toISOString();
    }
  } else if (type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`Cannot encode cursor: field '${name}' not finite number`);
    }
    str = String(value);
  } else {
    str = String(value);
  }
  // Lỗ hổng #5: separator `|` không escape — an toàn với cuid/ISO/int, VỠ ngay
  // khi keyset theo `name`. Ném lúc GHI để bug lộ ở lần đầu ai đó thử.
  if (str.includes('|')) {
    throw new Error(`Cannot encode cursor: field '${name}' contains '|' separator`);
  }
  return str;
}

function decodePart(raw: string, type: KeysetFieldType, name: string): Date | string | number {
  if (type === 'date') {
    // Timezone safety: chuỗi ISO thiếu 'Z' bị JS parse theo LOCAL timezone.
    // Đây là cùng bảo vệ đã có trong decoder cũ (cursor-pagination.ts:58).
    const safe = raw.endsWith('Z') ? raw : raw + 'Z';
    const d = new Date(safe);
    if (isNaN(d.getTime())) {
      throw new BadRequestException(`Invalid pagination cursor (field '${name}')`);
    }
    return d;
  }
  if (type === 'number') {
    // Lỗ hổng #6: `parseInt('12abc') === 12` (im lặng sai). Regex trước.
    if (!/^-?\d+(\.\d+)?$/.test(raw)) {
      throw new BadRequestException(`Invalid pagination cursor (field '${name}')`);
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      throw new BadRequestException(`Invalid pagination cursor (field '${name}')`);
    }
    return n;
  }
  return raw;
}

/** Encode cursor từ row cuối trang. Wire format: `base64(part1|part2|…)`. */
export function encodeCursorFrom<T>(spec: KeysetSpec<T>, row: T): string {
  const parts = spec.fields.map((f) => encodePart((row as any)[f.name], f.type, f.name));
  return Buffer.from(parts.join('|'), 'utf-8').toString('base64');
}

interface DecodedKeyset {
  values: Array<Date | string | number>;
}

/**
 * Decode cursor. Ném `BadRequestException` khi format sai — vì cursor hỏng là
 * lỗi của client, không phải của server (bằng nếu để ném `Error` trần thì
 * GraphQL trả 500).
 *
 * Lỗ hổng #4: cursor số phần lệch với spec ⇒ nếu không assert số phần, spec
 * 3-phần được đưa cursor 2-phần sẽ cho `sortOrder: NaN` ⇒ 500.
 */
/**
 * Giải cursor ra **mảng giá trị theo đúng thứ tự spec** — cho consumer viết
 * raw SQL, nơi `keysetWhere` (vốn sinh object `where` của Prisma) không dùng
 * được. Dùng bởi `PinsService.relatedPins` (B-11).
 *
 * ⚠️ Đây KHÔNG phải cửa sau để tự dựng mệnh đề keyset theo ý mình. Consumer
 * raw SQL vẫn phải giữ đúng hai bất biến của keyset: so sánh theo **hàng**
 * `(f1, f2, …) < ($1, $2, …)` (Postgres so sánh từ điển đúng ngữ nghĩa keyset,
 * và chỉ hợp lệ khi **mọi** field cùng hướng) và `ORDER BY` **khớp từng field
 * từng hướng** với spec. Lệch một trong hai thì phân trang lặp/thiếu item mà
 * không có exception nào — đúng hình dạng P0 #6.
 */
export function decodeKeysetValues<T>(
  spec: KeysetSpec<T>,
  cursor: string,
): Array<Date | string | number> {
  return decodeKeysetCursor(spec, cursor).values;
}

function decodeKeysetCursor<T>(spec: KeysetSpec<T>, cursor: string): DecodedKeyset {
  let raw: string;
  try {
    raw = Buffer.from(cursor, 'base64').toString('utf-8');
  } catch {
    throw new BadRequestException('Invalid pagination cursor');
  }
  const parts = raw.split('|');
  if (parts.length !== spec.fields.length) {
    throw new BadRequestException('Invalid pagination cursor');
  }
  const values = parts.map((p, i) => {
    const f = spec.fields[i];
    if (!p) throw new BadRequestException('Invalid pagination cursor');
    return decodePart(p, f.type, f.name);
  });
  return { values };
}

// ─── Where builder ──────────────────────────────────────────────────────────

/**
 * Dựng mệnh đề `where` keyset và BỌC với `baseWhere` bằng `AND`.
 *
 * Lỗ hổng #3: bọc `AND` là AN TOÀN THEO CẤU TRÚC — nếu spread trực tiếp thì
 * `OR` của keyset sẽ đụng với `OR` sẵn có của bên gọi (đúng bẫy đã ghi ở
 * search.service.ts:48-50).
 *
 * ⚠️ CHỈ dùng cho consumer MỚI. `buildCursorFilter` cũ giữ nguyên hình dạng
 * `{ OR: [...] }` TRẦN vì search.service dùng nó làm 1 phần tử của mảng
 * `AND` sẵn có (`{AND:[…, {OR}]}`) — đổi shape ở đó = đổi ngữ nghĩa mà tsc
 * không thấy gì.
 */
export function keysetWhere<W extends object, T>(
  spec: KeysetSpec<T>,
  after: string | undefined,
  base: W,
): W | { AND: [W, { OR: any[] }] } {
  if (!after) return base;
  const { values } = decodeKeysetCursor(spec, after);
  return {
    AND: [base, { OR: buildOrClauses(spec, values) }],
  };
}

/**
 * Xây `OR` array của keyset (khai triển từ điển).
 *   f1 OP1 v1
 *   OR (f1=v1 AND f2 OP2 v2)
 *   OR (f1=v1 AND f2=v2 AND f3 OP3 v3)
 * OP = gt nếu asc, lt nếu desc.
 */
function buildOrClauses<T>(spec: KeysetSpec<T>, values: Array<any>): any[] {
  const or: any[] = [];
  for (let i = 0; i < spec.fields.length; i++) {
    const clause: Record<string, any> = {};
    // Tiền tố bằng: v_1..v_{i-1}
    for (let j = 0; j < i; j++) {
      clause[spec.fields[j].name] = values[j];
    }
    // Hạng cuối: bất phương thức
    const f = spec.fields[i];
    const op = f.direction === 'desc' ? 'lt' : 'gt';
    clause[f.name] = { [op]: values[i] };
    or.push(clause);
  }
  return or;
}

// ─── OrderBy builder ────────────────────────────────────────────────────────

/**
 * Prisma orderBy tương ứng — mảng để giữ thứ tự (đối tượng `{a:'asc',b:'desc'}`
 * không đảm bảo thứ tự trong Prisma). Consumer spread như:
 *   `orderBy: keysetOrderBy(spec)`
 */
export function keysetOrderBy<T>(
  spec: KeysetSpec<T>,
): Array<Record<string, KeysetDirection>> {
  return spec.fields.map((f) => ({ [f.name]: f.direction }));
}

// ─── Cắt trang ──────────────────────────────────────────────────────────────

/**
 * Cắt kết quả `take = first + 1` thành `{ items, pageInfo }` chuẩn.
 * `endCursor` = null khi trang rỗng (đồng bộ với `toPaginatedResult` cũ —
 * cũ trả `null`; hai bản sao khác của cùng logic ở boards.service.ts và
 * pins.service.ts vốn trả `undefined` — GraphQL serialize cả hai thành `null`,
 * client không phân biệt được).
 */
export function keysetPage<T>(
  spec: KeysetSpec<T>,
  rows: T[],
  first: number,
): { items: T[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } {
  const hasNextPage = rows.length > first;
  const items = hasNextPage ? rows.slice(0, first) : rows;
  const last = items[items.length - 1];
  return {
    items,
    pageInfo: {
      hasNextPage,
      endCursor: last ? encodeCursorFrom(spec, last) : null,
    },
  };
}

// ─── 4 SPEC — CHỈ những spec có consumer thật ──────────────────────────────
//
// ⚠️ ĐỪNG định nghĩa `FOLLOWERS_KEYSET`. `social.service.ts.getFollowers`
// nằm ngoài phạm vi Đợt 2 nên spec đó KHÔNG có consumer — đúng hình dạng
// "ký hiệu có mặt, cơ chế không có" mà cả kế hoạch này đang chống, và không
// phép kiểm nào bắt được nếu nó sai. `getFollowers` (social.service.ts:222)
// đã viết tay đúng hình dạng `(createdAt desc, followerId desc)` và sẽ chuyển
// sang spec khi có đợt chạm vào Social.

/**
 * `(createdAt desc, id desc)` — dùng bởi:
 *   • getUserBoards (byte-identical, cursor cũ vẫn giải mã đúng)
 *   • getMessages   (byte-identical)
 *   • pins.service _buildPaginatedResult (bản sao thứ 3 của logic phân trang)
 *   • wrapper của `buildCursorFilter`/`buildCursorOrderBy`/`toPaginatedResult`
 */
export const CREATED_DESC = defineKeyset<{ createdAt: Date | string; id: string }>([
  { name: 'createdAt', type: 'date', direction: 'desc' },
  { name: 'id', type: 'string', direction: 'desc' },
]);

/**
 * `(createdAt asc, id asc)` — dùng bởi wrapper cho `getCommentReplies`
 * (đọc thread theo thứ tự thời gian).
 */
export const CREATED_ASC = defineKeyset<{ createdAt: Date | string; id: string }>([
  { name: 'createdAt', type: 'date', direction: 'asc' },
  { name: 'id', type: 'string', direction: 'asc' },
]);

/**
 * `(sortOrder asc, createdAt desc, id desc)` — dùng bởi `getBoardPins`.
 *
 * Ca DUY NHẤT mà helper 2-thành-phần không diễn đạt được. `sortOrder` là khoá
 * MUTABLE (`reorderPins` ghi đè) — ai đang phân trang mà người khác reorder
 * sẽ thấy lặp/thiếu. Cố hữu của keyset trên khoá mutable, không sửa được —
 * ghi vào tài liệu chứ đừng cố workaround.
 */
export const BOARD_PINS_KEYSET = defineKeyset<{
  sortOrder: number;
  createdAt: Date | string;
  id: string;
}>([
  { name: 'sortOrder', type: 'number', direction: 'asc' },
  { name: 'createdAt', type: 'date', direction: 'desc' },
  { name: 'id', type: 'string', direction: 'desc' },
]);

/**
 * `(sharedTagCount desc, createdAt desc, id desc)` — dùng bởi
 * `PinsService.relatedPins` (B-11, 17/08/2026).
 *
 * ⚠️ `sharedTagCount` là **giá trị TÍNH ĐƯỢC** (`COUNT(*)` trên `_PinToTag`),
 * không phải cột của `Pin`. Nó hợp lệ làm khoá keyset vì trong **cùng một tập
 * kết quả** (cùng pin gốc) nó tất định; nhưng vì thế cursor của
 * `relatedPins(pinId: X)` **không** dùng lại được cho `pinId: Y` — nó sẽ giải
 * mã trót lọt rồi lọc theo một con số vô nghĩa. Đó là lý do cursor của mọi
 * query trong dự án là **chuỗi mờ**: client không được phép hiểu, ghép, hay
 * mang cursor từ query này sang query khác.
 *
 * ⚠️ Ba field CÙNG hướng `desc` — điều kiện bắt buộc để consumer raw SQL viết
 * được thành so sánh theo hàng `(a,b,c) < ($1,$2,$3)`. Đổi hướng một field mà
 * quên đổi câu SQL sẽ lặp/thiếu item mà không ném lỗi.
 */
export const RELATED_PINS_KEYSET = defineKeyset<{
  sharedTagCount: number;
  createdAt: Date | string;
  id: string;
}>([
  { name: 'sharedTagCount', type: 'number', direction: 'desc' },
  { name: 'createdAt', type: 'date', direction: 'desc' },
  { name: 'id', type: 'string', direction: 'desc' },
]);

/**
 * `(updatedAt desc, id desc)` — dùng bởi `getConversations`.
 *
 * `updatedAt` cũng là khoá mutable (tin nhắn mới đẩy hội thoại lên đầu inbox)
 * ⇒ có thể thấy trùng khi cuộn — đó là ĐÚNG UX inbox, không phải bug.
 */
export const CONVERSATION_KEYSET = defineKeyset<{
  updatedAt: Date | string;
  id: string;
}>([
  { name: 'updatedAt', type: 'date', direction: 'desc' },
  { name: 'id', type: 'string', direction: 'desc' },
]);
