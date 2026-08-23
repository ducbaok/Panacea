import type { Mirror } from '../mirror';

type Vi = (typeof import('../vi/settings'))['settings'];

export const settings: Mirror<Vi> = {
  // Khối Hồ sơ
  'settings.title': 'Settings',
  'settings.profile': 'Profile',
  'settings.changeAvatar': 'Change profile photo',
  'settings.uploadingAvatar': 'Uploading photo…',
  'settings.avatarHint': 'Square image, at least 200×200.',
  'settings.displayName': 'Display name',
  'settings.bio': 'Bio',
  'settings.savedProfile': 'Profile saved',
  'settings.saveFailed': 'Could not save, try again later.',

  // Khối Giao diện + ThemeToggle
  'settings.appearance': 'Appearance',
  'settings.appearanceHint': 'Three states. “System” keeps following your device setting.',
  'settings.themeGroupLabel': 'Display mode',
  'settings.themeLight': 'Light',
  'settings.themeLightTitle': 'Light theme',
  'settings.themeDark': 'Dark',
  'settings.themeDarkTitle': 'Dark theme',
  'settings.themeAuto': 'Auto',
  'settings.themeAutoTitle': 'Follow system',

  // Khối Ngôn ngữ + LanguageToggle
  'settings.language': 'Language',
  'settings.languageHint': 'Saved on this device — you can switch it without signing in.',
  'settings.languageGroupLabel': 'Display language',

  // Khối Tài khoản
  'settings.account': 'Account',
  'settings.accountHint': 'Manage the people you blocked and end your session.',
  'settings.blocked': 'Blocked people',
  'settings.blockedCount': '{countText} person|{countText} people',
  'settings.signOut': 'Sign out',

  // Khối Xoá tài khoản
  'settings.deleteAccount': 'Delete account',
  'settings.deleteHint': 'Two-step confirmation. This cannot be undone.',
  'settings.deleteTitle': 'Delete your account?',
  'settings.deleteBody': 'All of your pins, boards and comments will stop being shown. This cannot be undone.',
  'settings.deleteContinue': 'Continue',
  'settings.deleteFinalTitle': 'Final confirmation',
  'settings.deleteFinalBody': 'Are you sure you want to delete your account? You will be signed out immediately.',
  'settings.deleteForever': 'Delete permanently',
  'settings.deleteFailed': 'Could not delete, try again later.',

  // Màn C2b — Người đã chặn
  'settings.blockedLoadFailed': 'Could not load the list',
  'settings.blockedEmpty': 'You haven’t blocked anyone',
  'settings.blockedEmptyHint': 'People you block appear here so you can unblock them when you want.',
  'settings.unblock': 'Unblock',
  'settings.unblockTitle': 'Unblock {handle}?',
  'settings.unblockBody': 'They will see your pins again, and you will see theirs.',
  'settings.unblockDone': 'Unblocked {handle}',
  'settings.unblockFailed': 'Could not unblock, try again later.',
};
