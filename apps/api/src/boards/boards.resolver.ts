import { Resolver, Query, Mutation, Args, ResolveField, Parent, ID, Int } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { Board, PaginatedBoards } from './entities/board.entity';
import { BoardSection } from './entities/board-section.entity';
import { SavedPin, PaginatedSavedPins } from './entities/saved-pin.entity';
import { BoardCollaborator, CollaboratorRole } from './entities/board-collaborator.entity';
import { BoardsService } from './boards.service';
import { CreateBoardInput } from './dto/create-board.input';
import { UpdateBoardInput } from './dto/update-board.input';
import { CreateSectionInput, UpdateSectionInput } from './dto/create-section.input';
import { SavePinInput } from './dto/save-pin.input';
import { GqlAuthGuard, GqlOptionalAuthGuard } from '../auth/guards/gql-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/strategies/jwt.strategy';
import { DataloaderService } from '../common/dataloader/dataloader.service';
import { User } from '../users/entities/user.entity';
import { Pin } from '../pins/entities/pin.entity';
import { BoardPinsArgs, UserBoardsArgs, UserSavedPinsArgs } from './dto/board-queries.args';

@Resolver(() => Board)
export class BoardsResolver {
  constructor(
    private readonly boardsService: BoardsService,
    private readonly dataloaderService: DataloaderService,
  ) {}

  // ─── Queries ─────────────────────────────────────────────────────────────

  // 🔴 REVIEW-1 (18/08/2026) — ba query dưới đây trước nay KHÔNG lọc người đã
  // chặn, tạo ra một mâu thuẫn quan sát được ngay trên MỘT màn hình: vào hồ sơ
  // người đã chặn thì tab "Pin" rỗng (đã lọc từ Đợt 3e) còn tab "Board" vẫn
  // đầy đủ. `blockedUserIds` là memo theo request nên ba call-site này cộng lại
  // vẫn chỉ tốn một query `BlockedUser` (phép đếm ở `65-blocking.mjs` canh việc đó).
  @Query(() => Board, { nullable: true })
  @UseGuards(GqlOptionalAuthGuard)
  async board(@Args('id', { type: () => ID }) id: string, @CurrentUser() user: AuthUser | null) {
    const blockedIds = await this.dataloaderService.blockedUserIds(user?.userId);
    return this.boardsService.getBoardById(id, user?.userId, blockedIds);
  }

  @Query(() => PaginatedBoards)
  @UseGuards(GqlOptionalAuthGuard)
  async userBoards(
    // Gộp userId + first/after vào MỘT ArgsType. Trộn @Args('userId') với
    // @Args() CursorPaginationArgs làm query luôn trả 400 — xem
    // common/pagination/cursor-pagination.ts.
    @Args() { userId, ...pagination }: UserBoardsArgs,
    @CurrentUser() user: AuthUser | null,
  ) {
    const blockedIds = await this.dataloaderService.blockedUserIds(user?.userId);
    return this.boardsService.getUserBoards(userId, pagination, user?.userId, blockedIds);
  }

  @Query(() => PaginatedSavedPins)
  @UseGuards(GqlOptionalAuthGuard)
  async boardPins(
    @Args() { boardId, sectionId, ...pagination }: BoardPinsArgs,
    @CurrentUser() user: AuthUser | null,
  ) {
    const blockedIds = await this.dataloaderService.blockedUserIds(user?.userId);
    return this.boardsService.getBoardPins(boardId, sectionId, pagination, user?.userId, blockedIds);
  }

  /**
   * REVIEW-1 (#7) — Pin ĐÃ LƯU của một người dùng.
   *
   * Vì sao query này phải sinh ra: nút "Lưu" mặc định ở thẻ pin và ở màn chi
   * tiết đều ghi `SavedPin` với `boardId = null` ("lưu vào hồ sơ"), nhưng
   * `boardPins` bắt buộc `boardId: ID!` ⇒ **mọi dòng lưu-không-board không có
   * màn nào đọc được**. Người dùng bấm Lưu, thấy nút đổi trạng thái, rồi không
   * tìm thấy pin đó ở bất kỳ đâu. Index `SavedPin @@index([userId, createdAt
   * desc])` đã có sẵn từ trước cho đúng hình dạng đọc này mà chưa ai dùng.
   */
  @Query(() => PaginatedSavedPins)
  @UseGuards(GqlOptionalAuthGuard)
  async savedPins(
    @Args() { userId, ...pagination }: UserSavedPinsArgs,
    @CurrentUser() user: AuthUser | null,
  ) {
    const blockedIds = await this.dataloaderService.blockedUserIds(user?.userId);
    return this.boardsService.getUserSavedPins(userId, pagination, user?.userId, blockedIds);
  }

  // ─── Mutations ────────────────────────────────────────────────────────────

  @Mutation(() => Board)
  @UseGuards(GqlAuthGuard)
  async createBoard(@Args('input') input: CreateBoardInput, @CurrentUser() user: AuthUser) {
    return this.boardsService.createBoard(user.userId, input);
  }

  @Mutation(() => Board)
  @UseGuards(GqlAuthGuard)
  async updateBoard(@Args('input') input: UpdateBoardInput, @CurrentUser() user: AuthUser) {
    return this.boardsService.updateBoard(user.userId, input);
  }

  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard)
  async deleteBoard(@Args('id', { type: () => ID }) id: string, @CurrentUser() user: AuthUser) {
    return this.boardsService.deleteBoard(user.userId, id);
  }

  @Mutation(() => BoardSection)
  @UseGuards(GqlAuthGuard)
  async createSection(@Args('input') input: CreateSectionInput, @CurrentUser() user: AuthUser) {
    return this.boardsService.createSection(user.userId, input.boardId, input.name);
  }

  @Mutation(() => BoardSection)
  @UseGuards(GqlAuthGuard)
  async updateSection(@Args('input') input: UpdateSectionInput, @CurrentUser() user: AuthUser) {
    return this.boardsService.updateSection(user.userId, input.id, input.name);
  }

  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard)
  async deleteSection(@Args('id', { type: () => ID }) id: string, @CurrentUser() user: AuthUser) {
    return this.boardsService.deleteSection(user.userId, id);
  }

  @Mutation(() => SavedPin)
  @UseGuards(GqlAuthGuard)
  async savePin(@Args('input') input: SavePinInput, @CurrentUser() user: AuthUser) {
    return this.boardsService.savePin(user.userId, input);
  }

  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard)
  async unsavePin(
    @Args('pinId', { type: () => ID }) pinId: string,
    @Args('boardId', { type: () => ID, nullable: true }) boardId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.boardsService.unsavePin(user.userId, pinId, boardId);
  }

  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard)
  async reorderSections(
    @Args('boardId', { type: () => ID }) boardId: string,
    @Args('sectionIds', { type: () => [ID] }) sectionIds: string[],
    @CurrentUser() user: AuthUser,
  ) {
    return this.boardsService.reorderSections(user.userId, boardId, sectionIds);
  }

  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard)
  async reorderPins(
    @Args('boardId', { type: () => ID }) boardId: string,
    @Args('pinIds', { type: () => [ID] }) pinIds: string[],
    @CurrentUser() user: AuthUser,
  ) {
    return this.boardsService.reorderPins(user.userId, boardId, pinIds);
  }

  @Mutation(() => BoardCollaborator)
  @UseGuards(GqlAuthGuard)
  async inviteCollaborator(
    @Args('boardId', { type: () => ID }) boardId: string,
    @Args('userId', { type: () => ID }) userIdToInvite: string,
    @Args('role', { type: () => CollaboratorRole }) role: CollaboratorRole,
    @CurrentUser() user: AuthUser,
  ) {
    return this.boardsService.inviteCollaborator(user.userId, boardId, userIdToInvite, role);
  }

  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard)
  async removeCollaborator(
    @Args('boardId', { type: () => ID }) boardId: string,
    @Args('userId', { type: () => ID }) userIdToRemove: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.boardsService.removeCollaborator(user.userId, boardId, userIdToRemove);
  }

  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard)
  async updateCollaboratorRole(
    @Args('boardId', { type: () => ID }) boardId: string,
    @Args('userId', { type: () => ID }) collabUserId: string,
    @Args('role', { type: () => CollaboratorRole }) role: CollaboratorRole,
    @CurrentUser() user: AuthUser,
  ) {
    return this.boardsService.updateCollaboratorRole(user.userId, boardId, collabUserId, role);
  }

  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard)
  async setBoardCover(
    @Args('boardId', { type: () => ID }) boardId: string,
    @Args('pinId', { type: () => ID }) pinId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.boardsService.setBoardCover(user.userId, boardId, pinId);
  }

  // ─── ResolveFields cho Board ──────────────────────────────────────────────

  @ResolveField('user', () => User, { nullable: true })
  async getUser(@Parent() board: Board) {
    return this.dataloaderService.userByIdLoader.load(board.userId);
  }

  @ResolveField('coverPin', () => Pin, { nullable: true })
  async getCoverPin(@Parent() board: Board) {
    if (!board.coverPinId) return null;
    return this.dataloaderService.pinByIdLoader.load(board.coverPinId);
  }

  @ResolveField('sections', () => [BoardSection])
  async getSections(@Parent() board: Board) {
    return this.dataloaderService.sectionsByBoardIdLoader.load(board.id);
  }

  @ResolveField('collaborators', () => [BoardCollaborator])
  async getCollaborators(@Parent() board: Board) {
    return this.dataloaderService.collaboratorsByBoardIdLoader.load(board.id);
  }

  @ResolveField('pinCount', () => Int)
  async getPinCount(@Parent() board: Board) {
    return this.dataloaderService.pinCountByBoardIdLoader.load(board.id);
  }
}

// ─── ResolveFields cho BoardCollaborator & SavedPin ────────────────────────

@Resolver(() => BoardCollaborator)
export class BoardCollaboratorsResolver {
  constructor(private readonly dataloaderService: DataloaderService) {}

  @ResolveField('user', () => User, { nullable: true })
  async getUser(@Parent() collab: BoardCollaborator) {
    return this.dataloaderService.userByIdLoader.load(collab.userId);
  }
}

@Resolver(() => SavedPin)
export class SavedPinsResolver {
  constructor(private readonly dataloaderService: DataloaderService) {}

  @ResolveField('pin', () => Pin, { nullable: true })
  async getPin(@Parent() savedPin: SavedPin) {
    return this.dataloaderService.pinByIdLoader.load(savedPin.pinId);
  }
}
