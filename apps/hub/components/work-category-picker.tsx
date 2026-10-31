"use client";

import { useCategoryAccordion } from "@/lib/use-category-accordion";
import {
  WORK_CATEGORY_TAXONOMY,
  type WorkMarketplaceMode,
} from "@/lib/work-category-taxonomy";
import styles from "./work-category-picker.module.css";

export function WorkCategoryPicker({
  mode,
  value,
  onChange,
}: {
  mode: WorkMarketplaceMode;
  value: string;
  onChange: (category: string) => void;
}) {
  const selectedParent = WORK_CATEGORY_TAXONOMY[mode].find(
    (parent) =>
      parent.id === value || parent.children.some((child) => child.id === value),
  );
  const { isCategoryExpanded, toggleCategory } = useCategoryAccordion(
    selectedParent?.id ?? null,
  );

  return (
    <section className={styles.picker} aria-label="カテゴリ">
      <button
        className={value === "all" ? styles.selected : undefined}
        type="button"
        onClick={() => onChange("all")}
      >
        すべて
      </button>
      {WORK_CATEGORY_TAXONOMY[mode].map((parent) => {
        const expanded = isCategoryExpanded(parent.id);
        const parentSelected =
          value === parent.id ||
          parent.children.some((child) => child.id === value);
        return (
          <div className={styles.group} key={parent.id}>
            <button
              className={parentSelected ? styles.selected : undefined}
              type="button"
              aria-expanded={expanded}
              onClick={() => toggleCategory(parent.id)}
            >
              <span>{parent.label}</span>
              <span aria-hidden="true">{expanded ? "−" : "+"}</span>
            </button>
            {expanded ? (
              <div className={styles.children}>
                <button
                  className={value === parent.id ? styles.selected : undefined}
                  type="button"
                  onClick={() => onChange(parent.id)}
                >
                  {parent.label}すべて
                </button>
                {parent.children.map((child) => (
                  <button
                    className={value === child.id ? styles.selected : undefined}
                    type="button"
                    key={child.id}
                    onClick={() => onChange(child.id)}
                  >
                    {child.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}

