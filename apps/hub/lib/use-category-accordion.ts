"use client";

import { useCallback, useState } from "react";

export function useCategoryAccordion(initialKey: string | null = null) {
  const [expandedCategoryKey, setExpandedCategoryKey] = useState<string | null>(initialKey);

  const toggleCategory = useCallback((categoryKey: string) => {
    setExpandedCategoryKey((current) => current === categoryKey ? null : categoryKey);
  }, []);

  const expandCategory = useCallback((categoryKey: string) => {
    setExpandedCategoryKey(categoryKey);
  }, []);

  const collapseCategories = useCallback(() => {
    setExpandedCategoryKey(null);
  }, []);

  return {
    expandedCategoryKey,
    isCategoryExpanded: (categoryKey: string) => expandedCategoryKey === categoryKey,
    toggleCategory,
    expandCategory,
    collapseCategories,
  };
}
