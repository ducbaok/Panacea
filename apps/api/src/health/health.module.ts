import { Module } from '@nestjs/common';

import { HealthController } from './health.controller';

/**
 * HealthModule — `PrismaModule` và `RedisModule` đều `@Global()` nên
 * `PrismaService` / `REDIS_CLIENT` inject được mà không cần import.
 */
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
