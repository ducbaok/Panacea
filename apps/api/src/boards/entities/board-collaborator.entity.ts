import { ObjectType, Field, ID, registerEnumType } from '@nestjs/graphql';
import { User } from '../../users/entities/user.entity';

export enum CollaboratorRole {
  VIEWER = 'VIEWER',
  EDITOR = 'EDITOR',
}

registerEnumType(CollaboratorRole, {
  name: 'CollaboratorRole',
  description: 'Role of a collaborator in a board',
});

/**
 * BoardCollaborator GraphQL entity.
 * 
 * HƯỚNG DẪN CODE LẠI:
 * 1. Export và register enum CollaboratorRole.
 * 2. Các field cơ bản: id, boardId, userId, role, createdAt.
 * 3. Thêm ResolveField user (kiểu User) để lấy thông tin collaborator.
 */
@ObjectType()
export class BoardCollaborator {
  @Field(() => ID)
  id: string;

  @Field()
  boardId: string;

  @Field()
  userId: string;

  @Field(() => CollaboratorRole, { defaultValue: CollaboratorRole.VIEWER })
  role: CollaboratorRole;

  @Field()
  createdAt: Date;

  // ─── Resolve Fields ───────────────────────────────────────────────

  @Field(() => User, { nullable: true })
  user?: User;
}
