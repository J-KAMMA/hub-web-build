import { clientResearchChangeContext } from "@/lib/server/client-research-change-context";

export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  return clientResearchChangeContext(request, (await params).projectId);
}
