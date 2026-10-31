export type CommunityAccessKind='invites'|'rules'|'questions';
export type CommunityManagedInvite={id:string;label:string;maxUses:number|null;useCount:number;expiresAt:string|null;revokedAt:string|null;createdAt:string};
export type CommunityManagedRule={id:string;title:string;body:string;required:boolean;position:number;createdAt:string;updatedAt:string};
export type CommunityManagedQuestion={id:string;prompt:string;required:boolean;position:number;createdAt:string};
export type CommunityAccessItem=CommunityManagedInvite|CommunityManagedRule|CommunityManagedQuestion;
export type CommunityAccessPage={communityId:string;viewerId:string;role:'owner'|'moderator';kind:CommunityAccessKind;items:CommunityAccessItem[];offset:number;hasMore:boolean};
export type CommunityAccessAction='create_invite'|'revoke_invite'|'create_rule'|'delete_rule'|'create_onboarding_question'|'delete_onboarding_question';
export type CommunityAccessInput={action:CommunityAccessAction;operationId:string;note:string}&(
  {action:'create_invite';label:string;maxUses:number|null;expiresInDays:number}|
  {action:'revoke_invite';inviteId:string;expected:CommunityManagedInvite}|
  {action:'create_rule';title:string;body:string}|
  {action:'delete_rule';ruleId:string;expected:CommunityManagedRule}|
  {action:'create_onboarding_question';prompt:string;required:boolean}|
  {action:'delete_onboarding_question';questionId:string;expected:CommunityManagedQuestion}
);
export type CommunityAccessResult={communityId:string;kind:CommunityAccessKind;targetId:string;target:CommunityAccessItem|null;inviteCode:string|null;receipt:{auditId:string;action:CommunityAccessAction;targetId:string;confirmedAt:string;replayed:boolean}};
