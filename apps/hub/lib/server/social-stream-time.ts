/** Fixed stream columns only: SQL key must floor fractions exactly like streamTimestamp. */
export function socialStreamTimeSql(kind: 'post' | 'thread' | 'community'): string {
  let column: string;
  switch (kind) {
    case 'post': column = 's.created_at'; break;
    case 'thread': column = 't.created_at'; break;
    case 'community': column = 'm.created_at'; break;
    default: throw new Error('social_stream_unavailable');
  }
  return `(CASE WHEN length(${column})=10 THEN ${column}||'T00:00:00.000Z'
    ELSE substr(${column},1,10)||'T'||substr(${column},12,8)||'.'||
      CASE WHEN substr(${column},20,1)='.' THEN substr(rtrim(substr(${column},21),'Z')||'000',1,3) ELSE '000' END||'Z' END)`;
}
