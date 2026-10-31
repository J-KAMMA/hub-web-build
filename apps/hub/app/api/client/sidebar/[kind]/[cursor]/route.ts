import { sidebarResponse } from "../handler";

export async function GET(request: Request, { params }: { params: Promise<{ kind: string; cursor: string }> }) {
  const { kind, cursor } = await params;
  return sidebarResponse(request, kind, cursor);
}
