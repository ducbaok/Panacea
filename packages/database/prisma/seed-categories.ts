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
 * - name: tên hiển thị
 * - slug: URL-friendly identifier (unique trong DB)
 * - icon: emoji đại diện
 */
const CATEGORIES = [
  { name: 'Art & Illustration', slug: 'art-illustration', icon: '🎨' },
  { name: 'Architecture', slug: 'architecture', icon: '🏛️' },
  { name: 'Fashion', slug: 'fashion', icon: '👗' },
  { name: 'Food & Drink', slug: 'food-drink', icon: '🍕' },
  { name: 'Travel', slug: 'travel', icon: '✈️' },
  { name: 'DIY & Crafts', slug: 'diy-crafts', icon: '🔨' },
  { name: 'Technology', slug: 'technology', icon: '💻' },
  { name: 'Photography', slug: 'photography', icon: '📷' },
  { name: 'Home Decor', slug: 'home-decor', icon: '🏠' },
  { name: 'Nature', slug: 'nature', icon: '🌿' },
  { name: 'Fitness & Health', slug: 'fitness-health', icon: '💪' },
  { name: 'Education', slug: 'education', icon: '📚' },
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
      update: {},
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
