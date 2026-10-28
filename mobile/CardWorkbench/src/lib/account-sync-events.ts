type ChangeEvent = 'local-changed' | 'imported' | 'settings-changed';
const listeners = new Set<(event: ChangeEvent) => void>();
export const emitAccountSyncChange = (event: ChangeEvent) => { for (const listener of listeners) listener(event); };
export const subscribeAccountSyncChanges = (listener: (event: ChangeEvent) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
