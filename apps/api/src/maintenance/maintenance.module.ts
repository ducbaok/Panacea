import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { PurgeController } from './purge.controller';
import { PurgeScheduler } from './purge.scheduler';
import { PurgeService } from './purge.service';

/**
 * MaintenanceModule — việc bảo trì chạy nền, không thuộc module nghiệp vụ nào.
 *
 * `RedisModule` là `@Global()` nên `REDIS_CLIENT` inject được mà không cần
 * import ở đây (xem `redis.module.ts`).
 */
@Module({
  imports: [PrismaModule],
  controllers: [PurgeController],
  providers: [PurgeService, PurgeScheduler],
  exports: [PurgeService],
})
export class MaintenanceModule {}
