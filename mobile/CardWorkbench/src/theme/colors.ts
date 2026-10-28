import { Color } from 'expo-router';
import { Platform } from 'react-native';

export const colors = {
  background: '#F6F5FB',
  card: '#FFFFFF',
  cardMuted: '#F1F1F6',
  label: Platform.select({
    ios: Color.ios.label,
    // The current screen/card canvas is light on both system themes. Dynamic
    // onSurface becomes light in dark mode and disappears on these white cards.
    android: '#111114',
    default: '#111114',
  })!,
  secondaryLabel: Platform.select({
    ios: Color.ios.secondaryLabel,
    android: '#73737B',
    default: '#73737B',
  })!,
  tertiaryLabel: Platform.select({
    ios: Color.ios.tertiaryLabel,
    android: '#A0A0A8',
    default: '#A0A0A8',
  })!,
  separator: Platform.select({
    ios: Color.ios.separator,
    android: '#E6E6EA',
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
