import { Module } from '@nestjs/common';
import { CirclesService } from './circles.service';
import { CirclesResolver } from './circles.resolver';
import { PrismaModule } from '../prisma/prisma.module';
import { SocialModule } from '../social/social.module';

/**
 * CirclesModule — XH-3 (PLAN_XAHOI.md §6).
 *
 * ⚠️ KHÔNG import `DataloaderModule`. `DataloaderService` là `Scope.REQUEST`;
 * inject nó vào `CirclesService` (singleton) sẽ kéo cả nhánh phụ thuộc sang
 * request-scope — bẫy vòng đời đã ghi trong repo. Module này không cần loader
 * nào: trần 20 vòng × 50 thành viên đóng cứng kích thước mọi response.
 *
 * `SocialModule` vào đây để tái dùng xếp hạng bạn-của-bạn của `suggestedUsers`
 * (nó `exports: [SocialService]`). Đọc-only: không hàm nào ở đây ghi vào
 * `Follows`/`BlockedUser`.
 *
 * `exports: [CirclesService]` để đường ghi pin (luồng A, XH-4a) gọi được
 * `createAdHocCircle` — XH-QĐ-5 chốt "một cơ chế khán giả DUY NHẤT", nên chỗ
 * đó phải dùng lại hàm này chứ không dựng bản tìm-hoặc-tạo thứ hai.
 */
@Module({
  imports: [PrismaModule, SocialModule],
  providers: [CirclesService, CirclesResolver],
  exports: [CirclesService],
})
export class CirclesModule {}
