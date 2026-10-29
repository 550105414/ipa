import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import type { AccountSyncStatus } from '@/lib/account-sync';
import { colors } from '@/theme/colors';

export function AccountSyncProgress({ status }: { status: AccountSyncStatus }) {
  const progress = status.phase === 'syncing' ? status.progress : null;
  const startedAt = progress?.startedAt;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt === undefined || !Number.isFinite(startedAt)) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt, progress?.stage, progress?.attempt]);

  if (progress && Number.isFinite(progress.startedAt)) {
    const elapsedSeconds = Math.floor(Math.max(0, now - progress.startedAt) / 1000);
    const attempt = Number.isFinite(progress.attempt) ? Math.min(3, Math.max(1, Math.floor(progress.attempt))) : 1;
    return (
      <View style={{ gap: 4 }}>
        <Text selectable style={{ color: colors.secondaryLabel, fontSize: 12, lineHeight: 18, fontVariant: ['tabular-nums'] }}>本阶段 {elapsedSeconds} 秒 · 第 {attempt}/3 次</Text>
        {elapsedSeconds >= 30 ? <Text selectable style={{ color: colors.orange, fontSize: 12, lineHeight: 18 }}>耗时较长，请保持工作台在前台并解锁；不要重新设置同步密码。尚未确认同步完成。</Text> : null}
      </View>
    );
  }
  if (status.phase !== 'syncing' && typeof status.lastDurationMs === 'number' && Number.isFinite(status.lastDurationMs) && status.lastDurationMs >= 0) {
    return <Text selectable style={{ color: colors.secondaryLabel, fontSize: 12, lineHeight: 18, fontVariant: ['tabular-nums'] }}>最近一轮耗时：{Math.round(status.lastDurationMs / 1000)} 秒</Text>;
  }
  return null;
}
