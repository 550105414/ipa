import { useLocalSearchParams } from 'expo-router';

import { CredentialForm } from '@/components/credential-form';

export default function EditCredentialScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <CredentialForm credentialId={id} />;
}
