// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  Tag — nhãn TỰ DO do người dùng đặt                                      ║
// ║                                                                          ║
// ║  Bất đối xứng với `Category` là CÓ CHỦ ĐÍCH, không phải thiếu sót:       ║
// ║  `Tag` chỉ có `name @unique` — không slug, không icon, không thứ tự biên  ║
// ║  tập. Người dùng đẻ ra tag mới bằng cách gõ nó vào `createPin`.          ║
// ║  `Category` thì ngược lại: curated, dùng cho onboarding (`User.categories`)║
// ║  nên client CHỈ được `connect` vào id có sẵn.                            ║
// ║                                                                          ║
// ║  ⚠️ `name` ở đây LUÔN đã chuẩn hoá (lowercase, gộp khoảng trắng) —       ║
// ║  xem `pins/tag-name.util.ts`. Postgres so sánh `@unique` phân biệt hoa    ║
// ║  thường, nên không chuẩn hoá thì `Design`/`design`/`Design ` thành ba     ║
// ║  bản ghi khác nhau và tính năng vô dụng ngay tuần đầu.                    ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

import { ObjectType, Field, ID } from '@nestjs/graphql';

@ObjectType()
export class Tag {
  @Field(() => ID)
  id: string;

  /** Đã chuẩn hoá: trim → lowercase → gộp khoảng trắng. Dài 1..30. */
  @Field()
  name: string;
}
