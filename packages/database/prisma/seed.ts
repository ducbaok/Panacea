// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  Database Main Seed Script                                                ║
// ║                                                                            ║
// ║  HƯỚNG DẪN CODE LẠI:                                                       ║
// ║  1. Tạo instance PrismaClient mới.                                         ║
// ║  2. Dọn dẹp dữ liệu cũ (Clean up) theo thứ tự từ bảng con đến bảng cha    ║
// ║     để tránh lỗi khóa ngoại (Foreign Key Constraints).                     ║
// ║  3. Gọi seedCategories(prisma) và seedTags(prisma) để seed danh mục/tag.   ║
// ║  4. Tạo 5 Users bằng prisma.user.create. Dùng mật khẩu băm sẵn           ║
// ║     (bcrypt hash cho 'password123') để không cần cài thêm thư viện bcrypt.║
// ║  5. Tạo 20 Pins (phân bổ cho các user) với imageUrl và creatorId thích hợp.║
// ║  6. Tạo 3 Boards (1 public, 1 secret, 1 có 2 sections).                   ║
// ║  7. Tạo các mối quan hệ Follows (theo dõi lẫn nhau, bao gồm mutual follow).║
// ║  8. Tạo các SavedPins (lưu pin vào board/section) và Reactions cho Pin.    ║
// ║  9. Tạo 10 Comments (bao gồm bình luận gốc và bình luận phản hồi - reply). ║
// ║  10. Bọc tất cả trong hàm main(), gọi main() và xử lý disconnect/lỗi.      ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

import { PrismaClient, ReactionType } from '../src/client/index.js';
import { seedCategories, seedTags } from './seed-categories.js';

// Khai báo một hash bcrypt hợp lệ cho mật khẩu 'password123'
const PASSWORD_HASH = '$2b$12$Cheo7Xdnw71Ud0LDJv/BWOWxxPmNavgIwHjjAmkSEwXqiOk7K9Ik6';

/**
 * Hàm dọn dẹp toàn bộ dữ liệu cũ trong database.
 * Bắt buộc dọn dẹp bảng con chứa khóa ngoại trước rồi mới đến bảng cha.
 *
 * HƯỚNG DẪN CODE LẠI:
 * 1. Gọi deleteMany cho các bảng phụ thuộc trực tiếp: CommentReaction, Comment, Reaction, SavedPin, BoardCollaborator, BoardSection, Board, Message, ConversationMember, Conversation, Notification, DeviceToken, Follows, BlockedUser.
 * 2. Tiếp theo gọi deleteMany cho Pin.
 * 3. Cuối cùng gọi deleteMany cho User.
 */
async function cleanDatabase(prisma: PrismaClient) {
  console.log('🧹 Cleaning up database...');
  await prisma.commentReaction.deleteMany({});
  await prisma.comment.deleteMany({});
  await prisma.reaction.deleteMany({});
  await prisma.savedPin.deleteMany({});
  await prisma.boardCollaborator.deleteMany({});
  await prisma.boardSection.deleteMany({});
  await prisma.board.deleteMany({});
  await prisma.message.deleteMany({});
  await prisma.conversationMember.deleteMany({});
  await prisma.conversation.deleteMany({});
  await prisma.notification.deleteMany({});
  await prisma.deviceToken.deleteMany({});
  await prisma.follows.deleteMany({});
  await prisma.blockedUser.deleteMany({});
  await prisma.pin.deleteMany({});
  await prisma.user.deleteMany({});
}

/**
 * Hàm tạo dữ liệu Seed chính cho hệ thống.
 *
 * HƯỚNG DẪN CODE LẠI:
 * 1. Seed danh mục và tag bằng seedCategories và seedTags.
 * 2. Lấy ra danh mục du lịch (travel) và ẩm thực (food-drink) để liên kết.
 * 3. Tạo 5 users mẫu (id cụ thể: user_1_id, user_2_id, ...).
 * 4. Tạo 20 pins (mỗi user tạo 4 pins).
 * 5. Tạo 3 boards (bao gồm section và link coverPinId).
 * 6. Tạo follow chéo (User 1 <-> User 2 mutual follow để có thể DM).
 * 7. Tạo một số SavedPins và Reactions.
 * 8. Tạo 10 comments (root comments và replies).
 */
async function seedData(prisma: PrismaClient) {
  // 1. Seed Categories & Tags
  await seedCategories(prisma);
  await seedTags(prisma);

  const travelCat = await prisma.category.findUnique({ where: { slug: 'travel' } });
  const foodCat = await prisma.category.findUnique({ where: { slug: 'food-drink' } });
  const techCat = await prisma.category.findUnique({ where: { slug: 'technology' } });
  const artCat = await prisma.category.findUnique({ where: { slug: 'art-illustration' } });

  const categoriesToConnect = [];
  if (travelCat) categoriesToConnect.push({ id: travelCat.id });

  // 2. Tạo 5 Users mẫu
  console.log('👤 Seeding 5 users...');
  const users = [
    {
      id: 'user_1_id',
      email: 'bao@example.com',
      username: 'bao_developer',
      name: 'Bao Developer',
      password: PASSWORD_HASH,
      bio: 'TypeScript & Node.js Developer. Building cool apps.',
      website: 'https://github.com/bao-dev',
      avatarUrl: 'https://api.dicebear.com/7.x/adventurer/svg?seed=bao',
      isOnboarded: true,
    },
    {
      id: 'user_2_id',
      email: 'jane@example.com',
      username: 'jane_designer',
      name: 'Jane Designer',
      password: PASSWORD_HASH,
      bio: 'UI/UX Designer. Lover of minimalism and pastel colors.',
      website: 'https://behance.net/jane-design',
      avatarUrl: 'https://api.dicebear.com/7.x/adventurer/svg?seed=jane',
      isOnboarded: true,
    },
    {
      id: 'user_3_id',
      email: 'john@example.com',
      username: 'john_traveler',
      name: 'John Traveler',
      password: PASSWORD_HASH,
      bio: 'Exploring the world one city at a time. Wanderlust!',
      website: 'https://medium.com/@john-travel',
      avatarUrl: 'https://api.dicebear.com/7.x/adventurer/svg?seed=john',
      isOnboarded: true,
    },
    {
      id: 'user_4_id',
      email: 'alice@example.com',
      username: 'alice_chef',
      name: 'Alice Chef',
      password: PASSWORD_HASH,
      bio: 'Pastry chef. Baking is my therapy and science.',
      website: 'https://alicebakes.com',
      avatarUrl: 'https://api.dicebear.com/7.x/adventurer/svg?seed=alice',
      isOnboarded: true,
    },
    {
      id: 'user_5_id',
      email: 'bob@example.com',
      username: 'bob_photographer',
      name: 'Bob Photographer',
      password: PASSWORD_HASH,
      bio: 'Landscape and street photographer based in Tokyo.',
      website: 'https://flickr.com/bob-photo',
      avatarUrl: 'https://api.dicebear.com/7.x/adventurer/svg?seed=bob',
      isOnboarded: true,
    },
  ];

  for (const u of users) {
    await prisma.user.create({ data: u });
  }

  // 3. Tạo 20 Pins mẫu (mỗi user 4 pins)
  console.log('📌 Seeding 20 pins...');
  const pinData = [
    // Pins cho User 1 (Bao Developer)
    {
      id: 'pin_1_id',
      title: 'Minimalist Workspace Setup',
      description: 'Clean setup with a curved ultrawide monitor, mechanical keyboard, and plants.',
      imageUrl: 'https://images.unsplash.com/photo-1585776245991-cf89dd7fc73a?w=800',
      imageWidth: 800,
      imageHeight: 600,
      creatorId: 'user_1_id',
      sourceUrl: 'https://unsplash.com',
    },
    {
      id: 'pin_2_id',
      title: 'NestJS Architecture Patterns',
      description: 'Understanding modules, controllers, providers, and middleware in NestJS applications.',
      imageUrl: 'https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=800',
      imageWidth: 800,
      imageHeight: 533,
      creatorId: 'user_1_id',
      sourceUrl: 'https://nestjs.com',
    },
    {
      id: 'pin_3_id',
      title: 'TypeScript Types Guide',
      description: 'Advanced types, generics, mapped types, and conditional types in TypeScript.',
      // REVIEW-1 (18/08/2026) — URL cũ `photo-1516116211223` đã bị Unsplash gỡ
      // (curl trả 404). Ảnh chết ở seed đọc y hệt bug ảnh không tải, nên thay
      // bằng URL đã kiểm 200 tại thời điểm sửa.
      imageUrl: 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=800',
      imageWidth: 800,
      imageHeight: 533,
      creatorId: 'user_1_id',
    },
    {
      id: 'pin_4_id',
      title: 'Cozy Coding Night',
      description: 'Late night coding session with a cup of coffee and warm ambient lighting.',
      imageUrl: 'https://images.unsplash.com/photo-1542831371-29b0f74f9713?w=800',
      imageWidth: 800,
      imageHeight: 533,
      creatorId: 'user_1_id',
    },
    // Pins cho User 2 (Jane Designer)
    {
      id: 'pin_5_id',
      title: 'Pastel Color Palette',
      description: 'Harmonious color combinations for modern web applications and UI designs.',
      imageUrl: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?w=800',
      imageWidth: 800,
      imageHeight: 800,
      creatorId: 'user_2_id',
    },
    {
      id: 'pin_6_id',
      title: 'Pinterest UI Case Study',
      description: 'Redesigning the board and discovery feed layout for a cleaner user experience.',
      imageUrl: 'https://images.unsplash.com/photo-1507238691740-187a5b1d37b8?w=800',
      imageWidth: 800,
      imageHeight: 600,
      creatorId: 'user_2_id',
    },
    {
      id: 'pin_7_id',
      title: 'Bento Grid UI Design',
      description: 'Exploring grid layouts for landing pages and modern dashboard layouts.',
      imageUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800',
      imageWidth: 800,
      imageHeight: 533,
      creatorId: 'user_2_id',
    },
    {
      id: 'pin_8_id',
      title: 'Abstract Fluid 3D Render',
      description: 'Stunning 3D wallpaper with organic shapes and iridescent colors.',
      // REVIEW-1 — URL cũ `photo-1618005198143` trả 404 (xem ghi chú pin_3_id).
      imageUrl: 'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=800',
      imageWidth: 800,
      imageHeight: 1200,
      creatorId: 'user_2_id',
    },
    // Pins cho User 3 (John Traveler)
    {
      id: 'pin_9_id',
      title: 'Amalfi Coast View, Italy',
      description: 'Breathtaking cliffs, colorful houses, and blue ocean in Amalfi, Italy.',
      imageUrl: 'https://images.unsplash.com/photo-1533900298318-6b8da08a523e?w=800',
      imageWidth: 800,
      imageHeight: 1000,
      creatorId: 'user_3_id',
      sourceUrl: 'https://travel.com',
    },
    {
      id: 'pin_10_id',
      title: 'Eiffel Tower Sunset, France',
      description: 'Iconic view of the Eiffel Tower glowing during a pink sunset in Paris.',
      imageUrl: 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=800',
      imageWidth: 800,
      imageHeight: 600,
      creatorId: 'user_3_id',
    },
    {
      id: 'pin_11_id',
      title: 'Mount Fuji Cherry Blossoms',
      description: 'Stunning landscape of Mt. Fuji framed by pink sakura blossoms in spring.',
      imageUrl: 'https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?w=800',
      imageWidth: 800,
      imageHeight: 533,
      creatorId: 'user_3_id',
    },
    {
      id: 'pin_12_id',
      title: 'Banff National Park, Canada',
      description: 'Turquoise water of Moraine Lake surrounded by majestic snow-capped peaks.',
      imageUrl: 'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=800',
      imageWidth: 800,
      imageHeight: 533,
      creatorId: 'user_3_id',
    },
    // Pins cho User 4 (Alice Chef)
    {
      id: 'pin_13_id',
      title: 'Classic French Croissant',
      description: 'Golden, flaky, and buttery croissants freshly baked from the oven.',
      imageUrl: 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=800',
      imageWidth: 800,
      imageHeight: 600,
      creatorId: 'user_4_id',
    },
    {
      id: 'pin_14_id',
      title: 'Fresh Strawberry Tart',
      description: 'Crisp sweet pastry filled with vanilla custard and topped with fresh strawberries.',
      imageUrl: 'https://images.unsplash.com/photo-1519869325930-281384150729?w=800',
      imageWidth: 800,
      imageHeight: 800,
      creatorId: 'user_4_id',
    },
    {
      id: 'pin_15_id',
      title: 'Matcha Mille Crepe Cake',
      description: 'Over 20 layers of paper-thin crepes stacked with light matcha green tea cream.',
      // REVIEW-1 — URL cũ `photo-1536680465769` trả 404 (xem ghi chú pin_3_id).
      imageUrl: 'https://images.unsplash.com/photo-1493246507139-91e8fad9978e?w=800',
      imageWidth: 800,
      imageHeight: 1000,
      creatorId: 'user_4_id',
    },
    {
      id: 'pin_16_id',
      title: 'Homemade Sourdough Bread',
      description: 'Perfect open crumb and crispy blistered crust sourdough loaf.',
      imageUrl: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=800',
      imageWidth: 800,
      imageHeight: 533,
      creatorId: 'user_4_id',
    },
    // Pins cho User 5 (Bob Photographer)
    {
      id: 'pin_17_id',
      title: 'Shibuya Crossing Long Exposure',
      description: 'Neon light trails and motion blur of crowds crossing in Tokyo, Japan.',
      imageUrl: 'https://images.unsplash.com/photo-1503899036084-c55cdd92da26?w=800',
      imageWidth: 800,
      imageHeight: 1000,
      creatorId: 'user_5_id',
    },
    {
      id: 'pin_18_id',
      title: 'Misty Forest at Sunrise',
      description: 'Sunbeams filtering through tall pine trees shrouded in morning fog.',
      imageUrl: 'https://images.unsplash.com/photo-1448375240586-882707db888b?w=800',
      imageWidth: 800,
      imageHeight: 533,
      creatorId: 'user_5_id',
    },
    {
      id: 'pin_19_id',
      title: 'Milky Way Galaxy Landscape',
      description: 'Deep sky photography of the galactic core rising over a desert rock formation.',
      imageUrl: 'https://images.unsplash.com/photo-1506318137071-a8e063b4bec0?w=800',
      imageWidth: 800,
      imageHeight: 533,
      creatorId: 'user_5_id',
    },
    {
      id: 'pin_20_id',
      title: 'Golden Gate Bridge Fog',
      description: 'The Golden Gate Bridge peeking through the thick San Francisco fog at sunrise.',
      imageUrl: 'https://images.unsplash.com/photo-1506012787146-f92b2d7d6d96?w=800',
      imageWidth: 800,
      imageHeight: 600,
      creatorId: 'user_5_id',
    },
  ];

  // ─── Luật gắn TAG cho pin (Đợt 6) ──────────────────────────────────────────
  //
  // VÌ SAO SEED PHẢI SỬA: trước đợt này vòng lặp dưới chỉ `connect` category,
  // nên bảng nối `_PinToTag` RỖNG TUYỆT ĐỐI. Hệ quả không phải "thiếu dữ liệu
  // cho đẹp" mà là MẤT KHẢ NĂNG PHÂN BIỆT: `Pin.tags` trả `[]` thì không ai
  // nói được đó là "chưa cài đặt" hay "cài đặt đúng và pin này thật sự không
  // có tag". Đúng loại mù mà dự án này tồn tại để chống — xem
  // docs/debug_history.md §13.
  //
  // Cùng khuôn `lowerTitle.includes(...)` với category ngay bên dưới, chỉ khác
  // là bảng luật được tách ra thành dữ liệu để đọc được bằng mắt.
  //
  // ⚠️ HAI PIN CỐ Ý KHÔNG KHỚP LUẬT NÀO (`pin_10` Eiffel Tower, `pin_20`
  // Golden Gate) và chúng phải ở lại như vậy. Bộ verify cần CẢ HAI nhánh —
  // pin có tag và pin không tag — xuất hiện trong CÙNG MỘT response thì mới
  // loại trừ được kiểu hỏng "loader gán chung một giá trị cho mọi item". Gắn
  // thêm tag cho hai pin này để "dữ liệu đầy đủ hơn" sẽ phá đúng phép kiểm
  // quyết định của đợt.
  //
  // Mọi tên tag dưới đây PHẢI nằm trong 30 tag của `seed-categories.ts`
  // (`seedTags` chạy trước, ở đầu hàm này) — connect theo `name` chứ không
  // theo id, vì `Tag.name` là `@unique` và ổn định qua mọi lần re-seed, còn id
  // là cuid sinh mới mỗi lần.
  const TAG_RULES: Array<{ tag: string; keywords: string[] }> = [
    { tag: 'minimal', keywords: ['minimalist', 'minimal'] },
    { tag: 'workspace', keywords: ['workspace', 'coding', 'setup'] },
    // `'ui '` có dấu cách ở cuối là CỐ Ý: `'ui'` trần khớp nhầm cả `guide` và
    // `fluid`, khiến hai pin nhận tag `modern` không ai giải thích được.
    { tag: 'modern', keywords: ['nestjs', 'typescript', 'ui ', 'bento'] },
    { tag: 'tutorial', keywords: ['guide', 'patterns', 'case study'] },
    { tag: 'inspiration', keywords: ['palette', 'case study', 'render'] },
    { tag: 'dark', keywords: ['night', 'galaxy'] },
    { tag: 'pastel', keywords: ['pastel', 'matcha'] },
    { tag: 'colorful', keywords: ['color'] },
    { tag: 'geometric', keywords: ['grid', '3d'] },
    { tag: 'abstract', keywords: ['abstract', 'fluid'] },
    { tag: 'landscape', keywords: ['coast', 'park', 'landscape', 'forest'] },
    { tag: 'outdoor', keywords: ['coast', 'fuji', 'park', 'forest', 'crossing'] },
    { tag: 'seasonal', keywords: ['cherry blossoms', 'sunrise'] },
    { tag: 'organic', keywords: ['strawberry', 'sourdough', 'matcha', 'forest'] },
    { tag: 'recipe', keywords: ['croissant', 'tart', 'crepe', 'bread', 'cake'] },
    { tag: 'handmade', keywords: ['homemade', 'sourdough', 'croissant'] },
    { tag: 'street-style', keywords: ['shibuya', 'crossing'] },
  ];

  for (const p of pinData) {
    const categories = [];
    const lowerTitle = p.title.toLowerCase();

    // Gắn tag theo cùng một luật đọc-tiêu-đề với category bên dưới.
    const tags = TAG_RULES.filter((rule) =>
      rule.keywords.some((kw) => lowerTitle.includes(kw)),
    ).map((rule) => ({ name: rule.tag }));

    if (lowerTitle.includes('workspace') || lowerTitle.includes('coding') || lowerTitle.includes('typescript') || lowerTitle.includes('nestjs')) {
      if (techCat) categories.push({ id: techCat.id });
    }
    if (lowerTitle.includes('color') || lowerTitle.includes('design') || lowerTitle.includes('case') || lowerTitle.includes('3d')) {
      if (artCat) categories.push({ id: artCat.id });
    }
    if (lowerTitle.includes('italy') || lowerTitle.includes('france') || lowerTitle.includes('fuji') || lowerTitle.includes('park')) {
      if (travelCat) categories.push({ id: travelCat.id });
    }
    if (lowerTitle.includes('croissant') || lowerTitle.includes('tart') || lowerTitle.includes('matcha') || lowerTitle.includes('bread')) {
      if (foodCat) categories.push({ id: foodCat.id });
    }

    await prisma.pin.create({
      data: {
        ...p,
        categories: { connect: categories },
        // `connect` theo `name` (khoá `@unique` ổn định), không theo id cuid.
        // Mảng rỗng ⇒ Prisma no-op, đúng thứ ta muốn cho pin_10 và pin_20.
        tags: { connect: tags },
      },
    });
  }

  // 4. Tạo 3 Boards mẫu
  console.log('🗂️ Seeding 3 boards...');
  // Board 1: Public
  const board1 = await prisma.board.create({
    data: {
      id: 'board_1_id',
      name: 'Beautiful Workspace Design',
      description: 'A place for clean minimal coding and setup aesthetics.',
      isSecret: false,
      userId: 'user_1_id',
      coverPinId: 'pin_1_id',
    },
  });

  // Board 2: Secret
  const board2 = await prisma.board.create({
    data: {
      id: 'board_2_id',
      name: 'Confidential Web UI Ideas',
      description: 'Secret color palettes and abstract assets.',
      isSecret: true,
      userId: 'user_2_id',
      coverPinId: 'pin_5_id',
    },
  });

  // Board 3: With Sections
  const board3 = await prisma.board.create({
    data: {
      id: 'board_3_id',
      name: 'Dream Travel Plans',
      description: 'Locations to visit in the near future.',
      isSecret: false,
      userId: 'user_3_id',
      coverPinId: 'pin_9_id',
    },
  });

  // Tạo Sections cho Board 3
  console.log('📂 Seeding board sections...');
  const sec1 = await prisma.boardSection.create({
    data: {
      id: 'section_1_id',
      name: 'Italy',
      boardId: 'board_3_id',
      sortOrder: 1,
    },
  });

  const sec2 = await prisma.boardSection.create({
    data: {
      id: 'section_2_id',
      name: 'France',
      boardId: 'board_3_id',
      sortOrder: 2,
    },
  });

  // 5. Tạo SavedPins (lưu pin vào board/section)
  console.log('💾 Seeding Saved Pins...');
  // User 1 saves Pin 5 (Jane's UI) to Board 1
  await prisma.savedPin.create({
    data: {
      userId: 'user_1_id',
      pinId: 'pin_5_id',
      boardId: 'board_1_id',
      note: 'Stunning colors to try in next project',
    },
  });

  // User 3 saves Pin 9 (Amalfi Coast) to Board 3 Section 1 (Italy)
  await prisma.savedPin.create({
    data: {
      userId: 'user_3_id',
      pinId: 'pin_9_id',
      boardId: 'board_3_id',
      sectionId: 'section_1_id',
      note: 'Must visit Amalfi coast cliffs',
    },
  });

  // User 3 saves Pin 10 (Eiffel Tower) to Board 3 Section 2 (France)
  await prisma.savedPin.create({
    data: {
      userId: 'user_3_id',
      pinId: 'pin_10_id',
      boardId: 'board_3_id',
      sectionId: 'section_2_id',
      note: 'Visit during sunset',
    },
  });

  // User 2 saves Pin 1 (Bao's Workspace) to Board 2 (Secret UI)
  await prisma.savedPin.create({
    data: {
      userId: 'user_2_id',
      pinId: 'pin_1_id',
      boardId: 'board_2_id',
    },
  });

  // 6. Tạo Follows (Người theo dõi)
  console.log('🤝 Seeding Follows relationships...');
  const follows = [
    // Mutual follow User 1 <-> User 2 (so they can DM)
    { followerId: 'user_1_id', followingId: 'user_2_id' },
    { followerId: 'user_2_id', followingId: 'user_1_id' },
    // Other follows
    { followerId: 'user_1_id', followingId: 'user_3_id' },
    { followerId: 'user_3_id', followingId: 'user_1_id' }, // Mutual 1 <-> 3
    { followerId: 'user_2_id', followingId: 'user_3_id' },
    { followerId: 'user_3_id', followingId: 'user_4_id' },
    { followerId: 'user_4_id', followingId: 'user_5_id' },
  ];

  for (const f of follows) {
    await prisma.follows.create({ data: f });
  }

  // 7. Tạo Reactions
  console.log('❤️ Seeding Pin Reactions...');
  const reactions = [
    { type: ReactionType.HEART, userId: 'user_1_id', pinId: 'pin_5_id' },
    { type: ReactionType.IDEA, userId: 'user_2_id', pinId: 'pin_1_id' },
    { type: ReactionType.WOW, userId: 'user_3_id', pinId: 'pin_1_id' },
    { type: ReactionType.THANKS, userId: 'user_4_id', pinId: 'pin_1_id' },
    { type: ReactionType.FUNNY, userId: 'user_5_id', pinId: 'pin_13_id' },
  ];

  for (const r of reactions) {
    await prisma.reaction.create({ data: r });
  }

  // 8. Tạo 10 Comments (bao gồm replies)
  console.log('💬 Seeding Comments...');
  // Comment 1 on Pin 1 (root) from User 2
  const c1 = await prisma.comment.create({
    data: {
      id: 'comment_1_id',
      content: 'This setup is absolutely stunning! What monitor model is that?',
      pinId: 'pin_1_id',
      userId: 'user_2_id',
    },
  });

  // Comment 2 on Pin 1 (root) from User 3
  await prisma.comment.create({
    data: {
      id: 'comment_2_id',
      content: 'Great post, thanks for sharing. Very inspirational!',
      pinId: 'pin_1_id',
      userId: 'user_3_id',
    },
  });

  // Comment 3 (Reply to Comment 1) from User 1
  await prisma.comment.create({
    data: {
      id: 'comment_3_id',
      content: 'Thanks Jane! It is the Dell UltraSharp 40-inch curved monitor.',
      pinId: 'pin_1_id',
      userId: 'user_1_id',
      parentId: 'comment_1_id',
    },
  });

  // Comment 4 (Reply to Comment 1) from User 4
  await prisma.comment.create({
    data: {
      id: 'comment_4_id',
      content: 'I have the same monitor, it is a game changer for multi-tasking.',
      pinId: 'pin_1_id',
      userId: 'user_4_id',
      parentId: 'comment_1_id',
    },
  });

  // Comments on Pin 5
  const c5 = await prisma.comment.create({
    data: {
      id: 'comment_5_id',
      content: 'Love the soft pastel UI layout here. Very clean.',
      pinId: 'pin_5_id',
      userId: 'user_1_id',
    },
  });

  await prisma.comment.create({
    data: {
      id: 'comment_6_id',
      content: 'Is this mock-up made in Figma or Sketch?',
      pinId: 'pin_5_id',
      userId: 'user_5_id',
    },
  });

  await prisma.comment.create({
    data: {
      id: 'comment_7_id',
      content: 'Yes! 100% Figma, used some component library auto layouts.',
      pinId: 'pin_5_id',
      userId: 'user_2_id',
      parentId: 'comment_6_id',
    },
  });

  // Other comments
  await prisma.comment.create({
    data: {
      id: 'comment_8_id',
      content: 'Wow, this Italian coastline view is beautiful!',
      pinId: 'pin_9_id',
      userId: 'user_1_id',
    },
  });

  await prisma.comment.create({
    data: {
      id: 'comment_9_id',
      content: 'Looks absolutely delicious. Can I get the ingredients list?',
      pinId: 'pin_13_id',
      userId: 'user_2_id',
    },
  });

  await prisma.comment.create({
    data: {
      id: 'comment_10_id',
      content: 'Sure Jane, I will update the Pin description with the full recipe link.',
      pinId: 'pin_13_id',
      userId: 'user_4_id',
      parentId: 'comment_9_id',
    },
  });
}

/**
 * Hàm chạy chính của seed.
 *
 * HƯỚNG DẪN CODE LẠI:
 * 1. Khởi tạo PrismaClient.
 * 2. Gọi cleanDatabase(prisma) trước.
 * 3. Gọi seedData(prisma) sau.
 * 4. catch lỗi, log lỗi và exit(1).
 * 5. Khối finally luôn disconnect prisma.
 */
async function main() {
  const prisma = new PrismaClient();

  try {
    console.log('🌱 Starting database seeding...');
    await cleanDatabase(prisma);
    await seedData(prisma);
    console.log('🎉 Database seeding completed successfully!');
  } catch (error) {
    console.error('❌ Database seeding failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
