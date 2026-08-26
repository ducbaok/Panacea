// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  Pin GraphQL Entity                                                      ║
// ║  Đại diện cho một Pin trong schema GraphQL.                              ║
// ║                                                                          ║
// ║  HƯỚNG DẪN CODE LẠI:                                                     ║
// ║  1. Tạo @ObjectType() class Pin với các field theo schema Prisma.       ║
// ║  2. Bao gồm:                                                            ║
// ║     - id, title, description, imageUrl, thumbnailUrl, mediumUrl,        ║
// ║       largeUrl, imageWidth, imageHeight, sourceUrl                       ║
// ║     - viewCount, clickCount                                             ║
// ║     - creatorId (internal), creator (resolved qua DataLoader)           ║
// ║     - createdAt, updatedAt                                               ║
// ║  3. Thêm computed fields (resolve bằng @ResolveField):                  ║
// ║     - savedCount, reactionCount, commentCount                           ║
// ║     - creator: User (qua DataLoader)                                    ║
// ║     - isSavedByViewer, viewerReaction — PHỤ THUỘC NGƯỜI ĐANG XEM:       ║
// ║       cùng một pin trả giá trị khác nhau cho hai token khác nhau, và    ║
// ║       false/null cho khách vãng lai.                                    ║
// ║  4. Tạo PaginatedPins extends createPaginatedType(Pin)                  ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

import { ObjectType, Field, ID, Int } from '@nestjs/graphql';
import { createPaginatedType } from '../../common/pagination';
import { User } from '../../users/entities/user.entity';
import { ReactionType } from '../../comments/entities/reaction-type.enum';
import { Tag } from './tag.entity';
import { Category } from './category.entity';
import { Visibility } from './visibility.enum';

@ObjectType()
export class Pin {
  @Field(() => ID)
  id: string;

  @Field({ nullable: true })
  title?: string;

  @Field({ nullable: true })
  description?: string;

  @Field()
  imageUrl: string;

  @Field({ nullable: true })
  thumbnailUrl?: string;

  @Field({ nullable: true })
  mediumUrl?: string;

  @Field({ nullable: true })
  largeUrl?: string;

  @Field(() => Int)
  imageWidth: number;

  @Field(() => Int)
  imageHeight: number;

  // ─── XH-VIDEO (26/08/2026) ─────────────────────────────────────────────────
  //
  // `videoUrl != null` là dấu hiệu DUY NHẤT phân biệt pin video với pin ảnh.
  // Mọi field ảnh ở trên VẪN có giá trị với pin video (poster đi qua đúng
  // pipeline resize), nên bề mặt nào không quan tâm tới video thì không phải
  // sửa gì — xem docblock của `Pin.videoUrl` trong `schema.prisma`.
  //
  // `processingStatus` CHƯA phơi ra: hôm nay luôn READY (phương án A không
  // transcode), một field hằng số chỉ dạy FE viết nhánh chết.

  /** URL tuyệt đối của file video gốc do MediaRecorder sinh ra. */
  @Field({ nullable: true })
  videoUrl?: string;

  /**
   * Thời lượng đoạn quay, tính bằng mili-giây.
   *
   * Mili-giây chứ không phải giây: mốc là 10/15/30s nhưng người dùng được dừng
   * SỚM, nên con số thật hiếm khi tròn. Làm tròn xuống giây ở BE là mất thông
   * tin ngay tại cửa vào; FE muốn hiện "0:07" thì tự làm tròn khi vẽ.
   */
  @Field(() => Int, { nullable: true })
  videoDurationMs?: number;

  @Field({ nullable: true })
  sourceUrl?: string;

  /**
   * Lượt mở chi tiết pin — **`Int` NULLABLE từ XH-5**, không còn `Int!`.
   *
   * §4 luật 3: `viewCount` bị ẨN trên pin giới hạn, chỉ chủ pin đọc được; người
   * khác nhận `null`. Với một vòng 5 người, con số này vừa lộ quy mô khán giả
   * (thứ XH-QĐ-3 cố tình giữ kín) vừa tạo áp lực xã hội — "đăng cho 5 người mà
   * chỉ 1 người xem" là một thông tin không ai xin.
   *
   * 🔴 ĐỔI `Int!` → `Int` LÀ BREAKING CHANGE Ở TẦNG SCHEMA, không phải chuyện
   * tương thích ngược: client nào khai `viewCount: Int!` trong fragment/biến sẽ
   * bị GraphQL từ chối, và codegen của `apps/web` sinh lại kiểu thành
   * `number | null`. Cùng họ với `togglePinReaction: Boolean! → Pin!` (B-19).
   *
   * `clickCount` ngay dưới KHÔNG đổi và đó là chủ đích: nó đếm lượt bấm link
   * NGOÀI, chỉ tồn tại trên pin có `sourceUrl`, và không nói gì về quy mô khán
   * giả. Luật 3 nói đích danh `viewCount`.
   *
   * Giá trị đọc từ cột vẫn nằm trên parent; việc quyết định có trả ra hay không
   * nằm ở `PinsResolver.getViewCount` — cùng khuôn `audienceCircleId`.
   */
  @Field(() => Int, { nullable: true })
  viewCount?: number | null;

  @Field(() => Int)
  clickCount: number;

  /** ID của người tạo pin — dùng nội bộ để resolve creator qua DataLoader */
  @Field()
  creatorId: string;

  @Field()
  createdAt: Date;

  @Field()
  updatedAt: Date;

  // ─── Khán giả + hạn sống (XH-4a/XH-6) ────────────────────────────────────
  //
  // ⚠️ BA FIELD, HAI CHẾ ĐỘ HIỂN THỊ KHÁC NHAU — cố ý:
  //
  //   `visibility`/`expiresAt` trả THẲNG cho ai đọc được pin. Người đã ở trong
  //   khán giả thì việc biết pin này "gửi cho một vòng" không lộ thêm gì, mà
  //   FE thì CẦN nó để vẽ nhãn quyền trên `PinCard` (XH-8) và đếm ngược hạn.
  //
  //   `audienceCircleId` thì KHÔNG: nó là danh tính của vòng, và biết id vòng
  //   là biết "mình bị xếp chung một nhóm tên gì với ai" — thứ XH-QĐ-3 cố tình
  //   giữ kín (rời vòng phải im lặng). Vì vậy nó resolve qua `@ResolveField`
  //   và CHỈ chính chủ nhận được giá trị; người khác nhận `null`. Xem
  //   `PinsResolver.getAudienceCircleId`.

  /** Cấp khán giả của pin. Pin cũ trước XH-1 ⇒ `PUBLIC` (mặc định của cột). */
  @Field(() => Visibility)
  visibility: Visibility;

  /**
   * Vòng được ghim — CHỈ chính chủ đọc được, người khác luôn `null`.
   * `null` ở đây KHÔNG phân biệt được với "pin này không ghim vòng nào", và đó
   * là chủ đích.
   */
  @Field(() => ID, { nullable: true })
  audienceCircleId?: string | null;

  /**
   * Hạn sống. `null` = pin thường. Quá hạn ⇒ chỉ còn thấy trong kho.
   *
   * ⚠️ `@Field(() => Date)` TƯỜNG MINH, không phải `@Field()` trần như
   * `createdAt` ngay trên. Kiểu ở đây là `Date | null` nên metadata mà
   * TypeScript phát ra là `Object`, và Nest không đoán nổi — nó ném
   * `UndefinedTypeError` LÚC BOOT (schema GraphQL sinh lúc chạy, không phải lúc
   * build), tức `tsc` xanh 100% mà API chết ngay khi khởi động.
   */
  @Field(() => Date, { nullable: true })
  expiresAt?: Date | null;

  // ─── Resolved Fields (xử lý trong PinsResolver) ──────────────────────────

  /** User object — resolved qua DataLoader, không query trực tiếp */
  @Field(() => User, { nullable: true })
  creator?: User;

  /** Số lần pin được save — resolved qua DataLoader */
  @Field(() => Int, { nullable: true })
  savedCount?: number;

  /** Tổng số reactions — resolved qua DataLoader */
  @Field(() => Int, { nullable: true })
  reactionCount?: number;

  /** Tổng số comments — resolved qua DataLoader */
  @Field(() => Int, { nullable: true })
  commentCount?: number;

  // ─── Taxonomy (Đợt 6) ─────────────────────────────────────────────────────
  //
  // Cả hai khai `[T!]!` (không nullable ở cả mảng lẫn phần tử): pin không có
  // tag nào thì trả `[]`, và `[]` là một câu trả lời ĐẦY ĐỦ chứ không phải
  // "không biết". Cho phép `null` ở đây sẽ tạo ra hai cách biểu diễn cùng một
  // sự thật, và client nào cũng phải xử lý cả hai.
  //
  // ⚠️ Hai field này KHÔNG phụ thuộc viewer — khác hẳn `isSavedByViewer` /
  // `viewerReaction` ngay bên dưới. Tag của `pin_1_id` giống nhau với mọi
  // token và với cả khách vãng lai, nên loader của chúng memo theo PIN, không
  // theo viewer.

  /** Nhãn tự do gắn với pin. Không có ⇒ `[]`. Resolved qua DataLoader. */
  @Field(() => [Tag])
  tags?: Tag[];

  /** Danh mục biên tập của pin. Không có ⇒ `[]`. Resolved qua DataLoader. */
  @Field(() => [Category])
  categories?: Category[];

  // ─── Phụ thuộc viewer (Đợt 3c) ────────────────────────────────────────────
  //
  // Hai field dưới đây KHÁC hẳn 4 field trên: chúng không phải thuộc tính của
  // pin mà là quan hệ giữa pin và NGƯỜI ĐANG GỌI. Cùng một `pin_5_id` trả
  // `true`/`HEART` cho bao và `false`/`null` cho mọi người khác. Vì vậy:
  //   - loader của chúng phải memo theo viewer (`perViewer`), không phải theo
  //     pin — xem dataloader.service.ts;
  //   - khách vãng lai phải trả false/null, và đó là giá trị HỢP LỆ chứ không
  //     phải lỗi, nên không phép kiểm nào bắt được nếu viewer bị mất giữa
  //     đường. Đợt 3a tồn tại chính vì lỗi đó đã xảy ra một lần.

  /** Viewer đã lưu pin này chưa? Khách vãng lai ⇒ `false`. */
  @Field(() => Boolean, { nullable: true })
  isSavedByViewer?: boolean;

  /**
   * Reaction của riêng viewer trên pin này, `null` nếu chưa thả.
   * Tối đa MỘT giá trị vì `Reaction` có `@@unique([userId, pinId])`.
   */
  @Field(() => ReactionType, { nullable: true })
  viewerReaction?: ReactionType;
}

// Paginated wrapper cho danh sách Pins
@ObjectType()
export class PaginatedPins extends createPaginatedType(Pin) {}
