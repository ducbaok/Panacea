import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { GqlExecutionContext } from '@nestjs/graphql';
import type { AuthUser } from '../strategies/jwt.strategy';

/**
 * Guard dùng cho GraphQL resolvers.
 * Cần override getRequest() vì GraphQL context khác REST.
 */
@Injectable()
export class GqlAuthGuard extends AuthGuard('jwt') {
  getRequest(context: ExecutionContext) {
    // TODO: 
    // 1. Tạo GqlExecutionContext từ context truyền vào
    // 2. Trả về request (ctx.getContext().req)
    const ctx = GqlExecutionContext.create(context);
    return ctx.getContext().req;
  }
}

/**
 * Guard cho phép cả authenticated và unauthenticated requests.
 * Dùng cho các query public nhưng cần biết user là ai nếu đã login.
 */
@Injectable()
export class GqlOptionalAuthGuard extends AuthGuard('jwt') {
  getRequest(context: ExecutionContext) {
    // TODO: Tương tự như GqlAuthGuard
    const ctx = GqlExecutionContext.create(context);
    return ctx.getContext().req;
  }

  /**
   * Trả về user nếu có; nếu không có (hoặc lỗi) trả `null` thay vì ném 401.
   *
   * `user` do Passport truyền vào chính là giá trị `JwtStrategy.validate()`
   * trả về (kiểu `AuthUser`), hoặc `false` khi token thiếu/sai/hết hạn.
   *
   * Signature phải giữ generic `<TUser>` để tương thích `IAuthGuard` của
   * @nestjs/passport — nên ở đây buộc phải cast. Đây là một trong số rất ít
   * chỗ `as` là chính đáng: bị ràng buộc bởi kiểu của thư viện, không phải
   * do lười khai báo. Bù lại, default `TUser = AuthUser | null` khiến mọi
   * call-site dùng guard này buộc phải check null.
   */
  handleRequest<TUser = AuthUser | null>(_err: any, user: unknown): TUser {
    return (user || null) as TUser;
  }
}
