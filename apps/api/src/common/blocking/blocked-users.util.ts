// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  Blocked users — nguồn sự thật DUY NHẤT cho "ai không được thấy ai"       ║
// ║                                                                          ║
// ║  Tách ra từ `SearchService.getBlockedUserIds` (bản `private`) ở Đợt 3e.  ║
// ║  Lý do tách: Search đã lọc block từ lâu, còn Pins thì chưa — hai nơi     ║
// ║  cùng trả lời một câu hỏi thì phải hỏi cùng một hàm, nếu không sẽ lệch   ║
// ║  nhau đúng theo kiểu không ai phát hiện được (feed lọc, search không,    ║
// ║  hoặc ngược lại).                                                        ║
// ║                                                                          ║
// ║  Hàm THUẦN, nhận `prisma` làm tham số thay vì inject — để dùng được cả   ║
// ║  từ service singleton lẫn từ `DataloaderService` (`Scope.REQUEST`) mà    ║
// ║  không kéo scope lan sang bên nào.                                       ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

import { PrismaService } from '../../prisma/prisma.service';

/**
 * Trả về id của mọi người mà `userId` KHÔNG được nhìn thấy nội dung.
 *
 * ⚠️ QUAN HỆ NÀY HAI CHIỀU, VÀ ĐÓ LÀ CHỦ ĐÍCH. `OR` phủ cả hai vai:
 *   - `blockerId = userId` → những người TÔI chặn (tôi không muốn thấy họ)
 *   - `blockedId = userId` → những người CHẶN TÔI (họ không muốn tôi thấy họ)
 *
 * Bỏ nhánh thứ hai vẫn biên dịch sạch và một nửa số phép kiểm vẫn xanh: người
 * đi chặn vẫn được phục vụ đúng, chỉ có người BỊ chặn là vẫn xem được nội dung
 * của người đã chặn mình — tức là đúng cái lỗ hổng mà tính năng này sinh ra để
 * bịt. `scripts/verify/steps/65-blocking.mjs` giữ riêng một phép kiểm cho
 * chiều ngược đó (xem đối chứng âm ở docs/debug_history.md §16).
 *
 * `BlockedUser` KHÔNG có cột `deletedAt` (schema.prisma:170-181) — bỏ chặn là
 * DELETE thật, nên ở đây không cần lọc soft-delete như các model khác.
 *
 * @param userId Khách vãng lai (không token) ⇒ `undefined` ⇒ mảng rỗng: không
 *   đăng nhập thì không có quan hệ chặn nào để áp dụng.
 */
export async function getBlockedUserIds(
  prisma: PrismaService,
  userId?: string,
): Promise<string[]> {
  if (!userId) return [];

  const blocks = await prisma.blockedUser.findMany({
    where: {
      OR: [{ blockerId: userId }, { blockedId: userId }],
    },
  });

  // Lấy "người kia" của mỗi cặp — bản ghi có thể ghi tôi ở vai nào cũng được.
  return blocks.map((b) =>
    b.blockerId === userId ? b.blockedId : b.blockerId,
  );
}
