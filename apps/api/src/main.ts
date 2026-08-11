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
async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['log', 'error', 'warn', 'debug'],
  });

  // Serve static files from the uploads directory
  app.useStaticAssets(join(process.cwd(), 'uploads'), {
    prefix: '/uploads/',
  });

  const logger = new Logger('Bootstrap');

  // ── Security ────────────────────────────────────────────────────────────────
  app.use(
    helmet({
      // GraphQL playground cần bỏ CSP trong development
      contentSecurityPolicy: process.env.NODE_ENV === 'production' ? undefined : false,
    }),
  );

  // ── CORS ─────────────────────────────────────────────────────────────────────
  app.enableCors({
    origin: process.env.WEB_URL ?? 'http://localhost:3000',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // ── Swagger Documentation ──────────────────────────────────────────────────
  const config = new DocumentBuilder()
    .setTitle('Pinterest Clone REST API')
    .setDescription('The Pinterest Clone REST API documentation')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api-docs', app, document);

  // ── Global prefix ────────────────────────────────────────────────────────────
  // GraphQL tại /graphql, REST tại /api/*
  // Không dùng global prefix để /auth/... giữ nguyên theo PLAN.md

  const port = process.env.PORT ?? 4000;
  await app.listen(port);

  logger.log(`🚀 API running on http://localhost:${port}`);
  logger.log(`📊 GraphQL Playground: http://localhost:${port}/graphql`);
  logger.log(` Swagger UI: http://localhost:${port}/api-docs`);
}

bootstrap();

