import { desktopVideoDelete, desktopVideoGet, desktopVideoUpdate } from "@/lib/server/hub-videos-desktop-handlers";

export const dynamic = "force-dynamic";
export const GET = desktopVideoGet;
export const PATCH = desktopVideoUpdate;
export const DELETE = desktopVideoDelete;
