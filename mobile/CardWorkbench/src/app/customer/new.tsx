import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { SymbolIcon } from '@/components/symbol-icon';
import { workspaceJson } from '@/lib/workspace-api';
import { colors } from '@/theme/colors';
import type { CustomerCategory, MachineMode, MachineType } from '@/types/customer';

const categories: CustomerCategory[] = ['直营', '代理', '汇来米', '收银通'];
const machineTypes: MachineType[] = ['音响', '扫码王', '收银机'];
const machineModes: MachineMode[] = ['购买', '赠送'];

type DuplicateResponse = {
  duplicate: boolean;
  customer?: { id: string; name: string; maskedPhone: string; inTrash: boolean };
};

export default function NewCustomerScreen() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [shopName, setShopName] = useState('');
  const [category, setCategory] = useState<CustomerCategory>('直营');
  const [nextFollowUpAt, setNextFollowUpAt] = useState('');
  const [bankCardNumber, setBankCardNumber] = useState('');
  const [machineType, setMachineType] = useState<MachineType | null>(null);
  const [machineMode, setMachineMode] = useState<MachineMode | null>(null);
  const [feeRate, setFeeRate] = useState('');
  const [depositAmount, setDepositAmount] = useState('');
  const [front, setFront] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [back, setBack] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [license, setLicense] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [duplicate, setDuplicate] = useState<DuplicateResponse['customer'] | null>(null);
  const [saving, setSaving] = useState(false);

  const pick = async (setter: (value: ImagePicker.ImagePickerAsset | null) => void) => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('需要相册权限', '请在系统设置中允许“工作台”访问照片。');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 0.86,
    });
    if (!result.canceled && result.assets[0]) setter(result.assets[0]);
  };

  const checkDuplicate = async (): Promise<boolean> => {
    const normalized = normalizePhone(phone);
    if (normalized.length < 7) {
      setDuplicate(null);
      return false;
    }
    try {
      const result = await workspaceJson<DuplicateResponse>('/api/customers/check-phone', {
        method: 'POST',
        body: JSON.stringify({ phone: normalized }),
      });
      setDuplicate(result.customer ?? null);
      return result.duplicate;
    } catch {
      return false;
    }
  };

  const submit = async () => {
    const normalizedPhone = normalizePhone(phone);
    if (!name.trim()) {
      Alert.alert('请填写姓名');
      return;
    }
    if (!/^\+?\d{7,20}$/.test(normalizedPhone)) {
      Alert.alert('手机号格式不正确');
      return;
    }
    if (await checkDuplicate()) {
      Alert.alert('手机号已存在', '请先打开已有客户，避免重复录入。');
      return;
    }
    const bankDigits = bankCardNumber.replace(/\D/g, '');
    if (bankDigits && (bankDigits.length < 12 || bankDigits.length > 19)) {
      Alert.alert('银行卡号应为 12～19 位数字');
      return;
    }
    if (machineType && (!machineMode || !feeRate || Number(feeRate) <= 0 || Number(feeRate) > 100)) {
      Alert.alert('请完整填写机器模式和 0～100 之间的费率');
      return;
    }
    let followUpIso = '';
    if (nextFollowUpAt.trim()) {
      const parsed = new Date(nextFollowUpAt.trim().replace(' ', 'T'));
      if (Number.isNaN(parsed.getTime())) {
        Alert.alert('跟进时间格式不正确', '请按“2026-08-12 10:30”填写。');
        return;
      }
      followUpIso = parsed.toISOString();
    }

    const form = new FormData();
    form.append('name', name.trim());
    form.append('phone', normalizedPhone);
    form.append('shopName', shopName.trim());
    form.append('category', category);
    if (followUpIso) form.append('nextFollowUpAt', followUpIso);
    if (bankDigits) form.append('bankCardNumber', bankDigits);
    if (machineType && machineMode) {
      form.append('machineType', machineType);
      form.append('machineMode', machineMode);
      form.append('feeRate', feeRate.trim());
      if (depositAmount.trim()) form.append('depositAmount', depositAmount.trim());
    }
    appendAsset(form, 'idCardFront', front);
    appendAsset(form, 'idCardBack', back);
    appendAsset(form, 'businessLicense', license);

    setSaving(true);
    try {
      const result = await workspaceJson<{ id: string; warning?: string }>('/api/customers', {
        method: 'POST',
        body: form,
      });
      if (result.warning) Alert.alert('客户已保存', result.warning);
      router.replace(`/customer/${result.id}` as never);
    } catch (error) {
      Alert.alert('保存失败', error instanceof Error ? error.message : '请稍后重试。');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ gap: 14, padding: 16, paddingBottom: 70 }}>
      <View style={styles.notice}>
        <SymbolIcon name="bolt.fill" size={18} color={colors.blue} />
        <Text selectable style={styles.noticeText}>
          姓名和手机号即可先保存；证件未齐全时自动标记为“资料待补”。
        </Text>
      </View>

      <FormSection title="基础信息">
        <FormField label="姓名" required value={name} onChangeText={setName} placeholder="请输入客户姓名" />
        <FormField
          label="手机号"
          required
          value={phone}
          onChangeText={(value) => {
            setPhone(value);
            setDuplicate(null);
          }}
          onBlur={() => void checkDuplicate()}
          placeholder="例如 13800138888"
          keyboardType="phone-pad"
        />
        {duplicate ? (
          <Pressable
            onPress={() => router.push(`/customer/${duplicate.id}` as never)}
            style={styles.duplicateWarning}>
            <Text selectable style={styles.duplicateText}>
              已存在：{duplicate.name} {duplicate.maskedPhone}{duplicate.inTrash ? '（回收站）' : ''}
            </Text>
            <SymbolIcon name="chevron.right" size={14} color="#B66B12" />
          </Pressable>
        ) : null}
        <FormField label="店铺名字" value={shopName} onChangeText={setShopName} placeholder="选填" />
        <ChoiceField label="客户分类" values={categories} selected={category} onSelect={setCategory} />
        <FormField
          label="下次跟进时间"
          value={nextFollowUpAt}
          onChangeText={setNextFollowUpAt}
          placeholder="2026-08-12 10:30（选填）"
        />
      </FormSection>

      <FormSection title="机器信息">
        <ChoiceField
          label="机器"
          values={machineTypes}
          selected={machineType}
          onSelect={(value) => setMachineType(value === machineType ? null : value)}
        />
        {machineType ? (
          <>
            <ChoiceField label="模式" values={machineModes} selected={machineMode} onSelect={setMachineMode} />
            <FormField label="费率（%）" value={feeRate} onChangeText={setFeeRate} placeholder="例如 0.38" keyboardType="decimal-pad" />
            <FormField label="押金（元）" value={depositAmount} onChangeText={setDepositAmount} placeholder="选填" keyboardType="decimal-pad" />
          </>
        ) : null}
      </FormSection>

      <FormSection title="银行卡">
        <FormField
          label="银行卡号"
          value={bankCardNumber}
          onChangeText={setBankCardNumber}
          placeholder="输入 12～19 位银行卡号（选填）"
          keyboardType="number-pad"
        />
        <Text selectable style={styles.helper}>只填写卡号，不要填写密码、PIN、CVV 或短信验证码。</Text>
      </FormSection>

      <FormSection title="证件图片">
        <PhotoField title="身份证正面" asset={front} onPick={() => void pick(setFront)} onClear={() => setFront(null)} />
        <PhotoField title="身份证反面" asset={back} onPick={() => void pick(setBack)} onClear={() => setBack(null)} />
        <PhotoField title="营业执照" asset={license} onPick={() => void pick(setLicense)} onClear={() => setLicense(null)} />
      </FormSection>

      <Pressable
        accessibilityRole="button"
        disabled={saving}
        onPress={() => void submit()}
        style={({ pressed }) => [styles.submit, { opacity: pressed || saving ? 0.6 : 1 }]}>
        <Text style={styles.submitText}>{saving ? '正在保存…' : '保存客户'}</Text>
      </Pressable>
    </ScrollView>
  );
}

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text selectable style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function FormField({ label, required, ...props }: React.ComponentProps<typeof TextInput> & { label: string; required?: boolean }) {
  return (
    <View style={styles.field}>
      <View style={styles.labelRow}>
        <Text selectable style={styles.label}>{label}</Text>
        {required ? <Text style={styles.required}>必填</Text> : null}
      </View>
      <TextInput
        {...props}
        placeholderTextColor={colors.tertiaryLabel}
        style={[styles.input, props.style]}
      />
    </View>
  );
}

function ChoiceField<T extends string>({
  label,
  values,
  selected,
  onSelect,
}: {
  label: string;
  values: readonly T[];
  selected: T | null;
  onSelect: (value: T) => void;
}) {
  return (
    <View style={styles.field}>
      <Text selectable style={styles.label}>{label}</Text>
      <View style={styles.choices}>
        {values.map((value) => {
          const active = selected === value;
          return (
            <Pressable
              key={value}
              onPress={() => onSelect(value)}
              style={({ pressed }) => [styles.choice, active && styles.choiceActive, { opacity: pressed ? 0.6 : 1 }]}>
              <Text style={[styles.choiceText, active && styles.choiceTextActive]}>{value}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function PhotoField({
  title,
  asset,
  onPick,
  onClear,
}: {
  title: string;
  asset: ImagePicker.ImagePickerAsset | null;
  onPick: () => void;
  onClear: () => void;
}) {
  return (
    <View style={styles.photoField}>
      <View style={styles.photoHeader}>
        <Text selectable style={styles.label}>{title}</Text>
        {asset ? (
          <Pressable onPress={onClear} hitSlop={8}>
            <Text style={styles.removePhoto}>移除</Text>
          </Pressable>
        ) : null}
      </View>
      <Pressable onPress={onPick} style={({ pressed }) => [styles.photoBox, { opacity: pressed ? 0.65 : 1 }]}>
        {asset ? (
          <Image source={{ uri: asset.uri }} contentFit="cover" style={styles.photoPreview} />
        ) : (
          <>
            <SymbolIcon name="photo.on.rectangle" size={24} color={colors.blue} />
            <Text style={styles.photoButtonText}>从相册选择</Text>
          </>
        )}
      </Pressable>
    </View>
  );
}

function appendAsset(form: FormData, key: string, asset: ImagePicker.ImagePickerAsset | null) {
  if (!asset) return;
  const extension = asset.uri.split('.').pop()?.split('?')[0] || 'jpg';
  form.append(
    key,
    {
      uri: asset.uri,
      name: asset.fileName || `${key}.${extension}`,
      type: asset.mimeType || `image/${extension === 'jpg' ? 'jpeg' : extension}`,
    } as unknown as Blob,
  );
}

function normalizePhone(value: string): string {
  const trimmed = value.trim();
  return `${trimmed.startsWith('+') ? '+' : ''}${trimmed.replace(/\D/g, '')}`;
}

const styles = StyleSheet.create({
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, padding: 14, borderRadius: 18, borderCurve: 'continuous', backgroundColor: '#EAF2FF' },
  noticeText: { flex: 1, color: '#346493', fontSize: 13, lineHeight: 19 },
  section: { gap: 14, padding: 16, borderRadius: 22, borderCurve: 'continuous', backgroundColor: colors.card },
  sectionTitle: { color: colors.label, fontSize: 18, fontWeight: '800' },
  field: { gap: 7 },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between' },
  label: { color: colors.label, fontSize: 14, fontWeight: '700' },
  required: { color: '#C9682A', fontSize: 12 },
  input: { minHeight: 48, paddingHorizontal: 13, borderWidth: 1, borderColor: '#D8DDE8', borderRadius: 15, borderCurve: 'continuous', backgroundColor: '#F9FAFC', color: colors.label, fontSize: 16 },
  duplicateWarning: { minHeight: 43, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingHorizontal: 12, borderRadius: 13, borderCurve: 'continuous', backgroundColor: '#FFF3DF' },
  duplicateText: { flex: 1, color: '#A5600F', fontSize: 13, fontWeight: '600' },
  helper: { color: colors.secondaryLabel, fontSize: 12, lineHeight: 18 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { minHeight: 38, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 15, borderRadius: 13, borderCurve: 'continuous', backgroundColor: '#F1F3F7' },
  choiceActive: { backgroundColor: colors.blueTint },
  choiceText: { color: colors.secondaryLabel, fontWeight: '700' },
  choiceTextActive: { color: colors.blue },
  photoField: { gap: 8 },
  photoHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  removePhoto: { color: '#C43D3D', fontSize: 13, fontWeight: '700' },
  photoBox: { minHeight: 92, alignItems: 'center', justifyContent: 'center', gap: 8, overflow: 'hidden', borderRadius: 16, borderCurve: 'continuous', backgroundColor: '#F1F5FB' },
  photoPreview: { width: '100%', aspectRatio: 1.75 },
  photoButtonText: { color: colors.blue, fontSize: 14, fontWeight: '700' },
  submit: { minHeight: 54, alignItems: 'center', justifyContent: 'center', borderRadius: 18, borderCurve: 'continuous', backgroundColor: colors.blue },
  submitText: { color: colors.white, fontSize: 17, fontWeight: '800' },
});
