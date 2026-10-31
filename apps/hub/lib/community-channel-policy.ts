export const COMMUNITY_SLOWMODE_SECONDS=[0,5,10,30,60,300,600,3600] as const;
export type CommunitySlowmodeSeconds=typeof COMMUNITY_SLOWMODE_SECONDS[number];
export type CommunityChannelPolicy={id:string;name:string;slowmodeSeconds:CommunitySlowmodeSeconds;archivedAt:string|null};
export type CommunityChannelPolicyPage={communityId:string;viewerId:string;role:'owner'|'moderator';channels:CommunityChannelPolicy[];offset:number;hasMore:boolean};
export type CommunityChannelPolicyResult={communityId:string;channel:CommunityChannelPolicy;receipt:{auditId:string;action:'channel_controls'|'set_channel_archived';targetId:string;confirmedAt:string;replayed:boolean}};
