import { Module } from '@nestjs/common';
import { MessagesService } from './messages.service';
import { MessagesResolver } from './messages.resolver';
import { SocialModule } from '../social/social.module';

@Module({
  imports: [SocialModule],
  providers: [MessagesResolver, MessagesService],
})
export class MessagesModule {}
