import { Image } from 'expo-image';
import type { ColorValue, ImageStyle, StyleProp } from 'react-native';

type SymbolIconProps = {
  name: string;
  color: ColorValue;
  size?: number;
  style?: StyleProp<ImageStyle>;
};

export function SymbolIcon({ name, color, size = 20, style }: SymbolIconProps) {
  return (
    <Image
      source={`sf:${name}`}
      tintColor={color as string}
      contentFit="contain"
      style={[{ width: size, height: size }, style]}
    />
  );
}
