import type { Mirror } from '../mirror';

type Vi = (typeof import('../vi/home'))['home'];

export const home: Mirror<Vi> = {
  // B1 — Trang chủ
  'home.suggestBannerTitle': 'Follow a few people to make your home feed fit you',
  'home.suggestBannerBody': 'You do not follow anyone yet, so this is explore content.',
  'home.dismissSuggest': 'Dismiss suggestions',
  'home.sourceTablist': 'Home feed source',
  'home.tabFollowing': 'Following',
  'home.tabExplore': 'Explore',
  'home.emptyFollowingTitle': 'You do not follow anyone yet',
  'home.emptyFollowingBody': 'When you follow someone, their new pins show up here.',
  'home.seeExplore': 'Go to Explore',

  // Khối gợi ý người theo dõi
  'home.followerCount': '{countText} follower|{countText} followers',
  'home.follow': 'Follow',
  'home.followed': 'Now following @{handle}',
  'home.followFailed': 'Could not follow, try again later.',
  'home.someone': 'this person',

  // Khối Khám phá — dải chip chủ đề
  'home.categoryTablist': 'Topic filter',
  'home.categoryAll': 'All',
  'home.exploreEmpty': 'No pins in this topic yet.',
  // ── Chip vòng + feed một vòng (XH-CIRCLE-FEED, luồng D) ──
  'home.emptyCircleTitle': 'Nothing here yet',
  'home.emptyCircleBody': 'No one has shared anything just for this circle. You could be the first.',
  'home.postToCircle': 'Post to this circle',
};
