// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  Search Service                                                           ║
// ║                                                                           ║
// ║  HƯỚNG DẪN CODE LẠI:                                                      ║
// ║  1. searchPins:                                                           ║
// ║     - Yêu cầu full-text search PostgreSQL.                                ║
// ║     - (TODO) Dùng prisma.$queryRaw cho tsvector hoặc Prisma Preview       ║
// ║       fullTextSearch. Ở đây tạm dùng contains để đơn giản.                ║
// ║     - Filter blocked users (chỉ lấy pin của creator không bị block).      ║
// ║  2. searchUsers:                                                          ║
// ║     - OR [ { username: { contains } }, { name: { contains } } ].          ║
// ║     - Lọc bỏ blockedUsers.                                                ║
// ║  3. searchBoards:                                                         ║
// ║     - OR [ { name: { contains } }, { description: { contains } } ].       ║
// ║     - Filter blocked users.                                               ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildCursorFilter,
  buildCursorOrderBy,
  toPaginatedResult,
} from '../common/pagination';
// Đợt 3e — thân hàm `getBlockedUserIds` trước đây nằm ngay trong class này
// (`private`, :30-41). Chuyển ra common/blocking để PinsService dùng chung
// CÙNG một định nghĩa "ai bị chặn". Hành vi giữ nguyên từng chữ.
import { getBlockedUserIds } from '../common/blocking';

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async searchPins(userId: string | undefined, query: string, limit: number, cursor?: string) {
    const blockedIds = await getBlockedUserIds(this.prisma, userId);

    const pins = await this.prisma.pin.findMany({
      where: {
        AND: [
          {
            OR: [
              { title: { contains: query, mode: 'insensitive' } },
              { description: { contains: query, mode: 'insensitive' } }
            ]
          },
          { deletedAt: null },
          { creatorId: { notIn: blockedIds } },
          // Keyset cursor phải là một phần tử RIÊNG trong AND: bản thân nó đã
          // chứa `OR`, spread chung với `OR` của điều kiện tìm kiếm ở trên thì
          // một trong hai sẽ bị ghi đè mất.
          buildCursorFilter(cursor, 'desc'),
        ]
      },
      take: limit + 1,
      orderBy: buildCursorOrderBy('desc'),
    });

    return toPaginatedResult(pins, limit);
  }

  async searchUsers(userId: string | undefined, query: string, limit: number, cursor?: string) {
    const blockedIds = await getBlockedUserIds(this.prisma, userId);

    const users = await this.prisma.user.findMany({
      where: {
        AND: [
          {
            OR: [
              { username: { contains: query, mode: 'insensitive' } },
              { name: { contains: query, mode: 'insensitive' } }
            ]
          },
          { deletedAt: null },
          { id: { notIn: blockedIds } },
          buildCursorFilter(cursor, 'desc'),
        ]
      },
      take: limit + 1,
      orderBy: buildCursorOrderBy('desc'),
    });

    return toPaginatedResult(users, limit);
  }

  async searchBoards(userId: string | undefined, query: string, limit: number, cursor?: string) {
    const blockedIds = await getBlockedUserIds(this.prisma, userId);

    const boards = await this.prisma.board.findMany({
      where: {
        AND: [
          {
            OR: [
              { name: { contains: query, mode: 'insensitive' } },
              { description: { contains: query, mode: 'insensitive' } }
            ]
          },
          { deletedAt: null },
          { userId: { notIn: blockedIds } },
          { isSecret: false }, // Only search public boards
          buildCursorFilter(cursor, 'desc'),
        ]
      },
      take: limit + 1,
      orderBy: buildCursorOrderBy('desc'),
    });

    return toPaginatedResult(boards, limit);
  }
}
