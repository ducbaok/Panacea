// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  DataloaderService — REQUEST SCOPED                                      ║
// ║  Mỗi HTTP/GraphQL request tạo một instance mới → cache tự reset.       ║
// ║                                                                          ║
// ║  HƯỚNG DẪN CODE LẠI:                                                     ║
// ║  1. Inject PrismaService.                                               ║
// ║  2. Tạo các DataLoader dưới dạng getter (lazy initialization):          ║
// ║     - userByIdLoader: batch fetch users by id[]                         ║
// ║     - savedCountByPinIdLoader: COUNT SavedPin grouped by pinId          ║
// ║     - reactionCountByPinIdLoader: COUNT Reaction grouped by pinId       ║
// ║     - commentCountByPinIdLoader: COUNT Comment grouped by pinId         ║
// ║  3. Dùng Scope.REQUEST trong @Injectable.                              ║
// ║  4. Pattern: new DataLoader(async (keys) => {                           ║
// ║       // batch query                                                     ║
// ║       // map results theo đúng thứ tự keys                              ║
// ║     })                                                                   ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

import { Injectable, Scope } from '@nestjs/common';
import DataLoader from 'dataloader';
import { PrismaService } from '../../prisma/prisma.service';
import { groupRows, mapCounts, mapExists, mapValues } from './dataloader.util';
import {
  getBlockedUserIds,
  getPinAudienceCtx,
  visiblePinWhere,
  GUEST_AUDIENCE_CTX,
} from '../blocking';
import type { PinAudienceCtx } from '../blocking';
// XH-5 — chiều NGƯỢC của bộ lọc khán giả (từ PIN ra NGƯỜI). Là một hàm THUẦN
// nhận `prisma`, không phải một service: `PinsService` là singleton còn
// `DataloaderService` là Scope.REQUEST, inject bên nào vào bên nào cũng kéo
// theo vòng đời của nhau (và một vòng import). Dùng chung với
// `PinsService.mentionSuggestions` để luật khán-giả-hiện-tại chỉ có MỘT bản.
import { currentAudienceIdsByPin } from '../../pins/pin-audience.util';
// Enum của Prisma (union string literal), KHÔNG phải enum GraphQL cùng tên ở
// comments/entities/reaction-type.enum.ts. Ở tầng loader ta trả thẳng giá trị
// đọc từ DB nên dùng kiểu của DB mới đúng; enum GraphQL chỉ cần ở tầng schema.
import { ReactionType } from '@antigravity/database';

@Injectable({ scope: Scope.REQUEST })
export class DataloaderService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Loader phụ thuộc viewer ───────────────────────────────────────────────

  /**
   * Cache loader theo viewer, cho những loader mà kết quả phụ thuộc vào NGƯỜI
   * ĐANG XEM chứ không chỉ vào key được load.
   *
   * ⚠️ ĐỂ Ở CẤP INSTANCE, ĐỪNG NÂNG LÊN `static`. `DataloaderService` là
   * `Scope.REQUEST` (:24) nên Map này sinh ra và chết theo từng request — đó
   * chính là thứ làm cho việc cache an toàn. Nâng lên singleton thì cache sống
   * xuyên request và loader sẽ trả trạng thái follow CŨ cho request sau, kể cả
   * sau khi người dùng bấm follow/unfollow.
   */
  private _viewerLoaders = new Map<string, DataLoader<any, any>>();

  /**
   * Trả về loader đã memo cho cặp (tên loader, viewer); chưa có thì tạo.
   *
   * VÌ SAO CẦN — đây là bug #10 của P1: hai method bên dưới trước đây
   * `return new DataLoader(...)` thẳng, tức MỖI lần resolve field lại dựng một
   * instance mới. DataLoader gom `.load()` trong cùng một tick THEO TỪNG
   * INSTANCE, nên instance mới ⇒ hàng đợi luôn đúng 1 key ⇒ 1 query cho mỗi
   * parent, cộng thêm mất luôn cache trong phạm vi request. Instance mới không
   * phải "hơi kém hiệu quả": nó vô hiệu hoá 100% cơ chế batch.
   *
   * Đo được: `followers` trả 4 item — trước 10 query, sau 4 query, và số query
   * không còn tăng theo kích thước trang (`scripts/verify/steps/20-social.mjs`).
   *
   * `name` nằm trong khoá vì hai loader khác nhau CÙNG nhận `viewerId` làm
   * tham số; thiếu nó thì `isFollowedBy` và `isFollowing` sẽ dùng chung một
   * instance và trả kết quả của nhau.
   */
  private perViewer<K, V>(
    name: string,
    viewerId: string,
    make: () => DataLoader<K, V>,
  ): DataLoader<K, V> {
    const cacheKey = `${name}:${viewerId}`;
    let loader = this._viewerLoaders.get(cacheKey);
    if (!loader) {
      loader = make();
      this._viewerLoaders.set(cacheKey, loader);
    }
    return loader as DataLoader<K, V>;
  }

  // ─── Blocked user ids (Đợt 3e) ─────────────────────────────────────────────

  /**
   * Memo theo viewer cho danh sách người bị chặn.
   *
   * ⚠️ LƯU `Promise`, KHÔNG LƯU GIÁ TRỊ ĐÃ AWAIT. Đây là toàn bộ lý do memo này
   * đạt được "1 query cho cả request". Một request GraphQL có thể chạm hàm này
   * từ nhiều resolver trong CÙNG một tick (`exploreFeed` và các field con).
   * Nếu chỉ lưu kết quả sau khi await, cả n lời gọi đều thấy cache rỗng trước
   * khi lời gọi đầu tiên kịp resolve ⇒ n query. Lưu promise thì lời gọi thứ hai
   * trở đi bám vào đúng promise đang bay.
   *
   * Cùng lý do với `_viewerLoaders`, Map này ĐỂ Ở CẤP INSTANCE: service là
   * `Scope.REQUEST` nên nó chết theo request. Nâng lên `static` thì một lần
   * block/unblock sẽ không có hiệu lực cho tới khi process khởi động lại.
   */
  private _blockedUserIds = new Map<string, Promise<string[]>>();

  /**
   * Danh sách id mà `viewerId` không được thấy nội dung — hai chiều.
   *
   * Khách vãng lai (`undefined`) trả mảng rỗng và KHÔNG chạm database.
   */
  blockedUserIds(viewerId?: string): Promise<string[]> {
    if (!viewerId) return Promise.resolve([]);

    let p = this._blockedUserIds.get(viewerId);
    if (!p) {
      p = getBlockedUserIds(this.prisma, viewerId);
      this._blockedUserIds.set(viewerId, p);
    }
    return p;
  }

  // ─── Ngữ cảnh khán giả của pin (XH-2, 21/08/2026) ──────────────────────────

  /**
   * Memo theo viewer cho ngữ cảnh khán giả (`followingIds` + `memberCircleIds`).
   * Cùng khuôn với `_blockedUserIds` ngay trên: LƯU `Promise` chứ không lưu giá
   * trị đã await, Map ở CẤP INSTANCE — hai cảnh báo ở đó áp nguyên vào đây.
   */
  private _pinAudienceCtx = new Map<string, Promise<PinAudienceCtx>>();

  /**
   * Ngữ cảnh khán giả để lọc pin theo XH-2. Khách vãng lai (`undefined`) trả
   * hằng `GUEST_AUDIENCE_CTX` và KHÔNG chạm database — fail-closed: chỉ PUBLIC.
   */
  pinAudienceCtx(viewerId?: string): Promise<PinAudienceCtx> {
    if (!viewerId) return Promise.resolve(GUEST_AUDIENCE_CTX);

    let p = this._pinAudienceCtx.get(viewerId);
    if (!p) {
      p = getPinAudienceCtx(this.prisma, viewerId);
      this._pinAudienceCtx.set(viewerId, p);
    }
    return p;
  }

  /**
   * Batch fetch pin theo id, LỌC theo quyền xem của viewer — pin ngoài khán
   * giả (hoặc đã hết hạn) trả `null`, không phân biệt được với pin không tồn
   * tại. Dùng cho `Board.coverPin` và `SavedPin.pin`: hai đường mà một pin
   * giới hạn có thể lọt ra ngoài sau khi lưới đã lọc (PLAN_XAHOI.md §3 bẫy 5 —
   * board lật quyền qua `updateBoard.isSecret`).
   *
   * Khoá `'(guest)'` cho khách vãng lai KHÔNG vi phạm cảnh báo "khoá rỗng" của
   * pins.resolver: ở đó khoá rỗng là vô nghĩa vì kết quả đã biết trước; ở đây
   * mọi khách vãng lai CÙNG một quyền xem (chỉ PUBLIC) nên dùng chung một
   * loader trong request là đúng và còn batch tốt hơn.
   */
  buildVisiblePinLoader(viewerId?: string): DataLoader<string, any> {
    return this.perViewer('visiblePin', viewerId ?? '(guest)', () => {
      return new DataLoader<string, any>(async (pinIds) => {
        const ctx = await this.pinAudienceCtx(viewerId);
        // Middleware soft-delete đã lọc `deletedAt` cho findMany — cùng chủ
        // đích với `pinByIdLoader` bên dưới, không nhân đôi quy tắc.
        const pins = await this.prisma.pin.findMany({
          where: { id: { in: [...pinIds] }, AND: [visiblePinWhere(ctx)] },
        });

        return mapValues(pinIds, pins, (p) => p.id);
      });
    });
  }

  // ─── Ai đã xem pin (XH-5, 24/08/2026) ──────────────────────────────────────

  /**
   * Danh sách "ai đã xem" của một pin — **CHỈ chủ pin đọc được**.
   *
   * @returns mảng `User` xếp theo lượt xem MỚI NHẤT trước, hoặc `null` khi pin
   *          không tồn tại / không phải của `viewerId`. Bên gọi biến `null`
   *          thành 404 "Pin not found" — KHÔNG phải 403, cùng chính sách với
   *          mọi bề mặt pin khác: 403 tự nó đã xác nhận pin đó có thật.
   *
   * ⚠️ QUYỀN NẰM TRONG `where`, KHÔNG phải trong một nhánh `if` ở resolver:
   * `creatorId: viewerId` là điều kiện của chính câu query, nên "quên kiểm tra"
   * không phải một trạng thái có thể tồn tại ở đây. Cùng khuôn với
   * `buildVisiblePinLoader` ngay trên.
   *
   * ⚠️ BA BỘ LỌC CỘNG DỒN trên tập `PinView` đọc lên, và cả ba đều đánh giá
   * **lúc đọc** chứ không phải lúc ghi:
   *   1. **Khán giả HIỆN TẠI của vòng — XH-QĐ-15 (chốt 24/08).** Người bị bớt
   *      khỏi vòng biến mất khỏi danh sách, dù dòng `PinView` của họ vẫn còn.
   *      Quyết định này cố ý ĐẢO đề xuất "giữ — lịch sử là lịch sử" của spec
   *      archive, để nhất quán hồi tố với XH-QĐ-3 (rời vòng phải im lặng): giữ
   *      họ trong danh sách chính là tiết lộ "người này TỪNG ở trong vòng".
   *   2. **Chặn hai chiều.** Chặn và quyền riêng tư CỘNG DỒN (AND) ở mọi bề
   *      mặt của dự án, không thay thế nhau.
   *   3. **Chính chủ.** `_recordPinView` đã không ghi lượt xem của chủ pin, nên
   *      đây là dây bảo hiểm cho dữ liệu cũ chứ không phải luật thứ hai.
   *
   * `blockedIds` truyền vào thay vì tự lấy: resolver đã memo nó cho cả request
   * (`blockedUserIds`), và nó là hàm của đúng `viewerId` đang làm khoá
   * `perViewer` — nên không có cách nào để hai lời gọi trong cùng request nhìn
   * thấy hai bộ lọc chặn khác nhau.
   */
  buildPinViewersLoader(
    viewerId: string,
    blockedIds: string[],
  ): DataLoader<string, any[] | null> {
    return this.perViewer('pinViewers', viewerId, () => {
      return new DataLoader<string, any[] | null>(async (pinIds) => {
        // Middleware soft-delete lọc `deletedAt` cho findMany — pin đã xoá mềm
        // rơi ra ngoài và bên gọi thấy 404, đúng như pin của người khác.
        const pins = await this.prisma.pin.findMany({
          where: { id: { in: [...pinIds] }, creatorId: viewerId },
          select: { id: true, creatorId: true, visibility: true, audienceCircleId: true },
        });
        if (!pins.length) return pinIds.map(() => null);

        const [rows, audienceByPin] = await Promise.all([
          this.prisma.pinView.findMany({
            where: { pinId: { in: pins.map((p) => p.id) } },
            select: { pinId: true, viewerId: true },
            orderBy: { firstViewedAt: 'desc' },
          }),
          currentAudienceIdsByPin(this.prisma, pins),
        ]);

        const blocked = new Set(blockedIds);
        const keptByPin = new Map<string, string[]>();
        for (const r of rows) {
          if (r.viewerId === viewerId || blocked.has(r.viewerId)) continue;
          const audience = audienceByPin.get(r.pinId);
          // `null` = PUBLIC = không lọc. Pin PUBLIC không đẻ dòng `PinView`
          // nào (luật 1), nên nhánh này chỉ chạm dữ liệu của pin ĐÃ ĐƯỢC MỞ
          // công khai sau khi có người xem — và lúc đó không còn gì để giấu.
          if (audience && !audience.has(r.viewerId)) continue;
          const list = keptByPin.get(r.pinId);
          if (list) list.push(r.viewerId);
          else keptByPin.set(r.pinId, [r.viewerId]);
        }

        // MỘT lời gọi `userByIdLoader` cho toàn bộ lô, không phải một lời gọi
        // mỗi pin: loader ở đây gom theo instance, và instance là dùng chung.
        const needed = [...new Set([...keptByPin.values()].flat())];
        const users = needed.length ? await this.userByIdLoader.loadMany(needed) : [];
        const byId = new Map<string, any>();
        needed.forEach((id, i) => {
          const u = users[i];
          if (u && !(u instanceof Error)) byId.set(id, u);
        });

        const owned = new Set(pins.map((p) => p.id));
        return pinIds.map((id) =>
          owned.has(id) ? (keptByPin.get(id) ?? []).map((uid) => byId.get(uid)).filter(Boolean) : null,
        );
      });
    });
  }

  // ─── User By ID ────────────────────────────────────────────────────────────

  private _userByIdLoader?: DataLoader<string, any>;

  /**
   * Batch fetch users by id[].
   * Dùng để resolve Pin.creator, Notification.actor, v.v.
   */
  get userByIdLoader(): DataLoader<string, any> {
    if (!this._userByIdLoader) {
      this._userByIdLoader = new DataLoader<string, any>(async (userIds) => {
        // Batch query: SELECT * FROM User WHERE id IN (...)
        const users = await this.prisma.user.findMany({
          where: { id: { in: [...userIds] } },
        });

        // Map lại theo thứ tự keys ban đầu (DataLoader yêu cầu)
        return mapValues(userIds, users, (u) => u.id);
      });
    }
    return this._userByIdLoader;
  }

  // ─── Saved Count By Pin ID ─────────────────────────────────────────────────

  private _savedCountByPinIdLoader?: DataLoader<string, number>;

  /**
   * COUNT SavedPin grouped by pinId.
   * Trả về số lần pin được save bởi tất cả users.
   */
  get savedCountByPinIdLoader(): DataLoader<string, number> {
    if (!this._savedCountByPinIdLoader) {
      this._savedCountByPinIdLoader = new DataLoader<string, number>(
        async (pinIds): Promise<number[]> => {
          // groupBy + count
          const counts = await this.prisma.savedPin.groupBy({
            by: ['pinId'],
            where: { pinId: { in: [...pinIds] } },
            _count: { pinId: true },
          });

          return mapCounts(pinIds, counts, 'pinId');
        },
      );
    }
    return this._savedCountByPinIdLoader!;
  }

  // ─── Reaction Count By Pin ID ──────────────────────────────────────────────

  private _reactionCountByPinIdLoader?: DataLoader<string, number>;

  /**
   * COUNT Reaction grouped by pinId.
   */
  get reactionCountByPinIdLoader(): DataLoader<string, number> {
    if (!this._reactionCountByPinIdLoader) {
      this._reactionCountByPinIdLoader = new DataLoader<string, number>(
        async (pinIds): Promise<number[]> => {
          const counts = await this.prisma.reaction.groupBy({
            by: ['pinId'],
            where: { pinId: { in: [...pinIds] } },
            _count: { pinId: true },
          });

          return mapCounts(pinIds, counts, 'pinId');
        },
      );
    }
    return this._reactionCountByPinIdLoader!;
  }

  // ─── Comment Count By Pin ID ───────────────────────────────────────────────

  private _commentCountByPinIdLoader?: DataLoader<string, number>;

  /**
   * COUNT Comment grouped by pinId (chỉ đếm comment chưa bị soft-delete).
   */
  get commentCountByPinIdLoader(): DataLoader<string, number> {
    if (!this._commentCountByPinIdLoader) {
      this._commentCountByPinIdLoader = new DataLoader<string, number>(
        async (pinIds): Promise<number[]> => {
          const counts = await this.prisma.comment.groupBy({
            by: ['pinId'],
            where: {
              pinId: { in: [...pinIds] },
              deletedAt: null,
            },
            _count: { pinId: true },
          });

          return mapCounts(pinIds, counts, 'pinId');
        },
      );
    }
    return this._commentCountByPinIdLoader!;
  }

  // ─── Reply Count By Comment ID (Đợt 4) ─────────────────────────────────────

  private _replyCountByCommentIdLoader?: DataLoader<string, number>;

  /**
   * COUNT Comment grouped by parentId — số reply của từng comment gốc.
   *
   * ⚠️ `deletedAt: null` Ở ĐÂY LÀ BẮT BUỘC, KHÔNG PHẢI THỪA. Middleware
   * soft-delete (`prisma.service.ts:53`) chỉ intercept `findMany`/`findFirst`;
   * `groupBy` đi thẳng xuống database. Bỏ dòng đó thì reply đã xoá vẫn được
   * đếm — biên dịch sạch, không ném lỗi, và chỉ lộ ra ở phép kiểm "xoá reply ⇒
   * replyCount về 0" trong `40-comments.mjs`.
   *
   * Cùng lý do, cùng hình dạng với `commentCountByPinIdLoader` ngay trên.
   *
   * Ghi chú hiệu năng: `Comment` mới chỉ có `@@index([pinId, createdAt])`
   * (`schema.prisma:337`) nên phép gom nhóm này seq-scan. Xem `PLAN_P1.md` §4 —
   * quyết định thêm `@@index([parentId])` đang chờ người dùng.
   */
  get replyCountByCommentIdLoader(): DataLoader<string, number> {
    if (!this._replyCountByCommentIdLoader) {
      this._replyCountByCommentIdLoader = new DataLoader<string, number>(
        async (commentIds): Promise<number[]> => {
          const counts = await this.prisma.comment.groupBy({
            by: ['parentId'],
            where: {
              parentId: { in: [...commentIds] },
              deletedAt: null,
            },
            _count: { parentId: true },
          });

          return mapCounts(commentIds, counts, 'parentId');
        },
      );
    }
    return this._replyCountByCommentIdLoader!;
  }

  // ─── Reaction Count By Comment ID (Đợt 4) ──────────────────────────────────

  private _commentReactionCountLoader?: DataLoader<string, number>;

  /**
   * COUNT CommentReaction grouped by commentId.
   *
   * KHÔNG có `deletedAt` ở đây, và đó là chủ đích: model `CommentReaction`
   * (`schema.prisma:341-353`) không hề có cột đó — bỏ reaction là DELETE thật
   * (`comments.service.ts:152`), không phải soft-delete. Chỉ loader ngay trên
   * mới dính bẫy middleware, vì chỉ nó gom nhóm trên `Comment`.
   */
  get commentReactionCountLoader(): DataLoader<string, number> {
    if (!this._commentReactionCountLoader) {
      this._commentReactionCountLoader = new DataLoader<string, number>(
        async (commentIds): Promise<number[]> => {
          const counts = await this.prisma.commentReaction.groupBy({
            by: ['commentId'],
            where: { commentId: { in: [...commentIds] } },
            _count: { commentId: true },
          });

          return mapCounts(commentIds, counts, 'commentId');
        },
      );
    }
    return this._commentReactionCountLoader!;
  }

  // ─── Follower Count By User ID ─────────────────────────────────────────────

  private _followerCountLoader?: DataLoader<string, number>;

  /**
   * COUNT Follows where followingId = userId
   */
  get followerCountLoader(): DataLoader<string, number> {
    if (!this._followerCountLoader) {
      this._followerCountLoader = new DataLoader<string, number>(
        async (userIds): Promise<number[]> => {
          const counts = await this.prisma.follows.groupBy({
            by: ['followingId'],
            where: { followingId: { in: [...userIds] } },
            _count: { followingId: true },
          });

          return mapCounts(userIds, counts, 'followingId');
        },
      );
    }
    return this._followerCountLoader!;
  }

  // ─── Following Count By User ID ────────────────────────────────────────────

  private _followingCountLoader?: DataLoader<string, number>;

  /**
   * COUNT Follows where followerId = userId
   */
  get followingCountLoader(): DataLoader<string, number> {
    if (!this._followingCountLoader) {
      this._followingCountLoader = new DataLoader<string, number>(
        async (userIds): Promise<number[]> => {
          const counts = await this.prisma.follows.groupBy({
            by: ['followerId'],
            where: { followerId: { in: [...userIds] } },
            _count: { followerId: true },
          });

          return mapCounts(userIds, counts, 'followerId');
        },
      );
    }
    return this._followingCountLoader!;
  }

  // ─── Is Followed By Current User Loader ───────────────────────────────────

  /**
   * "Viewer có đang follow những người này không?"
   *
   * Dataloader này cần CurrentUser ID để kiểm tra, nên không dựng được dưới
   * dạng getter cache-một-lần như các loader khác — mỗi viewer cần một hàng đợi
   * riêng. `perViewer` lo phần đó; chữ ký giữ nguyên nên call-site
   * (`users.resolver.ts:149`) không phải đổi.
   *
   * ⚠️ ĐỪNG GỘP method này với `buildIsFollowingLoader` bằng MỘT tham số tên
   * trường. Hai method đảo ngược nhau ở CẢ BA chỗ, không phải một:
   *
   *              | where cố định | lọc `in`      | khoá lấy ra từ Set
   *   isFollowedBy | followerId    | followingId   | f.followingId
   *   isFollowing  | followingId   | followerId    | f.followerId
   *
   * Gộp bằng một tham số sẽ biên dịch sạch và trả về boolean trông rất hợp lý —
   * chỉ là của quan hệ NGƯỢC CHIỀU. Muốn gộp thì tham số phải là một CẶP
   * `(fixedField, inField)`, và lúc đó phần gộp dài hơn phần nó tiết kiệm.
   */
  buildIsFollowedByLoader(currentUserId: string): DataLoader<string, boolean> {
    return this.perViewer('isFollowedBy', currentUserId, () =>
      new DataLoader<string, boolean>(async (userIds) => {
        const follows = await this.prisma.follows.findMany({
          where: {
            followerId: currentUserId,
            followingId: { in: [...userIds] },
          },
        });
        return mapExists(userIds, follows, (f) => f.followingId);
      }),
    );
  }

  // ─── Is Following Current User Loader ─────────────────────────────────────

  /**
   * "Những người này có đang follow viewer không?" — chiều NGƯỢC LẠI của
   * `buildIsFollowedByLoader`; xem cảnh báo không-gộp ở method đó.
   */
  buildIsFollowingLoader(currentUserId: string): DataLoader<string, boolean> {
    return this.perViewer('isFollowing', currentUserId, () =>
      new DataLoader<string, boolean>(async (userIds) => {
        const follows = await this.prisma.follows.findMany({
          where: {
            followingId: currentUserId,
            followerId: { in: [...userIds] },
          },
        });
        return mapExists(userIds, follows, (f) => f.followerId);
      }),
    );
  }

  // ─── Is Blocked By Viewer Loader (QĐ-7 / FE-6) ────────────────────────────

  /**
   * "Viewer đã CHẶN những user này chưa?" — MỘT CHIỀU: blockerId = viewer.
   *
   * ⚠️ CỐ Ý KHÔNG dùng `blockedUserIds()` / `getBlockedUserIds` ở đây. Hai hàm
   * đó trả quan hệ HAI CHIỀU (gồm cả người đã chặn viewer) để LỌC FEED. Nút
   * Chặn ↔ Bỏ chặn ở C1b cần đúng một câu hỏi hẹp hơn: "viewer có row block LÊN
   * người này không". Trả true cho người-chặn-viewer sẽ hiện nút "Bỏ chặn" dẫn
   * tới unblock rỗng (`social.service.ts:124` catch P2025 → false). Đây là loader
   * phụ thuộc viewer nên đi qua `perViewer`, cùng khuôn `buildIsFollowedByLoader`.
   */
  buildIsBlockedByViewerLoader(currentUserId: string): DataLoader<string, boolean> {
    return this.perViewer('isBlockedByViewer', currentUserId, () =>
      new DataLoader<string, boolean>(async (userIds) => {
        const blocks = await this.prisma.blockedUser.findMany({
          where: {
            blockerId: currentUserId,
            blockedId: { in: [...userIds] },
          },
          select: { blockedId: true },
        });
        return mapExists(userIds, blocks, (b) => b.blockedId);
      }),
    );
  }

  // ─── Is Saved By Viewer Loader (Đợt 3c) ───────────────────────────────────

  /**
   * "Viewer đã lưu những pin này chưa?"
   *
   * ⚠️ PHẢI `findMany` + Set, TUYỆT ĐỐI KHÔNG `findUnique`. `SavedPin` có
   * `@@unique([userId, pinId, boardId])` với `boardId` NULLABLE
   * (schema.prisma:290,301), nên một người có thể có NHIỀU dòng cho cùng một
   * pin: mỗi board một dòng, cộng thêm một dòng `boardId = null` khi lưu thẳng
   * vào profile. Khoá "unique" đó không định danh được một dòng khi chỉ biết
   * (userId, pinId) ⇒ `findUnique` không dùng được ở đây.
   *
   * Đây không phải suy đoán từ schema: `boards.service.ts:257` đã phải né đúng
   * ràng buộc này bằng `findFirst` thay vì `findUnique` trong code đang chạy.
   *
   * `mapExists` gom kết quả vào `Set` nên nhiều dòng trùng pinId là vô hại —
   * "có mặt" vẫn là "có mặt". Chọn helper này chính vì nó chịu được trùng lặp.
   */
  buildIsSavedByViewerLoader(currentUserId: string): DataLoader<string, boolean> {
    return this.perViewer('isSavedByViewer', currentUserId, () =>
      new DataLoader<string, boolean>(async (pinIds) => {
        const saved = await this.prisma.savedPin.findMany({
          where: {
            userId: currentUserId,
            pinId: { in: [...pinIds] },
          },
          select: { pinId: true },
        });
        return mapExists(pinIds, saved, (s) => s.pinId);
      }),
    );
  }

  // ─── Viewer Reaction Loader (Đợt 3c) ──────────────────────────────────────

  /**
   * "Viewer đã thả reaction gì trên những pin này?" — `null` nếu chưa thả.
   *
   * Ở đây `mapValues` (map 1-1) là ĐÚNG, ngược với loader saved ngay trên:
   * `Reaction` có `@@unique([userId, pinId])` KHÔNG kèm cột nullable nào
   * (schema.prisma:316) ⇒ mỗi cặp (user, pin) tối đa một dòng. Hai model nghe
   * giống nhau nhưng ràng buộc khác nhau, và chính chỗ khác đó quyết định hình
   * dạng loader — đừng chép qua lại.
   *
   * `mapValues` trả về nguyên dòng, nên phải rút lấy `type`; `?? null` giữ đúng
   * hợp đồng độ dài của DataLoader (`undefined` sẽ bị hiểu là lỗi).
   */
  buildViewerReactionLoader(
    currentUserId: string,
  ): DataLoader<string, ReactionType | null> {
    return this.perViewer('viewerReaction', currentUserId, () =>
      new DataLoader<string, ReactionType | null>(async (pinIds) => {
        const reactions = await this.prisma.reaction.findMany({
          where: {
            userId: currentUserId,
            pinId: { in: [...pinIds] },
          },
          select: { pinId: true, type: true },
        });
        return mapValues(pinIds, reactions, (r) => r.pinId).map(
          (r) => r?.type ?? null,
        );
      }),
    );
  }

  // ─── Is Reacted By Viewer Loader — COMMENT (Đợt 4) ────────────────────────

  /**
   * "Viewer đã thả reaction lên những comment này chưa?" — key là COMMENT id.
   *
   * `mapExists` (boolean) là đủ, KHÔNG cần map 1-1 như `buildViewerReactionLoader`
   * của Pin: `CommentReaction` có `@@unique([userId, commentId])` không kèm cột
   * nullable nào (`schema.prisma:351`) ⇒ tối đa 1 dòng cho mỗi cặp, và field
   * GraphQL tương ứng chỉ là `Boolean` chứ không phải enum. Nếu về sau thêm
   * `Comment.viewerReaction` cho đối xứng với Pin thì mới cần `mapValues`.
   *
   * ⚠️ TÊN TRONG `perViewer` PHẢI KHÁC MỌI LOADER CỦA PIN. Khoá cache là
   * `${name}:${viewerId}` (`:68`), nên trùng tên với một loader nhận PIN id sẽ
   * khiến hai bên dùng chung một instance DataLoader — nó sẽ gom lẫn comment id
   * và pin id vào một hàng đợi, trả kết quả trông vẫn là Boolean hợp lệ. Đó
   * đúng là kiểu hỏng mà `name` sinh ra để chặn (xem chú thích ở `perViewer`).
   */
  buildCommentIsReactedByViewerLoader(
    currentUserId: string,
  ): DataLoader<string, boolean> {
    return this.perViewer('commentIsReactedByViewer', currentUserId, () =>
      new DataLoader<string, boolean>(async (commentIds) => {
        const reactions = await this.prisma.commentReaction.findMany({
          where: {
            userId: currentUserId,
            commentId: { in: [...commentIds] },
          },
          select: { commentId: true },
        });
        return mapExists(commentIds, reactions, (r) => r.commentId);
      }),
    );
  }

  // ─── Phase 2.2 Board Dataloaders ─────────────────────────────────────────

  private _sectionsByBoardIdLoader?: DataLoader<string, any[]>;
  get sectionsByBoardIdLoader(): DataLoader<string, any[]> {
    if (!this._sectionsByBoardIdLoader) {
      this._sectionsByBoardIdLoader = new DataLoader<string, any[]>(
        async (boardIds) => {
          const sections = await this.prisma.boardSection.findMany({
            where: { boardId: { in: [...boardIds] } },
            orderBy: { sortOrder: 'asc' },
          });

          // Group by boardId — groupRows giữ nguyên thứ tự query trả về, nên
          // `orderBy: sortOrder` ở trên vẫn còn hiệu lực trong từng board.
          return groupRows(boardIds, sections, (sec) => sec.boardId);
        },
      );
    }
    return this._sectionsByBoardIdLoader;
  }

  private _collaboratorsByBoardIdLoader?: DataLoader<string, any[]>;
  get collaboratorsByBoardIdLoader(): DataLoader<string, any[]> {
    if (!this._collaboratorsByBoardIdLoader) {
      this._collaboratorsByBoardIdLoader = new DataLoader<string, any[]>(
        async (boardIds) => {
          const collabs = await this.prisma.boardCollaborator.findMany({
            where: { boardId: { in: [...boardIds] } },
            include: { user: true }, // Nạp kèm user luôn nếu cần
          });

          return groupRows(boardIds, collabs, (c) => c.boardId);
        },
      );
    }
    return this._collaboratorsByBoardIdLoader;
  }

  // ─── Taxonomy loaders (Đợt 6) ─────────────────────────────────────────────
  //
  // ⚠️ KHÔNG BỌC `perViewer`. Tag và category của một pin là thuộc tính của
  // chính pin đó — mọi người xem đều thấy y hệt nhau. Bọc `perViewer` sẽ nhân
  // số instance loader lên theo số viewer mà không đổi được một giá trị nào,
  // tức là phá batch để đổi lấy đúng con số không.
  //
  // ⚠️ KHÔNG DÙNG `groupRows` Ở ĐÂY, dù đây là quan hệ 1-nhiều. `groupRows`
  // nhận một danh sách dòng CON PHẲNG rồi gom về từng key cha (đúng cho
  // `BoardSection`: mỗi dòng section tự mang `boardId`). Câu query dưới đây trả
  // về một hình dạng KHÁC HẲN: mỗi dòng là một `Pin` đã CHỨA SẴN mảng con.
  // Việc gom nhóm đã do Prisma làm xong, phần còn lại chỉ là sắp đúng thứ tự
  // `pinIds` — nên là `map`, không phải `groupRows`. Ép dùng `groupRows` thì
  // phải đi từ phía `Tag` với `where: { pins: { some: { id: { in } } } }`, và
  // khi đó lại mất thông tin dòng nào thuộc pin nào.
  //
  // Đo được: `select` lồng quan hệ m2m sinh 2 câu SQL (một cho `Pin`, một cho
  // `Tag` JOIN bảng nối) — HẰNG SỐ theo kích thước trang, đúng thứ `assertBatched`
  // đo. Bằng chứng của loader không phải con số tuyệt đối mà là tính bất biến.

  private _tagsByPinIdLoader?: DataLoader<string, any[]>;
  get tagsByPinIdLoader(): DataLoader<string, any[]> {
    if (!this._tagsByPinIdLoader) {
      this._tagsByPinIdLoader = new DataLoader<string, any[]>(async (pinIds) => {
        const rows = await this.prisma.pin.findMany({
          where: { id: { in: [...pinIds] } },
          select: {
            id: true,
            // `orderBy` để thứ tự tag ổn định giữa hai lần gọi. Không có nó,
            // Postgres được phép trả về thứ tự khác nhau cho cùng một pin và
            // phép kiểm đối chiếu danh sách sẽ đỏ ngẫu nhiên — loại flake tốn
            // nhiều giờ nhất để truy vì nó không tái lập theo yêu cầu.
            tags: { select: { id: true, name: true }, orderBy: { name: 'asc' } },
          },
        });

        const byPinId = new Map(rows.map((row) => [row.id, row.tags]));
        // Pin không có dòng nào ⇒ `[]`, KHÔNG phải `null`: `Pin.tags` khai là
        // `[Tag!]!` nên `null` sẽ ném lỗi non-nullable ngay tại runtime. Cùng
        // hợp đồng với `groupRows`.
        return pinIds.map((id) => byPinId.get(id) ?? []);
      });
    }
    return this._tagsByPinIdLoader;
  }

  private _categoriesByPinIdLoader?: DataLoader<string, any[]>;
  get categoriesByPinIdLoader(): DataLoader<string, any[]> {
    if (!this._categoriesByPinIdLoader) {
      this._categoriesByPinIdLoader = new DataLoader<string, any[]>(async (pinIds) => {
        const rows = await this.prisma.pin.findMany({
          where: { id: { in: [...pinIds] } },
          select: {
            id: true,
            categories: {
              select: { id: true, name: true, slug: true, icon: true },
              orderBy: { slug: 'asc' },
            },
          },
        });

        const byPinId = new Map(rows.map((row) => [row.id, row.categories]));
        return pinIds.map((id) => byPinId.get(id) ?? []);
      });
    }
    return this._categoriesByPinIdLoader;
  }

  private _pinCountByBoardIdLoader?: DataLoader<string, number>;
  get pinCountByBoardIdLoader(): DataLoader<string, number> {
    if (!this._pinCountByBoardIdLoader) {
      this._pinCountByBoardIdLoader = new DataLoader<string, number>(
        async (boardIds): Promise<number[]> => {
          const counts = await this.prisma.savedPin.groupBy({
            by: ['boardId'],
            where: { boardId: { in: [...boardIds] } },
            _count: { boardId: true },
          });

          // `SavedPin.boardId` NULLABLE (pin đã lưu nhưng chưa xếp board) ⇒
          // Prisma có thể trả về một nhóm key = null. mapCounts bỏ qua nhóm đó,
          // giữ đúng hành vi bản viết tay trước đây.
          return mapCounts(boardIds, counts, 'boardId');
        },
      );
    }
    return this._pinCountByBoardIdLoader;
  }

  private _pinByIdLoader?: DataLoader<string, any>;
  get pinByIdLoader(): DataLoader<string, any> {
    if (!this._pinByIdLoader) {
      this._pinByIdLoader = new DataLoader<string, any>(async (pinIds) => {
        // Cố ý KHÔNG lọc `deletedAt` ở đây — Prisma middleware đã lọc soft-delete
        // toàn cục. Thêm điều kiện vào đây là nhân đôi một quy tắc đang sống ở
        // chỗ khác, và sẽ lệch âm thầm nếu middleware đổi.
        const pins = await this.prisma.pin.findMany({
          where: { id: { in: [...pinIds] } },
        });

        return mapValues(pinIds, pins, (p) => p.id);
      });
    }
    return this._pinByIdLoader;
  }
}
