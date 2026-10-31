"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";

/*
 * The settings screen's left column: a directory of every section, with a
 * filter and a marker for the section currently on screen.
 *
 * The screen used to be one scroll of thirteen sections with a partial
 * quick-nav that named only four of them — everything else had to be found by
 * scrolling. Every other catalogue screen on the Hub (bbs, music, hubpedia)
 * already answers this with the shared left column, so settings joins them.
 *
 * The bbs-* class names are load-bearing, not leftovers: they are how the
 * shared column system recognises this column, the same way the music
 * directory does it. That inherits the whole responsive contract — a sticky
 * 228px column from 1440px, a toggle below that, a drawer on phones — instead
 * of restating it and drifting. The community workspace restated its own
 * breakpoints and spent a day broken between 1200px and 1439px for it.
 */

export interface SettingsDirectorySection {
  id: string;
  label: string;
  hint: string;
  group: string;
}

interface SettingsDirectoryProps {
  title: string;
  toggleLabel: string;
  searchLabel: string;
  searchPlaceholder: string;
  closeLabel: string;
  emptyText: string;
  sections: readonly SettingsDirectorySection[];
  children: ReactNode;
}

export function SettingsDirectory({
  title,
  toggleLabel,
  searchLabel,
  searchPlaceholder,
  closeLabel,
  emptyText,
  sections,
  children,
}: SettingsDirectoryProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);

  /* A deep link like /settings#storage marks its section from the start. */
  useEffect(() => {
    const fromHash = () => {
      const id = window.location.hash.slice(1);
      if (id && sections.some((section) => section.id === id)) setActiveId(id);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [sections]);

  useEffect(() => {
    /* jsdom has no IntersectionObserver; the directory still renders. */
    if (typeof IntersectionObserver === "undefined") return;
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.id;
          if (entry.isIntersecting) visible.add(id);
          else visible.delete(id);
        }
        /* Of the sections on screen, the one highest in the page order wins. */
        const current = sections.find((section) => visible.has(section.id));
        if (current) setActiveId(current.id);
      },
      /* The band between the sticky header and the lower third: a section is
         "current" while its content occupies where people actually read. */
      { rootMargin: "-72px 0px -55% 0px", threshold: 0 },
    );
    const targets = sections
      .map((section) => document.getElementById(section.id))
      .filter((element): element is HTMLElement => element !== null);
    for (const target of targets) observer.observe(target);
    return () => observer.disconnect();
  }, [sections]);

  const normalizedQuery = query.trim().normalize("NFKC").toLocaleLowerCase("ja");
  const visibleSections = useMemo(() => {
    if (!normalizedQuery) return sections;
    return sections.filter((section) =>
      `${section.label} ${section.hint} ${section.group}`
        .normalize("NFKC")
        .toLocaleLowerCase("ja")
        .includes(normalizedQuery));
  }, [sections, normalizedQuery]);

  const closeMobile = () => setMobileOpen(false);

  let previousGroup: string | null = null;

  return (
    <div className="settings-directory-layout bbs-directory-layout tab-left-column-layout">
      <button
        type="button"
        className="bbs-directory-mobile-toggle"
        onClick={() => setMobileOpen((current) => !current)}
        aria-controls="settings-directory"
        aria-expanded={mobileOpen}
      >
        {toggleLabel}
      </button>
      {mobileOpen && (
        <button type="button" className="bbs-directory-backdrop" onClick={closeMobile} aria-label={closeLabel} />
      )}
      <aside
        id="settings-directory"
        data-hub-page-left-column
        className={`settings-directory bbs-thread-directory tab-left-column${mobileOpen ? " bbs-thread-directory--open" : ""}`}
        aria-label={title}
      >
        <header className="bbs-thread-directory__header tab-left-column__header">
          <div>
            <strong>{title}</strong>
          </div>
          <button type="button" onClick={closeMobile} aria-label={closeLabel}>×</button>
        </header>
        <label className="bbs-thread-directory__search">
          <span>{searchLabel}</span>
          <div>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="11" cy="11" r="6" />
              <path d="m16 16 4 4" />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={searchPlaceholder}
            />
          </div>
        </label>
        <nav className="bbs-thread-directory__nav settings-directory__nav" aria-label={title}>
          {visibleSections.map((section) => {
            const heading = section.group !== previousGroup
              ? <p className="settings-directory__group" key={`group-${section.group}`}>{section.group}</p>
              : null;
            previousGroup = section.group;
            return (
              <span key={section.id} className="settings-directory__item">
                {heading}
                <a
                  href={`#${section.id}`}
                  aria-current={activeId === section.id ? "true" : undefined}
                  onClick={() => { setActiveId(section.id); closeMobile(); }}
                >
                  <strong>{section.label}</strong>
                  <small>{section.hint}</small>
                </a>
              </span>
            );
          })}
          {!visibleSections.length && <p className="settings-directory__empty">{emptyText}</p>}
        </nav>
      </aside>
      <div className="settings-directory-content bbs-directory-content">
        {children}
      </div>
    </div>
  );
}
