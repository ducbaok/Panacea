import type { Mirror } from '../mirror';

type Vi = (typeof import('../vi/circles'))['circles'];

export const circles: Mirror<Vi> = {
  // ── Audience picker (XH-AUD) ──
  'circles.audienceLabel': 'Who can see this pin',
  'circles.visPublic': 'Public',
  'circles.visPublicSub': 'Anyone can see it, even people who are not signed in',
  'circles.visFollowers': 'Followers',
  'circles.visFollowersSub': '{count} people follow you',
  'circles.visFollowersSubUnknown': 'The people who follow you',
  'circles.visCircle': 'One circle',
  'circles.visCircleSub': 'Pick exactly one circle — mixing two means making a new one',
  'circles.visOnlyMe': 'Only me',
  'circles.visOnlyMeSub': 'Nobody else sees this pin',
  'circles.yourCircles': 'Your circles',
  'circles.memberCount': '{count} person|{count} people',
  'circles.rankSuffix': 'closeness {rank}',
  'circles.noRank': 'no closeness set',
  'circles.pickPeopleInline': '+ Pick people right here',
  'circles.adhocHeading': 'Pick people — suggested from friends of friends',
  'circles.adhocNone': 'Nobody picked yet',
  'circles.adhocChosen': '{count} person picked|{count} people picked',
  'circles.saveThisCircle': 'Save this circle',
  'circles.adhocNote':
    'You can post without saving — an on-the-spot circle needs no name and never shows up in your circle list.',
  'circles.adhocSaved': 'Circle saved',
  'circles.adhocSavePrompt': 'Name this circle',
  'circles.pickerEmptyTitle': 'You have no circles yet',
  'circles.pickerEmptyBody':
    'A circle is the group of people you want to share privately with. Make one, then come back here.',
  'circles.createCircle': 'Create a circle',
  'circles.adHocName': 'Group of {count}',
  'circles.sharedPrivately': 'Shared privately',

  // ── Lifespan (QĐ-23) ──
  'circles.expiryHeading': 'Lifespan',
  'circles.expiryNone': 'No limit',
  'circles.expiry24h': '24 hours',
  'circles.expiry7d': '7 days',
  'circles.expiryCustom': 'Pick a time…',
  'circles.expiryDate': 'Date',
  'circles.expiryTime': 'Time',
  'circles.expiryEcho': 'Expires {time} on {date} — {left}.',
  'circles.expiryPast': 'Pick a moment in the future.',
  'circles.expiryNoteNone': 'The pin stays until you delete it.',
  'circles.expiryNoteSet':
    'Once it expires the pin disappears from every surface — your own profile included — and lands in the Archive. Comments and reactions stay.',
  'circles.leftHours': '{count} hour left|{count} hours left',
  'circles.leftDays': '{count} day left|{count} days left',

  // ── Misposting guard: private → public confirm ──
  'circles.confirmPublicTitle': 'Make this pin public?',
  'circles.confirmPublicBody':
    'Right now only {audience} can see it. Public means anyone can, including people who are not signed in.',
  'circles.confirmPublicYes': 'Make it public',
  'circles.audienceCircleName': 'the {name} circle',
  'circles.audienceFollowers': 'the people who follow you',
  'circles.audienceOnlyMe': 'you',
  'circles.audienceEveryone': 'everyone',

  // ── Circle management in /settings (XH-CIRCLES) ──
  'circles.title': 'Circles',
  'circles.subtitle':
    'One-way: the people you add are never asked and never notified. Leaving a circle removes access to past pins too, silently.',
  'circles.settingsCardBody':
    'The groups you share privately with. One-way — the people you add are never asked and never notified.',
  'circles.settingsCardAction': 'Manage circles',
  'circles.settingsCardCount': '{count} circle|{count} circles',
  'circles.capNote':
    'Caps: 20 circles per account (on-the-spot ones included) · 50 people per circle. On-the-spot circles never show up on this screen.',
  'circles.newCircle': 'New circle',
  'circles.emptyListTitle': 'You have no circles yet',
  'circles.emptyListBody':
    'A circle is the group of people you want to share privately with — close friends, family, a shared-hobby group.',
  'circles.createFirst': 'Create your first circle',
  'circles.backAll': 'All circles',
  'circles.editNameRank': 'Edit name / closeness',
  'circles.duplicate': 'Duplicate circle',
  'circles.deleteCircle': 'Delete circle',
  'circles.noMembersTitle': 'This circle is empty',
  'circles.noMembersBody':
    'A pin shared with an empty circle is visible to nobody — same as Only me. Add people below.',
  'circles.addPeople': 'Add people',
  'circles.searchPlaceholder': 'Type a name or @username',
  'circles.suggestHeading': 'Suggested from friends of friends',
  'circles.searchHeading': 'Search results',
  'circles.add': 'Add',
  'circles.drop': 'Remove',
  'circles.loadFailed': 'Could not load your circles.',
  'circles.notFound': 'That circle does not exist, or it is not yours.',

  'circles.namePrompt': 'Circle name',
  'circles.namePlaceholder': 'Close friends, Family, Cooking crew…',
  'circles.rankPrompt': 'Closeness (optional)',
  'circles.rankPlaceholder': 'Lower number = closer',
  'circles.duplicateNameSuffix': '{name} (2)',
  'circles.created': 'Circle “{name}” created',
  'circles.updated': 'Changes saved',
  'circles.duplicated': 'Copy “{name}” created',
  'circles.deleted': 'Circle deleted',
  'circles.memberAdded': 'Added {name} to the circle',
  'circles.memberDropped': 'Removed {name}',

  'circles.confirmDropTitle': 'Remove {name} from this circle?',
  'circles.confirmDropBody':
    'They lose access to every pin shared with this circle, past ones included. No notification is sent.',
  'circles.confirmDropYes': 'Remove from circle',
  'circles.confirmDeleteTitle': 'Delete the “{name}” circle?',
  'circles.confirmDeleteBody':
    'Everyone in it loses access to the pins shared with this circle. The pins themselves are not deleted.',
  'circles.confirmDeleteYes': 'Delete circle',

  // ── Capture screen (XH-CAM) ──
  'capture.open': 'Take a photo',
  'capture.back': 'Back to creating the pin',
  'capture.title': 'Take a photo',
  'capture.subtitle':
    'When you are done you continue into the audience picker — there is no second posting flow.',
  'capture.promptTitle': 'Panacea needs your camera',
  'capture.promptBody': 'The photo only leaves your machine when you press Publish.',
  'capture.allow': 'Allow camera',
  'capture.pickFromDisk': 'Pick a photo from this device',
  'capture.deniedTitle': 'Your browser is blocking the camera',
  'capture.deniedBody':
    'Open the padlock in the address bar → Camera → Allow, then reload the page. Or just pick an existing photo as before.',
  'capture.noCamNote':
    'No camera found on this device — the shutter stays dimmed instead of hidden so you know the feature exists. Use “Pick a photo from this device”.',
  'capture.insecureNote':
    'The camera only works over HTTPS or on localhost, and this page is neither — use “Pick a photo from this device”.',
  'capture.shoot': 'Shoot',
  'capture.use': 'Use this photo',
  'capture.retake': 'Retake',
  'capture.reviewNote':
    'EXIF orientation is preserved — a portrait photo must not come out landscape. imageWidth/Height sent to the API are the original measurements so the grid reserves the right slot.',
  'capture.startFailed': 'Could not open the camera. Try picking a photo from this device.',
  'capture.previewAlt': 'The photo you just took',
  'capture.streamAria': 'Camera viewfinder',
};
