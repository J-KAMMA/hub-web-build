import { desktopVideoCreate, desktopVideoList } from "@/lib/server/hub-videos-desktop-handlers";

export const dynamic = "force-dynamic";
export const GET = desktopVideoList;
export const POST = desktopVideoCreate;
