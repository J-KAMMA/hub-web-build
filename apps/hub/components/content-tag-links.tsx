export function ContentTagLinks({ tags }: { tags?: string[] }) {
  if (!tags?.length) return null;
  return (
    <nav className="content-tag-links" aria-label="タグ">
      {tags.map((tag) => (
        <a href={`/search?q=${encodeURIComponent(`#${tag}`)}`} key={tag}>#{tag}</a>
      ))}
    </nav>
  );
}
