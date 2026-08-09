import {
  apiError,
  findOwnedCustomer,
  getWorkspaceBindings,
  isWorkspaceCloudConfigured,
} from "@/lib/workspace/server";

interface RouteContext {
  params:
    | Promise<{ id: string; side: string }>
    | { id: string; side: string };
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  if (!(await isWorkspaceCloudConfigured())) {
    return apiError(404, "ID_CARD_NOT_FOUND", "未找到身份证图片");
  }
  const params = await context.params;
  let id = "";
  try {
    id = decodeURIComponent(params.id).trim();
  } catch {
    return apiError(404, "ID_CARD_NOT_FOUND", "未找到身份证图片");
  }
  const side = params.side === "front" || params.side === "back" ? params.side : null;
  if (!side) return apiError(404, "ID_CARD_NOT_FOUND", "未找到身份证图片");
  const owned = await findOwnedCustomer(request, id);
  if (!owned) return apiError(404, "ID_CARD_NOT_FOUND", "未找到身份证图片");
  const key = side === "front"
    ? owned.row.id_card_front_key
    : owned.row.id_card_back_key;
  if (!key) return apiError(404, "ID_CARD_NOT_FOUND", "未找到身份证图片");
  const { files } = await getWorkspaceBindings();
  const object = await files.get(key);
  if (!object) return apiError(404, "ID_CARD_NOT_FOUND", "未找到身份证图片");
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("Content-Disposition", "inline");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  return new Response(object.body, { status: 200, headers });
}
