// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  Cursor Pagination — GraphQL Types & Utility                             ║
// ║  Composite cursor: (createdAt DESC, id DESC) → Base64 encode/decode.    ║
// ║                                                                          ║
// ║  HƯỚNG DẪN CODE LẠI:                                                     ║
// ║  1. Tạo CursorPaginationArgs (Input): first (default 20), after (opt). ║
// ║  2. Tạo PageInfo (ObjectType): hasNextPage, endCursor.                  ║
// ║  3. Tạo hàm generic createPaginatedType(ItemType) trả về               ║
// ║     PaginatedResult { items, pageInfo }.                                 ║
// ║  4. Utility: encodeCursor(createdAt, id), decodeCursor(cursor).         ║
// ║  5. Giải thuật: query LIMIT = first + 1. Nếu trả về > first items      ║
// ║     → hasNextPage = true, cắt bỏ item cuối.                             ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

import { ArgsType, Field, Int, ObjectType } from '@nestjs/graphql';
import { BadRequestException, Type } from '@nestjs/common';
import { IsOptional, IsString, Max, Min } from 'class-validator';

// ─── Cursor encode/decode ────────────────────────────────────────────────────

export interface DecodedCursor {
  createdAt: Date;
  id: string;
}

/**
 * Encode composite cursor thành Base64 string.
 * Format nội bộ: `{createdAt_ISO}|{id}`
 */
export function encodeCursor(createdAt: Date, id: string): string {
  const raw = `${createdAt.toISOString()}|${id}`;
  return Buffer.from(raw, 'utf-8').toString('base64');
}

/**
 * Decode Base64 cursor thành { createdAt, id }.
 * Ném Error nếu format không hợp lệ.
 *
 * HƯỚNG DẪN CODE LẠI:
 * 1. Decode Base64 → UTF-8 string.
 * 2. Split bởi '|' → [isoDate, id].
 * 3. Validate: cả 2 phải có giá trị.
 * 4. **Timezone safety**: Đảm bảo isoDate có suffix 'Z' (UTC).
 *    Lý do: new Date('2026-05-19T10:00:00.000') (thiếu Z) được JS engine
 *    parse theo LOCAL timezone → sai kết quả trên server khác timezone.
 *    Trong khi new Date('2026-05-19T10:00:00.000Z') luôn là UTC.
 * 5. Parse Date và validate bằng isNaN.
 * 6. Return { createdAt, id }.
 */
export function decodeCursor(cursor: string): DecodedCursor {
  const raw = Buffer.from(cursor, 'base64').toString('utf-8');
  const [isoDate, id] = raw.split('|');
  if (!isoDate || !id) {
    throw new Error('Invalid cursor format');
  }

  // Đảm bảo ISO string luôn có suffix Z (UTC) để tránh timezone offset
  const safeDateStr = isoDate.endsWith('Z') ? isoDate : isoDate + 'Z';
  const createdAt = new Date(safeDateStr);

  if (isNaN(createdAt.getTime())) {
    throw new Error('Invalid date in cursor');
  }

  return { createdAt, id };
}

// ─── GraphQL Args ────────────────────────────────────────────────────────────

// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  ⚠️ KHÔNG trộn `@Args()` (không tên) với `@Args('x')` trong CÙNG resolver ║
// ║                                                                          ║
// ║  Viết thế này thì query KHÔNG BAO GIỜ gọi được — luôn trả 400:            ║
// ║      async userPins(                                                     ║
// ║        @Args('userId') userId: string,        ← args riêng lẻ            ║
// ║        @Args() pagination: CursorPaginationArgs,  ← args gộp             ║
// ║      )                                                                   ║
// ║                                                                          ║
// ║  Lý do: `@Args()` không tên nhận TOÀN BỘ object args của field, tức là    ║
// ║  `{ userId, first, after }` chứ không chỉ `{ first, after }`. Nó được     ║
// ║  đưa qua global ValidationPipe (`app.module.ts`) đang bật                 ║
// ║  `forbidNonWhitelisted: true`. `CursorPaginationArgs` không khai `userId` ║
// ║  ⇒ pipe coi đó là field lạ ⇒ ném BadRequestException                      ║
// ║  "property userId should not exist".                                     ║
// ║                                                                          ║
// ║  Bug này build sạch 100% (tsc + nest build đều exit 0) vì nó thuần tuý là ║
// ║  hành vi lúc chạy — hoàn toàn không có gì sai về kiểu. Nó đã làm 6 query  ║
// ║  chết hẳn mà không ai biết: userPins, userBoards, boardPins, followers,   ║
// ║  following, messages.                                                    ║
// ║                                                                          ║
// ║  CÁCH ĐÚNG: cho tất cả args vào MỘT @ArgsType() kế thừa class này:        ║
// ║      @ArgsType()                                                         ║
// ║      export class UserPinsArgs extends CursorPaginationArgs {            ║
// ║        @Field(() => ID) @IsString() @IsNotEmpty() userId: string;        ║
// ║      }                                                                   ║
// ║      async userPins(@Args() args: UserPinsArgs) { ... }                  ║
// ║                                                                          ║
// ║  Schema GraphQL sinh ra y hệt (userId, first, after) nên client không     ║
// ║  phải đổi gì. Chỉ có `first`/`after` một mình thì `@Args()` vẫn an toàn   ║
// ║  (exploreFeed, notifications, conversations — cả 3 đều chạy tốt).         ║
// ╚═══════════════════════════════════════════════════════════════════════════╝
@ArgsType()
export class CursorPaginationArgs {
  /** Số items mỗi trang (tối đa 50, mặc định 20). */
  @Field(() => Int, { defaultValue: 20 })
  @Min(1)
  @Max(50)
  first: number = 20;

  /** Cursor của item cuối cùng ở trang trước. Bỏ trống = trang đầu. */
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  after?: string;
}

// ─── PageInfo ────────────────────────────────────────────────────────────────

@ObjectType()
export class PageInfo {
  @Field()
  hasNextPage: boolean;

  @Field({ nullable: true })
  endCursor?: string;
}

// ─── Generic Paginated Result ────────────────────────────────────────────────

/**
 * Factory tạo PaginatedResult type cho bất kỳ GraphQL ObjectType nào.
 *
 * Cách dùng:
 * ```ts
 * @ObjectType()
 * export class PaginatedPins extends createPaginatedType(Pin) {}
 * ```
 */
export function createPaginatedType<T>(classRef: Type<T>) {
  @ObjectType({ isAbstract: true })
  abstract class PaginatedType {
    @Field(() => [classRef])
    items: T[];

    @Field(() => PageInfo)
    pageInfo: PageInfo;
  }
  return PaginatedType as new () => { items: T[]; pageInfo: PageInfo };
}

// ─── Keyset pagination helpers (Prisma) ──────────────────────────────────────
//
// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  TẠI SAO KHÔNG DÙNG `cursor` + `skip: 1` CỦA PRISMA (P0 #6)              ║
// ║                                                                          ║
// ║  Trước đây Comments/Search làm:                                          ║
// ║      { cursor: { id: rawId }, orderBy: { createdAt: 'desc' } }           ║
// ║  Hai lỗi nằm chồng lên nhau:                                             ║
// ║                                                                          ║
// ║  1. THIẾU `skip: 1`. Prisma `cursor` là INCLUSIVE — nó bắt đầu TỪ chính  ║
// ║     item đó. Không skip ⇒ item cuối trang N lặp lại ở đầu trang N+1.     ║
// ║                                                                          ║
// ║  2. `cursor` trỏ theo `id` nhưng `orderBy` lại theo `createdAt`. Prisma  ║
// ║     dịch cái này thành OFFSET tính từ vị trí của row đó trong thứ tự     ║
// ║     đã sort — nếu 2 bản ghi trùng `createdAt` (rất dễ xảy ra: seed hàng  ║
// ║     loạt, import, hoặc chỉ đơn giản là 2 comment trong cùng mili-giây)   ║
// ║     thì thứ tự KHÔNG xác định ⇒ trang sau có thể nhảy cóc hoặc lặp.      ║
// ║                                                                          ║
// ║  Cách đúng — keyset (seek) pagination trên TUPLE (createdAt, id):        ║
// ║      WHERE createdAt < $1 OR (createdAt = $1 AND id < $2)                ║
// ║      ORDER BY createdAt DESC, id DESC                                    ║
// ║  `id` là tie-breaker duy nhất nên thứ tự luôn xác định, và điều kiện đã  ║
// ║  loại chính item cursor rồi nên KHÔNG cần `skip`.                        ║
// ║                                                                          ║
// ║  Đây đúng là thứ Pins đang làm bằng raw SQL và Social làm bằng Prisma    ║
// ║  where — 3 helper dưới đây gom lại để phần còn lại của app dùng chung.   ║
// ║                                                                          ║
// ║  P1 Đợt 1a: 3 helper CŨ này giờ là wrapper mỏng quanh `CREATED_DESC`/    ║
// ║  `CREATED_ASC` ở `./keysets.ts`. Chữ ký giữ nguyên VÀ HÌNH DẠNG TRẢ VỀ    ║
// ║  cũng giữ nguyên (`{ OR: [...] }` TRẦN, không `{ AND: [...] }`), vì:     ║
// ║    • Comments/Notifications spread thẳng vào `where` → cần `{}` hoặc     ║
// ║      `{OR:[…]}`;                                                          ║
// ║    • Search (search.service.ts:51,75,100) đưa vào MỘT PHẦN TỬ của mảng   ║
// ║      `AND` sẵn có — chính là cách né bẫy "đụng độ `OR` top-level".        ║
// ║      Đổi shape ở đây = đổi ngữ nghĩa của 3 hàm search mà tsc không thấy. ║
// ║  Nếu bạn cần bọc `AND` tự động, dùng `keysetWhere` ở `./keysets.ts`.     ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

import { CREATED_ASC, CREATED_DESC, keysetOrderBy, keysetPage } from './keysets';

export type CursorDirection = 'asc' | 'desc';

/** Row tối thiểu để phân trang được: phải có cặp (createdAt, id). */
export interface CursorRow {
  id: string;
  createdAt: Date;
}

/**
 * Dựng mệnh đề `where` keyset từ cursor Base64.
 * Trả `{}` khi không có cursor (trang đầu) để spread thẳng vào `where`.
 *
 * @param direction phải KHỚP với `orderBy`: 'desc' → so sánh `lt`, 'asc' → `gt`.
 */
export function buildCursorFilter(after: string | undefined, direction: CursorDirection = 'desc') {
  if (!after) return {};

  let decoded: DecodedCursor;
  try {
    decoded = decodeCursor(after);
  } catch {
    // decodeCursor ném Error trần → GraphQL trả 500. Cursor hỏng là lỗi của
    // client, không phải của server, nên dịch sang 400.
    throw new BadRequestException('Invalid pagination cursor');
  }

  const op = direction === 'desc' ? 'lt' : 'gt';
  return {
    OR: [
      { createdAt: { [op]: decoded.createdAt } },
      { createdAt: decoded.createdAt, id: { [op]: decoded.id } },
    ],
  };
}

/**
 * `orderBy` đi kèm bắt buộc — luôn có `id` làm tie-breaker.
 * Wrapper mỏng quanh `keysetOrderBy(CREATED_DESC|CREATED_ASC)`.
 */
export function buildCursorOrderBy(direction: CursorDirection = 'desc') {
  return keysetOrderBy(direction === 'desc' ? CREATED_DESC : CREATED_ASC);
}

/**
 * Cắt kết quả `take = first + 1` thành `{ items, pageInfo }` chuẩn.
 * Wrapper mỏng quanh `keysetPage(CREATED_DESC, …)` — wire format của
 * `encodeCursor(createdAt, id)` và của spec CREATED_DESC là identical
 * (base64(`ISO|id`)) nên các cursor cũ vẫn giải mã đúng qua cả 2 đường.
 */
export function toPaginatedResult<T extends CursorRow>(rows: T[], first: number) {
  return keysetPage(CREATED_DESC as any, rows as any, first) as {
    items: T[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}
