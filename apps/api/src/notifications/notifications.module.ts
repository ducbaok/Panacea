import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsResolver } from './notifications.resolver';
import { DeviceTokensController } from './device-tokens.controller';

@Module({
  providers: [NotificationsService, NotificationsResolver],
  controllers: [DeviceTokensController],
  exports: [NotificationsService],
})
export class NotificationsModule {}
