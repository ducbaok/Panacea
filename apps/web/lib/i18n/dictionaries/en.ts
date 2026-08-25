import type { Mirror } from './mirror';
import type { vi } from './vi';
import { common } from './en/common';
import { nav } from './en/nav';
import { auth } from './en/auth';
import { home } from './en/home';
import { pin } from './en/pin';
import { board } from './en/board';
import { profile } from './en/profile';
import { messages } from './en/messages';
import { settings } from './en/settings';
import { circles } from './en/circles';
import { archive } from './en/archive';
import { errors } from './en/errors';

/**
 * Từ điển tiếng Anh. Kiểu `Mirror<typeof vi>` là chốt an toàn cuối cùng:
 * thiếu MỘT key so với vi là build đỏ.
 */
export const en: Mirror<typeof vi> = {
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
  ...archive,
  ...errors,
};
