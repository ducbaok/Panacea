import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationType } from '@antigravity/database';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateBoardInput } from './dto/create-board.input';
import { UpdateBoardInput } from './dto/update-board.input';
import { SavePinInput } from './dto/save-pin.input';
import { CollaboratorRole } from './entities/board-collaborator.entity';
import {
  CursorPaginationArgs,
  encodeCursor,
  decodeCursor,
  CREATED_DESC,
  BOARD_PINS_KEYSET,
  keysetWhere,
  keysetOrderBy,
  keysetPage,
} from '../common/pagination';

@Injectable()
export class BoardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Tạo board mới.
   * HƯỚNG DẪN CODE LẠI:
   * 1. Đếm số lượng board của user (chưa bị xóa mềm).
   * 2. Nếu >= 200, ném BadRequestException.
   * 3. Tạo board mới.
   */
  async createBoard(userId: string, input: CreateBoardInput) {
    const count = await this.prisma.board.count({
      where: { userId, deletedAt: null },
    });
    if (count >= 200) {
      throw new BadRequestException('You can only create up to 200 boards.');
    }

    return this.prisma.board.create({
      data: {
        userId,
        name: input.name,
        description: input.description,
        isSecret: input.isSecret ?? false,
      },
    });
  }

  /**
   * Lấy chi tiết board (kèm check quyền cho secret board).
   */
  async getBoardById(boardId: string, currentUserId?: string) {
    const board = await this.prisma.board.findFirst({
      where: { id: boardId, deletedAt: null },
      include: { collaborators: true },
    });

    if (!board) throw new NotFoundException('Board not found');

    if (board.isSecret && board.userId !== currentUserId) {
      const isCollab = board.collaborators.some(c => c.userId === currentUserId);
      if (!isCollab) throw new ForbiddenException('Access denied');
    }

    return board;
  }

  /**
   * Lấy danh sách boards của user (Cursor Pagination).
   *
   * P1 Đợt 2 §3a — dùng `CREATED_DESC` qua `keysetWhere`/`keysetOrderBy`/
   * `keysetPage`. Cursor byte-identical với bản cũ (base64(`ISO|id`)) nên
   * cursor cũ vẫn giải mã đúng. Thay `cursor+skip:1` (offset) bằng WHERE
   * keyset — loại luôn cùng bẫy đã bịt ở Comments/Search P0 #6.
   */
  async getUserBoards(userId: string, pagination: CursorPaginationArgs, currentUserId?: string) {
    const isOwner = userId === currentUserId;
    const { first, after } = pagination;

    const base = {
      userId,
      deletedAt: null,
      ...(isOwner ? {} : { isSecret: false }),
    };

    const boards = await this.prisma.board.findMany({
      where: keysetWhere(CREATED_DESC, after, base) as any,
      take: first + 1,
      orderBy: keysetOrderBy(CREATED_DESC),
    });

    return keysetPage(CREATED_DESC as any, boards as any, first);
  }

  /**
   * Lấy các pins trong một board hoặc section (Cursor Pagination).
   *
   * P1 Đợt 2 §3b — dùng `BOARD_PINS_KEYSET` (3-thành-phần, hướng TRỘN
   * `sortOrder asc, createdAt desc, id desc`). Ca duy nhất helper 2-thành-phần
   * không diễn đạt được — phải khai triển từ điển.
   *
   * ⚠️ BREAKING CHANGE ỒN ÀO: cursor cũ là 2 phần (base64(ISO|id)), cursor
   * mới 3 phần (base64(sortOrder|ISO|id)). Cursor cũ đưa vào decoder mới sẽ
   * ăn `parts.length !== spec.fields.length` ⇒ `BadRequestException 400
   * "Invalid pagination cursor"`. Chấp nhận được vì chưa có client, nhưng
   * ghi vào commit message.
   *
   * ⚠️ `sortOrder` là khoá MUTABLE (`reorderPins` ghi đè) — ai đang phân
   * trang mà người khác reorder sẽ thấy lặp/thiếu. Cố hữu của keyset trên
   * khoá mutable, không sửa được — ghi tài liệu chứ đừng cố workaround.
   */
  async getBoardPins(boardId: string, sectionId: string | null | undefined, pagination: CursorPaginationArgs, currentUserId?: string) {
    await this.checkBoardAccess(boardId, currentUserId);

    const { first, after } = pagination;
    const base = {
      boardId,
      ...(sectionId ? { sectionId } : {}),
    };

    const savedPins = await this.prisma.savedPin.findMany({
      where: keysetWhere(BOARD_PINS_KEYSET, after, base) as any,
      take: first + 1,
      orderBy: keysetOrderBy(BOARD_PINS_KEYSET),
    });

    return keysetPage(BOARD_PINS_KEYSET as any, savedPins as any, first);
  }

  /**
   * Cập nhật board.
   * HƯỚNG DẪN CODE LẠI:
   * 1. Tìm board, kiểm tra quyền (owner hoặc collaborator EDITOR).
   * 2. Update field.
   */
  async updateBoard(userId: string, input: UpdateBoardInput) {
    const board = await this.prisma.board.findFirst({
      where: { id: input.id, deletedAt: null },
      include: { collaborators: true },
    });
    if (!board) throw new NotFoundException('Board not found');

    const isOwner = board.userId === userId;
    const isEditor = board.collaborators.some(c => c.userId === userId && c.role === 'EDITOR');
    
    if (!isOwner && !isEditor) {
      throw new ForbiddenException('You do not have permission to edit this board');
    }

    return this.prisma.board.update({
      where: { id: input.id },
      data: {
        ...(input.name && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.isSecret !== undefined && { isSecret: input.isSecret }),
      },
    });
  }

  /**
   * Xóa mềm board.
   */
  async deleteBoard(userId: string, boardId: string) {
    const board = await this.prisma.board.findFirst({
      where: { id: boardId, userId, deletedAt: null },
    });
    if (!board) throw new ForbiddenException('Board not found or no permission');

    await this.prisma.board.update({
      where: { id: boardId },
      data: { deletedAt: new Date() },
    });
    return true;
  }

  // ─── Sections ─────────────────────────────────────────────────────────────

  async createSection(userId: string, boardId: string, name: string) {
    // Check permission
    await this.checkBoardEditorAccess(userId, boardId);

    // Check limit
    const count = await this.prisma.boardSection.count({ where: { boardId } });
    if (count >= 50) throw new BadRequestException('Max 50 sections per board');

    return this.prisma.boardSection.create({
      data: { boardId, name, sortOrder: count },
    });
  }

  async updateSection(userId: string, sectionId: string, name: string) {
    const section = await this.prisma.boardSection.findUnique({ where: { id: sectionId } });
    if (!section) throw new NotFoundException('Section not found');

    await this.checkBoardEditorAccess(userId, section.boardId);

    return this.prisma.boardSection.update({
      where: { id: sectionId },
      data: { name },
    });
  }

  async deleteSection(userId: string, sectionId: string) {
    const section = await this.prisma.boardSection.findUnique({ where: { id: sectionId } });
    if (!section) return false;

    await this.checkBoardEditorAccess(userId, section.boardId);

    // Move saved pins to board root (sectionId = null)
    await this.prisma.savedPin.updateMany({
      where: { sectionId },
      data: { sectionId: null },
    });

    await this.prisma.boardSection.delete({ where: { id: sectionId } });
    return true;
  }

  // ─── Saved Pins ───────────────────────────────────────────────────────────

  async savePin(userId: string, input: SavePinInput) {
    if (input.boardId) {
      // Check limit 2000 pins/board
      const count = await this.prisma.savedPin.count({ where: { boardId: input.boardId } });
      if (count >= 2000) throw new BadRequestException('Max 2000 pins per board');

      // Check permission
      await this.checkBoardEditorAccess(userId, input.boardId);
    }

    // Check if pin exists
    const pin = await this.prisma.pin.findFirst({ where: { id: input.pinId, deletedAt: null } });
    if (!pin) throw new NotFoundException('Pin not found');

    // Create SavedPin. Upsert if already exists in the same board/profile.
    // Dựa theo schema: @@unique([userId, pinId, boardId]) -> nhưng boardId có thể null.
    // Nếu boardId null ta thay đổi xíu cách upsert.
    
    // Tìm max sortOrder hiện tại
    const maxSort = await this.prisma.savedPin.aggregate({
      where: { boardId: input.boardId, userId },
      _max: { sortOrder: true }
    });
    const nextOrder = (maxSort._max.sortOrder ?? -1) + 1;

    // Do schema.prisma có unique([userId, pinId, boardId]), nhưng vì prisma ko cho phép nullable trong unique key ở 1 số db, ta xử lý thủ công
    const existing = await this.prisma.savedPin.findFirst({
      where: { userId, pinId: input.pinId, boardId: input.boardId || null },
    });

    if (existing) {
      return this.prisma.savedPin.update({
        where: { id: existing.id },
        data: { sectionId: input.sectionId, note: input.note },
      });
    }

    const savedPin = await this.prisma.savedPin.create({
      data: {
        userId,
        pinId: input.pinId,
        boardId: input.boardId,
        sectionId: input.sectionId,
        note: input.note,
        sortOrder: nextOrder,
      },
    });

    // Cập nhật coverPinId cho board nếu board chưa có cover
    if (input.boardId) {
      const board = await this.prisma.board.findUnique({ where: { id: input.boardId } });
      if (board && !board.coverPinId) {
        await this.prisma.board.update({
          where: { id: board.id },
          data: { coverPinId: pin.id },
        });
      }
    }

    // --- PHASE 2.5: Gửi thông báo SAVE cho chủ nhân pin ---
    await this.notificationsService.createNotification({
      type: NotificationType.SAVE,
      actorId: userId,
      recipientId: pin.creatorId,
      pinId: pin.id,
    });

    return savedPin;
  }

  async unsavePin(userId: string, pinId: string, boardId?: string) {
    const existing = await this.prisma.savedPin.findFirst({
      where: { userId, pinId, boardId: boardId || null },
    });

    if (!existing) return false;

    if (boardId) {
      await this.checkBoardEditorAccess(userId, boardId);
    }

    await this.prisma.savedPin.delete({ where: { id: existing.id } });
    return true;
  }

  // ─── Utilities ────────────────────────────────────────────────────────────

  private async checkBoardEditorAccess(userId: string, boardId: string) {
    const board = await this.prisma.board.findFirst({
      where: { id: boardId, deletedAt: null },
      include: { collaborators: true },
    });

    if (!board) throw new NotFoundException('Board not found');

    const isOwner = board.userId === userId;
    const isEditor = board.collaborators.some(c => c.userId === userId && c.role === 'EDITOR');

    if (!isOwner && !isEditor) {
      throw new ForbiddenException('You do not have editor access to this board');
    }

    return board;
  }

  private async checkBoardAccess(boardId: string, userId?: string) {
    const board = await this.prisma.board.findFirst({
      where: { id: boardId, deletedAt: null },
      include: { collaborators: true },
    });

    if (!board) throw new NotFoundException('Board not found');

    if (board.isSecret && board.userId !== userId) {
      const isCollab = board.collaborators.some(c => c.userId === userId);
      if (!isCollab) throw new ForbiddenException('Access denied');
    }

    return board;
  }


  // ─── Reordering ───────────────────────────────────────────────────────────

  async reorderSections(userId: string, boardId: string, sectionIds: string[]) {
    await this.checkBoardEditorAccess(userId, boardId);

    // Dùng transaction để đảm bảo tính nhất quán
    const updates = sectionIds.map((id, index) =>
      this.prisma.boardSection.update({
        where: { id },
        data: { sortOrder: index },
      })
    );
    await this.prisma.$transaction(updates);
    return true;
  }

  async reorderPins(userId: string, boardId: string, pinIds: string[]) {
    await this.checkBoardEditorAccess(userId, boardId);

    const updates = pinIds.map((id, index) =>
      this.prisma.savedPin.updateMany({
        where: { pinId: id, boardId, userId },
        data: { sortOrder: index },
      })
    );
    await this.prisma.$transaction(updates);
    return true;
  }

  // ─── Collaborators ────────────────────────────────────────────────────────

  async inviteCollaborator(userId: string, boardId: string, collabUserId: string, role: CollaboratorRole) {
    // Chỉ owner mới được mời
    const board = await this.prisma.board.findFirst({ where: { id: boardId, userId, deletedAt: null } });
    if (!board) throw new ForbiddenException('Only board owner can invite collaborators');

    if (userId === collabUserId) throw new BadRequestException('Cannot invite yourself');

    return this.prisma.boardCollaborator.create({
      data: { boardId, userId: collabUserId, role },
    });
  }

  async removeCollaborator(userId: string, boardId: string, collabUserId: string) {
    const board = await this.prisma.board.findFirst({ where: { id: boardId, deletedAt: null } });
    if (!board) throw new NotFoundException('Board not found');

    // Owner có thể xóa ai cũng được, collab tự rời khỏi board cũng được
    if (board.userId !== userId && userId !== collabUserId) {
      throw new ForbiddenException('No permission to remove this collaborator');
    }

    await this.prisma.boardCollaborator.deleteMany({
      where: { boardId, userId: collabUserId },
    });
    return true;
  }

  async updateCollaboratorRole(userId: string, boardId: string, collabUserId: string, role: CollaboratorRole) {
    const board = await this.prisma.board.findFirst({ where: { id: boardId, userId, deletedAt: null } });
    if (!board) throw new ForbiddenException('Only board owner can update roles');

    // `updateMany` trả về `{ count: n }`, KHÔNG phải boolean. Resolver khai
    // @Mutation(() => Boolean) nên trả thẳng object này làm GraphQL nổ lúc
    // serialize: "Boolean cannot represent a non boolean value: { count: 1 }".
    // Lỗi thuần runtime — tsc không bắt được vì kiểu trả về của service không
    // bị ràng buộc với kiểu khai trong @Mutation().
    const { count } = await this.prisma.boardCollaborator.updateMany({
      where: { boardId, userId: collabUserId },
      data: { role },
    });

    // count === 0 nghĩa là user đó không phải collaborator của board này.
    // Không báo lỗi thì client nhận `true` và tưởng đã đổi quyền thành công.
    if (count === 0) throw new NotFoundException('User is not a collaborator of this board');

    return true;
  }

  // ─── Cover Pin ────────────────────────────────────────────────────────────

  async setBoardCover(userId: string, boardId: string, pinId: string) {
    await this.checkBoardEditorAccess(userId, boardId);

    // Check if pin is saved in this board
    const savedPin = await this.prisma.savedPin.findFirst({
      where: { boardId, pinId },
    });
    if (!savedPin) throw new BadRequestException('Pin must be saved in this board to be a cover');

    await this.prisma.board.update({
      where: { id: boardId },
      data: { coverPinId: pinId },
    });
    return true;
  }
}

