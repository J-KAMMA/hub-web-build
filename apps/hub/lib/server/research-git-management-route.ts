import 'server-only';
import {HubAuthenticationError,HubSuspendedError} from './hub-session';
import {DesktopHubAuthenticationError} from './desktop-hub-auth';
import {ResearchWorkspaceError} from './research-workspace';
import {readPdfBytes} from './research-pdfs';
export const gitManagementJson = (value:unknown,status=200) => Response.json(value,{status,headers:{'Cache-Control':'private, no-store'}});
export function gitManagementQuery(request:Request) {if (new URL(request.url).searchParams.size) throw new ResearchWorkspaceError('Gitの指定が不正です。');}
export async function gitManagementBody(request:Request) {
  let value:unknown;
  try {value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readPdfBytes(request,8192)));}
  catch(error) {if(error instanceof ResearchWorkspaceError && error.status===413) throw new ResearchWorkspaceError('Gitの入力は8KBまでです。',413); if(error instanceof SyntaxError || error instanceof TypeError) throw new ResearchWorkspaceError('Gitの入力が不正です。'); throw error;}
  if (!value || typeof value!=='object' || Array.isArray(value)) throw new ResearchWorkspaceError('Gitの入力が不正です。');
  return value as Record<string,unknown>;
}
export function gitManagementFailure(error:unknown) {
  const status=error instanceof ResearchWorkspaceError?error.status:error instanceof HubSuspendedError?403:error instanceof HubAuthenticationError || error instanceof DesktopHubAuthenticationError?401:503;
  return gitManagementJson({error:error instanceof ResearchWorkspaceError?error.message:'Git情報を処理できませんでした。'},status);
}
