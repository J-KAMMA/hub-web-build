import {clientCommunityNotifications} from '@/lib/server/client-community-notifications';
type Context = {params: Promise<{communityId: string}>};
export const GET = (request: Request, {params}: Context) => clientCommunityNotifications(request, params, 'get');
export const PATCH = (request: Request, {params}: Context) => clientCommunityNotifications(request, params, 'update');
