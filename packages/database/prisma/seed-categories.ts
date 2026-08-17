// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  Seed Categories & Tags                                                   ║
// ║                                                                            ║
// ║  HƯỚNG DẪN CODE LẠI:                                                       ║
// ║  1. Import PrismaClient từ '@antigravity/database'.                        ║
// ║  2. Khai báo mảng CATEGORIES (12 phần tử):                                ║
// ║     - Mỗi entry: { name, slug (unique), icon (emoji) }.                   ║
// ║     - slug là kebab-case: 'art-illustration', 'home-decor', v.v.          ║
// ║  3. Khai báo mảng TAGS (30 phần tử):                                      ║
// ║     - Mỗi entry: chuỗi string (name, unique).                            ║
// ║  4. Hàm seedCategories(prisma):                                            ║
// ║     - Lặp qua CATEGORIES, dùng prisma.category.upsert                    ║
// ║       (where: { slug }, update: {}, create: { name, slug, icon }).        ║
// ║     - Upsert = tạo mới nếu chưa có, bỏ qua nếu đã tồn tại.             ║
// ║  5. Hàm seedTags(prisma):                                                  ║
// ║     - Lặp qua TAGS, dùng prisma.tag.upsert                               ║
// ║       (where: { name }, update: {}, create: { name }).                    ║
// ║  6. Export seedCategories và seedTags để gọi từ seed chính (Phase 2.7).   ║
// ║  7. Nếu chạy trực tiếp (node seed-categories.ts), tự tạo PrismaClient   ║
// ║     và gọi cả hai hàm.                                                     ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

import { PrismaClient } from '../src/client/index.js';

// ─── Categories ──────────────────────────────────────────────────────────────

/**
 * 12 categories phổ biến, lấy cảm hứng từ Pinterest thật.
 * Mỗi category có:
 * - name: tên HIỂN THỊ — **tiếng Việt** (Đ7a, user duyệt 17/08/2026)
 * - slug: khoá ổn định — **giữ tiếng Anh**, unique trong DB
 * - icon: emoji đại diện
 *
 * ⚠️ ĐỔI `name` NHƯNG GIỮ NGUYÊN `slug` — đây là quyết định, không phải sơ suất.
 * `slug` là thứ mọi chỗ khác bám vào: URL (`/category/travel`), `exploreFeed(
 * categorySlug:)` của B-5, `updateMyCategories(slugs:)` của B-7, và bảng kỳ vọng
 * `CATEGORY_SLUGS` trong bộ verify. `name` chỉ để hiển thị. Dịch cả slug là
 * breaking change trên URL và trên hợp đồng API, đổi lấy đúng con số 0 lợi ích.
 *
 * ✅ Đã đo trước khi đổi (17/08): grep `Art & Illustration`/`Food & Drink`/
 * `Home Decor`/`Fitness & Health`/`DIY & Crafts` trong `scripts/` và
 * `apps/web/src` ⇒ **0 hit**. `68-taxonomy.mjs` đối chiếu category **chỉ theo
 * slug**; chỗ duy nhất chạm `name` là khẳng định nó khác rỗng. `Pin_fts_idx`
 * chỉ phủ `Pin.title` + `Pin.description` nên đổi tên category **không thể**
 * chạm search. ⇒ chi phí đổi tên = 0 bản ghi verify.
 */
const CATEGORIES = [
  { name: 'Nghệ thuật & Minh hoạ', slug: 'art-illustration', icon: '🎨' },
  { name: 'Kiến trúc', slug: 'architecture', icon: '🏛️' },
  { name: 'Thời trang', slug: 'fashion', icon: '👗' },
  { name: 'Ẩm thực', slug: 'food-drink', icon: '🍕' },
  { name: 'Du lịch', slug: 'travel', icon: '✈️' },
  { name: 'Thủ công & DIY', slug: 'diy-crafts', icon: '🔨' },
  { name: 'Công nghệ', slug: 'technology', icon: '💻' },
  { name: 'Nhiếp ảnh', slug: 'photography', icon: '📷' },
  { name: 'Trang trí nhà cửa', slug: 'home-decor', icon: '🏠' },
  { name: 'Thiên nhiên', slug: 'nature', icon: '🌿' },
  { name: 'Sức khoẻ & Thể hình', slug: 'fitness-health', icon: '💪' },
  { name: 'Giáo dục', slug: 'education', icon: '📚' },
] as const;

// ─── Tags ────────────────────────────────────────────────────────────────────

/**
 * 30 tags thông dụng cho hệ thống pin tagging.
 * Mỗi tag là chuỗi unique trong bảng Tag.
 */
const TAGS = [
  'minimal', 'aesthetic', 'vintage', 'modern', 'colorful',
  'dark', 'pastel', 'retro', 'boho', 'scandinavian',
  'industrial', 'rustic', 'luxury', 'sustainable', 'handmade',
  'organic', 'geometric', 'abstract', 'portrait', 'landscape',
  'street-style', 'wedding', 'seasonal', 'holiday', 'workspace',
  'outdoor', 'indoor', 'recipe', 'tutorial', 'inspiration',
] as const;

// ─── Seed Functions ──────────────────────────────────────────────────────────

/**
 * Seed categories vào database.
 * Dùng upsert để idempotent (chạy lại không lỗi).
 *
 * HƯỚNG DẪN CODE LẠI:
 * 1. Lặp qua mảng CATEGORIES.
 * 2. Dùng prisma.category.upsert({ where: { slug }, update: {}, create: { name, slug, icon } }).
 * 3. Log số lượng đã seed.
 */
export async function seedCategories(prisma: PrismaClient): Promise<void> {
  let count = 0;

  for (const cat of CATEGORIES) {
    await prisma.category.upsert({
      where: { slug: cat.slug },
      // 🔴 `update` PHẢI ghi lại `name`/`icon`, KHÔNG được để `{}`.
      //
      // Bản cũ để `update: {}`, và `resetDatabase()` trong `seed.ts:36-51`
      // **KHÔNG** xoá bảng `Category`/`Tag` (nó chỉ dọn từ `CommentReaction`
      // xuống `User`). Hai chuyện đó cộng lại nghĩa là: chạy lại seed trên một
      // DB đã có category sẽ **giữ nguyên bản ghi cũ** — nên đợt đổi tên sang
      // tiếng Việt (Đ7a) sẽ "xanh" trên máy sạch và **im lặng không đổi gì**
      // trên mọi máy đã seed từ trước. Đúng hình dạng xanh-giả mà dự án đã
      // trả giá nhiều lần.
      //
      // `slug` cố ý KHÔNG nằm trong `update`: nó là khoá tra cứu, sửa nó ở đây
      // là tạo bản ghi thứ hai chứ không phải đổi tên.
      update: {
        name: cat.name,
        icon: cat.icon,
      },
      create: {
        name: cat.name,
        slug: cat.slug,
        icon: cat.icon,
      },
    });
    count++;
  }

  console.log(`✅ Seeded ${count} categories`);
}

/**
 * Seed tags vào database.
 * Dùng upsert để idempotent.
 *
 * HƯỚNG DẪN CODE LẠI:
 * 1. Lặp qua mảng TAGS.
 * 2. Dùng prisma.tag.upsert({ where: { name }, update: {}, create: { name } }).
 * 3. Log số lượng đã seed.
 */
export async function seedTags(prisma: PrismaClient): Promise<void> {
  let count = 0;

  for (const tagName of TAGS) {
    await prisma.tag.upsert({
      where: { name: tagName },
      update: {},
      create: { name: tagName },
    });
    count++;
  }

  console.log(`✅ Seeded ${count} tags`);
}

// ─── Standalone execution ────────────────────────────────────────────────────

/**
 * Nếu chạy trực tiếp file này (không import):
 *   npx ts-node prisma/seed-categories.ts
 *
 * HƯỚNG DẪN CODE LẠI:
 * 1. Tạo PrismaClient mới.
 * 2. Gọi seedCategories(prisma) và seedTags(prisma).
 * 3. Disconnect prisma sau khi xong.
 * 4. Dùng require.main === module để detect chạy trực tiếp.
 */
async function main() {
  const prisma = new PrismaClient();

  try {
    console.log('🌱 Seeding categories and tags...');
    await seedCategories(prisma);
    await seedTags(prisma);
    console.log('🎉 Seed completed!');
  } catch (error) {
    console.error('❌ Seed failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Chỉ chạy main() khi file được execute trực tiếp
if (require.main === module) {
  main();
}
