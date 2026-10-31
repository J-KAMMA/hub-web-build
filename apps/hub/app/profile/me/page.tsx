import { redirect } from "next/navigation";

import { getHubViewer } from "@/lib/server/hub-viewer";

export default async function MyProfilePage() {
  const viewer = await getHubViewer();
  if (!viewer) redirect("/v2/auth?next=%2Fv2%2Fprofile%2Fme");

  redirect(`/v2/profile/${encodeURIComponent(viewer.handle)}`);
}
