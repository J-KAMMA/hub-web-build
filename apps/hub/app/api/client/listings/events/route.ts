import { clientEventListings } from "@/lib/server/client-event-listings";

export async function GET(request: Request) { return clientEventListings(request, "list"); }
