import { Color } from 'expo-router';
import { Platform } from 'react-native';

export const colors = {
  background: '#F6F5FB',
  card: '#FFFFFF',
  cardMuted: '#F1F1F6',
  label: Platform.select({
    ios: Color.ios.label,
    android: Color.android.dynamic.onSurface,
    default: '#111114',
  })!,
  secondaryLabel: Platform.select({
    ios: Color.ios.secondaryLabel,
    android: Color.android.dynamic.onSurfaceVariant,
    default: '#73737B',
  })!,
  tertiaryLabel: Platform.select({
    ios: Color.ios.tertiaryLabel,
    android: Color.android.dynamic.onSurfaceVariant,
    default: '#A0A0A8',
  })!,
  separator: Platform.select({
    ios: Color.ios.separator,
    android: Color.android.dynamic.outlineVariant,
    default: '#E6E6EA',
  })!,
  blue: '#3479C8',
  blueTint: '#EAF2FC',
  red: '#E3515D',
  orange: '#F39A31',
  white: '#FFFFFF',
};

export const layout = {
  horizontalPadding: 20,
  bottomBarHeight: 72,
  bottomContentInset: 130,
};
