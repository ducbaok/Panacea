import { common } from './vi/common';
import { nav } from './vi/nav';
import { auth } from './vi/auth';
import { home } from './vi/home';
import { pin } from './vi/pin';
import { board } from './vi/board';
import { profile } from './vi/profile';
import { messages } from './vi/messages';
import { settings } from './vi/settings';
import { circles } from './vi/circles';
import { errors } from './vi/errors';

/**
 * Từ điển tiếng Việt — NGUỒN KEY DUY NHẤT của app.
 *
 * Chia theo namespace để mỗi màn sửa một file, không ai phải mở một file
 * 500 dòng chung. Key đã gắn sẵn tiền tố namespace ('nav.home', …) nên spread
 * phẳng ở đây không thể đụng key nhau.
 */
export const vi = {
  ...common,
  ...nav,
  ...auth,
  ...home,
  ...pin,
  ...board,
  ...profile,
  ...messages,
  ...settings,
  ...circles,
  ...errors,
} as const;
