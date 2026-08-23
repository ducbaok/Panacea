import type { Mirror } from '../mirror';

type Vi = (typeof import('../vi/messages'))['messages'];

export const messages: Mirror<Vi> = {
  // D4 — Danh sách trò chuyện
  'messages.title': 'Messages',
  'messages.reconnecting': 'Reconnecting…',
  'messages.listLoadFailed': 'Could not load your conversations.',
  'messages.emptyList': 'No conversations yet.',
  'messages.mutualOnly': 'Messages open only when the two of you follow each other.',
  'messages.pickConversation': 'Pick a conversation to get started.',
  'messages.someUser': 'Someone',
  'messages.unread': 'Unread',
  'messages.sentAPin': 'Sent a pin',

  // D4 — Khung chat
  'messages.revoked': 'Message deleted',
  'messages.revoke': 'Delete',
  'messages.revokeTitle': 'Delete this message?',
  'messages.revokeBody': 'It disappears for both of you.',
  'messages.revokeFailed': 'Could not delete it. Please try again.',
  'messages.sendFailed': 'Could not send it. Please try again.',
  'messages.loadFailed': 'Could not load the messages.',
  'messages.emptyThread': 'No messages yet. Say hello.',
  'messages.loadOlder': 'Load older messages',
  'messages.attachPinSoon': 'Attaching a pin is coming in a later version',
  'messages.composerPlaceholder': 'Say something',
  'messages.send': 'Send',

  // D4 — Lỗi messaging (backend trả tiếng Anh)
  'messages.errMutualRequired': 'Messages open only when the two of you follow each other.',
  'messages.errBlocked': 'This conversation cannot open because one of you blocked the other.',
  'messages.errSelf': 'You cannot message yourself.',
  'messages.errNotMember': 'You are no longer part of this conversation.',
  'messages.errNotOwnMessage': 'You can only delete your own messages.',
  'messages.errGeneric': 'Something went wrong. Please try again.',
};
