import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

/**
 * Bootstrap function — điểm khởi đầu của NestJS application.
 *
 * HƯỚNG DẪN CODE LẠI:
 * 1. Khởi tạo app bằng NestFactory.create<NestExpressApplication>(AppModule).
 * 2. Cấu hình serve static assets cho thư mục 'uploads' với prefix '/uploads/'.
 * 3. Thêm bảo mật bằng helmet.
 * 4. Bật CORS với nguồn gốc từ WEB_URL hoặc localhost:3000.
 * 5. Swagger Setup:
 *    - Dùng DocumentBuilder cấu hình title, description, version, và Bearer Auth.
 *    - Gọi SwaggerModule.createDocument(app, config).
 *    - Setup UI tại đường dẫn 'api-docs'.
 * 6. Lắng nghe trên PORT (mặc định 4000).
 */
/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  HT-3 — 5/6 lỗ hổng production được vá trong file này (17/08/2026)        ║
 * ║                                                                          ║
 * ║  Đặc điểm chung của cả 6: **không cái nào hỏng gì ở localhost.** Chúng   ║
 * ║  chỉ nổ khi có ALB đứng trước, có nhiều task, và có SIGTERM lúc deploy — ║
 * ║  tức đúng lúc không ai đang nhìn. Vì vậy mỗi chỗ vá dưới đây kèm cách    ║
 * ║  ĐO ĐƯỢC NGAY ở localhost; bảng đỏ-trước/xanh-sau ở `PLAN_HATANG.md`     ║
 * ║  §HT-3, số đo ở `docs/debug_history.md` §36.                            ║
 * ║                                                                          ║
 * ║  🔴 HAI THỨ TUYỆT ĐỐI KHÔNG ĐƯỢC LÀM MẤT (đã đo được là cần thiết):     ║
 * ║   • `commandTimeout: 500` ở factory `REDIS_CLIENT` (`redis.module.ts`) — ║
 * ║     thiếu ⇒ Redis chết thì login tốn **7–24 GIÂY** thay vì ~1,2s.        ║
 * ║   • `.catch()` cho mọi publish fire-and-forget (`notifications.service`) ║
 * ║     — thiếu ⇒ chính `commandTimeout` **làm sập cả tiến trình**.          ║
 * ║  Cả hai đã có trong code; việc của HT-3 là **đừng đụng vào chúng**.      ║
 * ║                                                                          ║
 * ║  🔴 `introspection` của GraphQL ĐÃ được chặn đúng ở `app.module.ts:58`   ║
 * ║  (`process.env.NODE_ENV !== 'production'`) — **đừng "sửa" lại nó**.      ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/**
 * Danh sách origin được phép — HT-3 lỗ hổng #5.
 *
 * `WEB_URL` nhận **danh sách ngăn cách bằng dấu phẩy**, không còn là một chuỗi
 * đơn. Lý do: production có ít nhất hai origin hợp lệ cùng lúc (domain chính +
 * domain CloudFront, cộng thêm các URL preview), và bản cũ
 * `origin: process.env.WEB_URL ?? 'http://localhost:3000'` chặn sạch mọi cái
 * thứ hai. Vẫn là **whitelist**, không phải `origin: true` — mở hết là bỏ luôn
 * lớp bảo vệ mà CORS sinh ra để cung cấp.
 */
function allowedOrigins(): string[] {
  const raw = process.env.WEB_URL ?? 'http://localhost:3000';
  return raw
    .split(',')
    .map((o) =>
      o
        .trim()
        // ⚠️ Bóc dấu nháy bao ngoài. `apps/api/.env` viết `WEB_URL="http://…"`
        // và **`docker run --env-file` KHÔNG bóc dấu nháy** (khác hẳn dotenv).
        // Đo được 17/08 trong container HT-1: log in ra `"http://localhost:3000"`
        // KÈM dấu nháy ⇒ so sánh với header `Origin` không bao giờ khớp ⇒ CORS
        // chặn sạch mọi origin. Hỏng toàn phần, và thông điệp lỗi chẳng gợi ý
        // gì về dấu nháy. Rẻ để chống, đắt để truy.
        .replace(/^["']|["']$/g, '')
        .replace(/\/+$/, ''), // bỏ `/` cuối: trình duyệt không gửi nó trong header Origin
    )
    .filter(Boolean);
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['log', 'error', 'warn', 'debug'],
  });

  // ── HT-3 #1 — trust proxy ───────────────────────────────────────────────────
  //
  // `ThrottlerModule` giới hạn 100 req/phút **mỗi IP** (`app.module.ts:41`).
  // Sau ALB, mọi request mang IP của ALB ⇒ Express thấy đúng MỘT IP ⇒ **toàn bộ
  // người dùng dùng chung một hạn mức**. Biểu hiện không phải lỗi rõ ràng mà là
  // "app chậm ngẫu nhiên" — loại sự cố tốn nhiều giờ nhất để truy.
  //
  // ⚠️ `1` CHỨ KHÔNG PHẢI `true`. `true` bảo Express tin **toàn bộ** chuỗi
  // `X-Forwarded-For` và lấy phần tử ngoài cùng bên trái — mà phần tử đó do
  // CLIENT gửi. Kẻ tấn công chỉ cần tự đặt `X-Forwarded-For: <ip bịa>` là có
  // hạn mức mới sau mỗi request, tức **rate limit bị vô hiệu hoá hoàn toàn**.
  // `1` = "tin đúng một hop gần nhất" = đúng ALB, không hơn.
  //
  // Chỉ bật trên production: ở localhost không có proxy nào, bật lên là tự
  // nguyện tin một header client gửi mà chẳng đổi lấy gì.
  app.set('trust proxy', IS_PRODUCTION ? 1 : false);

  // ── HT-3 #6 — không serve `uploads/` trên production ────────────────────────
  //
  // Fargate có filesystem **ephemeral**: file biến mất khi task restart và
  // KHÔNG chia sẻ giữa các task. Nên trên production đường ảnh phải là S3
  // (`POST /uploads/presigned-url`, đã có sẵn). Tắt static ở đây, còn nhánh
  // ghi (`POST /uploads/local`) bị chặn ngay trong `UploadsController` —
  // hai lớp cho hai chiều đọc/ghi, thiếu lớp nào cũng còn nửa lỗ hổng.
  if (!IS_PRODUCTION) {
    app.useStaticAssets(join(process.cwd(), 'uploads'), {
      prefix: '/uploads/',
    });
  }

  const logger = new Logger('Bootstrap');

  // ── Security ────────────────────────────────────────────────────────────────
  app.use(
    helmet({
      // GraphQL playground cần bỏ CSP trong development
      contentSecurityPolicy: process.env.NODE_ENV === 'production' ? undefined : false,
    }),
  );

  // ── CORS — HT-3 #5 ───────────────────────────────────────────────────────────
  const origins = allowedOrigins();
  app.enableCors({
    // Hàm chứ không mảng: cần cho phép cả request **không có** header `Origin`
    // (curl, health check của ALB, app di động). Truyền mảng thì các request đó
    // bị coi là origin không khớp và bị chặn — và ALB sẽ thấy task unhealthy.
    origin: (origin, callback) => {
      if (!origin || origins.includes(origin.replace(/\/+$/, ''))) return callback(null, true);
      callback(new Error(`Origin ${origin} không nằm trong WEB_URL`), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // ── Swagger — HT-3 #4: KHÔNG mở trên production ─────────────────────────────
  //
  // Bản cũ gọi `SwaggerModule.setup` vô điều kiện ⇒ toàn bộ bề mặt REST + mọi
  // DTO (gồm cả hình dạng của endpoint `/internal/*`) công khai trên production.
  // Đây là rò rỉ thông tin, không phải lỗ hổng thực thi — nhưng nó là bản đồ
  // chỉ đường cho mọi thứ khác.
  if (!IS_PRODUCTION) {
    const config = new DocumentBuilder()
      .setTitle('Pinterest Clone REST API')
      .setDescription('The Pinterest Clone REST API documentation')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api-docs', app, document);
  }

  // ── HT-3 #3 — graceful shutdown ─────────────────────────────────────────────
  //
  // ECS gửi SIGTERM mỗi lần deploy/scale-in. Không có hook thì tiến trình chết
  // ngay: request đang chạy bị cắt ngang (5xx cho người dùng thật, mỗi lần
  // deploy một nhúm), và kết nối Prisma/Redis không đóng sạch.
  //
  // `enableShutdownHooks()` làm Nest bắt SIGTERM/SIGINT, ngừng nhận kết nối mới,
  // chờ request đang chạy xong, rồi gọi `onModuleDestroy` của mọi provider —
  // trong đó có `PrismaService.onModuleDestroy` (`$disconnect`) vốn đã viết sẵn
  // từ lâu và **chưa từng chạy** trên đường thoát nào.
  //
  // ⚠️ Phải gọi TRƯỚC `listen()`: sau đó thì cửa sổ giữa hai lệnh là khoảng
  // thời gian tiến trình đã nhận traffic nhưng chưa có hook.
  //
  // 🔴 `{ useProcessExit: true }` KHÔNG PHẢI TUỲ CHỌN — thiếu nó thì container
  // KHÔNG BAO GIỜ THOÁT. Đo được 17/08/2026 trên chính image của HT-1:
  // `docker kill -s TERM` ⇒ `State.Running` vẫn `true` sau 30 giây.
  //
  // Nguyên nhân, hai mảnh ghép lại (đọc từ `@nestjs/core@11.1.19`
  // `nest-application-context.js:197-232`):
  //   1. Sau khi chạy xong hook, Nest **gỡ listener của chính nó** rồi
  //      `process.kill(process.pid, signal)` để tín hiệu rơi vào hành vi mặc
  //      định. Đó là cách đúng cho một tiến trình thường.
  //   2. Nhưng trong container, Node là **PID 1**, và kernel **bỏ qua** mọi
  //      tín hiệu không có handler đối với PID 1 (bảo vệ init). Không handler
  //      ⇒ không có "hành vi mặc định" nào để rơi vào ⇒ tín hiệu bốc hơi.
  // ⇒ Hook chạy đủ, DB/Redis đóng sạch, và tiến trình **sống tiếp mãi mãi**.
  // ECS sẽ chờ hết `stopTimeout` rồi SIGKILL — tức mỗi lần deploy vẫn mất thêm
  // 30 giây và vẫn kết thúc bằng một cú giết cứng.
  //
  // `useProcessExit: true` đổi bước cuối thành `process.exit(0)` — thoát thật.
  // Đây đúng là loại bẫy mà `docker build` xanh không nói gì (§29): nó chỉ lộ
  // ra khi chạy `node dist/main` như PID 1 và gửi tín hiệu thật.
  //
  // Log hai đầu của quá trình tắt, đăng ký TRƯỚC để nó chạy trước hook của Nest.
  // Không có nó thì "deploy vừa rồi có graceful không" là câu hỏi không trả lời
  // được từ CloudWatch — mà đó lại là nơi DUY NHẤT quan sát được khi sự việc
  // xảy ra thật trên ECS.
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => logger.log(`[shutdown] nhận ${signal} — đang đóng dịch vụ…`));
  }
  process.on('exit', (code) => logger.log(`[shutdown] tiến trình thoát với code ${code}`));

  app.enableShutdownHooks([], { useProcessExit: true });

  // ── Global prefix ────────────────────────────────────────────────────────────
  // GraphQL tại /graphql, REST tại /api/*
  // Không dùng global prefix để /auth/... giữ nguyên theo PLAN.md

  const port = process.env.PORT ?? 4000;
  await app.listen(port);

  logger.log(`🚀 API running on http://localhost:${port}`);
  logger.log(`📊 GraphQL Playground: http://localhost:${port}/graphql`);
  logger.log(`🩺 Health: http://localhost:${port}/health`);
  logger.log(
    IS_PRODUCTION
      ? '🔒 production: Swagger TẮT · static /uploads TẮT · trust proxy = 1'
      : ` Swagger UI: http://localhost:${port}/api-docs`,
  );
  logger.log(`🌐 CORS origin cho phép: ${origins.join(', ')}`);
}

bootstrap();

