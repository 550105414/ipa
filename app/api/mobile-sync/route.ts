import { createMobileSyncHandlers } from "@/lib/security/mobile-sync";
import {
  getWorkspaceDatabase,
  privateJson,
  workspaceUserId,
} from "@/lib/workspace/server";

const handlers = createMobileSyncHandlers({
  userId: workspaceUserId,
  database: getWorkspaceDatabase,
  respond: privateJson,
});

export async function GET(request: Request): Promise<Response> {
  return handlers.GET(request);
}

export async function PUT(request: Request): Promise<Response> {
  return handlers.PUT(request);
}
