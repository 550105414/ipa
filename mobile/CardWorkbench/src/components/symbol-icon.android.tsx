import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { View, type ColorValue, type ImageStyle, type StyleProp } from 'react-native';

import { getAndroidSymbol } from '@/lib/android-symbols';

type SymbolIconProps = {
  name: string;
  color: ColorValue;
  size?: number;
  style?: StyleProp<ImageStyle>;
};

export function SymbolIcon({ name, color, size = 20, style }: SymbolIconProps) {
  return (
    <View
      accessible={false}
      importantForAccessibility="no"
      style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, style]}>
      <MaterialCommunityIcons
        accessible={false}
        name={getAndroidSymbol(name)}
        color={color}
        size={size}
      />
    </View>
  );
}
