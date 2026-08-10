import { useRouter } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SymbolIcon } from '@/components/symbol-icon';
import { colors } from '@/theme/colors';

export function FloatingAddButton() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <Pressable
      accessibilityLabel="新增待办"
      accessibilityRole="button"
      onPress={() => router.push('/add-task')}
      style={({ pressed }) => [
        styles.button,
        {
          bottom: Math.max(insets.bottom, 10) + 84,
          transform: [{ scale: pressed ? 0.94 : 1 }],
        },
      ]}>
      <SymbolIcon name="plus" color={colors.white} size={30} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    position: 'absolute',
    right: 24,
    zIndex: 10,
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 32,
    backgroundColor: colors.blue,
    boxShadow: '0 8px 18px rgba(52, 121, 200, 0.34)',
  },
});
