import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@antigravity/database';

/**
 * PrismaService — extends PrismaClient với NestJS lifecycle hooks.
 *
 * HƯỚNG DẪN CODE LẠI:
 * 1. @Injectable() class extends PrismaClient, implements OnModuleInit + OnModuleDestroy.
 * 2. Constructor: gọi super() với log config (development: ['query','warn','error'], production: ['error']).
 * 3. onModuleInit(): gọi this.$connect(), sau đó áp dụng soft delete middleware.
 * 4. onModuleDestroy(): gọi this.$disconnect().
 * 5. _applySoftDeleteMiddleware():
 *    - Danh sách models có soft delete: ['Pin', 'Comment', 'Board', 'Message'].
 *    - Intercept cả 'findMany' VÀ 'findFirst' actions.
 *    - Tự động inject { deletedAt: null } vào where clause.
 *    - LƯU Ý: findUnique KHÔNG được middleware intercept đáng tin cậy.
 *      → Khi query theo ID cho model soft-delete, dùng findFirst + { deletedAt: null } thay vì findUnique.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: process.env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['error'],
    });
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Database connected');
    this._applySoftDeleteMiddleware();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Tự động inject `deletedAt: null` vào mọi findMany + findFirst query
   * cho các model có soft delete, tránh bỏ sót lọc thủ công.
   *
   * HƯỚNG DẪN CODE LẠI:
   * 1. Khai báo danh sách models: ['Pin', 'Comment', 'Board', 'Message', 'User'].
   * 2. Khai báo danh sách actions: ['findMany', 'findFirst'].
   * 3. Dùng this.$use() để đăng ký middleware.
   * 4. Trong middleware: check model + action, inject deletedAt: null vào where.
   * 5. KHÔNG intercept findUnique vì Prisma có thể bypass middleware cho findUnique.
   *    Thay vào đó, service layer phải dùng findFirst + deletedAt: null.
   */
  private _applySoftDeleteMiddleware() {
    const softDeleteModels = ['Pin', 'Comment', 'Board', 'Message', 'User'];
    const interceptedActions = ['findMany', 'findFirst'];

    // @ts-ignore – $use là Prisma middleware API
    this.$use(async (params: any, next: any) => {
      if (
        softDeleteModels.includes(params.model) &&
        interceptedActions.includes(params.action)
      ) {
        params.args = params.args ?? {};
        params.args.where = { ...params.args.where, deletedAt: null };
      }
      return next(params);
    });
  }
}

