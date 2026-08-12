export type CredentialCategory = {
  id: string;
  name: string;
  color: string;
  tint: string;
  icon: string;
  sortOrder: number;
};

export type CredentialSecret = {
  account: string;
  password: string;
  email: string;
  nickname: string;
  website: string;
  notes: string;
  tags: string[];
};

export type CredentialEntry = CredentialSecret & {
  id: string;
  platformName: string;
  categoryId: string;
  categoryName: string;
  categoryColor: string;
  categoryTint: string;
  categoryIcon: string;
  icon: string;
  createdAt: string;
  updatedAt: string;
};

export type SaveCredentialInput = {
  id?: string;
  platformName: string;
  categoryId: string;
  icon: string;
  secret: CredentialSecret;
};
