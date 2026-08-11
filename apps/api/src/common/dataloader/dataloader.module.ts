// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  DataloaderModule                                                        ║
// ║  Export DataloaderService để các feature module inject được.             ║
// ║                                                                          ║
// ║  HƯỚNG DẪN CODE LẠI:                                                     ║
// ║  1. Tạo module export DataloaderService.                                ║
// ║  2. Module này phải là GLOBAL để mọi resolver đều có thể inject.        ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

import { Global, Module } from '@nestjs/common';
import { DataloaderService } from './dataloader.service';

@Global()
@Module({
  providers: [DataloaderService],
  exports: [DataloaderService],
})
export class DataloaderModule {}
