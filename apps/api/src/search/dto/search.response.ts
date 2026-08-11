import { ObjectType, Field } from '@nestjs/graphql';
import { PaginatedPins } from '../../pins/entities/pin.entity';
import { User, PaginatedUsers } from '../../users/entities/user.entity';
import { Board, PaginatedBoards } from '../../boards/entities/board.entity';

@ObjectType()
export class SearchResponse {
  @Field(() => PaginatedPins, { nullable: true })
  pins?: PaginatedPins;

  @Field(() => PaginatedUsers, { nullable: true })
  users?: PaginatedUsers;

  @Field(() => PaginatedBoards, { nullable: true })
  boards?: PaginatedBoards;
}
