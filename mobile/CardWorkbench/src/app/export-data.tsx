import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';

import { SymbolIcon } from '@/components/symbol-icon';
import {
  loadWorkspaceSession,
  workspaceAuthHeaders,
  workspaceJson,
  WorkspaceApiError,
} from '@/lib/workspace-api';
import { colors } from '@/theme/colors';
import { readLastWorkspaceBackupDay, runDailyWorkspaceBackup } from '@/lib/auto-backup';

export default function ExportDataScreen() {
  const [exporting, setExporting] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [lastBackupDay, setLastBackupDay] = useState<string | null>(null);

  useEffect(() => {
    void readLastWorkspaceBackupDay().then(setLastBackupDay);
  }, []);

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

  const saveAutoBackup = async () => {
    setBackingUp(true);
    try {
      await runDailyWorkspaceBackup(true);
      const day = await readLastWorkspaceBackupDay();
      setLastBackupDay(day);
      Alert.alert('备份完成', '最新完整备份已保存到本机 App 文档目录。');
    } catch (error) {
      Alert.alert('备份失败', error instanceof Error ? error.message : '请稍后重试。');
    } finally {
      setBackingUp(false);
    }
  };

  const restoreData = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/json', 'application/octet-stream'],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    Alert.alert('恢复这份备份？', '系统会跳过手机号重复的客户，不会覆盖现有资料。', [
      { text: '取消', style: 'cancel' },
      {
        text: '开始恢复',
        onPress: () => {
          setRestoring(true);
          const form = new FormData();
          form.append('backup', {
            uri: asset.uri,
            name: asset.name || 'workspace-backup.json',
            type: asset.mimeType || 'application/json',
          } as unknown as Blob);
          void workspaceJson<{ imported: number; skipped: number }>('/api/backup', {
            method: 'POST',
            body: form,
          })
            .then((response) => Alert.alert('恢复完成', `成功恢复 ${response.imported} 位客户，跳过 ${response.skipped} 位。`))
            .catch((error) => Alert.alert('恢复失败', error instanceof Error ? error.message : '请检查备份文件。'))
            .finally(() => setRestoring(false));
        },
      },
    ]);
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
        <Text selectable style={{ color: colors.secondaryLabel, fontSize: 12, textAlign: 'center' }}>
          {lastBackupDay ? `本机最近自动备份：${lastBackupDay}` : '连接工作台后，每天首次打开 App 会自动保存一份本机备份。'}
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
      <Pressable
        accessibilityRole="button"
        disabled={backingUp}
        onPress={() => void saveAutoBackup()}
        style={({ pressed }) => ({
          minHeight: 52,
          alignItems: 'center', justifyContent: 'center', borderRadius: 18, borderCurve: 'continuous',
          backgroundColor: colors.blueTint, opacity: pressed || backingUp ? 0.62 : 1,
        })}>
        <Text style={{ color: colors.blue, fontSize: 16, fontWeight: '800' }}>
          {backingUp ? '正在保存本机备份…' : '立即备份到本机'}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={restoring}
        onPress={() => void restoreData()}
        style={({ pressed }) => ({
          minHeight: 52,
          alignItems: 'center', justifyContent: 'center', borderRadius: 18, borderCurve: 'continuous',
          borderWidth: 1, borderColor: colors.separator, backgroundColor: colors.card,
          opacity: pressed || restoring ? 0.62 : 1,
        })}>
        <Text style={{ color: colors.label, fontSize: 16, fontWeight: '800' }}>
          {restoring ? '正在恢复…' : '从 JSON 备份恢复'}
        </Text>
      </Pressable>
    </ScrollView>
  );
}
