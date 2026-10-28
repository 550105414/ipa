import type MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps } from 'react';

type AndroidIconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

// Keep persisted category/icon identifiers shared with iOS. Only their Android
// presentation changes; Apple SF Symbols are not available to Android's loader.
export const ANDROID_SYMBOLS = {
  'square.grid.2x2': 'view-grid-outline',
  'square.grid.2x2.fill': 'view-grid',
  calendar: 'calendar-blank-outline',
  'calendar.badge.clock': 'calendar-clock-outline',
  'calendar.badge.minus': 'calendar-minus',
  'calendar.badge.plus': 'calendar-plus',
  'calendar.circle.fill': 'calendar-edit',
  'checkmark.circle': 'check-circle-outline',
  'checkmark.circle.fill': 'check-circle',
  checkmark: 'check',
  'chevron.right': 'chevron-right',
  plus: 'plus',
  star: 'star-outline',
  'star.fill': 'star',
  repeat: 'repeat',
  clock: 'clock-outline',
  'list.bullet': 'format-list-bulleted',
  'list.bullet.rectangle': 'clipboard-list-outline',
  'plus.square.on.square': 'plus-box-multiple-outline',
  'rectangle.on.rectangle': 'widgets-outline',
  'person.crop.rectangle.stack': 'card-account-details-outline',
  'person.2': 'account-multiple-outline',
  'person.2.fill': 'account-multiple',
  'person.badge.plus': 'account-plus-outline',
  'key.fill': 'key',
  'key.slash': 'key-remove',
  'lock.shield.fill': 'shield-lock',
  'wand.and.stars': 'auto-fix',
  'bell.badge': 'bell-badge-outline',
  eye: 'eye-outline',
  'eye.slash': 'eye-off-outline',
  'checkmark.seal.fill': 'check-decagram',
  'link.badge.plus': 'link-plus',
  'exclamationmark.arrow.triangle.2.circlepath': 'sync-alert',
  'arrow.triangle.2.circlepath': 'sync',
  'exclamationmark.triangle.fill': 'alert',
  'square.and.arrow.up': 'export-variant',
  'square.and.arrow.down': 'import',
  magnifyingglass: 'magnify',
  archivebox: 'archive-outline',
  'phone.fill': 'phone',
  pencil: 'pencil-outline',
  trash: 'trash-can-outline',
  photo: 'image-outline',
  'photo.on.rectangle': 'image-multiple-outline',
  'bolt.fill': 'lightning-bolt',
  'exclamationmark.circle.fill': 'alert-circle',
  tray: 'inbox-outline',
  megaphone: 'bullhorn-outline',
  'building.2': 'office-building-outline',
  'book.closed': 'book-outline',
  film: 'movie-outline',
  cart: 'cart-outline',
  'cart.fill': 'cart',
  'message.fill': 'message',
  'gamecontroller.fill': 'gamepad-variant',
  'building.columns.fill': 'bank',
  'briefcase.fill': 'briefcase',
  'folder.fill': 'folder',
  globe: 'web',
} satisfies Record<string, AndroidIconName>;

export function getAndroidSymbol(name: string): AndroidIconName {
  return Object.prototype.hasOwnProperty.call(ANDROID_SYMBOLS, name)
    ? ANDROID_SYMBOLS[name as keyof typeof ANDROID_SYMBOLS]
    : 'circle-outline';
}
