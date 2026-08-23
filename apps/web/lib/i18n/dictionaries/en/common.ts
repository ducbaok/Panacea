import type { Mirror } from '../mirror';

type Vi = (typeof import('../vi/common'))['common'];

export const common: Mirror<Vi> = {
  // Metadata gốc (app/layout.tsx)
  'common.appDescription': 'Antigravity — save and discover inspiration through images.',

  // Nút và trạng thái dùng lại khắp app
  'common.save': 'Save',
  'common.saving': 'Saving…',
  'common.cancel': 'Cancel',
  'common.delete': 'Delete',
  'common.edit': 'Edit',
  'common.close': 'Close',
  'common.loading': 'Loading…',
  'common.loadMore': 'Load more',
  'common.retry': 'Try again',
  'common.back': 'Back',
  'common.goHome': 'Back to home',
  'common.checkNetwork': 'Check your connection and try again.',

  // Nhãn mặc định của ConfirmDialog
  'common.agree': 'OK',

  // D1 — Tìm kiếm
  'search.placeholder': 'Search pins, people, boards',
  'search.boxAria': 'Search box',
  'search.resultsFor': 'Results for “{query}”',
  'search.tabsAria': 'Result type',
  'search.tabPins': 'Pins',
  'search.tabUsers': 'People',
  'search.tabBoards': 'Boards',
  'search.prompt': 'Type a keyword to search pins, people and boards.',
  'search.loadFailed': 'Could not load the results',
  'search.noPins': 'No pins match',
  'search.noPinsHint': 'Try a shorter keyword, or look under People and Boards.',
  'search.noUsers': 'No people found',
  'search.noUsersHint': 'Try a different name or @username.',
  'search.noBoards': 'No boards match',
  'search.noBoardsHint': 'Try a shorter keyword, or look under Pins and People.',
  'search.unfollowFailed': 'Could not unfollow, try again later.',

  // Thời gian tương đối (lib/format.ts)
  'notif.justNow': 'Just now',
  'notif.minutesAgo': '{n} minute ago|{n} minutes ago',
  'notif.hoursAgo': '{n} hour ago|{n} hours ago',
  'notif.yesterday': 'Yesterday',
  'notif.daysAgo': '{n} day ago|{n} days ago',
  'notif.weeksAgo': '{n} week ago|{n} weeks ago',

  // D2 — Thông báo
  'notif.title': 'Notifications',
  'notif.typeFollow': 'started following you',
  'notif.typeComment': 'commented on your pin',
  'notif.typeReply': 'replied to your comment',
  'notif.typeSave': 'saved your pin',
  'notif.typeReaction': 'reacted to your pin',
  'notif.typeMention': 'mentioned you',
  'notif.markAllRead': 'Mark all as read',
  'notif.markAllFailed': 'Could not mark them, try again later.',
  'notif.reconnecting': 'Reconnecting…',
  'notif.loadFailed': 'Could not load notifications',
  'notif.empty': 'No notifications yet',
  'notif.emptyHint': 'When someone follows you, saves a pin or mentions you, it shows up here.',
  'notif.someone': 'Someone',
  'notif.unread': 'Unread',
};
