import {clientCommunityNotifications} from '@/lib/server/client-community-notifications';
type Context = {params: Promise<{communityId: string}>};
export const POST = (request: Request, {params}: Context) => clientCommunityNotifications(request, params, 'read-all');
