// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  TaxonomyResolver — hai query GỐC cho Tag và Category                    ║
// ║                                                                          ║
// ║  Ở RIÊNG một resolver chứ không nhét vào `PinsResolver`: hai query dưới   ║
// ║  đây không nhận pin nào làm đầu vào và không trả về pin nào. Gộp chúng    ║
// ║  vào `PinsResolver` (`@Resolver(() => Pin)`) chỉ vì "cùng thư mục" sẽ     ║
// ║  làm file đó phình ra theo hướng không liên quan tới Pin. Vẫn thuộc       ║
// ║  `PinsModule` vì taxonomy chỉ tồn tại để phục vụ pin — tách hẳn thành     ║
// ║  module riêng lúc này là chia nhỏ mà không có ai dùng lại.                ║
// ║                                                                          ║
// ║  ⚠️ ĐÂY LÀ HAI QUERY DỄ GÂY HIỂU NHẦM NHẤT CỦA ĐỢT 6. Bảng `Tag` đã có   ║
// ║  sẵn 30 dòng từ seed và `Category` có 12 dòng, nên CẢ HAI trả về dữ liệu  ║
// ║  đầy đủ ngay cả khi `_PinToTag` rỗng tuyệt đối và `Pin.tags` chưa nối     ║
// ║  được gì. Chúng KHÔNG phải bằng chứng cho việc gắn tag hoạt động — bằng   ║
// ║  chứng đó phải là `Pin.tags` đúng theo từng pin. Xem                      ║
// ║  `scripts/verify/steps/68-taxonomy.mjs`.                                  ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

import { Resolver, Query, Args, Int } from '@nestjs/graphql';
import { PrismaService } from '../prisma/prisma.service';
import { Tag } from './entities/tag.entity';
import { Category } from './entities/category.entity';

/** Trần cứng cho `tags(first:)`. Client gửi lớn hơn ⇒ bị kẹp xuống, không lỗi. */
const TAGS_MAX_FIRST = 50;

@Resolver()
export class TaxonomyResolver {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Toàn bộ 12 danh mục biên tập. Public — dùng cho màn hình onboarding, nơi
   * người dùng còn CHƯA có tài khoản để mà gắn token.
   *
   * KHÔNG phân trang, và đó là quyết định có chủ đích chứ không phải bỏ sót:
   * `Category` không có cột `createdAt` nên không dựng được keyset cursor theo
   * khuôn chung của app; thêm offset pagination riêng cho mỗi một chỗ này sẽ
   * đưa vào codebase style pagination thứ ba mà #14 đang cố gỡ. Với tập 12 bản
   * ghi do biên tập viên kiểm soát, trả hết một lần vừa đúng vừa rẻ hơn.
   *
   * Sắp theo `name` để thứ tự ổn định giữa các lần gọi — không có `orderBy`,
   * Postgres được phép trả về thứ tự bất kỳ và UI sẽ nhảy lung tung giữa hai
   * lần tải mà không ai đổi gì.
   */
  @Query(() => [Category], { name: 'categories' })
  async categories() {
    return this.prisma.category.findMany({ orderBy: { name: 'asc' } });
  }

  /**
   * Tìm tag theo tiền tố/chuỗi con — dùng cho ô autocomplete lúc gắn tag.
   *
   * `query` rỗng/không gửi ⇒ trả `first` tag đầu tiên theo thứ tự chữ cái, làm
   * gợi ý mặc định khi người dùng mới click vào ô nhập.
   *
   * `mode: 'insensitive'` là bắt buộc dù `Tag.name` đã luôn được lưu ở dạng
   * lowercase: người dùng GÕ `"Des"` chứ không gõ `"des"`, và một ô tìm kiếm
   * không tìm ra gì vì viết hoa là loại lỗi người dùng không bao giờ báo — họ
   * chỉ kết luận là tính năng hỏng.
   */
  @Query(() => [Tag], { name: 'tags' })
  async tags(
    @Args('query', { nullable: true }) query?: string,
    @Args('first', { type: () => Int, nullable: true, defaultValue: 20 }) first = 20,
  ) {
    const q = query?.trim();
    return this.prisma.tag.findMany({
      where: q ? { name: { contains: q, mode: 'insensitive' } } : {},
      orderBy: { name: 'asc' },
      // Kẹp cả hai đầu: `first <= 0` sẽ làm Prisma trả rỗng (trông như "không
      // có tag nào") thay vì báo lỗi, nên nó phải được nắn về khoảng hợp lệ ở
      // đây chứ không để lọt xuống DB.
      take: Math.min(Math.max(first, 1), TAGS_MAX_FIRST),
    });
  }
}
