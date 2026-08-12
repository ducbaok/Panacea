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
import { getBlockedUserIds } from '../common/blocking/blocked-users.util';

const MAX_MENTIONS_PER_COMMENT = 10;
const MENTION_REGEX = /@([a-z0-9_]{3,20})/gi;

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

    // Parse @mentions — MENTION là kênh THỨ HAI: người nhận có thể ĐÃ được báo
    // qua COMMENT/REPLY ngay trên. Vì vậy loại pin.creatorId và parent.userId
    // khỏi danh sách nhắc để không dội hai loại thông báo về CÙNG một hành động.
    await this._notifyMentions({
      actorId: userId,
      pinId,
      commentId: comment.id,
      content,
      excludeUserIds: [pin.creatorId, parent?.userId],
    });

    return comment;
  }

  async updateComment(userId: string, input: UpdateCommentInput) {
    const comment = await this.prisma.comment.findFirst({ where: { id: input.id } });
    if (!comment) throw new NotFoundException('Comment not found');
    if (comment.userId !== userId) throw new ForbiddenException('Not authorized');

    const updated = await this.prisma.comment.update({
      where: { id: input.id },
      data: { content: input.content },
    });

    // Sửa nội dung có thể ADD/REMOVE @mention. Chỉ báo cho người MỚI xuất hiện —
    // báo cả danh sách thì mỗi lần sửa chính tả là một loạt notification lặp.
    // `Notification` là nguồn sự thật duy nhất về "đã báo ai chưa"; parse lại
    // nội dung cũ có thể lệch với thực tế do đợt trước bị trần cắt hoặc bị lọc
    // block ở thời điểm đó.
    const prevMentioned = await this.prisma.notification.findMany({
      where: { type: NotificationType.MENTION, commentId: comment.id },
      select: { recipientId: true },
    });
    const alreadyNotifiedUserIds = new Set(prevMentioned.map((n) => n.recipientId));

    // pin/parent phải tra lại — comment đã tồn tại nhưng service không giữ ngữ
    // cảnh của lần create. Cùng lý do như create: bỏ chủ pin + chủ comment cha.
    const pin = await this.prisma.pin.findFirst({
      where: { id: comment.pinId },
      select: { creatorId: true },
    });
    const parent = comment.parentId
      ? await this.prisma.comment.findFirst({
          where: { id: comment.parentId },
          select: { userId: true },
        })
      : null;

    await this._notifyMentions({
      actorId: userId,
      pinId: comment.pinId,
      commentId: comment.id,
      content: input.content,
      excludeUserIds: [pin?.creatorId, parent?.userId],
      alreadyNotifiedUserIds,
    });

    return updated;
  }

  /**
   * Bóc @mention từ nội dung bình luận và tạo notification MENTION.
   *
   * Năm quyết định KHÔNG hiển nhiên trong khối này:
   *
   * 1. **`toLowerCase()` username TRƯỚC khi tra DB.** Regex có cờ `i` bóc được
   *    `@Bao` nhưng `username: { in: [...] }` là so khớp CHÍNH XÁC; username
   *    trong DB luôn thường (schema regex `^[a-z0-9_]{3,20}$` + `_generateUsername`
   *    ép lower). Không chuẩn hoá một phía ⇒ `@Bao` mãi mãi im lặng.
   *
   * 2. **Lọc block DÙNG `getBlockedUserIds` chung**, không viết nhánh lọc thứ tư.
   *    Bốn nơi khác trong app (Pins/Search/Home/Boards) đều hỏi cùng câu qua
   *    hàm này; viết nhánh riêng ở đây là mở đường cho hai nơi trả lời khác nhau
   *    cùng một câu hỏi.
   *
   * 3. **Trần 10 mention/comment**, cắt phần thừa KHÔNG ném lỗi. Ném lỗi làm
   *    mất luôn nội dung bình luận — client không đọc được validation error ở
   *    tầng mutation của Notification (nó là fire-and-forget). Cắt câm là hành
   *    vi đúng.
   *
   * 4. **`Promise.all` thay vì `for...await`.** N mention ⇒ N round-trip DB +
   *    N push tuần tự là chờ vô nghĩa — mỗi notification độc lập, không có ràng
   *    buộc thứ tự.
   *
   * 5. **`Set(...usernames.map(lower))`** để `@Bao @bao` chỉ tính 1 người. Không
   *    dedupe ở đây thì `findMany` trả 1 dòng nhưng nếu đi vòng theo `matches`
   *    sẽ tạo 2 notification trùng.
   */
  private async _notifyMentions(params: {
    actorId: string;
    pinId: string;
    commentId: string;
    content: string;
    excludeUserIds?: Array<string | null | undefined>;
    alreadyNotifiedUserIds?: Set<string>;
  }): Promise<void> {
    const matches = [...params.content.matchAll(MENTION_REGEX)];
    if (matches.length === 0) return;

    // Dedupe + lower, rồi CẮT ở 10 usernames đầu tiên. Cắt ở đây (trước khi tra
    // DB) tuân đúng nghĩa "trần 10 mention/bình luận": người dùng viết 15 @s thì
    // chỉ 10 tên đầu được xử lý, phần sau bị bỏ như thể không viết.
    const usernames = [...new Set(matches.map((m) => m[1].toLowerCase()))].slice(
      0,
      MAX_MENTIONS_PER_COMMENT,
    );

    const users = await this.prisma.user.findMany({
      where: { username: { in: usernames } },
      select: { id: true },
    });

    const excluded = new Set<string>([params.actorId]);
    for (const id of params.excludeUserIds ?? []) if (id) excluded.add(id);

    const blockedIds = new Set(await getBlockedUserIds(this.prisma, params.actorId));
    const alreadyNotified = params.alreadyNotifiedUserIds ?? new Set<string>();

    const recipients = users
      .map((u) => u.id)
      .filter(
        (id) => !excluded.has(id) && !blockedIds.has(id) && !alreadyNotified.has(id),
      );

    if (recipients.length === 0) return;

    await Promise.all(
      recipients.map((recipientId) =>
        this.notificationsService.createNotification({
          type: NotificationType.MENTION,
          actorId: params.actorId,
          recipientId,
          pinId: params.pinId,
          commentId: params.commentId,
        }),
      ),
    );
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
