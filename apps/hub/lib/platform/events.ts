export type HubCloudEvent<T extends Record<string, unknown>> = {
  specversion: "1.0";
  id: string;
  source: `/hub/${string}`;
  type: `hub.${string}.v${number}`;
  time: string;
  datacontenttype: "application/json";
  schemaVersion: number;
  correlationId: string;
  subject?: string;
  data: T;
};

const EVENT_TYPE = /^hub\.[a-z0-9-]+(?:\.[a-z0-9-]+)+\.v[1-9][0-9]*$/;

export function createHubEvent<T extends Record<string, unknown>>(input: {
  source: `/hub/${string}`;
  type: `hub.${string}.v${number}`;
  schemaVersion: number;
  correlationId: string;
  subject?: string;
  data: T;
  id?: string;
  time?: string;
}): HubCloudEvent<T> {
  if (!EVENT_TYPE.test(input.type)) throw new TypeError("Invalid Hub event type.");
  if (!Number.isInteger(input.schemaVersion) || input.schemaVersion < 1) throw new TypeError("schemaVersion must be a positive integer.");
  return {
    specversion: "1.0",
    id: input.id ?? crypto.randomUUID(),
    source: input.source,
    type: input.type,
    time: input.time ?? new Date().toISOString(),
    datacontenttype: "application/json",
    schemaVersion: input.schemaVersion,
    correlationId: input.correlationId,
    ...(input.subject ? { subject: input.subject } : {}),
    data: input.data,
  };
}
