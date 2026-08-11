import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { SymbolIcon } from '@/components/symbol-icon';
import { WorkspaceApiError } from '@/lib/workspace-api';
import { colors } from '@/theme/colors';

export function WorkspaceLoading({ label = '正在同步…' }: { label?: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 28 }}>
      <ActivityIndicator size="large" color={colors.blue} />
      <Text selectable style={{ color: colors.secondaryLabel }}>{label}</Text>
    </View>
  );
}

export function WorkspaceError({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}) {
  const router = useRouter();
  const pairingRequired =
    error instanceof WorkspaceApiError &&
    (error.code === 'DEVICE_PAIRING_REQUIRED' || error.status === 401 || error.status === 403);
  const message = error instanceof Error ? error.message : '暂时无法读取工作台资料。';

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 28 }}>
      <View
        style={{
          width: 58,
          height: 58,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 20,
          borderCurve: 'continuous',
          backgroundColor: pairingRequired ? '#FFF2D9' : '#FEEDEE',
        }}>
        <SymbolIcon
          name={pairingRequired ? 'link.badge.plus' : 'exclamationmark.triangle.fill'}
          size={25}
          color={pairingRequired ? '#C87800' : '#D84A4A'}
        />
      </View>
      <Text selectable style={{ color: colors.label, fontSize: 20, fontWeight: '800' }}>
        {pairingRequired ? '需要先配对工作台' : '同步失败'}
      </Text>
      <Text
        selectable
        style={{ color: colors.secondaryLabel, lineHeight: 21, textAlign: 'center' }}>
        {message}
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={pairingRequired ? () => router.push('/pair' as never) : onRetry}
        style={({ pressed }) => ({
          minWidth: 168,
          minHeight: 48,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 16,
          borderCurve: 'continuous',
          backgroundColor: colors.blue,
          opacity: pressed ? 0.62 : 1,
        })}>
        <Text style={{ color: colors.white, fontWeight: '800' }}>
          {pairingRequired ? '打开配对页面' : '重新加载'}
        </Text>
      </Pressable>
    </View>
  );
}
