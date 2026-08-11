import { Module } from '@nestjs/common';
import { CommentsService } from './comments.service';
import { CommentsResolver } from './comments.resolver';
import { PrismaModule } from '../prisma/prisma.module';
import { DataloaderModule } from '../common/dataloader';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PrismaModule, DataloaderModule, NotificationsModule],
  providers: [CommentsResolver, CommentsService],
  exports: [CommentsService],
})
export class CommentsModule {}
