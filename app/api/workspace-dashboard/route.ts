import {
  apiError,
  getWorkspaceBindings,
  isWorkspaceCloudConfigured,
  maskPhone,
  privateJson,
  workspaceUserId,
} from "@/lib/workspace/server";
import { CUSTOMER_STAGES, type CustomerStage } from "@/lib/customers/profile";

type HealthRow = {
  id: string;
  name: string;
  phone: string;
  id_card_front_key: string | null;
  id_card_back_key: string | null;
  business_license_key: string | null;
  next_follow_up_at: string | null;
  machine_type: string | null;
  machine_serial: string | null;
};

export async function GET(request: Request): Promise<Response> {
  if (!(await isWorkspaceCloudConfigured())) {
    return apiError(409, "CLOUD_SYNC_REQUIRED", "今日工作需要启用云端同步");
  }
  const userId = await workspaceUserId(request);
  if (!userId) return apiError(401, "AUTH_REQUIRED", "请先连接个人工作台");

  const now = new Date();
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const { db } = await getWorkspaceBindings();

  const [totals, stageRows, followRows, followCount, healthRows, earnings] = await Promise.all([
    db.prepare(
      `SELECT COUNT(*) AS customers,
              SUM(CASE WHEN id_card_front_key IS NOT NULL AND id_card_back_key IS NOT NULL THEN 1 ELSE 0 END) AS complete,
              SUM(CASE WHEN id_card_front_key IS NULL OR id_card_back_key IS NULL THEN 1 ELSE 0 END) AS draft,
              SUM(CASE WHEN stage = '已商户' THEN 1 ELSE 0 END) AS merchants
       FROM customers WHERE owner_id = ?1 AND deleted_at IS NULL`,
    ).bind(userId).first<{ customers: number; complete: number; draft: number; merchants: number }>(),
    db.prepare(
      `SELECT stage, COUNT(*) AS count FROM customers
       WHERE owner_id = ?1 AND deleted_at IS NULL GROUP BY stage`,
    ).bind(userId).all<{ stage: string; count: number }>(),
    db.prepare(
      `SELECT id, name, phone, next_follow_up_at FROM customers
       WHERE owner_id = ?1 AND deleted_at IS NULL AND next_follow_up_at IS NOT NULL AND next_follow_up_at <= ?2
       ORDER BY next_follow_up_at ASC LIMIT 20`,
    ).bind(userId, todayEnd.toISOString()).all<{ id: string; name: string; phone: string; next_follow_up_at: string }>(),
    db.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN next_follow_up_at < ?3 THEN 1 ELSE 0 END) AS overdue
       FROM customers WHERE owner_id = ?1 AND deleted_at IS NULL
         AND next_follow_up_at IS NOT NULL AND next_follow_up_at <= ?2`,
    ).bind(userId, todayEnd.toISOString(), todayStart.toISOString()).first<{ total: number; overdue: number }>(),
    db.prepare(
      `SELECT id, name, phone, id_card_front_key, id_card_back_key, business_license_key,
              next_follow_up_at, machine_type, machine_serial
       FROM customers WHERE owner_id = ?1 AND deleted_at IS NULL
       ORDER BY updated_at DESC LIMIT 100`,
    ).bind(userId).all<HealthRow>(),
    db.prepare(
      `SELECT COALESCE(SUM(monthly_volume), 0) AS monthly_volume,
              COALESCE(SUM(monthly_volume * profit_share_rate / 100.0), 0) AS estimated_profit,
              SUM(CASE WHEN machine_type IS NOT NULL AND (machine_status IS NULL OR machine_status != '已回收') THEN 1 ELSE 0 END) AS active_machines
       FROM customers WHERE owner_id = ?1 AND deleted_at IS NULL`,
    ).bind(userId).first<{ monthly_volume: number; estimated_profit: number; active_machines: number }>(),
  ]);

  const health = (healthRows.results ?? []).map((row) => {
    const issues: string[] = [];
    if (!row.id_card_front_key || !row.id_card_back_key) issues.push("身份证待补");
    if (!row.business_license_key) issues.push("营业执照待补");
    if (!row.next_follow_up_at) issues.push("未设置跟进时间");
    if (row.machine_type && !row.machine_serial) issues.push("机器序列号待补");
    return { id: row.id, name: row.name, maskedPhone: maskPhone(row.phone), issues };
  }).filter((item) => item.issues.length > 0);
  const stageMap = new Map((stageRows.results ?? []).map((row) => [row.stage, Number(row.count)]));

  return privateJson({
    totals: {
      customers: Number(totals?.customers ?? 0),
      complete: Number(totals?.complete ?? 0),
      draft: Number(totals?.draft ?? 0),
      merchants: Number(totals?.merchants ?? 0),
    },
    followUps: {
      totalDue: Number(followCount?.total ?? 0),
      overdue: Number(followCount?.overdue ?? 0),
      items: (followRows.results ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        maskedPhone: maskPhone(row.phone),
        nextFollowUpAt: row.next_follow_up_at,
        overdue: row.next_follow_up_at < todayStart.toISOString(),
      })),
    },
    stages: CUSTOMER_STAGES.map((stage: CustomerStage) => ({ stage, count: stageMap.get(stage) ?? 0 })),
    health: { total: health.length, issues: health.slice(0, 20) },
    earnings: {
      monthlyVolume: Number(earnings?.monthly_volume ?? 0),
      estimatedProfit: Number(earnings?.estimated_profit ?? 0),
      activeMachines: Number(earnings?.active_machines ?? 0),
    },
  });
}
