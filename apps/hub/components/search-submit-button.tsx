import React from "react";
import { Search } from "lucide-react";
import { AsyncActionButton } from "./async-action-button";

export function SearchSubmitButton({ label, disabled = false, pending = false }: { label: string; disabled?: boolean; pending?: boolean }) {
  return (
    <AsyncActionButton
      className="search-submit-button"
      type="submit"
      aria-label={pending ? `${label}中` : label}
      title={label}
      disabled={disabled}
      pending={pending}
      pendingLabel={`${label}中`}
    >
      <Search aria-hidden="true" size={18} strokeWidth={2} />
    </AsyncActionButton>
  );
}
