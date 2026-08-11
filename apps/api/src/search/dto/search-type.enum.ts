import { registerEnumType } from '@nestjs/graphql';

export enum SearchType {
  PIN = 'PIN',
  USER = 'USER',
  BOARD = 'BOARD',
}

registerEnumType(SearchType, {
  name: 'SearchType',
});
