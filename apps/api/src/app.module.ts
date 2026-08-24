import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { GqlThrottlerGuard } from './common/guards/gql-throttler.guard';
import { APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';

import { configuration, validationSchema } from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { MailModule } from './mail/mail.module';
import { AuthModule } from './auth/auth.module';
import { buildGraphqlContext, createWsOnConnect } from './auth/ws-auth';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { UsersModule } from './users/users.module';
import { PinsModule } from './pins/pins.module';
import { UploadsModule } from './uploads/uploads.module';
import { DataloaderModule } from './common/dataloader';
import { SocialModule } from './social/social.module';
import { CirclesModule } from './circles/circles.module';
import { BoardsModule } from './boards/boards.module';
import { CommentsModule } from './comments/comments.module';
import { SearchModule } from './search/search.module';
import { NotificationsModule } from './notifications/notifications.module';
import { MessagesModule } from './messages/messages.module';
import { ScheduleModule } from '@nestjs/schedule';
import { MaintenanceModule } from './maintenance/maintenance.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    // ── Config (env validation) ──────────────────────────────────────────────
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema,
      validationOptions: { abortEarly: false },
    }),

    // ── Rate Limiting ────────────────────────────────────────────────────────
    ThrottlerModule.forRoot([
      { name: 'global', ttl: 60_000, limit: 100 },   // 100 req/min per IP
    ]),

    // ── Lịch chạy nền (B-9) ──────────────────────────────────────────────────
    // `forRoot()` chỉ bật bộ quét decorator `@Cron`. Bản thân nó không đăng ký
    // job nào — job nằm ở `MaintenanceModule`. Thiếu dòng này thì `@Cron` trở
    // thành decorator KHÔNG LÀM GÌ: build sạch, app chạy, job không bao giờ nổ.
    ScheduleModule.forRoot(),

    // ── Core Infrastructure ──────────────────────────────────────────────────
    PrismaModule,
    RedisModule,
    MailModule,

    // ── GraphQL ──────────────────────────────────────────────────────────────
    GraphQLModule.forRootAsync<ApolloDriverConfig>({
      driver: ApolloDriver,
      // JwtModule ở đây chỉ để `onConnect` verify token lúc handshake WebSocket.
      // ConfigModule là global nên ConfigService inject được mà không cần import.
      imports: [JwtModule.register({})],
      inject: [JwtService, ConfigService],
      useFactory: (jwtService: JwtService, configService: ConfigService) => ({
        autoSchemaFile: 'schema.graphql',
        introspection: process.env.NODE_ENV !== 'production',

        // `context` được gọi cho CẢ HTTP lẫn WebSocket nhưng với tham số khác
        // nhau hoàn toàn. buildGraphqlContext() chuẩn hóa về `{ req, res }`
        // để GqlAuthGuard / @CurrentUser() dùng chung một đường. Chi tiết
        // trong `auth/ws-auth.ts`.
        context: buildGraphqlContext,

        subscriptions: {
          'graphql-ws': {
            // Xác thực NGAY ở handshake: token sai ⇒ socket bị đóng (4403),
            // không mở được kết nối chứ không phải mở rồi mới chặn.
            onConnect: createWsOnConnect(jwtService, configService),
          },
          // 'subscriptions-transport-ws' ĐÃ BỊ GỠ (P0 #3).
          // Lý do: protocol này deprecated, và nếu bật song song thì nó là một
          // cổng WebSocket THỨ HAI không đi qua `onConnect` ở trên → client chỉ
          // cần đổi subprotocol là bỏ qua toàn bộ lớp xác thực vừa thêm.
          // Chưa có client nào tồn tại (Web/Android 0%) nên gỡ là an toàn.
        },
      }),
    }),

    // ── Infrastructure ─────────────────────────────────────────────────────────
    DataloaderModule,

    // ── Feature Modules ──────────────────────────────────────────────────────
    AuthModule,
    UsersModule,
    PinsModule,
    UploadsModule,
    SocialModule,
    // XH-3 — vòng tròn bạn bè (PLAN_XAHOI.md §6). Đặt ngay sau SocialModule
    // vì nó dùng lại xếp hạng bạn-của-bạn của `suggestedUsers`.
    CirclesModule,
    BoardsModule,
    CommentsModule,
    NotificationsModule,
    MessagesModule,
    SearchModule,
    MaintenanceModule,
    // HT-3 #2 — health check THẬT. `AppController` (di sản `nest new`) chưa
    // từng được đăng ký ở đây, nên trước 17/08 `GET /` trả **404** và ALB sẽ
    // không bao giờ thấy task nào healthy. Đã xoá `AppController`/`AppService`.
    HealthModule,
  ],
  providers: [
    // Global rate limiting
    { provide: APP_GUARD, useClass: GqlThrottlerGuard },
    // Global validation pipe (class-validator)
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,          // strip unknown fields
        forbidNonWhitelisted: true,
        transform: true,          // auto-transform types
        transformOptions: { enableImplicitConversion: true },
      }),
    },
  ],
})
export class AppModule {}

