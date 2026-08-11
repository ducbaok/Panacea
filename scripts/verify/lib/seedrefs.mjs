// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  Tham chiếu cố định tới dữ liệu seed                                     ║
// ║                                                                          ║
// ║  Nguồn: packages/database/prisma/seed.ts — seed cố tình gán id tường     ║
// ║  minh (`user_1_id`, `pin_1_id`, …) thay vì để cuid tự sinh, chính là     ║
// ║  để bộ verify bám vào được.                                             ║
// ║                                                                          ║
// ║  ⚠️ Sửa seed.ts thì phải sửa file này. Nếu một hằng ở đây trỏ vào bản    ║
// ║  ghi không còn tồn tại, phép kiểm tra sẽ FAIL với thông điệp "not found" ║
// ║  rất khó truy — hãy chạy `pnpm db:seed` trước khi nghi ngờ code app.     ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

export const PASSWORD = 'password123';

/** 3 nhân vật của mọi kịch bản phân quyền. */
export const USERS = {
  /** Chủ thể chính — sở hữu pin/board được tạo trong lúc test. */
  bao: { id: 'user_1_id', email: 'bao@example.com', username: 'bao_developer' },
  /** Đối tác — mutual follow với bao để mở khoá DM. */
  alice: { id: 'user_4_id', email: 'alice@example.com', username: 'alice_chef' },
  /** Người ngoài — dùng để chứng minh phân quyền CHẶN đúng. */
  john: { id: 'user_3_id', email: 'john@example.com', username: 'john_traveler' },
  /**
   * Người follow bao mà bao KHÔNG follow lại (bước 20 dựng quan hệ này).
   * Đây là cạnh `false` duy nhất trong danh sách follower của bao, nên phép
   * kiểm `isFollowedByViewer` phải có bob mới phân biệt được true/false trong
   * cùng một response.
   */
  bob: { id: 'user_5_id', email: 'bob@example.com', username: 'bob_photographer' },
};

/** Bản ghi seed dùng khi cần một đối tượng chắc chắn tồn tại từ trước. */
export const SEED = {
  pinId: 'pin_1_id',
  commentId: 'comment_1_id',

  /**
   * Hai comment GỐC của `pin_1_id` (`seed.ts:495-537`), chọn vì `replyCount`
   * của chúng KHÁC NHAU — `comment_1_id` có 2 reply (`comment_3` của bao +
   * `comment_4` của alice), `comment_2_id` có 0.
   *
   * `pinComments(pin_1_id)` lọc `parentId: null` nên trả về đúng hai comment
   * này, tức MỘT response chứa cả nhánh khác-0 lẫn nhánh bằng-0. Đó là điều
   * kiện để loại trừ kiểu hỏng "loader gán chung một giá trị cho mọi item" —
   * bài học §13, và cũng chính là phép kiểm mà Đợt 4 thiếu nên 3 stub `return 0`
   * sống sót nhiều ngày.
   *
   * Đối chứng chéo có sẵn: `Pin.commentCount` trả `pin_1 = 4` = 2 gốc + 2 reply.
   */
  commentWithTwoReplies: 'comment_1_id',
  commentWithNoReply: 'comment_2_id',

  /**
   * Pin DUY NHẤT mà bao vừa lưu (seed.ts:423) vừa thả reaction (seed.ts:484).
   * Một pin chứng minh được cả `isSavedByViewer` lẫn `viewerReaction`, và vì
   * 19 pin còn lại đều false/null nên cùng một response chứa CẢ HAI nhánh —
   * đó là điều kiện để loại trừ khả năng loader gán chung một giá trị cho mọi
   * item (kiểu hỏng mà phép kiểm "field có trả về gì không" không thấy).
   */
  baoSavedAndReactedPinId: 'pin_5_id',
  baoReactionOnThatPin: 'HEART',

  /**
   * `pin_1_id` có 3 reaction của 3 người khác nhau (seed.ts:485-487) và bao
   * KHÔNG nằm trong số đó. Dùng để chứng minh loader tách đúng theo viewer:
   * cùng một pin, ba token cho ra ba kết quả khác nhau.
   * (jane = user_2_id cũng có reaction IDEA ở đây nhưng bộ verify không có
   * token của jane — chỉ T1/T2/T3 = bao/alice/john.)
   */
  reactionsOnFirstPin: { alice: 'THANKS', john: 'WOW', bao: null },
};

// ─── Taxonomy (Đợt 6) ────────────────────────────────────────────────────────
//
// ⚠️ TUYỆT ĐỐI KHÔNG HARDCODE `Category.id` VÀO FILE NÀY. `Category.id` là cuid
// và ĐỔI SAU MỖI LẦN RE-SEED — mà Đợt 6 bắt buộc phải re-seed. Một id chép vào
// đây sẽ đỏ ngay lần seed kế tiếp, kèm thông điệp "not found" chẳng liên quan
// gì tới thứ phép kiểm đang đo, và người đọc sẽ đi tìm bug trong code app.
// `slug` mới là khoá ổn định: nó có `@unique` và seed dùng
// `upsert(where: { slug })`. Bước verify nào cần id thì phải ĐỌC QUA chính
// query `categories` rồi lọc theo `slug`.

/**
 * Sự thật nền về tag của 20 pin seed — nguồn: bảng `TAG_RULES` ở
 * `packages/database/prisma/seed.ts`, dẫn xuất ĐỘC LẬP từ luật rồi mới đối
 * chiếu với DB (43 dòng `_PinToTag`, khớp từng dòng ngày 10/08/2026).
 *
 * VÌ SAO PHẢI LÀ BẢN ĐỒ ĐẦY ĐỦ, KHÔNG PHẢI "có pin nào có tag không":
 * câu hỏi "có tag không" xanh với một loader trả CÙNG MỘT danh sách cho mọi
 * pin — đúng kiểu hỏng đã để 3 stub `return 0` của Đợt 4 sống sót nhiều ngày
 * (§13). Chỉ khi đối chiếu ĐÚNG pin nào mang ĐÚNG tag nào thì "ký hiệu có mặt"
 * mới không thể giả dạng "cơ chế có thật".
 *
 * ⚠️ `pin_10_id` và `pin_20_id` RỖNG LÀ CÓ CHỦ ĐÍCH và phải giữ nguyên như
 * vậy: phép kiểm quyết định cần cả nhánh-có-tag lẫn nhánh-rỗng trong CÙNG một
 * response. Gắn tag cho hai pin này là phá phép kiểm, không phải làm giàu dữ
 * liệu. Chú ý `pin_10` có tag rỗng nhưng category `travel`, còn `pin_19` thì
 * ngược lại — đó là cặp đối chứng chứng minh hai loader độc lập với nhau.
 *
 * Danh sách đã sắp theo `name` tăng dần, khớp `orderBy` của `tagsByPinIdLoader`.
 */
export const SEED_PIN_TAGS = {
  pin_1_id: ['minimal', 'workspace'],
  pin_2_id: ['modern', 'tutorial'],
  pin_3_id: ['modern', 'tutorial'],
  pin_4_id: ['dark', 'workspace'],
  pin_5_id: ['colorful', 'inspiration', 'pastel'],
  pin_6_id: ['inspiration', 'modern', 'tutorial'],
  pin_7_id: ['geometric', 'modern'],
  pin_8_id: ['abstract', 'geometric', 'inspiration'],
  pin_9_id: ['landscape', 'outdoor'],
  pin_10_id: [],
  pin_11_id: ['outdoor', 'seasonal'],
  pin_12_id: ['landscape', 'outdoor'],
  pin_13_id: ['handmade', 'recipe'],
  pin_14_id: ['organic', 'recipe'],
  pin_15_id: ['organic', 'pastel', 'recipe'],
  pin_16_id: ['handmade', 'organic', 'recipe'],
  pin_17_id: ['outdoor', 'street-style'],
  pin_18_id: ['landscape', 'organic', 'outdoor', 'seasonal'],
  pin_19_id: ['dark', 'landscape'],
  pin_20_id: [],
};

/**
 * Sự thật nền về category của 20 pin seed — nguồn: vòng lặp `lowerTitle
 * .includes(...)` ở `seed.ts` (16 dòng `_PinToCategory`).
 *
 * Khoá là `slug`, KHÔNG phải id — xem cảnh báo cuid ở trên.
 * `pin_17..20` rỗng, cùng vai trò nhánh-rỗng như `pin_10`/`pin_20` bên tag.
 */
export const SEED_PIN_CATEGORY_SLUGS = {
  pin_1_id: ['technology'],
  pin_2_id: ['technology'],
  pin_3_id: ['technology'],
  pin_4_id: ['technology'],
  pin_5_id: ['art-illustration'],
  pin_6_id: ['art-illustration'],
  pin_7_id: ['art-illustration'],
  pin_8_id: ['art-illustration'],
  pin_9_id: ['travel'],
  pin_10_id: ['travel'],
  pin_11_id: ['travel'],
  pin_12_id: ['travel'],
  pin_13_id: ['food-drink'],
  pin_14_id: ['food-drink'],
  pin_15_id: ['food-drink'],
  pin_16_id: ['food-drink'],
  pin_17_id: [],
  pin_18_id: [],
  pin_19_id: [],
  pin_20_id: [],
};

/** 12 slug category cố định — ổn định qua re-seed, khác hẳn `Category.id`. */
export const CATEGORY_SLUGS = [
  'architecture',
  'art-illustration',
  'diy-crafts',
  'education',
  'fashion',
  'fitness-health',
  'food-drink',
  'home-decor',
  'nature',
  'photography',
  'technology',
  'travel',
];

/**
 * Id seed có dạng `pin_<số>_id`; pin do bộ verify tạo mang cuid. Phép kiểm nào
 * đối chiếu với bảng seed cố định phải lọc bằng cái này, nếu không một pin còn
 * sót từ lần chạy trước (run bị ngắt giữa chừng, chưa kịp qua bước 90) sẽ làm
 * đỏ một phép kiểm chẳng liên quan gì tới thứ nó đang đo.
 */
export const isSeedPinId = (id) => /^pin_\d+_id$/.test(id);
