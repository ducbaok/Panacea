import { Injectable, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CursorPaginationArgs, encodeCursor, decodeCursor } from '../common/pagination';
import { Prisma, NotificationType } from '@antigravity/database';
import { NotificationsService } from '../notifications/notifications.service';

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
}
