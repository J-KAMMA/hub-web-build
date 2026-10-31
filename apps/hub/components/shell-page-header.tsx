import React from "react";
import { Search } from "lucide-react";
import { hubSectionIsBrowsable, resolveHubPageTitle } from "@/lib/page-title-registry";
import { resolveHubPageSearch } from "@/lib/page-search-registry";
import { SearchSubmitButton } from "@/components/search-submit-button";

/*
 * ownsHeading is stated by the caller when the shell cannot work it out. A
 * layout serves a whole subtree with one fixed path, so /admin/moderation and
 * /admin both looked like the section page to this component.
 */
export function ShellPageHeader({ currentPath, initialQuery = "", ownsHeading }: { currentPath: string; initialQuery?: string; ownsHeading?: boolean }) {
  const page = resolveHubPageTitle(currentPath);
  const search = resolveHubPageSearch(currentPath);
  const isHeading = ownsHeading ?? currentPath === page.section;

  return (
    <header
      className="shell-page-header"
      data-shell-column-header="middle"
      data-shell-heading={isHeading ? "page" : "section"}
    >
      <div className="shell-page-header__title">
        {page.parent ? <small>{page.parent}</small> : null}
        {/*
          * On the section page itself this is the heading. One level down it
          * is not: the article, the profile, the product each print their own
          * name, and both were h1, so twenty-six routes shipped two. Here the
          * words stay and stop being a heading — they name where you are, and
          * lead back there.
          */}
        {isHeading ? <h1>{page.title}</h1> : (
          /*
           * Four sections name a family of pages without having an index of
           * their own, so the same words lead nowhere there and stay plain.
           */
          hubSectionIsBrowsable(page.section)
            ? <a className="shell-page-header__section" href={page.section}>{page.title}</a>
            : <p className="shell-page-header__section">{page.title}</p>
        )}
      </div>
      {search ? (
        <form className="shell-page-search" action={search.action} role="search" data-hub-page-main-search>
          <Search aria-hidden="true" />
          <input
            type="search"
            name="q"
            defaultValue={initialQuery}
            aria-label={search.ariaLabel}
            placeholder={search.placeholder}
            autoComplete="off"
          />
          <SearchSubmitButton label={`${page.title}を検索`} />
        </form>
      ) : null}
      {search ? (
        <a className="shell-page-search-link" href={search.action} aria-label={search.ariaLabel}>
          <Search aria-hidden="true" />
        </a>
      ) : null}
    </header>
  );
}
