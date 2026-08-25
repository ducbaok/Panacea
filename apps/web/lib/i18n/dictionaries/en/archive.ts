import type { Mirror } from '../mirror';
import type { archive as vi } from '../vi/archive';

/** F2 (XH-10) — English mirror of `vi/archive.ts`. Lý do từng chuỗi: xem bản vi. */
export const archive: Mirror<typeof vi> = {
  'archive.tab': 'Archive',
  'archive.loading': 'Loading archive…',
  'archive.emptyTitle': 'Your archive is empty',
  'archive.emptyBody':
    'Pins you give a lifespan land here once they expire, with their comments intact.',

  // vi dùng số tháng ("Tháng 7"), en dùng TÊN tháng ("July") — cùng một call
  // site truyền cả `month` lẫn `monthName`, mỗi bản từ điển chọn cái mình cần.
  'archive.groupThisMonth': 'This month',
  'archive.groupMonth': '{monthName}',
  'archive.groupMonthYear': '{monthName} {year}',

  'archive.expiredHoursAgo': 'Expired {count} hour ago|Expired {count} hours ago',
  'archive.expiredDaysAgo': 'Expired {count} day ago|Expired {count} days ago',
  'archive.expiredMonthsAgo': 'Expired {count} month ago|Expired {count} months ago',
  'archive.expiredJustNow': 'Just expired',

  'archive.republish': 'Republish',
  'archive.republishConfirmTitle': 'Republish “{title}”?',
  'archive.republishConfirmBody':
    '{audience} will see this pin again. It goes back where it was, by its original post date, and the old comments are still there.',
  'archive.republished': 'Pin republished',
  'archive.republishFailed': 'Could not republish',

  'archive.audienceEveryone': 'Everyone',
  'archive.audienceFollowers': 'Your followers',
  'archive.audienceCircle': 'The {name} circle',
  'archive.audienceOnlyMe': 'Only you',

  'viewers.count': '{count} person viewed|{count} people viewed',
  'viewers.none': 'No views yet',
  'viewers.onlyYou': 'only you can see this line',
  'viewers.loading': 'Loading…',
  'viewers.emptyTitle': 'Nobody has opened this pin',
  'viewers.emptyBody':
    'You just posted it. When someone in the circle opens it, they show up here.',
  'viewers.note':
    'Sorted by first view, newest first. Guests have no name, so they never appear here. Anyone removed from the circle disappears from this list.',
};
