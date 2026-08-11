import {
  apiError,
  getWorkspaceBindings,
  workspaceUserId,
} from "@/lib/workspace/server";

const RELEASE_TEST_CUSTOMER_ID = "fc7145d4-bbfa-4fee-99f1-1167d369a41c";

// Temporary, owner-scoped release-cleanup endpoint. It is deployed only long
// enough to remove the exact acceptance-test record created during this
// release, then removed from source in the immediately following deployment.
export async function GET(request: Request): Promise<Response> {
  const ownerId = workspaceUserId(request);
  if (!ownerId) return apiError(404, "NOT_FOUND", "Not found");

  const { db, files } = await getWorkspaceBindings();
  const customer = await db
    .prepare(
      `SELECT id_card_front_key, id_card_back_key, business_license_key
       FROM customers
       WHERE id = ?1 AND owner_id = ?2
       LIMIT 1`,
    )
    .bind(RELEASE_TEST_CUSTOMER_ID, ownerId)
    .first<{
      id_card_front_key: string | null;
      id_card_back_key: string | null;
      business_license_key: string | null;
    }>();

  if (customer) {
    await Promise.allSettled(
      [
        customer.id_card_front_key,
        customer.id_card_back_key,
        customer.business_license_key,
      ]
        .filter((key): key is string => Boolean(key))
        .map((key) => files.delete(key)),
    );
    await db.batch([
      db
        .prepare("DELETE FROM tasks WHERE customer_id = ?1 AND owner_id = ?2")
        .bind(RELEASE_TEST_CUSTOMER_ID, ownerId),
      db
        .prepare(
          "DELETE FROM customer_activity WHERE customer_id = ?1 AND owner_id = ?2",
        )
        .bind(RELEASE_TEST_CUSTOMER_ID, ownerId),
      db
        .prepare("DELETE FROM customers WHERE id = ?1 AND owner_id = ?2")
        .bind(RELEASE_TEST_CUSTOMER_ID, ownerId),
    ]);
  }

  return new Response(
    `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>清理完成</title><body><main><h1>${customer ? "验收资料已清理" : "没有待清理的验收资料"}</h1></main></body></html>`,
    {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": "text/html; charset=utf-8",
      },
    },
  );
}
