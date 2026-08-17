// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  Comments Resolver                                                        ║
// ║                                                                           ║
// ║  HƯỚNG DẪN CODE LẠI:                                                      ║
// ║  1. Mutations:                                                            ║
// ║     - createComment(input): gọi service, yêu cầu CurrentUser.             ║
// ║     - updateComment(input): update theo id.                               ║
// ║     - deleteComment(id): xóa comment by id.                               ║
// ║     - toggleCommentReaction(input): like/unlike comment.                  ║
// ║  2. Queries:                                                              ║
// ║     - pinComments(pinId, limit, cursor): phân trang root comments.        ║
// ║     - commentReplies(commentId, limit, cursor): phân trang replies.       ║
// ║  3. ResolveFields (cần DataLoader):                                       ║
// ║     - user(Comment): người viết.                                          ║
// ║     - replyCount(Comment): đếm số reply con.                              ║
// ║     - reactionCount(Comment): đếm số lượt react.                          ║
// ║     - isReactedByViewer(Comment): kiểm tra đã react chưa.                 ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

import { Resolver, Mutation, Args, Query, ResolveField, Parent, Int } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { CommentsService } from './comments.service';
import { Comment, PaginatedComments } from './entities/comment.entity';
import { CreateCommentInput } from './dto/create-comment.input';
import { UpdateCommentInput } from './dto/update-comment.input';
import { ToggleCommentReactionInput } from './dto/toggle-comment-reaction.input';
import { GqlAuthGuard, GqlOptionalAuthGuard } from '../auth/guards/gql-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/strategies/jwt.strategy';
import { User } from '../users/entities/user.entity';
import { DataloaderService } from '../common/dataloader/dataloader.service';

@Resolver(() => Comment)
export class CommentsResolver {
  constructor(
    private readonly commentsService: CommentsService,
    private readonly dataloaderService: DataloaderService,
  ) {}

  // ─── Mutations ────────────────────────────────────────────────────────

  @UseGuards(GqlAuthGuard)
  @Mutation(() => Comment)
  async createComment(
    @CurrentUser() user: AuthUser,
    @Args('input') input: CreateCommentInput,
  ) {
    return this.commentsService.createComment(user.userId, input);
  }

  @UseGuards(GqlAuthGuard)
  @Mutation(() => Comment)
  async updateComment(
    @CurrentUser() user: AuthUser,
    @Args('input') input: UpdateCommentInput,
  ) {
    return this.commentsService.updateComment(user.userId, input);
  }

  @UseGuards(GqlAuthGuard)
  @Mutation(() => Comment)
  async deleteComment(
    @CurrentUser() user: AuthUser,
    @Args('id') id: string,
  ) {
    return this.commentsService.deleteComment(user.userId, id);
  }

  /**
   * B-19 (17/08/2026) — `Boolean!` → `Comment!`.
   *
   * Bốn dòng TODO trước đây ở đúng chỗ này ("let the client refetch") mô tả
   * chính cái giá phải trả: FE không có cách nào biết `reactionCount` mới ngoài
   * việc hỏi lại server. Trả `Comment` ⇒ Apollo chuẩn hoá theo `id` ⇒ cả danh
   * sách bình luận lẫn cây trả lời tự đúng, không `refetch`, không `cache.modify`.
   *
   * 🔴 Đây là breaking change ở tầng validation — mọi call site đang viết
   * `{ toggleCommentReaction(input:$i) }` phải thêm selection set.
   */
  @UseGuards(GqlAuthGuard)
  @Mutation(() => Comment)
  async toggleCommentReaction(
    @CurrentUser() user: AuthUser,
    @Args('input') input: ToggleCommentReactionInput,
  ) {
    return this.commentsService.toggleReaction(user.userId, input);
  }

  // ─── Queries ──────────────────────────────────────────────────────────

  // GqlOptionalAuthGuard cần thiết để ResolveField `isReactedByViewer` biết
  // viewer là ai. Không có guard → @CurrentUser() luôn null → luôn trả false.
  @Query(() => PaginatedComments)
  @UseGuards(GqlOptionalAuthGuard)
  async pinComments(
    @Args('pinId') pinId: string,
    @Args('first', { type: () => Int, defaultValue: 20 }) limit: number,
    @Args('after', { nullable: true }) cursor?: string,
  ) {
    return this.commentsService.getPinComments(pinId, limit, cursor);
  }

  @Query(() => PaginatedComments)
  @UseGuards(GqlOptionalAuthGuard)
  async commentReplies(
    @Args('commentId') commentId: string,
    @Args('first', { type: () => Int, defaultValue: 20 }) limit: number,
    @Args('after', { nullable: true }) cursor?: string,
  ) {
    return this.commentsService.getCommentReplies(commentId, limit, cursor);
  }

  // ─── ResolveFields ────────────────────────────────────────────────────

  @ResolveField(() => User, { nullable: true })
  async user(@Parent() comment: Comment) {
    return this.dataloaderService.userByIdLoader.load(comment.userId);
  }

  /**
   * Số reply của comment này (không tính reply đã soft-delete — phép lọc nằm
   * trong loader, vì `groupBy` KHÔNG đi qua middleware soft-delete).
   */
  @ResolveField(() => Int, { nullable: true })
  async replyCount(@Parent() comment: Comment) {
    return this.dataloaderService.replyCountByCommentIdLoader.load(comment.id);
  }

  /**
   * Tổng số reaction trên comment này, của mọi người — KHÔNG phụ thuộc viewer.
   * Cặp với `isReactedByViewer` ngay dưới: đếm là chung, cờ là riêng.
   */
  @ResolveField(() => Int, { nullable: true })
  async reactionCount(@Parent() comment: Comment) {
    return this.dataloaderService.commentReactionCountLoader.load(comment.id);
  }

  /**
   * Riêng viewer đã react comment này chưa. Khách vãng lai ⇒ `false`.
   *
   * Lối thoát sớm `if (!user)` giữ nguyên từ bản stub và vẫn cần thiết vì lý do
   * mới: nó chặn việc gọi `perViewer(name, '')`, vốn sẽ memo MỘT loader dùng
   * chung cho mọi khách vãng lai rồi query với `userId: ''` — tốn một round-trip
   * cho câu trả lời đã biết trước. Xem chú thích cùng nội dung ở
   * `pins.resolver.ts` (Đợt 3c).
   */
  @ResolveField(() => Boolean, { nullable: true })
  async isReactedByViewer(
    @Parent() comment: Comment,
    @CurrentUser() user: AuthUser | null,
  ) {
    if (!user) return false;
    return this.dataloaderService
      .buildCommentIsReactedByViewerLoader(user.userId)
      .load(comment.id);
  }
}
