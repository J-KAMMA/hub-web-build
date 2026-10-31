import { clientEventListings } from "@/lib/server/client-event-listings";

type Context = { params: Promise<{ listingId: string }> };
export async function GET(request: Request, { params }: Context) {
  return clientEventListings(request, "detail", (await params).listingId);
}
export async function PATCH(request: Request, { params }: Context) {
  return clientEventListings(request, "cancel", (await params).listingId);
}
