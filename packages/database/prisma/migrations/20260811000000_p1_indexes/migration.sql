-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  P1 Đợt 1b — 9 index viết tay                                             ║
-- ║                                                                           ║
-- ║  Vì sao viết tay thay vì `prisma migrate dev`:                            ║
-- ║  `migrate dev` sẽ sinh `DROP INDEX "Pin_fts_idx"` và                      ║
-- ║  `DROP INDEX "SavedPin_userId_pinId_no_board_key"` — hai index viết tay   ║
-- ║  ở `20260728000100_custom_indexes` mà `@@index` không diễn đạt được       ║
-- ║  (partial + GIN). Viết tay ⇒ `db:migrate:deploy` chạy đúng nội dung này.  ║
-- ║                                                                           ║
-- ║  Tên index PHẢI khớp quy ước Prisma `Table_col1_col2_..._idx` — lệch      ║
-- ║  một chữ là drift vĩnh viễn giữa schema và DB. Kiểm bằng                  ║
-- ║  `prisma migrate diff --from-url $DATABASE_URL --to-schema-datamodel      ║
-- ║   schema.prisma --script`: chỉ được sinh ĐÚNG 2 dòng `DROP INDEX` cho     ║
-- ║  Pin_fts_idx + SavedPin_userId_pinId_no_board_key. Dòng thứ 3 = tên lệch. ║
-- ║                                                                           ║
-- ║  ⚠️ SavedPin(boardId,sortOrder ASC,createdAt DESC,id DESC) — hướng TRỘN.  ║
-- ║  Toàn ASC hoặc toàn DESC KHÔNG phục vụ ORDER BY hướng trộn — Postgres     ║
-- ║  chỉ quét ngược khi đảo TOÀN BỘ thứ tự cột. Sai chỗ này thì index tạo     ║
-- ║  ra mà planner vẫn chèn node `Sort`, index vô dụng mà không ai biết.     ║
-- ║  Phép quyết định: `SET enable_seqscan=off; EXPLAIN <câu boardPins>` phải  ║
-- ║  hiện Index Scan using SavedPin_boardId_sortOrder_createdAt_id_idx VÀ     ║
-- ║  KHÔNG có node `Sort`.                                                    ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

-- 1. Comment(parentId, createdAt ASC) — cho getCommentReplies và replyCount groupBy của #9
CREATE INDEX IF NOT EXISTS "Comment_parentId_createdAt_idx"
    ON "Comment"("parentId", "createdAt");

-- 2. CommentReaction(commentId) — reactionCount groupBy commentId ở #9.
--    Unique hiện tại `@@unique([userId, commentId])` dẫn đầu bằng userId ⇒ vô dụng.
CREATE INDEX IF NOT EXISTS "CommentReaction_commentId_idx"
    ON "CommentReaction"("commentId");

-- 3. Reaction(pinId) — cho reactionCountByPinIdLoader (chạy mỗi lần render feed).
--    Unique hiện tại `@@unique([userId, pinId])` dẫn đầu bằng userId ⇒ vô dụng cho query này.
CREATE INDEX IF NOT EXISTS "Reaction_pinId_idx"
    ON "Reaction"("pinId");

-- 4. SavedPin(pinId) — cho savedCountByPinIdLoader.
--    Cả hai index hiện có (unique + userId_createdAt) đều dẫn đầu bằng userId.
CREATE INDEX IF NOT EXISTS "SavedPin_pinId_idx"
    ON "SavedPin"("pinId");

-- 5. SavedPin(boardId, sortOrder ASC, createdAt DESC, id DESC) — cho getBoardPins.
--    Hướng cột PHẢI khai đúng từng cột (xem block header). Prefix boardId
--    phục vụ luôn pinCountByBoardIdLoader.
CREATE INDEX IF NOT EXISTS "SavedPin_boardId_sortOrder_createdAt_id_idx"
    ON "SavedPin"("boardId", "sortOrder" ASC, "createdAt" DESC, "id" DESC);

-- 6. Board(userId, createdAt DESC, id DESC) — cho getUserBoards.
--    Board hiện KHÔNG có index nào ngoài PK.
CREATE INDEX IF NOT EXISTS "Board_userId_createdAt_id_idx"
    ON "Board"("userId", "createdAt" DESC, "id" DESC);

-- 7. ConversationMember(userId) — getConversations lọc members:{some:{userId}}.
--    Unique hiện tại dẫn đầu bằng conversationId.
CREATE INDEX IF NOT EXISTS "ConversationMember_userId_idx"
    ON "ConversationMember"("userId");

-- 8. Conversation(updatedAt DESC, id DESC) — keyset mới cho getConversations.
--    ⚠️ Là index DUY NHẤT chưa chắc planner sẽ dùng — nó có thể drive từ
--    ConversationMember rồi sort. Kiểm bằng EXPLAIN sau khi getConversations
--    đã ở dạng cuối (sau bước 3c); không dùng thì gỡ.
CREATE INDEX IF NOT EXISTS "Conversation_updatedAt_id_idx"
    ON "Conversation"("updatedAt" DESC, "id" DESC);

-- 9. BlockedUser(blockedId) — getBlockedUserIds dùng OR[{blockerId},{blockedId}];
--    nhánh blockedId hiện seq scan (unique có prefix blockerId).
CREATE INDEX IF NOT EXISTS "BlockedUser_blockedId_idx"
    ON "BlockedUser"("blockedId");
