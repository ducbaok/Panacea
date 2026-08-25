// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  Khán giả HIỆN TẠI của một pin — tập userId, tính lúc ĐỌC                 ║
// ║  (XH-5, 24/08/2026 — PLAN_XAHOI.md §4 luật 5 · XH-QĐ-15)                  ║
// ║                                                                           ║
// ║  KHÁC GÌ `visible-pins.util.ts`: ba hình thái ở đó trả lời câu hỏi        ║
// ║  **"người X có xem được pin nào"** (đi từ NGƯỜI ra PIN). File này trả lời ║
// ║  chiều NGƯỢC LẠI — **"pin P đang có những ai trong khán giả"** (đi từ PIN ║
// ║  ra NGƯỜI). Cùng một luật, hai chiều truy vấn; chiều này không viết được  ║
// ║  bằng ba hình thái kia vì chúng nhận `PinAudienceCtx` của MỘT người xem.  ║
// ║                                                                           ║
// ║  HAI CHỖ DÙNG, và cả hai đều là "hiện tại" chứ không phải "lúc đó":       ║
// ║    1. `pinViewers` — XH-QĐ-15 (chốt 24/08): ai-đã-xem lọc theo thành viên ║
// ║       HIỆN TẠI của vòng, nên người bị bớt khỏi vòng BIẾN MẤT khỏi danh    ║
// ║       sách. Quyết định này cố ý ĐẢO đề xuất "giữ — lịch sử là lịch sử",   ║
// ║       để nhất quán hồi tố với XH-QĐ-3 (rời vòng phải im lặng).            ║
// ║    2. `mentionSuggestions` — §4 luật 5: chặn @mention người ngoài khán    ║
// ║       giả NGAY LÚC GÕ, thay vì báo cho họ rồi để họ bấm vào và ăn 404.    ║
// ║                                                                           ║
// ║  ⚠️ `null` ≠ tập rỗng. `null` = PUBLIC = **không lọc ai cả**; tập rỗng =  ║
// ║  không còn ai trong khán giả. Lẫn hai thứ này theo chiều sai là rò rỉ.    ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

import { PrismaService } from '../prisma/prisma.service';
import { Visibility } from './entities/visibility.enum';

/** Tập cột tối thiểu để tính được khán giả của một pin đã fetch. */
export interface PinAudienceRow {
  id: string;
  creatorId: string;
  visibility: string;
  audienceCircleId: string | null;
}

/**
 * Khán giả hiện tại của NHIỀU pin trong đúng 2 query (không phải 2 query/pin).
 *
 * Hàm THUẦN nhận `prisma` — cùng lý do với `getPinAudienceCtx`: dùng được từ cả
 * service singleton (`PinsService`) lẫn `DataloaderService` (Scope.REQUEST) mà
 * không kéo scope lan sang bên nào, và không cần một trong hai inject bên kia.
 *
 * @returns map `pinId → tập userId trong khán giả`, hoặc `null` cho pin PUBLIC.
 *          Chủ pin LUÔN nằm trong tập của chính pin mình.
 */
export async function currentAudienceIdsByPin(
  prisma: PrismaService,
  pins: PinAudienceRow[],
): Promise<Map<string, Set<string> | null>> {
  const circleIds = [
    ...new Set(
      pins
        .filter((p) => p.visibility === Visibility.CIRCLE && p.audienceCircleId)
        .map((p) => p.audienceCircleId as string),
    ),
  ];
  const followedIds = [
    ...new Set(pins.filter((p) => p.visibility === Visibility.FOLLOWERS).map((p) => p.creatorId)),
  ];

  // Nhánh rỗng KHÔNG chạm database — cùng triết lý `_notInBlocked`: đa số
  // request thật chỉ có một loại khán giả trong tay.
  const [memberRows, followRows] = await Promise.all([
    circleIds.length
      ? prisma.circleMember.findMany({
          where: { circleId: { in: circleIds } },
          select: { circleId: true, userId: true },
        })
      : Promise.resolve([] as { circleId: string; userId: string }[]),
    followedIds.length
      ? prisma.follows.findMany({
          where: { followingId: { in: followedIds } },
          select: { followingId: true, followerId: true },
        })
      : Promise.resolve([] as { followingId: string; followerId: string }[]),
  ]);

  const byCircle = new Map<string, Set<string>>();
  for (const m of memberRows) {
    let s = byCircle.get(m.circleId);
    if (!s) byCircle.set(m.circleId, (s = new Set()));
    s.add(m.userId);
  }
  const byCreator = new Map<string, Set<string>>();
  for (const f of followRows) {
    let s = byCreator.get(f.followingId);
    if (!s) byCreator.set(f.followingId, (s = new Set()));
    s.add(f.followerId);
  }

  const out = new Map<string, Set<string> | null>();
  for (const pin of pins) {
    if (pin.visibility === Visibility.PUBLIC) {
      out.set(pin.id, null);
      continue;
    }
    const ids = new Set<string>();
    if (pin.visibility === Visibility.FOLLOWERS) {
      byCreator.get(pin.creatorId)?.forEach((id) => ids.add(id));
    } else if (pin.visibility === Visibility.CIRCLE && pin.audienceCircleId) {
      byCircle.get(pin.audienceCircleId)?.forEach((id) => ids.add(id));
    }
    // ONLY_ME (và mọi giá trị lạ trong tương lai) rơi xuống đây với tập rỗng —
    // FAIL-CLOSED, cùng chiều với `isPinVisibleInCtx`.
    ids.add(pin.creatorId); // chủ pin luôn ở trong khán giả của chính mình
    out.set(pin.id, ids);
  }
  return out;
}

/** Bản một-pin của hàm trên, cho những chỗ không có gì để gom lô. */
export async function currentAudienceIds(
  prisma: PrismaService,
  pin: PinAudienceRow,
): Promise<Set<string> | null> {
  return (await currentAudienceIdsByPin(prisma, [pin])).get(pin.id) ?? null;
}
