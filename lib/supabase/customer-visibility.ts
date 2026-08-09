import type { SearchBackendConfig } from "@/lib/supabase/rest";
import {
  callSupabaseRpc,
  getEndUserBearerToken,
} from "@/lib/supabase/rest";

interface VisibilityRpcRow {
  id: string;
  masked_phone: string | null;
}

export type CustomerVisibilityResult =
  | { visible: true; userAccessToken: string }
  | { visible: false };

export async function preflightCustomerVisibility(
  request: Request,
  backend: Extract<SearchBackendConfig, { mode: "supabase" }>,
  customerId: string,
): Promise<CustomerVisibilityResult> {
  const userAccessToken = getEndUserBearerToken(request, backend.anonKey);
  if (!userAccessToken) return { visible: false };

  const rows = await callSupabaseRpc<VisibilityRpcRow[]>(
    backend,
    userAccessToken,
    "get_sales_workspace_customer",
    { p_customer_id: customerId },
  );
  if (!Array.isArray(rows) || !rows[0] || String(rows[0].id) !== customerId) {
    return { visible: false };
  }
  return { visible: true, userAccessToken };
}
