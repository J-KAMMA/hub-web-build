export type JsonObject = Record<string, unknown>;

export type DeliveryMessage = {
  deliveryId: string;
  activityId: string;
  actorHandle: string;
  inboxUrl: string;
  activity: JsonObject;
  serviceRequestId?: string;
};

export type DomainAction = "allow" | "limit" | "suspend";

export type FederatedProfileRow = {
  profileId: string;
  handle: string;
  displayName: string;
  summary: string;
  avatarUrl: string | null;
  enabled: number;
  discoverable: number;
  createdAt: string;
  updatedAt: string;
  /** 段階2（0015）。SELECT * で読んだときだけ入る。 */
  rootKeyDid?: string | null;
  alsoKnownAsJson?: string | null;
  movedTo?: string | null;
  movedAt?: string | null;
};
