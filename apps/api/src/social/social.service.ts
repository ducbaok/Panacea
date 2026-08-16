import { Injectable, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CursorPaginationArgs, encodeCursor, decodeCursor } from '../common/pagination';
import { Prisma, NotificationType } from '@antigravity/database';
import { NotificationsService } from '../notifications/notifications.service';
import { getBlockedUserIds } from '../common/blocking';

@Injectable()
export class SocialService {
  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
  ) {}

  /**
   * Follow a user
   *
   * HƯỚNG DẪN CODE LẠI:
   * 1. Kiểm tra followerId !== followingId (không thể tự follow).
   * 2. Gọi isBlocked() kiểm tra 2 chiều, nếu true thì chặn (throw BadRequest).
   * 3. Gọi prisma.follows.create() bọc trong try/catch.
   * 4. Nếu catch error.code === 'P2002' (đã tồn tại) thì throw ConflictException.
   */
  async follow(followerId: string, followingId: string) {
    if (followerId === followingId) {
      throw new BadRequestException('Cannot follow yourself');
    }

    const blocked = await this.isBlocked(followerId, followingId);
    if (blocked) {
      throw new BadRequestException('Cannot follow this user due to block status');
    }

    try {
      await this.prisma.follows.create({
        data: {
          followerId,
          followingId,
        },
      });

      // Gửi thông báo FOLLOW cho người được follow
      await this.notificationsService.createNotification({
        type: NotificationType.FOLLOW,
        actorId: followerId,
        recipientId: followingId,
      });

      return true;
    } catch (error: any) {
      if (error.code === 'P2002') {
        throw new ConflictException('Already following this user');
      }
      throw error;
    }
  }

  /**
   * Unfollow a user
   *
   * HƯỚNG DẪN CODE LẠI:
   * 1. Gọi prisma.follows.delete() với điều kiện where { followerId_followingId: { ... } }
   * 2. Bọc trong try/catch.
   * 3. Nếu catch error.code === 'P2025' (không tồn tại) thì return false hoặc ignore.
   * 4. Return true nếu thành công.
   */
  async unfollow(followerId: string, followingId: string) {
    try {
      await this.prisma.follows.delete({
        where: {
          followerId_followingId: { followerId, followingId },
        },
      });
      return true;
    } catch (error: any) {
      if (error.code === 'P2025') return false;
      throw error;
    }
  }

  /**
   * Block a user
   *
   * HƯỚNG DẪN CODE LẠI:
   * 1. Không thể tự block chính mình.
   * 2. Sử dụng prisma.$transaction() để đảm bảo tính toàn vẹn.
   * 3. Trong transaction:
   *    a) prisma.blockedUser.create({ blockerId, blockedId }). Catch P2002 nếu đã block (không throw).
   *    b) prisma.follows.deleteMany({ OR: [ (A follow B), (B follow A) ] }) để auto-unfollow cả 2 chiều.
   */
  async blockUser(blockerId: string, blockedId: string) {
    if (blockerId === blockedId) {
      throw new BadRequestException('Cannot block yourself');
    }

    await this.prisma.$transaction(async (tx) => {
      try {
        await tx.blockedUser.create({
          data: { blockerId, blockedId },
        });
      } catch (error: any) {
        if (error.code !== 'P2002') throw error;
      }

      await tx.follows.deleteMany({
        where: {
          OR: [
            { followerId: blockerId, followingId: blockedId },
            { followerId: blockedId, followingId: blockerId },
          ],
        },
      });
    });

    return true;
  }

  /**
   * Unblock a user
   *
   * HƯỚNG DẪN CODE LẠI:
   * 1. Gọi prisma.blockedUser.delete() với where { blockerId_blockedId: { ... } }
   * 2. Bọc trong try/catch. Catch P2025 trả về false.
   */
  async unblockUser(blockerId: string, blockedId: string) {
    try {
      await this.prisma.blockedUser.delete({
        where: {
          blockerId_blockedId: { blockerId, blockedId },
        },
      });
      return true;
    } catch (error: any) {
      if (error.code === 'P2025') return false;
      throw error;
    }
  }

  /**
   * Check if any block exists between user1 and user2
   *
   * HƯỚNG DẪN CODE LẠI:
   * 1. Tìm bản ghi trong BlockedUser bằng findFirst, dùng OR để check 2 chiều (1->2 hoặc 2->1).
   * 2. Trả về true nếu có bản ghi (!!block).
   */
  async isBlocked(userId1: string, userId2: string) {
    const block = await this.prisma.blockedUser.findFirst({
      where: {
        OR: [
          { blockerId: userId1, blockedId: userId2 },
          { blockerId: userId2, blockedId: userId1 },
        ],
      },
    });
    return !!block;
  }

  /**
   * Get Mutual Follow Status
   * Cho DM check
   *
   * HƯỚNG DẪN CODE LẠI:
   * 1. Check count của bảng follows nơi user1 follow user2 VÀ user2 follow user1.
   * 2. Trả về true nếu count === 2.
   */
  async getMutualFollowStatus(userId1: string, userId2: string) {
    const follows = await this.prisma.follows.count({
      where: {
        OR: [
          { followerId: userId1, followingId: userId2 },
          { followerId: userId2, followingId: userId1 },
        ],
      },
    });
    return follows === 2;
  }

  /**
   * Is Following
   *
   * HƯỚNG DẪN CODE LẠI:
   * 1. Tìm findUnique theo followerId_followingId.
   * 2. Return true nếu tồn tại.
   */
  async isFollowing(followerId: string, followingId: string) {
    const follow = await this.prisma.follows.findUnique({
      where: {
        followerId_followingId: { followerId, followingId },
      },
    });
    return !!follow;
  }

  /**
   * Get Followers (with Cursor Pagination)
   * Những người đang follow userId
   *
   * HƯỚNG DẪN CODE LẠI:
   * 1. Setup filter: followingId = userId.
   * 2. Nếu có currentUserId, dùng Prisma NOT EXISTS để loại trừ những người đã block/bị block với currentUserId.
   * 3. Cursor pagination: parse cursor (after), query take = first + 1, order by createdAt DESC.
   * 4. Trả về { items, pageInfo: { hasNextPage, endCursor } }.
   */
  async getFollowers(userId: string, args: CursorPaginationArgs, currentUserId?: string) {
    const { first, after } = args;

    const blockExclusion: Prisma.FollowsWhereInput = currentUserId ? {
      NOT: {
        follower: {
          OR: [
            { blockedUsers: { some: { blockedId: currentUserId } } },
            { blockedBy: { some: { blockerId: currentUserId } } }
          ]
        }
      }
    } : {};

    const where: Prisma.FollowsWhereInput = {
      followingId: userId,
      ...blockExclusion,
    };

    let cursorQuery = {};
    if (after) {
      const { createdAt, id } = decodeCursor(after);
      cursorQuery = {
        OR: [
          { createdAt: { lt: createdAt } },
          { createdAt, followerId: { lt: id } },
        ],
      };
    }

    const follows = await this.prisma.follows.findMany({
      where: { ...where, ...cursorQuery },
      take: first + 1,
      orderBy: [
        { createdAt: 'desc' },
        { followerId: 'desc' },
      ],
      include: {
        follower: true,
      },
    });

    const hasNextPage = follows.length > first;
    if (hasNextPage) follows.pop();

    const items = follows.map(f => f.follower);
    
    let endCursor: string | null = null;
    if (items.length > 0) {
      const last = follows[follows.length - 1];
      endCursor = encodeCursor(last.createdAt, last.followerId);
    }

    return {
      items,
      pageInfo: {
        hasNextPage,
        endCursor,
      },
    };
  }

  /**
   * Get Following (with Cursor Pagination)
   * Những người userId đang follow
   *
   * HƯỚNG DẪN CODE LẠI:
   * 1. Filter: followerId = userId.
   * 2. Logic tương tự getFollowers nhưng include following (người được follow) thay vì follower.
   * 3. Pagination tương tự.
   */
  async getFollowing(userId: string, args: CursorPaginationArgs, currentUserId?: string) {
    const { first, after } = args;

    const blockExclusion: Prisma.FollowsWhereInput = currentUserId ? {
      NOT: {
        following: {
          OR: [
            { blockedUsers: { some: { blockedId: currentUserId } } },
            { blockedBy: { some: { blockerId: currentUserId } } }
          ]
        }
      }
    } : {};

    const where: Prisma.FollowsWhereInput = {
      followerId: userId,
      ...blockExclusion,
    };

    let cursorQuery = {};
    if (after) {
      const { createdAt, id } = decodeCursor(after);
      cursorQuery = {
        OR: [
          { createdAt: { lt: createdAt } },
          { createdAt, followingId: { lt: id } },
        ],
      };
    }

    const follows = await this.prisma.follows.findMany({
      where: { ...where, ...cursorQuery },
      take: first + 1,
      orderBy: [
        { createdAt: 'desc' },
        { followingId: 'desc' },
      ],
      include: {
        following: true,
      },
    });

    const hasNextPage = follows.length > first;
    if (hasNextPage) follows.pop();

    const items = follows.map(f => f.following);

    let endCursor: string | null = null;
    if (items.length > 0) {
      const last = follows[follows.length - 1];
      endCursor = encodeCursor(last.createdAt, last.followingId);
    }

    return {
      items,
      pageInfo: {
        hasNextPage,
        endCursor,
      },
    };
  }

  /**
   * Get Blocked Users (Cursor Pagination) — người mà `blockerId` ĐÃ CHẶN.
   * Nguồn dữ liệu cho C2b "Người đã chặn" (QĐ-7 / FE-6).
   *
   * MỘT CHIỀU CÓ CHỦ ĐÍCH: chỉ `blockerId = <viewer>`, KHÔNG phải quan hệ hai
   * chiều của `getBlockedUserIds`. Danh sách này để viewer BỎ CHẶN, nên chỉ được
   * chứa người viewer tự chặn; nhét thêm "người chặn viewer" vào đây sẽ cho ra
   * nút Bỏ chặn không có row để xoá.
   *
   * Cursor mirror đúng getFollowers/getFollowing: keyset (createdAt DESC,
   * blockedId DESC). `blockedId` là tie-breaker hợp lệ vì @@unique[blockerId,
   * blockedId] + blockerId cố định ⇒ blockedId duy nhất trong tập block của tôi.
   */
  async getBlockedUsers(blockerId: string, args: CursorPaginationArgs) {
    const { first, after } = args;

    let cursorQuery = {};
    if (after) {
      const { createdAt, id } = decodeCursor(after);
      cursorQuery = {
        OR: [
          { createdAt: { lt: createdAt } },
          { createdAt, blockedId: { lt: id } },
        ],
      };
    }

    const blocks = await this.prisma.blockedUser.findMany({
      where: { blockerId, ...cursorQuery },
      take: first + 1,
      orderBy: [
        { createdAt: 'desc' },
        { blockedId: 'desc' },
      ],
      include: {
        blocked: true,
      },
    });

    const hasNextPage = blocks.length > first;
    if (hasNextPage) blocks.pop();

    const items = blocks.map(b => b.blocked);

    let endCursor: string | null = null;
    if (items.length > 0) {
      const last = blocks[blocks.length - 1];
      endCursor = encodeCursor(last.createdAt, last.blockedId);
    }

    return {
      items,
      pageInfo: {
        hasNextPage,
        endCursor,
      },
    };
  }

  /**
   * Suggested users (B-12) — nguồn cho khối "gợi ý người theo dõi" ở B1.
   *
   * Xếp hạng theo BẠN-CỦA-BẠN: người được nhiều người mà tôi đang follow theo
   * dõi (mutual follows) lên trước. Loại khỏi kết quả 3 nhóm (§6b.2):
   *   - chính mình
   *   - người tôi đã follow (gợi ý follow lại là vô nghĩa)
   *   - người bị chặn HAI CHIỀU — dùng lại `getBlockedUserIds`, đúng chỗ cho
   *     bản hai chiều: không gợi ý cả người tôi chặn lẫn người chặn tôi.
   *
   * 🔴 BACKFILL BẮT BUỘC, KHÔNG PHẢI TÔ ĐIỂM. Khối gợi ý B1 hiện đúng cho người
   * MỚI (follow 0 người) — mà mutual-follows cho tài khoản đó luôn RỖNG (không có
   * cạnh f1 nào). Không backfill thì đúng đối tượng cần gợi ý nhất lại thấy khối
   * trống. Backfill = người nhiều follower nhất, cùng bộ loại trừ.
   *
   * QĐ-9 (co lại/ẩn khi < 3) là việc của FRONTEND — ở đây chỉ trả tối đa `limit`
   * người, có thể ít hơn nếu DB không đủ.
   */
  async getSuggestedUsers(viewerId: string, limit: number) {
    const following = await this.prisma.follows.findMany({
      where: { followerId: viewerId },
      select: { followingId: true },
    });
    const followingIds = following.map((f) => f.followingId);
    const blockedIds = await getBlockedUserIds(this.prisma, viewerId);
    const excluded = [viewerId, ...followingIds, ...blockedIds];

    // ── Ứng viên 1: bạn-của-bạn, xếp theo số mutual giảm dần ──
    let candidateIds: string[] = [];
    if (followingIds.length > 0) {
      const rows = await this.prisma.follows.groupBy({
        by: ['followingId'],
        where: {
          followerId: { in: followingIds },
          followingId: { notIn: excluded },
        },
        _count: { followingId: true },
        orderBy: { _count: { followingId: 'desc' } },
        take: limit,
      });
      candidateIds = rows.map((r) => r.followingId);
    }

    // Nạp User đầy đủ, GIỮ đúng thứ tự xếp hạng. `findMany` đi qua middleware
    // soft-delete nên user đã xoá bị loại tại đây (groupBy không lọc được).
    const result: any[] = [];
    if (candidateIds.length > 0) {
      const users = await this.prisma.user.findMany({ where: { id: { in: candidateIds } } });
      const byId = new Map(users.map((u) => [u.id, u]));
      for (const id of candidateIds) {
        const u = byId.get(id);
        if (u) result.push(u);
      }
    }

    // ── Backfill: người nhiều follower nhất, cùng bộ loại trừ + đã lấy ──
    if (result.length < limit) {
      const already = [...excluded, ...result.map((u) => u.id)];
      const popular = await this.prisma.user.findMany({
        where: { id: { notIn: already } },
        orderBy: [{ followedBy: { _count: 'desc' } }, { createdAt: 'desc' }],
        take: limit - result.length,
      });
      result.push(...popular);
    }

    return result;
  }
}
