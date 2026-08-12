// Re-export the native module. On web, it will be resolved to CardWorkbenchCredentialVaultModule.web.ts
// and on native platforms to CardWorkbenchCredentialVaultModule.ts
export { default } from './src/CardWorkbenchCredentialVaultModule';
export * from './src/CardWorkbenchCredentialVault.types';
