// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║  HomeFeed — kết quả của `homeFeed`, kèm NGUỒN đã chọn                    ║
// ║                                                                          ║
// ║  Vì sao `source` là một type RIÊNG chứ không nhét vào `PageInfo`:        ║
// ║  `PageInfo` dùng chung cho MỌI query phân trang của app (exploreFeed,    ║
// ║  userPins, followers, messages…). Thêm một field chỉ có nghĩa với        ║
// ║  homeFeed vào đó sẽ bắt mọi query khác phải khai một giá trị vô nghĩa —  ║
// ║  và SDL chỉ chứa được MỘT type tên `PageInfo`, nên sai lầm này không     ║
// ║  cục bộ hoá lại được về sau.                                             ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

import { ObjectType, Field, registerEnumType } from '@nestjs/graphql';
import { createPaginatedType } from '../../common/pagination';
import { Pin } from './pin.entity';

/**
 * Nguồn dữ liệu thật sự đã dùng để dựng trang này.
 *
 * Client CẦN biết giá trị này, không phải để hiển thị cho đẹp: người dùng bấm
 * Follow giữa lúc đang cuộn sẽ làm nhánh đổi từ EXPLORE sang FOLLOWING ở trang
 * kế tiếp. Cursor của trang trước KHÔNG còn nghĩa gì khi điều đó xảy ra (nó là
 * vị trí trong một tập hợp khác), nên client thấy `source` đổi thì phải bỏ
 * cursor và tải lại từ đầu. Không lộ `source` ra thì client không có cách nào
 * biết — và triệu chứng là pin bị nhảy cóc, không phải một lỗi.
 */
export enum FeedSource {
  /** Có ít nhất 1 người đang follow ⇒ pin của những người đó. */
  FOLLOWING = 'FOLLOWING',
  /** Chưa follow ai ⇒ rơi về explore feed để trang chủ không rỗng. */
  EXPLORE = 'EXPLORE',
}

registerEnumType(FeedSource, {
  name: 'FeedSource',
  description: 'Nguồn dữ liệu đã dùng để dựng trang homeFeed hiện tại.',
});

@ObjectType()
export class HomeFeed extends createPaginatedType(Pin) {
  @Field(() => FeedSource)
  source: FeedSource;
}
