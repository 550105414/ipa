import { NativeModule, requireNativeModule } from 'expo';

export type EncryptedCredential = {
  ciphertext: string;
  keyVersion: number;
};

declare class CardWorkbenchCredentialVaultModule extends NativeModule<Record<string, never>> {
  newRecordId(): string;
  encryptAsync(recordId: string, plaintext: string): Promise<EncryptedCredential>;
  decryptAsync(recordId: string, ciphertext: string, keyVersion: number): Promise<string>;
  generatePasswordAsync(
    length: number,
    uppercase: boolean,
    lowercase: boolean,
    numbers: boolean,
    symbols: boolean,
  ): Promise<string>;
}

export default requireNativeModule<CardWorkbenchCredentialVaultModule>('CardWorkbenchCredentialVault');
