import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import type { ComponentProps, ReactNode } from 'react';
import { useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import { SymbolIcon } from '@/components/symbol-icon';
import {
  generateStrongPassword,
  getCredential,
  getCredentialCategories,
  saveCredential,
} from '@/lib/credential-vault';
import { colors, layout } from '@/theme/colors';
import type { CredentialCategory } from '@/types/credential';

const ICONS = [
  'key.fill',
  'message.fill',
  'gamecontroller.fill',
  'building.columns.fill',
  'briefcase.fill',
  'cart.fill',
  'globe',
  'lock.shield.fill',
] as const;

export function CredentialForm({ credentialId }: { credentialId?: string }) {
  const database = useSQLiteContext();
  const router = useRouter();
  const [categories, setCategories] = useState<CredentialCategory[]>([]);
  const [platformName, setPlatformName] = useState('');
  const [categoryId, setCategoryId] = useState('other');
  const [icon, setIcon] = useState<string>('key.fill');
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [nickname, setNickname] = useState('');
  const [website, setWebsite] = useState('');
  const [tags, setTags] = useState('');
  const [notes, setNotes] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [length, setLength] = useState(20);
  const [useSymbols, setUseSymbols] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([
      getCredentialCategories(database),
      credentialId ? getCredential(database, credentialId) : Promise.resolve(null),
    ])
      .then(([nextCategories, entry]) => {
        if (!active) return;
        setCategories(nextCategories);
        if (!entry) return;
        setPlatformName(entry.platformName);
        setCategoryId(entry.categoryId);
        setIcon(entry.icon);
        setAccount(entry.account);
        setPassword(entry.password);
        setEmail(entry.email);
        setNickname(entry.nickname);
        setWebsite(entry.website);
        setTags(entry.tags.join('，'));
        setNotes(entry.notes);
      })
      .catch((error) => {
        if (active) setErrorMessage(error instanceof Error ? error.message : '密码资料读取失败');
      });
    return () => {
      active = false;
      setPassword('');
    };
  }, [credentialId, database]);

  const generate = async () => {
    try {
      const value = await generateStrongPassword(length, {
        uppercase: true,
        lowercase: true,
        numbers: true,
        symbols: useSymbols,
      });
      setPassword(value);
      setShowPassword(true);
      await Clipboard.setStringAsync(value);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '密码生成失败');
    }
  };

  const save = async () => {
    if (!platformName.trim() || !account.trim() || !password) {
      setErrorMessage('请填写平台名称、账号和密码。');
      return;
    }
    setIsSaving(true);
    setErrorMessage(null);
    try {
      const id = await saveCredential(database, {
        id: credentialId,
        platformName,
        categoryId,
        icon,
        secret: {
          account,
          password,
          email,
          nickname,
          website,
          notes,
          tags: tags.split(/[，,]/).map((tag) => tag.trim()).filter(Boolean),
        },
      });
      setPassword('');
      router.replace({ pathname: '/credential/[id]', params: { id } } as never);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '密码资料保存失败');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <View style={styles.heroCopy}>
          <Text selectable style={styles.heroTitle}>本机加密密码库</Text>
          <Text selectable style={styles.heroSubtitle}>Face ID 解锁 · Keychain 密钥 · AES-GCM 加密</Text>
        </View>
        <View style={styles.heroIcon}>
          <SymbolIcon name="lock.shield.fill" color="#3A2B16" size={24} />
        </View>
      </View>

      {errorMessage ? <Text selectable style={styles.error}>{errorMessage}</Text> : null}

      <FormSection title="基本信息">
        <Field label="平台名称" value={platformName} onChangeText={setPlatformName} placeholder="例如：微信、Steam、招商银行" />
        <Text selectable style={styles.fieldLabel}>分类</Text>
        <View style={styles.optionWrap}>
          {categories.map((category) => (
            <Pressable
              key={category.id}
              onPress={() => setCategoryId(category.id)}
              style={[
                styles.categoryChip,
                { backgroundColor: categoryId === category.id ? category.color : category.tint },
              ]}>
              <SymbolIcon
                name={category.icon}
                color={categoryId === category.id ? colors.white : category.color}
                size={15}
              />
              <Text style={{ color: categoryId === category.id ? colors.white : category.color, fontWeight: '700' }}>
                {category.name}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text selectable style={styles.fieldLabel}>图标</Text>
        <View style={styles.iconWrap}>
          {ICONS.map((name) => (
            <Pressable
              key={name}
              accessibilityLabel={`选择图标 ${name}`}
              onPress={() => setIcon(name)}
              style={[styles.iconChoice, icon === name && styles.iconChoiceActive]}>
              <SymbolIcon name={name} color={icon === name ? colors.white : colors.blue} size={20} />
            </Pressable>
          ))}
        </View>
      </FormSection>

      <FormSection title="登录资料">
        <Field label="账号" value={account} onChangeText={setAccount} autoCapitalize="none" placeholder="手机号、用户名或会员号" />
        <View style={styles.passwordHeader}>
          <Text selectable style={styles.fieldLabel}>密码</Text>
          <Pressable onPress={() => setShowPassword((value) => !value)}>
            <Text style={styles.link}>{showPassword ? '隐藏' : '显示'}</Text>
          </Pressable>
        </View>
        <TextInput
          value={password}
          onChangeText={setPassword}
          secureTextEntry={!showPassword}
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="newPassword"
          placeholder="输入或生成强密码"
          placeholderTextColor={colors.tertiaryLabel}
          style={styles.input}
        />
        <View style={styles.generatorRow}>
          <View style={styles.lengthGroup}>
            {[16, 20, 24, 32].map((value) => (
              <Pressable
                key={value}
                onPress={() => setLength(value)}
                style={[styles.lengthChip, length === value && styles.lengthChipActive]}>
                <Text style={[styles.lengthText, length === value && styles.lengthTextActive]}>{value}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>符号</Text>
            <Switch value={useSymbols} onValueChange={setUseSymbols} />
          </View>
        </View>
        <Pressable onPress={() => void generate()} style={styles.generateButton}>
          <SymbolIcon name="wand.and.stars" color="#3A2B16" size={18} />
          <Text style={styles.generateText}>生成并复制强密码</Text>
        </Pressable>
        <Field label="邮箱" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" placeholder="选填" />
        <Field label="昵称" value={nickname} onChangeText={setNickname} placeholder="选填" />
        <Field label="网站" value={website} onChangeText={setWebsite} autoCapitalize="none" keyboardType="url" placeholder="https://example.com" />
        <Field label="标签" value={tags} onChangeText={setTags} placeholder="工作，常用，重要" />
        <Field label="备注" value={notes} onChangeText={setNotes} placeholder="选填" multiline />
      </FormSection>

      <Pressable disabled={isSaving} onPress={() => void save()} style={styles.saveButton}>
        <Text style={styles.saveText}>{isSaving ? '正在加密保存…' : '安全保存'}</Text>
      </Pressable>
    </ScrollView>
  );
}

function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text selectable style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Field({ label, multiline, ...props }: ComponentProps<typeof TextInput> & { label: string }) {
  return (
    <View style={styles.field}>
      <Text selectable style={styles.fieldLabel}>{label}</Text>
      <TextInput
        {...props}
        multiline={multiline}
        placeholderTextColor={colors.tertiaryLabel}
        style={[styles.input, multiline && styles.multiline]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { width: '100%', maxWidth: 600, alignSelf: 'center', gap: 18, padding: layout.horizontalPadding, paddingBottom: 44 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 18, borderRadius: 24, borderCurve: 'continuous', backgroundColor: '#FFC229' },
  heroCopy: { flex: 1, gap: 4 },
  heroTitle: { color: '#2C2113', fontSize: 20, fontWeight: '900' },
  heroSubtitle: { color: '#6D511B', fontSize: 12, lineHeight: 17 },
  heroIcon: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.42)' },
  error: { color: colors.red, fontSize: 13, lineHeight: 19, paddingHorizontal: 4 },
  section: { gap: 12, padding: 17, borderRadius: 24, borderCurve: 'continuous', backgroundColor: colors.card, boxShadow: '0 4px 18px rgba(34,42,60,0.06)' },
  sectionTitle: { color: colors.label, fontSize: 18, fontWeight: '800' },
  field: { gap: 7 },
  fieldLabel: { color: colors.secondaryLabel, fontSize: 13, fontWeight: '600' },
  input: { minHeight: 48, borderRadius: 15, borderCurve: 'continuous', paddingHorizontal: 14, color: colors.label, fontSize: 16, backgroundColor: colors.cardMuted },
  multiline: { minHeight: 92, paddingTop: 13, textAlignVertical: 'top' },
  optionWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  categoryChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 14 },
  iconWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  iconChoice: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: colors.blueTint },
  iconChoiceActive: { backgroundColor: colors.blue },
  passwordHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  link: { color: colors.blue, fontSize: 13, fontWeight: '700' },
  generatorRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  lengthGroup: { flexDirection: 'row', gap: 6 },
  lengthChip: { minWidth: 38, alignItems: 'center', paddingVertical: 7, borderRadius: 12, backgroundColor: colors.cardMuted },
  lengthChipActive: { backgroundColor: '#3A2B16' },
  lengthText: { color: colors.secondaryLabel, fontWeight: '700', fontVariant: ['tabular-nums'] },
  lengthTextActive: { color: colors.white },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  switchLabel: { color: colors.secondaryLabel, fontSize: 12 },
  generateButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 15, backgroundColor: '#FFC229' },
  generateText: { color: '#3A2B16', fontSize: 15, fontWeight: '800' },
  saveButton: { minHeight: 54, alignItems: 'center', justifyContent: 'center', borderRadius: 18, borderCurve: 'continuous', backgroundColor: colors.blue },
  saveText: { color: colors.white, fontSize: 17, fontWeight: '800' },
});
