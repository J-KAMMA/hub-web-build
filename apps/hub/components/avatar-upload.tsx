"use client";

import { useRef, useState } from "react";

import {
  optimizeImageFile,
  SQUARE_AVATAR_PRESET,
} from "@/lib/client-image-optimizer";

async function prepareAvatar(file: File): Promise<string> {
  return (await optimizeImageFile(file, SQUARE_AVATAR_PRESET)).dataUrl;
}

interface AvatarUploadProps {
  displayName: string;
  avatarUrl?: string;
  isCurrentUser: boolean;
  editable?: boolean;
}

export function AvatarUpload({
  displayName,
  avatarUrl: initialAvatarUrl,
  isCurrentUser,
  editable = isCurrentUser,
}: AvatarUploadProps) {
  const [avatarUrl, setAvatarUrl] = useState(initialAvatarUrl);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError("");
    setUploading(true);
    try {
      const dataUrl = await prepareAvatar(file);
      const res = await fetch("/api/profile/avatar", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarUrl: dataUrl }),
      });

      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(payload?.error ?? "画像の更新に失敗しました。");
      }
      const payload = (await res.json()) as { profile?: { avatarUrl?: string } };
      setAvatarUrl(payload.profile?.avatarUrl ?? dataUrl);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "画像の更新に失敗しました。",
      );
    } finally {
      setUploading(false);
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }
  };

  return (
    <div className="profile-avatar-upload">
      <button
        type="button"
        className={`profile-avatar${editable ? " profile-avatar--editable" : ""}`}
        onClick={() => editable && !uploading && inputRef.current?.click()}
        aria-label={
          editable
            ? "プロフィール画像を変更"
            : `${displayName}のプロフィール画像`
        }
        disabled={!editable || uploading}
      >
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt=""
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              borderRadius: "50%",
            }}
          />
        ) : (
          displayName.slice(0, 2)
        )}
        {editable && (
          <>
            <div
              style={{
                position: "absolute",
                inset: 0,
                borderRadius: "50%",
                background: "color-mix(in srgb, var(--text) 70%, transparent)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                opacity: uploading ? 1 : 0,
                transition: "opacity 160ms ease",
                fontSize: "0.7rem",
                color: "var(--action-text)",
                pointerEvents: "none",
              }}
              className="avatar-overlay"
            >
              {uploading ? "…" : "変更"}
            </div>
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              style={{ display: "none" }}
              onChange={handleFileChange}
              disabled={uploading}
            />
          </>
        )}
      </button>
      {error ? (
        <p className="inline-error profile-avatar-upload__error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
