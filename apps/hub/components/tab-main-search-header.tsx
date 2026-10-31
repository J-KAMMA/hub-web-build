import { Children, type ReactNode } from "react";
import { Search } from "lucide-react";

import { SearchSubmitButton } from "@/components/search-submit-button";

export function TabMainSearchHeader({
  action,
  ariaLabel,
  children,
  defaultValue,
  placeholder,
}: {
  action?: string;
  ariaLabel: string;
  children?: ReactNode;
  defaultValue?: string;
  placeholder?: string;
}) {
  return (
    <header className="tab-main-search-header" data-hub-page-main-search>
      {children ? Children.toArray(children) : (
        <form action={action ?? "/search"} role="search" aria-label={ariaLabel}>
          <Search aria-hidden="true" />
          <input type="search" name="q" defaultValue={defaultValue} placeholder={placeholder ?? ariaLabel} aria-label={ariaLabel} autoComplete="off" />
          <SearchSubmitButton label={ariaLabel} />
        </form>
      )}
    </header>
  );
}
