import { registerWebModule, NativeModule } from 'expo';

// CardWorkbenchCredentialVaultModule is not available on the web platform.
class CardWorkbenchCredentialVaultModule extends NativeModule<{}> {}

export default registerWebModule(CardWorkbenchCredentialVaultModule, 'CardWorkbenchCredentialVaultModule');
