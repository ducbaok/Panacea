// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  PinsModule                                                              ║
// ║  NestJS module cho Pin feature.                                         ║
// ║                                                                          ║
// ║  HƯỚNG DẪN CODE LẠI:                                                     ║
// ║  1. Import cần thiết: không cần import DataloaderModule vì nó là Global.║
// ║  2. providers: PinsResolver + PinsService                               ║
// ║  3. controllers: PinsController (cho Lambda callback REST endpoint)     ║
// ║  4. exports: PinsService (có thể cần ở module khác)                    ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

import { Module } from '@nestjs/common';
import { PinsService } from './pins.service';
import { PinsResolver } from './pins.resolver';
import { TaxonomyResolver } from './taxonomy.resolver';
import { PinsController } from './pins.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { DataloaderModule } from '../common/dataloader';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PrismaModule, DataloaderModule, NotificationsModule],
  controllers: [PinsController],
  // `TaxonomyResolver` ở đây chứ không ở module riêng: nó chỉ có nghĩa trong
  // ngữ cảnh gắn nhãn cho pin. Nó chỉ cần `PrismaService` (đã có qua
  // `PrismaModule` ở trên), không đụng `PinsService`.
  providers: [PinsResolver, TaxonomyResolver, PinsService],
  exports: [PinsService],
})
export class PinsModule {}
