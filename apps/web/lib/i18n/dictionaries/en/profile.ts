import type { Mirror } from '../mirror';

type Vi = (typeof import('../vi/profile'))['profile'];

export const profile: Mirror<Vi> = {
  // Hook đổi ảnh đại diện / ảnh bìa
  'profile.avatarUpdated': 'Profile photo updated.',
  'profile.coverUpdated': 'Cover photo updated.',

  // C1 — Hồ sơ: trạng thái và nhãn
  'profile.loading': 'Loading profile…',
  'profile.loadFailed': 'Could not load this profile',
  'profile.notFound': 'User not found',
  'profile.notFoundBody': '@{username} does not exist, or the handle has changed.',
  'profile.blockedTitle': 'You blocked @{username}',
  'profile.followsYou': 'Follows you',
  'profile.followerLabel': 'follower|followers',
  'profile.followingLabel': 'following',

  // C1 — Hồ sơ: hàng nút
  'profile.editProfile': 'Edit profile',
  'profile.messages': 'Messages',
  'profile.follow': 'Follow',
  'profile.following': 'Following',
  'profile.unfollow': 'Unfollow',
  'profile.more': 'More',
  'profile.block': 'Block @{username}',
  'profile.unblock': 'Unblock',
  'profile.messagesMutualOnly': 'Messages open only when the two of you follow each other.',

  // C1 — Hồ sơ: hành động theo dõi/chặn
  'profile.nowFollowing': 'Now following {name}',
  'profile.followFailed': 'Could not follow, try again later.',
  'profile.unfollowed': 'Unfollowed {name}',
  'profile.undo': 'Undo',
  'profile.genericError': 'Something went wrong, try again later.',
  'profile.openChatFailed': 'Could not open the conversation. Please try again.',
  'profile.blockTitle': 'Block @{username}?',
  'profile.blockBody': 'They will not see your pins, and you will not see theirs.',
  'profile.blockYes': 'Block',
  'profile.blocked': 'Blocked @{username}',
  'profile.blockFailed': 'Could not block, try again later.',
  'profile.unblockTitle': 'Unblock @{username}?',
  'profile.unblockBody': 'They will see your pins again, and you will see theirs.',
  'profile.unblocked': 'Unblocked @{username}',
  'profile.unblockFailed': 'Could not unblock, try again later.',

  // C1 — Hồ sơ: tab và lưới
  'profile.tabPins': 'Pins',
  'profile.tabBoards': 'Boards',
  'profile.tabSaved': 'Saved',
  'profile.emptyPins': 'No pins to show',
  'profile.emptySavedSelf': 'You have not saved any pins yet',
  'profile.emptySavedOther': 'No saved pins yet',
  'profile.loadingBoards': 'Loading boards…',
  'profile.emptyBoards': 'No boards yet',
  'profile.secret': 'Private',
  'profile.pinCount': '{countText} pin|{countText} pins',
  'profile.changeCover': 'Change cover photo',
  'profile.changeAvatar': 'Change profile photo',

  // C3 — Follower / Following
  'profile.emptyFollowers': 'No followers yet',
  'profile.emptyFollowing': 'Not following anyone yet',
  'profile.followToggleFailed': 'Could not change the follow state, try again later.',
  'profile.backToProfile': 'Back to the profile',
  'profile.followTabsAria': 'Followers and Following',
  'profile.followerCount': '{countText} follower|{countText} followers',
  'profile.followingCount': '{countText} following',
  'profile.listLoadFailed': 'Could not load the list',
};
