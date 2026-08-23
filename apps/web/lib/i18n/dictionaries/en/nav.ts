import type { Mirror } from '../mirror';

type Vi = (typeof import('../vi/nav'))['nav'];

export const nav: Mirror<Vi> = {
  'nav.home': 'Home',
  'nav.create': 'Create',
  'nav.notifications': 'Notifications',
  'nav.messages': 'Messages',
  'nav.profile': 'Profile',
  'nav.settings': 'Settings',
  'nav.login': 'Log in',
  'nav.register': 'Sign up',

  'nav.groupMain': 'Main',
  'nav.groupAccount': 'Account',
  'nav.groupStart': 'Get started',

  'nav.mainNavLabel': 'Main navigation',
  'nav.mobileNavLabel': 'Mobile navigation',
  'nav.collapse': 'Collapse',
  'nav.collapseSidebar': 'Collapse sidebar',
  'nav.expandSidebar': 'Expand sidebar',

  'nav.searchPlaceholder': 'Search pins, people, boards',
  'nav.searchBoxLabel': 'Search box',
  'nav.search': 'Search',

  'nav.notificationsAria': 'Notifications',
  'nav.notificationsAriaUnread': 'Notifications ({count} unread)',
  'nav.myProfile': 'My profile',
};
