// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  Search Service                                                           ║
// ║                                                                           ║
// ║  HƯỚNG DẪN CODE LẠI:                                                      ║
// ║  1. searchPins:                                                           ║
// ║     - Full-text search PostgreSQL qua GIN index `Pin_fts_idx`.             ║
// ║     - Dùng $queryRawUnsafe: biểu thức phải TRÙNG KHÍT với biểu thức        ║
// ║       lúc CREATE INDEX (coalesce cả 2 cột, config 'english', partial      ║
// ║       theo "deletedAt" IS NULL) — lệch một chút Postgres rơi sang         ║
// ║       Seq Scan mà không báo gì.                                           ║
// ║     - Filter blocked users (chỉ lấy pin của creator không bị block).      ║
// ║  2. searchUsers:                                                          ║
// ║     - OR [ { username: { contains } }, { name: { contains } } ].          ║
// ║     - Lọc bỏ blockedUsers.                                                ║
// ║  3. searchBoards:                                                         ║
// ║     - OR [ { name: { contains } }, { description: { contains } } ].       ║
// ║     - Filter blocked users.                                               ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildCursorFilter,
  buildCursorOrderBy,
  toPaginatedResult,
  decodeCursor,
  keysetPage,
  CREATED_DESC,
} from '../common/pagination';
// Đợt 3e — thân hàm `getBlockedUserIds` trước đây nằm ngay trong class này
// (`private`, :30-41). Chuyển ra common/blocking để PinsService dùng chung
// CÙNG một định nghĩa "ai bị chặn". Hành vi giữ nguyên từng chữ.
import { getBlockedUserIds } from '../common/blocking';

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * B-3 — chuyển từ Prisma `contains` (ILIKE) sang tsvector full-text search
   * để dùng GIN index `Pin_fts_idx` đã có từ 28/07/2026.
   *
   * ⚠️ BIỂU THỨC PHẢI TRÙNG KHÍT VỚI ĐỊNH NGHĨA INDEX. Postgres chỉ dùng
   * expression index khi biểu thức trong `WHERE` khớp từng chữ với biểu thức
   * lúc `CREATE INDEX`. Bản chép nguyên văn:
   *
   *   CREATE INDEX "Pin_fts_idx" ON "Pin"
   *     USING GIN (to_tsvector('english',
   *                            coalesce("title",'') || ' ' || coalesce("description",'')))
   *     WHERE "deletedAt" IS NULL;
   *
   * ⇒ Câu SELECT phải có đủ 3 thứ: `coalesce(...)` ở CẢ 2 cột · config
   * `'english'` · và `"deletedAt" IS NULL` trong WHERE (index là PARTIAL —
   * thiếu vế này, planner không được phép dùng nó). Thiếu bất kỳ thứ nào ⇒
   * `Seq Scan`, tức là đổi ILIKE lấy một thứ chậm ngang ngửa mà mọi phép
   * kiểm hành vi vẫn xanh. Đây đúng hình dạng "ký hiệu có mặt, cơ chế
   * không có" mà dự án đã dính 5 lần.
   *
   * ⚠️ `NULL || ' ' || 'abc' = NULL` — biểu thức KHÔNG có `coalesce` sẽ
   * "nuốt" mọi pin thiếu 1 trong 2 trường (schema.prisma:209-210 — cả 2
   * đều nullable) mà không ném lỗi nào. `coalesce` giữ chúng lại VÀ giữ
   * trùng khít với index cùng một lúc.
   *
   * Chọn `websearch_to_tsquery` thay vì `to_tsquery` thô: input người dùng
   * có `&`, `!`, `:` không làm nổ 500; đồng thời cho ngay cú pháp mà
   * người dùng đã quen (`"cụm từ"`, `-loại trừ`, `OR`).
   *
   * Xếp hạng (`ts_rank`) CỐ Ý KHÔNG có ở lô này: đổi thứ tự đồng thời với
   * đổi cursor spec là cách chắc chắn nhất để không biết cái nào làm hỏng
   * cái gì. Giữ `ORDER BY "createdAt" DESC, "id" DESC` byte-identical với
   * bản ILIKE cũ.
   *
   * Chép khuôn từ `PinsService.exploreFeed` (pins.service.ts:382-452):
   * cùng bộ `_sqlParams` + `_notInBlocked` + `keysetPage(CREATED_DESC)`.
   * Chép nguyên văn — cân nhắc tách helper ra common/ để lại lô sau, khi
   * verify của lô này đã xanh.
   */
  async searchPins(userId: string | undefined, query: string, limit: number, cursor?: string) {
    const blockedIds = await getBlockedUserIds(this.prisma, userId);
    const take = limit + 1;

    const q = this._sqlParams();
    const where = ['"deletedAt" IS NULL'];

    // Biểu thức FTS PHẢI trùng khít định nghĩa index — xem doc trên hàm.
    where.push(
      `to_tsvector('english', coalesce("title", '') || ' ' || coalesce("description", ''))
             @@ websearch_to_tsquery('english', ${q.bind(query)})`,
    );

    if (cursor) {
      const c = decodeCursor(cursor);
      where.push(
        `("createdAt", "id") < (${q.bind(c.createdAt)}::timestamp, ${q.bind(c.id)}::text)`,
      );
    }

    const notInBlocked = this._notInBlocked(q, blockedIds);
    if (notInBlocked) where.push(notInBlocked);

    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM "Pin"
         WHERE ${where.join('\n           AND ')}
         ORDER BY "createdAt" DESC, "id" DESC
         LIMIT ${q.bind(take)}`,
      ...q.values,
    );

    // Cast qua `any` — cùng lý do với PinsService._buildPaginatedResult
    // (pins.service.ts:678-688): PageInfo.endCursor khai `string | undefined`
    // trong khi keysetPage trả `string | null`; GraphQL serialize cả hai
    // thành `null`, client không phân biệt được.
    return keysetPage(CREATED_DESC as any, rows as any, limit) as any;
  }

  async searchUsers(userId: string | undefined, query: string, limit: number, cursor?: string) {
    const blockedIds = await getBlockedUserIds(this.prisma, userId);

    const users = await this.prisma.user.findMany({
      where: {
        AND: [
          {
            OR: [
              { username: { contains: query, mode: 'insensitive' } },
              { name: { contains: query, mode: 'insensitive' } }
            ]
          },
          { deletedAt: null },
          { id: { notIn: blockedIds } },
          buildCursorFilter(cursor, 'desc'),
        ]
      },
      take: limit + 1,
      orderBy: buildCursorOrderBy('desc'),
    });

    return toPaginatedResult(users, limit);
  }

  async searchBoards(userId: string | undefined, query: string, limit: number, cursor?: string) {
    const blockedIds = await getBlockedUserIds(this.prisma, userId);

    const boards = await this.prisma.board.findMany({
      where: {
        AND: [
          {
            OR: [
              { name: { contains: query, mode: 'insensitive' } },
              { description: { contains: query, mode: 'insensitive' } }
            ]
          },
          { deletedAt: null },
          { userId: { notIn: blockedIds } },
          { isSecret: false }, // Only search public boards
          buildCursorFilter(cursor, 'desc'),
        ]
      },
      take: limit + 1,
      orderBy: buildCursorOrderBy('desc'),
    });

    return toPaginatedResult(boards, limit);
  }

  // ─── Private Helpers (chép nguyên văn từ PinsService — B-3) ─────────────────
  //
  // Chép chứ không tách vào common/ ở lô này. Lý do: brief B-3 §1 dán phạm vi
  // CỨNG là searchPins; chạm pins.service.ts thay 4 vị trí gọi `this._x` sang
  // helper chung là nới phạm vi, và nới thì thêm rủi ro rơi vào tripwire cũ
  // (65-blocking · exploreFeed) đang giữ hợp đồng "block lọc đủ 3 chỗ". Tách
  // helper để lô sau, khi B-3 đã xanh.

  /**
   * Bộ đếm placeholder cho raw SQL — sinh `$1`, `$2`, … THEO THỨ TỰ GỌI.
   * Xem pins.service.ts:626-636 để hiểu tại sao đánh số bằng tay là bẫy.
   */
  private _sqlParams() {
    const values: any[] = [];
    return {
      values,
      bind(v: any): string {
        values.push(v);
        return `$${values.length}`;
      },
    };
  }

  /**
   * Mệnh đề loại bỏ pin của người bị chặn, hoặc `null` khi mảng rỗng.
   * Xem pins.service.ts:657-664: MẢNG RỖNG PHẢI TRẢ null vì `NOT IN ()` là
   * lỗi cú pháp Postgres và đó KHÔNG phải biên hiếm — đó là đường đi của
   * mọi khách vãng lai và mọi người dùng chưa chặn ai.
   */
  private _notInBlocked(
    q: { bind: (v: any) => string },
    blockedIds: string[],
  ): string | null {
    if (blockedIds.length === 0) return null;
    return `"creatorId" NOT IN (${blockedIds.map((id) => q.bind(id)).join(',')})`;
  }
}
