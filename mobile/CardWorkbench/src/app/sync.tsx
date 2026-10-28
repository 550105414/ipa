import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState, useSyncExternalStore } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { changeAccountSyncPassword, configureAccountSyncPassword, forgetAccountSyncPassword, getAccountSyncStatus, subscribeAccountSyncStatus, syncAccountData } from '@/lib/account-sync';
import { useTodos } from '@/providers/todo-provider';
import { colors } from '@/theme/colors';

export default function AccountSyncScreen() {
  const database = useSQLiteContext();
  const router = useRouter();
  const { refresh } = useTodos();
  const status = useSyncExternalStore(subscribeAccountSyncStatus, getAccountSyncStatus, getAccountSyncStatus);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await operation();
      setPassword('');
      setConfirmation('');
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '同步未完成，本机资料已保留。');
    } finally { setBusy(false); }
  };
  const save = (rotate = false) => {
    if (password !== confirmation) { setError('两次输入的同步密码不一致。'); return; }
    if (rotate) {
      Alert.alert('修改各设备的同步密码？', '会用新密码重新加密云端资料。其他手机之后须输入这个新密码。不会修改设备解锁密码或已保存的网站密码。网络失败时会保留旧密码和待提交密码以便安全重试。', [
        { text: '取消', style: 'cancel' },
        { text: '确认修改', onPress: () => void run(() => changeAccountSyncPassword(database, password)) },
      ]);
    } else void run(() => configureAccountSyncPassword(database, password));
  };
  const resolve = (resolution: 'local' | 'remote') => Alert.alert('明确选择冲突版本', `仅对两边都修改过的冲突记录采用${resolution === 'local' ? '本机' : '云端'}版本；另一版本会被替换。其他无冲突记录仍会合并。确认前请保留所需资料。`, [
    { text: '取消', style: 'cancel' },
    { text: '确认采用', style: 'destructive', onPress: () => void run(() => syncAccountData(database, { resolution })) },
  ]);
  const button = (title: string, action: () => void, secondary = false) => (
    <Pressable accessibilityRole="button" disabled={busy} onPress={action}
      style={({ pressed }) => ({ minHeight: 48, justifyContent: 'center', alignItems: 'center', padding: 12, borderRadius: 14, backgroundColor: secondary ? colors.cardMuted : colors.blue, opacity: busy || pressed ? 0.5 : 1 })}>
      <Text style={{ color: secondary ? colors.blue : colors.white, fontWeight: '700' }}>{busy ? '处理中…' : title}</Text>
    </Pressable>
  );
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 50 }}>
      <View style={{ padding: 18, gap: 10, borderRadius: 20, backgroundColor: colors.card }}>
        <Text selectable style={{ color: colors.label, fontSize: 21, fontWeight: '700' }}>两台手机，共用同一份资料</Text>
        <Text selectable style={{ color: colors.secondaryLabel, lineHeight: 22 }}>1. iPhone 和安卓分别配对到同一个工作台账号。{ '\n' }2. 先在有完整资料的 iPhone 设置同步密码并同步一次。{ '\n' }3. 安卓输入同一个同步密码，合并已有资料。</Text>
        <Text selectable style={{ color: colors.secondaryLabel, lineHeight: 22 }}>客户仍通过同一工作台账号读取。密码库、待办备注/标签、完整分类、星标、日期原始格式、重复规则和重复锚点使用端到端加密同步。标题、完成状态和核心日期保留现有待办同步。</Text>
        <Text selectable style={{ color: colors.orange, lineHeight: 21 }}>同步密码至少 12 个字符，请妥善保管。服务端不保存解密密码，忘记密码不能通过重置来读取旧密文。设备登录凭证、设备私钥和解锁会话不跨设备复制。</Text>
      </View>
      <View style={{ padding: 18, gap: 12, borderRadius: 20, backgroundColor: colors.card }}>
        <Text selectable style={{ color: status.phase === 'error' || status.phase === 'conflict' ? colors.red : colors.label, lineHeight: 22 }}>{status.message}</Text>
        {status.lastSyncedAt ? <Text selectable style={{ color: colors.secondaryLabel }}>最近成功：{new Date(status.lastSyncedAt).toLocaleString()}</Text> : null}
        {status.scope ? <Text selectable style={{ color: colors.secondaryLabel, fontSize: 12 }}>账号隔离标识：{status.scope.slice(0, 12)}…</Text> : null}
        {button('连接/检查工作台账号', () => router.push('/pair' as never))}
        {button('立即同步 / 断线后重试', () => void run(() => syncAccountData(database)), true)}
      </View>
      <View style={{ padding: 18, gap: 12, borderRadius: 20, backgroundColor: colors.card }}>
        <Text style={{ color: colors.label, fontWeight: '700', fontSize: 17 }}>同步密码</Text>
        <TextInput secureTextEntry autoCapitalize="none" autoCorrect={false} textContentType="none" value={password} onChangeText={setPassword} editable={!busy} placeholder="输入至少 12 字符的同步密码" placeholderTextColor={colors.tertiaryLabel} style={{ minHeight: 48, padding: 12, borderRadius: 12, backgroundColor: colors.cardMuted, color: colors.label }} />
        <TextInput secureTextEntry autoCapitalize="none" autoCorrect={false} textContentType="none" value={confirmation} onChangeText={setConfirmation} editable={!busy} placeholder="再次输入同步密码" placeholderTextColor={colors.tertiaryLabel} style={{ minHeight: 48, padding: 12, borderRadius: 12, backgroundColor: colors.cardMuted, color: colors.label }} />
        {button('设置 / 验证已有同步密码', () => save())}
        {status.configured ? button('修改各设备的同步密码', () => save(true), true) : null}
        <Text selectable style={{ color: colors.secondaryLabel, fontSize: 12, lineHeight: 19 }}>密码错误、未配对、网络失败或版本不兼容时，都会停止，不会把云端当空库覆盖。并发冲突需你明确选择；断网编辑继续保存在本机。</Text>
      </View>
      {status.phase === 'conflict' ? <View style={{ gap: 10 }}>
        {button('冲突记录采用本机版本', () => resolve('local'), true)}
        {button('冲突记录采用云端版本', () => resolve('remote'), true)}
      </View> : null}
      {error ? <Text selectable style={{ color: colors.red, lineHeight: 22 }}>{error}</Text> : null}
      {status.configured ? button('仅移除这台手机的同步密码', () => Alert.alert('停止这台手机的加密同步？', '不会删除本机记录或云端密文，以后可重新输入同步密码恢复。', [
        { text: '取消', style: 'cancel' }, { text: '移除本机密码', style: 'destructive', onPress: () => void run(forgetAccountSyncPassword) },
      ]), true) : null}
    </ScrollView>
  );
}
