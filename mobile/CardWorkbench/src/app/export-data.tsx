import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';

import { SymbolIcon } from '@/components/symbol-icon';
import {
  loadWorkspaceSession,
  workspaceAuthHeaders,
  WorkspaceApiError,
} from '@/lib/workspace-api';
import { colors } from '@/theme/colors';

export default function ExportDataScreen() {
  const [exporting, setExporting] = useState(false);

  const exportData = async () => {
    setExporting(true);
    try {
      const session = await loadWorkspaceSession();
      if (!session) {
        throw new WorkspaceApiError('这台 iPhone 尚未与工作台配对。', 401, 'DEVICE_PAIRING_REQUIRED');
      }
      const filename = `工作台备份-${new Date().toISOString().slice(0, 10)}.json`;
      const file = await File.downloadFileAsync(
        new URL('/api/backup', session.baseUrl).toString(),
        new File(Paths.cache, filename),
        {
          headers: workspaceAuthHeaders(session),
          idempotent: true,
        },
      );
      if (!(await Sharing.isAvailableAsync())) {
        throw new Error('当前设备无法打开系统分享面板。');
      }
      await Sharing.shareAsync(file.uri, {
        mimeType: 'application/json',
        UTI: 'public.json',
        dialogTitle: '导出工作台资料',
      });
    } catch (error) {
      Alert.alert('导出失败', error instanceof Error ? error.message : '请稍后重试。');
    } finally {
      setExporting(false);
    }
  };

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', gap: 20, padding: 24 }}>
      <View style={{ alignItems: 'center', gap: 12 }}>
        <View
          style={{
            width: 68,
            height: 68,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 23,
            borderCurve: 'continuous',
            backgroundColor: colors.blueTint,
          }}>
          <SymbolIcon name="square.and.arrow.up" size={29} color={colors.blue} />
        </View>
        <Text selectable style={{ color: colors.label, fontSize: 25, fontWeight: '800' }}>
          导出完整资料
        </Text>
        <Text
          selectable
          style={{ color: colors.secondaryLabel, lineHeight: 22, textAlign: 'center' }}>
          导出 JSON 包含客户信息、手机号、银行卡号、身份证图片、营业执照和操作记录。
        </Text>
        <Text selectable style={{ color: '#B66B12', lineHeight: 20, textAlign: 'center', fontSize: 13 }}>
          文件不加密，请仅保存到自己的设备或私人存储中。
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        disabled={exporting}
        onPress={() => void exportData()}
        style={({ pressed }) => ({
          minHeight: 54,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 18,
          borderCurve: 'continuous',
          backgroundColor: colors.blue,
          opacity: pressed || exporting ? 0.62 : 1,
        })}>
        <Text style={{ color: colors.white, fontSize: 17, fontWeight: '800' }}>
          {exporting ? '正在生成…' : '生成并分享备份'}
        </Text>
      </Pressable>
    </ScrollView>
  );
}
