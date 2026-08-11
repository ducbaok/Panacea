// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  Comments Service                                                         ║
// ║                                                                           ║
// ║  HƯỚNG DẪN CODE LẠI:                                                      ║
// ║  1. createComment:                                                        ║
// ║     - Nếu có parentId, fetch parent. Nếu parent.parentId != null => lỗi   ║
// ║       (chỉ cho phép tối đa 2 level: root -> reply).                       ║
// ║     - Lưu db (prisma.comment.create).                                     ║
// ║     - TODO Phase 2.5: Parse @mention regex `/@([a-z0-9_]{3,20})/g`        ║
// ║       và tạo Notification. Tạo NotificationType.COMMENT hoặc REPLY.       ║
// ║  2. updateComment: Cập nhật nội dung, bắt buộc owner (kiểm tra userId).   ║
// ║  3. deleteComment: Soft delete (cập nhật deletedAt = now()), owner only.  ║
// ║  4. toggleReaction:                                                       ║
// ║     - Check xem user đã react chưa (dựa vào userId + commentId).          ║
// ║     - Nếu có -> toggle (nếu cùng type thì xoá, khác type thì update).     ║
// ║     - Nếu chưa -> tạo mới.                                                ║
// ║  5. Fetch Queries:                                                        ║
// ║     - getPinComments: lấy root comments (parentId: null) kèm pagination.  ║
// ║     - getCommentReplies: lấy replies của 1 comment (parentId) kèm pagi.   ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationType } from '@antigravity/database';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateCommentInput } from './dto/create-comment.input';
import { UpdateCommentInput } from './dto/update-comment.input';
import { ToggleCommentReactionInput } from './dto/toggle-comment-reaction.input';
import {
  buildCursorFilter,
  buildCursorOrderBy,
  toPaginatedResult,
} from '../common/pagination';

@Injectable()
export class CommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async createComment(userId: string, input: CreateCommentInput) {
    const { pinId, content, parentId } = input;

    const pin = await this.prisma.pin.findFirst({ where: { id: pinId } });
    if (!pin) throw new NotFoundException('Pin not found');

    let parent: any = null;
    if (parentId) {
      parent = await this.prisma.comment.findFirst({ where: { id: parentId } });
      if (!parent) throw new NotFoundException('Parent comment not found');
      if (parent.parentId) {
        throw new BadRequestException('Cannot reply to a reply (max 2 levels allowed)');
      }
    }

    const comment = await this.prisma.comment.create({
      data: {
        content,
        pinId,
        userId,
        parentId,
      },
    });

    // --- PHASE 2.5: NOTIFICATIONS ---
    
    // Gửi thông báo COMMENT hoặc REPLY
    if (parentId && parent) {
      // Thông báo cho người sở hữu comment cha
      await this.notificationsService.createNotification({
        type: NotificationType.REPLY,
        actorId: userId,
        recipientId: parent.userId,
        pinId,
        commentId: comment.id,
      });
    } else {
      // Thông báo cho người sở hữu pin
      await this.notificationsService.createNotification({
        type: NotificationType.COMMENT,
        actorId: userId,
        recipientId: pin.creatorId,
        pinId,
        commentId: comment.id,
      });
    }

    // Parse @mentions
    const mentionRegex = /@([a-z0-9_]{3,20})/gi;
    const matches = [...content.matchAll(mentionRegex)];
    const usernames = matches.map(m => m[1]);
    
    if (usernames.length > 0) {
      // Tìm các user được nhắc đến
      const mentionedUsers = await this.prisma.user.findMany({
        where: { username: { in: usernames } },
        select: { id: true }
      });
      
      // Gửi thông báo MENTION
      for (const mentionedUser of mentionedUsers) {
        await this.notificationsService.createNotification({
          type: NotificationType.MENTION,
          actorId: userId,
          recipientId: mentionedUser.id,
          pinId,
          commentId: comment.id,
        });
      }
    }

    return comment;
  }

  async updateComment(userId: string, input: UpdateCommentInput) {
    const comment = await this.prisma.comment.findFirst({ where: { id: input.id } });
    if (!comment) throw new NotFoundException('Comment not found');
    if (comment.userId !== userId) throw new ForbiddenException('Not authorized');

    return this.prisma.comment.update({
      where: { id: input.id },
      data: { content: input.content },
    });
  }

  async deleteComment(userId: string, commentId: string) {
    const comment = await this.prisma.comment.findFirst({ where: { id: commentId } });
    if (!comment) throw new NotFoundException('Comment not found');
    if (comment.userId !== userId) throw new ForbiddenException('Not authorized');

    return this.prisma.comment.update({
      where: { id: commentId },
      data: { deletedAt: new Date() },
    });
  }

  async toggleReaction(userId: string, input: ToggleCommentReactionInput) {
    const { commentId, type } = input;

    const comment = await this.prisma.comment.findFirst({ where: { id: commentId } });
    if (!comment) throw new NotFoundException('Comment not found');

    const existingReaction = await this.prisma.commentReaction.findUnique({
      where: {
        userId_commentId: { userId, commentId },
      },
    });

    if (existingReaction) {
      if (existingReaction.type === type) {
        await this.prisma.commentReaction.delete({ where: { id: existingReaction.id } });
        return { success: true, status: 'REMOVED' };
      } else {
        await this.prisma.commentReaction.update({
          where: { id: existingReaction.id },
          data: { type },
        });
        return { success: true, status: 'UPDATED' };
      }
    } else {
      await this.prisma.commentReaction.create({
        data: { userId, commentId, type },
      });
      return { success: true, status: 'ADDED' };
    }
  }

  /**
   * Root comments của 1 pin — mới nhất trước.
   * Keyset pagination trên (createdAt DESC, id DESC). Xem giải thích đầy đủ
   * trong `common/pagination/cursor-pagination.ts`.
   */
  async getPinComments(pinId: string, limit: number, cursor?: string) {
    const comments = await this.prisma.comment.findMany({
      where: {
        pinId,
        parentId: null,
        deletedAt: null,
        ...buildCursorFilter(cursor, 'desc'),
      },
      take: limit + 1,
      orderBy: buildCursorOrderBy('desc'),
    });

    return toPaginatedResult(comments, limit);
  }

  /**
   * Replies của 1 comment — cũ nhất trước (đọc thread theo thứ tự thời gian).
   * Vì `orderBy` là ASC nên cursor filter phải dùng `gt` — `'asc'` truyền vào
   * helper lo việc đó; truyền lệch hướng sẽ khiến trang 2 trả về rỗng.
   */
  async getCommentReplies(commentId: string, limit: number, cursor?: string) {
    const comments = await this.prisma.comment.findMany({
      where: {
        parentId: commentId,
        deletedAt: null,
        ...buildCursorFilter(cursor, 'asc'),
      },
      take: limit + 1,
      orderBy: buildCursorOrderBy('asc'),
    });

    return toPaginatedResult(comments, limit);
  }
}
