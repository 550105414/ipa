import { File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';

import { loadWorkspaceSession, workspaceAuthHeaders } from '@/lib/workspace-api';

const LAST_BACKUP_DAY_KEY = 'workspace.auto-backup-day';
const AUTO_BACKUP_FILENAME = '工作台-自动备份-最新.json';
let running: Promise<string | null> | null = null;

export function runDailyWorkspaceBackup(force = false): Promise<string | null> {
  if (running) return running;
  running = performBackup(force).finally(() => {
    running = null;
  });
  return running;
}

export async function readLastWorkspaceBackupDay(): Promise<string | null> {
  return SecureStore.getItemAsync(LAST_BACKUP_DAY_KEY);
}

async function performBackup(force: boolean): Promise<string | null> {
  const day = new Date().toISOString().slice(0, 10);
  if (!force && (await readLastWorkspaceBackupDay()) === day) return null;
  const session = await loadWorkspaceSession();
  if (!session) return null;
  const destination = new File(Paths.document, AUTO_BACKUP_FILENAME);
  const file = await File.downloadFileAsync(
    new URL('/api/backup', session.baseUrl).toString(),
    destination,
    { headers: workspaceAuthHeaders(session), idempotent: true },
  );
  await SecureStore.setItemAsync(LAST_BACKUP_DAY_KEY, day, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return file.uri;
}
