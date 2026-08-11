import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { WorkspaceError, WorkspaceLoading } from '@/components/workspace-screen-state';
import { SymbolIcon } from '@/components/symbol-icon';
import { workspaceJson } from '@/lib/workspace-api';
import { colors } from '@/theme/colors';
import type { CustomerCategory, CustomerDetail, CustomerSensitive, MachineMode, MachineType } from '@/types/customer';

const categories: CustomerCategory[] = ['直营', '代理', '汇来米', '收银通'];
const machines: MachineType[] = ['音响', '扫码王', '收银机'];
const modes: MachineMode[] = ['购买', '赠送'];

export default function EditCustomerScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] ?? '' : params.id ?? '';
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [shopName, setShopName] = useState('');
  const [category, setCategory] = useState<CustomerCategory>('直营');
  const [followUp, setFollowUp] = useState('');
  const [machineType, setMachineType] = useState<MachineType | null>(null);
  const [machineMode, setMachineMode] = useState<MachineMode | null>(null);
  const [feeRate, setFeeRate] = useState('');
  const [depositAmount, setDepositAmount] = useState('');
  const [bankCard, setBankCard] = useState('');
  const [front, setFront] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [back, setBack] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [license, setLicense] = useState<ImagePicker.ImagePickerAsset | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [detail, sensitive] = await Promise.all([
        workspaceJson<{ customer: CustomerDetail }>(`/api/customers/${encodeURIComponent(id)}`),
        workspaceJson<CustomerSensitive>(`/api/customers/${encodeURIComponent(id)}/sensitive`, {
          method: 'POST',
          body: '{}',
        }),
      ]);
      const customer = detail.customer;
      setShopName(customer.shopName ?? '');
      setCategory(customer.category ?? '直营');
      setFollowUp(toEditableDate(customer.nextFollowUpAt));
      setMachineType(customer.machineType ?? null);
      setMachineMode(customer.machineMode ?? null);
      setFeeRate(customer.feeRate == null ? '' : String(customer.feeRate));
      setDepositAmount(customer.depositAmount == null ? '' : String(customer.depositAmount));
      setBankCard(sensitive.bankCardNumber ?? '');
    } catch (loadError) {
      setError(loadError);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const pick = async (setter: (asset: ImagePicker.ImagePickerAsset | null) => void) => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('需要相册权限', '请在系统设置中允许“工作台”访问照片。');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.86,
      allowsEditing: false,
    });
    if (!result.canceled && result.assets[0]) setter(result.assets[0]);
  };

  const save = async () => {
    let followUpIso: string | null = null;
    if (followUp.trim()) {
      const date = new Date(followUp.trim().replace(' ', 'T'));
      if (Number.isNaN(date.getTime())) {
        Alert.alert('跟进时间格式不正确', '请按“2026-08-12 10:30”填写。');
        return;
      }
      followUpIso = date.toISOString();
    }
    if (machineType && (!machineMode || Number(feeRate) <= 0 || Number(feeRate) > 100)) {
      Alert.alert('请完整填写机器模式和 0～100 之间的费率');
      return;
    }
    const cardDigits = bankCard.replace(/\D/g, '');
    if (cardDigits && (cardDigits.length < 12 || cardDigits.length > 19)) {
      Alert.alert('银行卡号应为 12～19 位数字');
      return;
    }

    setSaving(true);
    try {
      await workspaceJson(`/api/customers/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          shopName: shopName.trim() || null,
          category,
          nextFollowUpAt: followUpIso,
          machineType,
          machineMode: machineType ? machineMode : null,
          feeRate: machineType ? Number(feeRate) : null,
          depositAmount: machineType && depositAmount.trim() ? Number(depositAmount) : null,
        }),
      });

      if (cardDigits) {
        await workspaceJson(`/api/customers/${encodeURIComponent(id)}/bank-card`, {
          method: 'PUT',
          body: JSON.stringify({ cardNumber: cardDigits }),
        });
      }
      if (front || back) {
        const identityForm = new FormData();
        appendAsset(identityForm, 'idCardFront', front);
        appendAsset(identityForm, 'idCardBack', back);
        await workspaceJson(`/api/customers/${encodeURIComponent(id)}/id-card`, {
          method: 'PUT',
          body: identityForm,
        });
      }
      if (license) {
        const licenseForm = new FormData();
        appendAsset(licenseForm, 'businessLicense', license);
        await workspaceJson(`/api/customers/${encodeURIComponent(id)}/business-license`, {
          method: 'PUT',
          body: licenseForm,
        });
      }
      router.back();
    } catch (saveError) {
      Alert.alert('保存失败', saveError instanceof Error ? saveError.message : '请稍后重试。');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <WorkspaceLoading label="正在读取客户资料…" />;
  if (error) return <WorkspaceError error={error} onRetry={() => void load()} />;

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ gap: 14, padding: 16, paddingBottom: 70 }}>
      <Section title="客户信息">
        <Field label="店铺名字" value={shopName} onChangeText={setShopName} placeholder="选填" />
        <Choice label="客户分类" values={categories} selected={category} onSelect={setCategory} />
        <Field label="下次跟进时间" value={followUp} onChangeText={setFollowUp} placeholder="2026-08-12 10:30（选填）" />
      </Section>

      <Section title="机器信息">
        <Choice
          label="机器"
          values={machines}
          selected={machineType}
          onSelect={(value) => setMachineType(value === machineType ? null : value)}
        />
        {machineType ? (
          <>
            <Choice label="模式" values={modes} selected={machineMode} onSelect={setMachineMode} />
            <Field label="费率（%）" value={feeRate} onChangeText={setFeeRate} keyboardType="decimal-pad" />
            <Field label="押金（元）" value={depositAmount} onChangeText={setDepositAmount} keyboardType="decimal-pad" />
          </>
        ) : null}
      </Section>

      <Section title="银行卡">
        <Field label="银行卡号" value={bankCard} onChangeText={setBankCard} keyboardType="number-pad" placeholder="输入 12～19 位银行卡号" />
      </Section>

      <Section title="补充证件">
        <PhotoChoice title="身份证正面" asset={front} onPress={() => void pick(setFront)} />
        <PhotoChoice title="身份证反面" asset={back} onPress={() => void pick(setBack)} />
        <PhotoChoice title="营业执照" asset={license} onPress={() => void pick(setLicense)} />
      </Section>

      <Pressable
        disabled={saving}
        onPress={() => void save()}
        style={({ pressed }) => [styles.save, { opacity: pressed || saving ? 0.6 : 1 }]}>
        <Text style={styles.saveText}>{saving ? '正在保存…' : '保存修改'}</Text>
      </Pressable>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <View style={styles.section}><Text selectable style={styles.sectionTitle}>{title}</Text>{children}</View>;
}

function Field({ label, ...props }: React.ComponentProps<typeof TextInput> & { label: string }) {
  return <View style={styles.field}><Text selectable style={styles.label}>{label}</Text><TextInput {...props} placeholderTextColor={colors.tertiaryLabel} style={styles.input} /></View>;
}

function Choice<T extends string>({ label, values, selected, onSelect }: { label: string; values: readonly T[]; selected: T | null; onSelect: (value: T) => void }) {
  return (
    <View style={styles.field}>
      <Text selectable style={styles.label}>{label}</Text>
      <View style={styles.choices}>
        {values.map((value) => <Pressable key={value} onPress={() => onSelect(value)} style={[styles.choice, selected === value && styles.choiceActive]}><Text style={[styles.choiceText, selected === value && styles.choiceTextActive]}>{value}</Text></Pressable>)}
      </View>
    </View>
  );
}

function PhotoChoice({ title, asset, onPress }: { title: string; asset: ImagePicker.ImagePickerAsset | null; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.photoChoice}>
      {asset ? <Image source={{ uri: asset.uri }} contentFit="cover" style={styles.thumbnail} /> : <View style={styles.photoIcon}><SymbolIcon name="photo.on.rectangle" size={20} color={colors.blue} /></View>}
      <View style={{ flex: 1 }}><Text selectable style={styles.label}>{title}</Text><Text selectable style={styles.photoStatus}>{asset ? '已选择新图片' : '从相册选择或替换'}</Text></View>
      <SymbolIcon name="chevron.right" size={14} color={colors.tertiaryLabel} />
    </Pressable>
  );
}

function appendAsset(form: FormData, key: string, asset: ImagePicker.ImagePickerAsset | null) {
  if (!asset) return;
  const extension = asset.uri.split('.').pop()?.split('?')[0] || 'jpg';
  form.append(key, { uri: asset.uri, name: asset.fileName || `${key}.${extension}`, type: asset.mimeType || `image/${extension === 'jpg' ? 'jpeg' : extension}` } as unknown as Blob);
}

function toEditableDate(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

const styles = StyleSheet.create({
  section: { gap: 14, padding: 16, borderRadius: 22, borderCurve: 'continuous', backgroundColor: colors.card },
  sectionTitle: { color: colors.label, fontSize: 18, fontWeight: '800' },
  field: { gap: 7 },
  label: { color: colors.label, fontSize: 14, fontWeight: '700' },
  input: { minHeight: 48, paddingHorizontal: 13, borderWidth: 1, borderColor: '#D8DDE8', borderRadius: 15, borderCurve: 'continuous', backgroundColor: '#F9FAFC', color: colors.label, fontSize: 16 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { minHeight: 38, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 15, borderRadius: 13, borderCurve: 'continuous', backgroundColor: '#F1F3F7' },
  choiceActive: { backgroundColor: colors.blueTint },
  choiceText: { color: colors.secondaryLabel, fontWeight: '700' },
  choiceTextActive: { color: colors.blue },
  photoChoice: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 11, padding: 8, borderRadius: 15, borderCurve: 'continuous', backgroundColor: '#F5F7FA' },
  photoIcon: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 13, borderCurve: 'continuous', backgroundColor: colors.blueTint },
  thumbnail: { width: 46, height: 46, borderRadius: 13, borderCurve: 'continuous' },
  photoStatus: { color: colors.secondaryLabel, fontSize: 12, paddingTop: 3 },
  save: { minHeight: 54, alignItems: 'center', justifyContent: 'center', borderRadius: 18, borderCurve: 'continuous', backgroundColor: colors.blue },
  saveText: { color: colors.white, fontSize: 17, fontWeight: '800' },
});
