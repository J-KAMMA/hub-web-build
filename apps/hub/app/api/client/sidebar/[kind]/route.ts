import { sidebarResponse } from "./handler";

export async function GET(request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  return sidebarResponse(request, kind, null);
}
