// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  Category — danh mục BIÊN TẬP, người dùng không được đẻ thêm             ║
// ║                                                                          ║
// ║  12 bản ghi cố định do seed dựng (`seed-categories.ts`). Client chỉ được  ║
// ║  `connect` vào id đã tồn tại; `createPin` nhận `categoryIds`, KHÔNG nhận  ║
// ║  `categoryNames` — đó là toàn bộ khác biệt so với `Tag`.                  ║
// ║                                                                          ║
// ║  ⚠️ `id` là CUID và ĐỔI SAU MỖI LẦN RE-SEED. Đừng hardcode nó ở bất cứ   ║
// ║  đâu (bộ verify, fixture, tài liệu). `slug` mới là khoá ổn định — nó có   ║
// ║  `@unique` trong Prisma và được seed bằng `upsert(where: { slug })`, nên  ║
// ║  giá trị của nó sống sót qua mọi lần seed lại.                           ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

import { ObjectType, Field, ID } from '@nestjs/graphql';

@ObjectType()
export class Category {
  /** ⚠️ cuid — ĐỔI sau mỗi lần re-seed. Bám vào `slug` nếu cần khoá ổn định. */
  @Field(() => ID)
  id: string;

  @Field()
  name: string;

  /** Khoá ổn định qua các lần re-seed: `travel`, `food-drink`, … */
  @Field()
  slug: string;

  @Field({ nullable: true })
  icon?: string;
}
