import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme/colors';

type ScreenStateProps = {
  isLoading: boolean;
  errorMessage: string | null;
  onRetry: () => void;
};

export function ScreenState({ isLoading, errorMessage, onRetry }: ScreenStateProps) {
  if (!isLoading && !errorMessage) {
    return null;
  }

  return (
    <View style={styles.container}>
      {isLoading ? <ActivityIndicator size="small" color={colors.blue} /> : null}
      <Text selectable style={styles.message}>
        {errorMessage ?? '正在整理待办…'}
      </Text>
      {errorMessage ? (
        <Pressable
          accessibilityRole="button"
          onPress={onRetry}
          style={({ pressed }) => [styles.retryButton, { opacity: pressed ? 0.6 : 1 }]}>
          <Text style={styles.retryText}>重试</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 260,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  message: {
    color: colors.secondaryLabel,
    fontSize: 14,
  },
  retryButton: {
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: colors.blueTint,
  },
  retryText: {
    color: colors.blue,
    fontSize: 14,
    fontWeight: '700',
  },
});
