import { Module } from '@nestjs/common';
import { BoardsService } from './boards.service';
import { BoardsResolver, BoardCollaboratorsResolver, SavedPinsResolver } from './boards.resolver';
import { PrismaModule } from '../prisma/prisma.module';
import { DataloaderModule } from '../common/dataloader';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PrismaModule, DataloaderModule, NotificationsModule],
  providers: [
    BoardsService,
    BoardsResolver,
    BoardCollaboratorsResolver,
    SavedPinsResolver,
  ],
  exports: [BoardsService],
})
export class BoardsModule {}
