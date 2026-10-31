import Link from 'next/link';
import { contentShareHref } from '@/lib/content-share';

export function V2ContentShare({ href, japanese = true }: { href: string; japanese?: boolean }) {
  const destination = contentShareHref(href);
  return destination ? <Link className="v2-button" href={destination}>{japanese ? '投稿で紹介' : 'Share in a post'}</Link> : null;
}
