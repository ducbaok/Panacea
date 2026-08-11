import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { AuthUser } from '../strategies/jwt.strategy';

/**
 * Decorator lấy current user từ GraphQL context.
 *
 * CÁCH KHAI BÁO Ở CALL-SITE — luôn annotate kiểu, KHÔNG dùng `any`:
 *
 *   @UseGuards(GqlAuthGuard)              // guard bắt buộc login
 *   foo(@CurrentUser() user: AuthUser)    // → chắc chắn có user
 *
 *   @UseGuards(GqlOptionalAuthGuard)             // guard cho phép ẩn danh
 *   bar(@CurrentUser() user: AuthUser | null)    // → buộc phải check null
 *
 * Lý do bắt buộc annotate: TypeScript không suy ra được kiểu tham số từ
 * decorator. Nếu viết `user: any` thì `user.batKyThuGi` đều hợp lệ với
 * compiler — đó chính xác là cách bug `user.id` / `user.userId` lọt lưới
 * suốt cả Phase 2. Xem LEARNING_NOTES.md mục 7.
 *
 * Trả `null` khi request không kèm token hợp lệ (guard Optional).
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser | null => {
    const ctx = GqlExecutionContext.create(context);
    return ctx.getContext().req.user ?? null;
  },
);

/**
 * Decorator lấy current user từ REST context.
 * Dùng trong REST controllers: `@CurrentUserRest() user: AuthUser`
 *
 * Mọi route REST dùng decorator này đều đứng sau `AuthGuard('jwt')` nên user
 * luôn tồn tại — nhưng kiểu vẫn để `| null` để phản ánh đúng sự thật runtime,
 * buộc call-site phải khai báo một cách có ý thức thay vì mặc định tin tưởng.
 */
export const CurrentUserRest = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser | null => {
    const request = context.switchToHttp().getRequest();
    return request.user ?? null;
  },
);
