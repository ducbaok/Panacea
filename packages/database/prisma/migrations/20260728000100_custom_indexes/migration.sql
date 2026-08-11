-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  Index viết tay — những thứ Prisma schema KHÔNG diễn đạt được             ║
-- ║                                                                           ║
-- ║  Prisma `@@index` / `@@unique` chỉ sinh được B-tree đầy đủ, không có:     ║
-- ║    • partial index  (mệnh đề WHERE)                                       ║
-- ║    • expression index / index trên kiểu GIN                               ║
-- ║  Hai thứ dưới đây bắt buộc phải viết SQL tay. Nguồn: PLAN.md §Fixes.      ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. SavedPin — bịt lỗ "lưu trùng pin vào No Board"
-- ─────────────────────────────────────────────────────────────────────────────
-- `@@unique([userId, pinId, boardId])` ở schema.prisma KHÔNG chặn được trùng
-- khi `boardId IS NULL`, vì trong SQL `NULL <> NULL` — hai dòng cùng
-- (user, pin, NULL) được Postgres coi là KHÁC nhau, unique constraint không nổ.
-- Hệ quả: user bấm "Save" 5 lần vào mục không-chọn-board thì có 5 bản ghi.
--
-- Partial unique index dưới đây phủ đúng khoảng trống đó. `boards.service.ts`
-- hiện phải né bằng `findFirst` thủ công — sau khi có index này, DB mới là nơi
-- bảo đảm bất biến, chứ không phải một đoạn check ở tầng ứng dụng (vốn luôn có
-- race condition giữa lúc check và lúc insert).
CREATE UNIQUE INDEX IF NOT EXISTS "SavedPin_userId_pinId_no_board_key"
    ON "SavedPin"("userId", "pinId")
    WHERE "boardId" IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Pin — GIN index cho full-text search
-- ─────────────────────────────────────────────────────────────────────────────
-- `search.service.ts` hiện dùng ILIKE `%query%`. Wildcard ở ĐẦU chuỗi khiến
-- B-tree index vô dụng ⇒ luôn sequential scan toàn bảng Pin.
--
-- Index này là điều kiện cần để chuyển sang `to_tsvector`/`plainto_tsquery`
-- (mục P3 trong báo cáo). Tạo trước vì nó thuộc về tầng schema, và migration
-- là nơi duy nhất đúng để đặt nó.
--
-- `WHERE "deletedAt" IS NULL`: pin đã xóa mềm không bao giờ xuất hiện trong kết
-- quả tìm kiếm, nên không cần chiếm chỗ trong index.
--
-- Chọn 'english' cho khớp PLAN.md. Với nội dung tiếng Việt, config này chỉ làm
-- được việc tách từ + hạ chữ thường (không stemming) — vẫn tốt hơn ILIKE rất
-- nhiều. Nếu sau này cần chuẩn tiếng Việt thì đổi sang 'simple' + unaccent.
CREATE INDEX IF NOT EXISTS "Pin_fts_idx"
    ON "Pin"
    USING GIN (to_tsvector('english', coalesce("title", '') || ' ' || coalesce("description", '')))
    WHERE "deletedAt" IS NULL;
