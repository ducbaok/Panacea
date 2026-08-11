import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateProfileInput } from './dto/update-profile.input';

/**
 * UsersService — user lookup operations.
 *
 * HƯỚNG DẪN CODE LẠI:
 * 1. Inject PrismaService.
 * 2. findById(userId):
 *    - Dùng prisma.user.findFirst (KHÔNG dùng findUnique) vì Prisma middleware
 *      không intercept findUnique đáng tin cậy cho soft delete.
 *    - Thêm deletedAt: null vào where clause (prep cho Phase 2.0 khi User có soft-delete).
 *    - Ném NotFoundException nếu không tìm thấy.
 * 3. findByUsername(username):
 *    - Tương tự, dùng findFirst với deletedAt: null.
 *    - Trả null nếu không thấy (không ném lỗi).
 * 4. updateProfile(userId, input):
 *    - Kiểm tra username mới: thỏa regex `^[a-z0-9_]{3,20}$`, chưa đổi trong 30 ngày, duy nhất.
 *    - Lưu `usernameChangedAt` = current date.
 *
 * LƯU Ý: Hiện tại User model chưa có trường deletedAt trong schema.
 * Khi Phase 2.0 thêm deletedAt vào User, code ở đây đã sẵn sàng.
 * Trước khi migration, Prisma sẽ tự bỏ qua field không tồn tại trong where.
 */
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Tìm user theo ID.
   *
   * HƯỚNG DẪN CODE LẠI:
   * 1. prisma.user.findFirst({ where: { id: userId } }).
   * 2. Nếu null → ném NotFoundException('User not found').
   * 3. Return user.
   */
  async findById(userId: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  /**
   * Tìm user theo username.
   *
   * HƯỚNG DẪN CODE LẠI:
   * 1. prisma.user.findFirst({ where: { username } }).
   * 2. Return user (hoặc null nếu không thấy).
   */
  async findByUsername(username: string) {
    return this.prisma.user.findFirst({ where: { username } });
  }

  /**
   * Cập nhật profile của user.
   *
   * HƯỚNG DẪN CODE LẠI:
   * 1. Gọi findById(userId) để lấy user hiện tại.
   * 2. Kiểm tra nếu input chứa username mới khác username cũ:
   *    - Regex check: `^[a-z0-9_]{3,20}$`.
   *    - Giới hạn 30 ngày: `user.usernameChangedAt` so với 30 ngày trước.
   *    - Trùng lặp check: `prisma.user.findFirst` với username và id khác userId.
   *    - Thiết lập `usernameChangedAt = new Date()`.
   * 3. Thực hiện update bằng `prisma.user.update`.
   */
  async updateProfile(userId: string, input: UpdateProfileInput) {
    const user = await this.findById(userId);

    const updateData: any = { ...input };

    if (input.username) {
      const newUsername = input.username.toLowerCase();
      if (newUsername !== user.username) {
        // Kiểm tra định dạng regex
        if (!/^[a-z0-9_]{3,20}$/.test(newUsername)) {
          throw new BadRequestException(
            'Username must be 3-20 characters long and contain only lowercase letters, numbers, and underscores',
          );
        }

        // Kiểm tra giới hạn đổi username 1 lần/30 ngày
        if (user.usernameChangedAt) {
          const thirtyDaysAgo = new Date();
          thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
          if (user.usernameChangedAt > thirtyDaysAgo) {
            throw new BadRequestException('You can only change your username once every 30 days');
          }
        }

        // Kiểm tra trùng username với user khác đang active
        const exists = await this.prisma.user.findFirst({
          where: {
            username: newUsername,
            deletedAt: null,
            id: { not: userId },
          },
        });
        if (exists) {
          throw new ConflictException('Username is already taken');
        }

        updateData.username = newUsername;
        updateData.usernameChangedAt = new Date();
      }
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: updateData,
    });
  }

  /**
   * Xóa tài khoản (soft delete).
   *
   * HƯỚNG DẪN CODE LẠI:
   * 1. Gọi findById(userId) để đảm bảo user tồn tại.
   * 2. Soft delete: SET deletedAt = new Date().
   * 3. Xóa tất cả RefreshToken của user (logout toàn bộ thiết bị).
   * 4. Return true.
   *
   * LƯU Ý: User bị soft delete sẽ tự động bị filter bởi Prisma middleware.
   * Hard delete sau 30 ngày sẽ được xử lý bởi cron job (v2).
   */
  async deleteAccount(userId: string): Promise<boolean> {
    // Verify user exists
    await this.findById(userId);

    // Soft delete user
    await this.prisma.user.update({
      where: { id: userId },
      data: { deletedAt: new Date() },
    });

    // Revoke all refresh tokens (logout from all devices)
    await this.prisma.refreshToken.deleteMany({
      where: { userId },
    });

    return true;
  }
}

