import { registerEnumType } from '@nestjs/graphql';

export enum ReactionType {
  HEART = 'HEART',
  IDEA = 'IDEA',
  THANKS = 'THANKS',
  WOW = 'WOW',
  FUNNY = 'FUNNY',
}

registerEnumType(ReactionType, {
  name: 'ReactionType',
  description: 'Các loại reaction cho comment hoặc pin',
});
