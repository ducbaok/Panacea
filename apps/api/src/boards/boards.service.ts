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
// XH-2 (21/08/2026) — board là bề mặt rò rỉ số 5 trong PLAN_XAHOI.md §3:
// `isSecret` SỬA ĐƯỢC qua updateBoard, nên "chỉ lưu vào board riêng tư"
// (XH-QĐ-4) là rào chắn UX chứ không phải ranh giới an toàn — đường ĐỌC vẫn
// phải lọc.
import { visiblePinWhere, isPinVisibleInCtx, GUEST_AUDIENCE_CTX } from '../common/blocking';
import type { PinAudienceCtx } from '../common/blocking';

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
  async getBoardById(boardId: string, currentUserId?: string, blockedIds: string[] = []) {
    const board = await this.prisma.board.findFirst({
      where: { id: boardId, deletedAt: null },
      include: { collaborators: true },
    });

    if (!board) throw new NotFoundException('Board not found');

    // REVIEW-1 — board của người đã chặn (hai chiều) phải trông như KHÔNG TỒN
    // TẠI, không phải "bị cấm". Dùng đúng 404 như `pins.service.findById`:
    // 403 tự nó là một tín hiệu rò rỉ ("có board thật ở đây, bạn không được xem").
    if (blockedIds.includes(board.userId)) throw new NotFoundException('Board not found');

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
  async getUserBoards(
    userId: string,
    pagination: CursorPaginationArgs,
    currentUserId?: string,
    blockedIds: string[] = [],
  ) {
    const isOwner = userId === currentUserId;
    const { first, after } = pagination;

    // REVIEW-1 — chặn hai chiều: trang RỖNG, không phải 403. Cùng hình dạng
    // `pins.service.getUserPins` đã chọn từ Đợt 3e, để hai tab của cùng một hồ
    // sơ không mâu thuẫn nhau (tab Pin rỗng còn tab Board đầy là bug cũ).
    if (blockedIds.includes(userId)) {
      return keysetPage(CREATED_DESC as any, [], first);
    }

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
  async getBoardPins(
    boardId: string,
    sectionId: string | null | undefined,
    pagination: CursorPaginationArgs,
    currentUserId?: string,
    blockedIds: string[] = [],
    audienceCtx: PinAudienceCtx = GUEST_AUDIENCE_CTX,
  ) {
    await this.checkBoardAccess(boardId, currentUserId);

    const { first, after } = pagination;
    const base = {
      boardId,
      ...(sectionId ? { sectionId } : {}),
      // REVIEW-1 — board là một đường vòng để pin của người đã chặn lọt vào
      // mắt viewer (ai cũng lưu được pin của bất kỳ ai vào board của mình).
      // Lọc theo creator của pin, không phải theo chủ board.
      //
      // XH-2 — cùng đường vòng đó cho pin giới hạn: lưu vào board bí mật rồi
      // LẬT board thành công khai (bẫy 5). Lọc khán giả LÚC ĐỌC, trong SQL
      // (relation filter một-một, không phá keyset 3 thành phần).
      pin: {
        ...(blockedIds.length ? { creatorId: { notIn: blockedIds } } : {}),
        AND: [visiblePinWhere(audienceCtx)],
      },
    };

    const savedPins = await this.prisma.savedPin.findMany({
      where: keysetWhere(BOARD_PINS_KEYSET, after, base) as any,
      take: first + 1,
      orderBy: keysetOrderBy(BOARD_PINS_KEYSET),
    });

    return keysetPage(BOARD_PINS_KEYSET as any, savedPins as any, first);
  }

  /**
   * REVIEW-1 (#7) — Pin ĐÃ LƯU của một người dùng, mới nhất trước.
   *
   * Khác `getBoardPins` ở chỗ **không đi qua board**: nó đọc thẳng `SavedPin`
   * theo `userId`, nên bao gồm cả những dòng `boardId = null` do nút "Lưu"
   * mặc định sinh ra — nhóm dòng trước nay không màn nào đọc được.
   *
   * Bốn mệnh đề lọc, mỗi cái chặn một thứ khác nhau:
   *   1. `pin.deletedAt: null` — phải ghi TƯỜNG MINH. Middleware soft-delete
   *      của Prisma không đi vào relation filter, nên thiếu dòng này thì pin
   *      đã xoá vẫn hiện qua đường `SavedPin` (cùng bẫy đã ghi ở
   *      `dataloader.service.ts` cho `replyCountByCommentIdLoader`).
   *   2. `pin.creatorId notIn blockedIds` — BR-17, hai chiều.
   *   3. `boardId: null` HOẶC board còn sống và (chủ xem / board không bí mật)
   *      — người khác không được nhìn thấy pin bạn lưu vào board bí mật, còn
   *      chính bạn thì phải thấy đủ.
   *   4. Chủ hồ sơ bị chặn ⇒ trang rỗng (khuôn `getUserBoards`).
   *
   * ⚠️ KHÔNG dedupe ở đây: một pin lưu vào N board là N dòng `SavedPin`
   * (`@@unique([userId, pinId, boardId])`). Dedupe server-side đòi `DISTINCT
   * ON` raw SQL, phá khuôn keyset dùng chung toàn dự án. FE gộp theo `pin.id`
   * — hệ quả: một trang có thể hiển thị ít hơn `first` thẻ. Ghi ở B-21.
   */
  async getUserSavedPins(
    userId: string,
    pagination: CursorPaginationArgs,
    currentUserId?: string,
    blockedIds: string[] = [],
    audienceCtx: PinAudienceCtx = GUEST_AUDIENCE_CTX,
  ) {
    const { first, after } = pagination;

    if (blockedIds.includes(userId)) {
      return keysetPage(CREATED_DESC as any, [], first);
    }

    const isOwner = userId === currentUserId;

    const base = {
      userId,
      pin: {
        deletedAt: null,
        ...(blockedIds.length ? { creatorId: { notIn: blockedIds } } : {}),
        // XH-2 — "lưu không board" (boardId=null) là cửa sau đi vòng XH-QĐ-4
        // (luật §4.6): mệnh đề OR bên dưới không che được nó, bộ lọc khán giả
        // trên chính pin mới che.
        AND: [visiblePinWhere(audienceCtx)],
      },
      OR: [
        { boardId: null },
        { board: { deletedAt: null, ...(isOwner ? {} : { isSecret: false }) } },
      ],
    };

    const savedPins = await this.prisma.savedPin.findMany({
      where: keysetWhere(CREATED_DESC, after, base) as any,
      take: first + 1,
      orderBy: keysetOrderBy(CREATED_DESC),
    });

    return keysetPage(CREATED_DESC as any, savedPins as any, first);
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

  async savePin(userId: string, input: SavePinInput, audienceCtx: PinAudienceCtx = GUEST_AUDIENCE_CTX) {
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

    // XH-2 — người lưu phải THẤY được pin đã: pin ngoài khán giả 404 y như
    // không tồn tại (chính chủ đi qua, kể cả pin trong kho).
    if (pin.creatorId !== userId && !isPinVisibleInCtx(pin, audienceCtx)) {
      throw new NotFoundException('Pin not found');
    }

    // XH-QĐ-4 + luật §4.6 (PLAN_XAHOI.md) — pin giới hạn CHỈ lưu được vào board
    // BÍ MẬT của CHÍNH người lưu. Chặn cả "lưu không board" (boardId=null): đó
    // là cửa sau đi vòng qua luật. Đây là RÀO CHẮN UX (lỗi ồn ào, người lưu vốn
    // đã thấy pin nên không có gì để che) — ranh giới an toàn thật nằm ở bộ lọc
    // đường đọc (getBoardPins/getUserSavedPins), vì isSecret lật được qua
    // updateBoard (bẫy 5).
    if (pin.visibility !== 'PUBLIC') {
      const restrictedMsg = 'Restricted pins can only be saved to your own secret board';
      if (!input.boardId) throw new BadRequestException(restrictedMsg);
      const board = await this.prisma.board.findFirst({
        where: { id: input.boardId, deletedAt: null },
      });
      if (!board || board.userId !== userId || !board.isSecret) {
        throw new BadRequestException(restrictedMsg);
      }
    }

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

