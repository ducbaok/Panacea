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

  // ─── B-7: Onboarding ────────────────────────────────────────────────────────
  //
  // ╔═══════════════════════════════════════════════════════════════════════════╗
  // ║  QUYẾT ĐỊNH ĐÃ CHỐT VỚI USER 17/08/2026 (nghiệm thu bundle onboarding):  ║
  // ║   • Q1 = b  — mục tiêu ON-2 KHÔNG lưu DB, chỉ điều hướng trong phiên     ║
  // ║               ⇒ 0 việc backend cho bước đó                              ║
  // ║   • Q2 = 3  — backend enforce **≥ 3 category**                          ║
  // ║   • Q4      — chỉ tài khoản đăng ký mới vào luồng; seed `isOnboarded`=true║
  // ║   • Đ2a     — **2 mutation riêng**, không gộp: `updateMyCategories` +    ║
  // ║               `completeOnboarding`                                       ║
  // ║   • Đ7a     — `Category.name` sang tiếng Việt, **GIỮ `slug` tiếng Anh**  ║
  // ║                                                                          ║
  // ║  📌 ĐÍNH CHÍNH tài liệu (đo 17/08): `PLAN_HOAN_THIEN.md` §B-7 từng ghi   ║
  // ║  *"hôm nay `isOnboarded` chỉ đổi được qua `updateProfile`"* — **SAI**.   ║
  // ║  `UpdateProfileInput` không có field đó, nên trước đợt này **KHÔNG có   ║
  // ║  đường nào** đổi được `isOnboarded` từ API.                             ║
  // ╚═══════════════════════════════════════════════════════════════════════════╝

  /**
   * Số category tối thiểu người dùng phải chọn (Q2).
   *
   * ⚠️ Hai chuỗi lỗi dưới đây là **HỢP ĐỒNG NGUYÊN VĂN** với frontend (QĐ-8:
   * backend giữ tiếng Anh, FE ánh xạ sang tiếng Việt theo đúng chuỗi). Đổi một
   * chữ là gãy ánh xạ ngầm mà **không có gì báo lỗi** — không phải ở tsc,
   * không phải ở runtime, chỉ là người dùng thấy thông báo lỗi tiếng Anh.
   */
  static readonly MIN_ONBOARDING_CATEGORIES = 3;
  static readonly ERR_TOO_FEW_CATEGORIES = 'You must select at least 3 categories.';
  static readonly ERR_UNKNOWN_CATEGORY_SLUGS = 'Some category slugs do not exist.';

  /**
   * THAY THẾ toàn bộ danh sách category yêu thích của người dùng.
   *
   * ⚠️ Ngữ nghĩa là **THAY THẾ**, không phải cộng dồn — Prisma `set:` chứ không
   * `connect:`. Gọi lần hai với bộ slug khác thì bộ cũ **biến mất hoàn toàn**.
   * Đây là quyết định hợp đồng: màn onboarding gửi lên trạng thái cuối của một
   * lưới chọn, không gửi delta. Dùng `connect:` sẽ làm người bỏ chọn một mục
   * không bao giờ bỏ được nó — và không có lỗi nào phát ra.
   *
   * Nhận `slug` chứ không `id`: `Category.id` là cuid và **đổi sau mỗi lần
   * re-seed**, còn `slug` có `@unique` và ổn định (xem `category.entity.ts`).
   */
  async updateMyCategories(userId: string, slugs: string[]) {
    await this.findById(userId);

    // Chuẩn hoá TRƯỚC khi đếm: gửi `['travel','travel','travel']` mà đếm thô
    // sẽ qua ngưỡng 3 trong khi người dùng mới chọn đúng MỘT chủ đề.
    const unique = [...new Set(slugs.map((s) => s.trim()).filter(Boolean))];

    if (unique.length < UsersService.MIN_ONBOARDING_CATEGORIES) {
      throw new BadRequestException(UsersService.ERR_TOO_FEW_CATEGORIES);
    }

    // Mọi slug phải tồn tại. `set:` của Prisma với một slug không có thật sẽ
    // ném lỗi Prisma thô (P2025) — thông điệp rò rỉ chi tiết ORM và không khớp
    // hợp đồng chuỗi ở trên. Nên kiểm trước và ném lỗi của mình.
    const found = await this.prisma.category.findMany({
      where: { slug: { in: unique } },
      select: { slug: true },
    });
    if (found.length !== unique.length) {
      throw new BadRequestException(UsersService.ERR_UNKNOWN_CATEGORY_SLUGS);
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: { categories: { set: unique.map((slug) => ({ slug })) } },
    });
  }

  /**
   * Đánh dấu đã hoàn tất onboarding.
   *
   * **KHÔNG có tham số** — có chủ đích (Đ2a). Một `setOnboarded(value: Boolean)`
   * sẽ cho client tự đẩy người dùng NGƯỢC vào luồng onboarding; ở đây không có
   * đường nào làm điều đó. Idempotent: gọi lại vẫn `true`, không lỗi.
   */
  async completeOnboarding(userId: string) {
    await this.findById(userId);
    return this.prisma.user.update({
      where: { id: userId },
      data: { isOnboarded: true },
    });
  }

  /** Category yêu thích của một user (quan hệ m2m `UserCategories`). */
  async getUserCategories(userId: string) {
    return this.prisma.category.findMany({
      where: { users: { some: { id: userId } } },
      orderBy: { name: 'asc' },
    });
  }
}

