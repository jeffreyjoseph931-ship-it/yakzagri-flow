"use client";
import { t as translateCopy } from "@/lib/i18n";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { api, type SearchResultItem } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { nextTrapTarget } from "@/lib/a11y/focusTrap";

interface GroupedResults {
  trades: SearchResultItem[];
  users: SearchResultItem[];
  contracts: SearchResultItem[];
}

const EMPTY_RESULTS: GroupedResults = { trades: [], users: [], contracts: [] };

const CATEGORY_LABELS: Record<keyof GroupedResults, string> = {
  trades: "Trades",
  users: "Users",
  contracts: "Contracts",
};

/** Id of the listbox popup the combobox controls. */
const RESULTS_LISTBOX_ID = "global-search-results";
/** Id of the "type to search" hint that describes the empty combobox. */
const SEARCH_HINT_ID = "global-search-hint";
/** How many rows a PageUp/PageDown jump moves through the result list. */
const PAGE_JUMP = 10;
/** localStorage key for persisting recent searches. */
const RECENT_SEARCHES_KEY = "eziagric:recentSearches";
/** Maximum number of recent searches to persist. */
const MAX_RECENT_SEARCHES = 5;

type Scope = "all" | "trades" | "streams" | "disputes";

interface ScopePill {
  scope: Scope;
  labelKey:
    | "ui.filter_all_c2a9b30"
    | "ui.filter_trades_8e3f1d4"
    | "ui.filter_streams_5b7c2e8"
    | "ui.filter_disputes_9d4a6f1";
}

const SCOPE_PILLS: ScopePill[] = [
  { scope: "all", labelKey: "ui.filter_all_c2a9b30" },
  { scope: "trades", labelKey: "ui.filter_trades_8e3f1d4" },
  { scope: "streams", labelKey: "ui.filter_streams_5b7c2e8" },
  { scope: "disputes", labelKey: "ui.filter_disputes_9d4a6f1" },
];

// ── Recent-searches helpers ──────────────────────────────────────────────────

function loadRecentSearches(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_SEARCHES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return Array.from(
      new Set(
        parsed.filter(
          (query): query is string => typeof query === "string" && query.trim().length > 0,
        ),
      ),
    ).slice(0, MAX_RECENT_SEARCHES);
  } catch {
    return [];
  }
}

function saveRecentSearch(query: string): void {
  try {
    const existing = loadRecentSearches();
    const deduped = [query, ...existing.filter((q) => q !== query)].slice(
      0,
      MAX_RECENT_SEARCHES,
    );
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(deduped));
  } catch {
    // localStorage may be unavailable (e.g. SSR, privacy mode)
  }
}

function clearRecentSearches(): void {
  try {
    localStorage.removeItem(RECENT_SEARCHES_KEY);
  } catch {
    // ignore
  }
}

// ── Component ────────────────────────────────────────────────────────────────

interface GlobalSearchProps {
  /** Called when the overlay is dismissed without a selection */
  onClose?: () => void;
}

export function GlobalSearch({ onClose }: GlobalSearchProps) {
  const router = useRouter();
  const { token } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GroupedResults>(EMPTY_RESULTS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [scope, setScope] = useState<Scope>("all");
  const [recentSearches, setRecentSearches] = useState<string[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const wasOpenRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Scope → category mapping ───────────────────────────────────────────────

  /**
   * Maps the active scope to the GroupedResults keys that should be visible.
   * `streams` maps to `contracts` because the API uses "contracts" internally.
   * `disputes` has no current API category — it will render empty until the
   * API adds a disputes category to SearchResponse.
   */
  function scopeToCategories(s: Scope): Array<keyof GroupedResults> {
    switch (s) {
      case "trades":
        return ["trades"];
      case "streams":
        return ["contracts"];
      case "disputes":
        return []; // future: add "disputes" category to GroupedResults
      case "all":
      default:
        return ["trades", "users", "contracts"];
    }
  }

  const visibleCategories = scopeToCategories(scope);

  const allItems = [
    ...(visibleCategories.includes("trades")
      ? results.trades.map((r) => ({ ...r, category: "trades" as const }))
      : []),
    ...(visibleCategories.includes("users")
      ? results.users.map((r) => ({ ...r, category: "users" as const }))
      : []),
    ...(visibleCategories.includes("contracts")
      ? results.contracts.map((r) => ({ ...r, category: "contracts" as const }))
      : []),
  ];

  const hasResults = allItems.length > 0;

  const hasAnyResults =
    results.trades.length > 0 ||
    results.users.length > 0 ||
    results.contracts.length > 0;

  // ── Open / close ──────────────────────────────────────────────────────────

  const open = useCallback(() => {
    setIsOpen(true);
    setQuery("");
    setResults(EMPTY_RESULTS);
    setError(null);
    setActiveIndex(-1);
    setScope("all");
    setRecentSearches(loadRecentSearches());
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setQuery("");
    setResults(EMPTY_RESULTS);
    setActiveIndex(-1);
    setScope("all");
    onClose?.();
  }, [onClose]);

  // ── Focus return ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!isOpen && wasOpenRef.current) {
      triggerRef.current?.focus();
    }
    wasOpenRef.current = isOpen;
  }, [isOpen]);

  // ── Cmd+K / Ctrl+K / Escape ───────────────────────────────────────────────

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        if (isOpen) {
          close();
        } else {
          open();
        }
      }
      if (e.key === "Escape" && isOpen) {
        close();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, open, close]);

  // ── Debounced search ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!isOpen) return;

    if (!query.trim()) {
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      if (!token) {
        setError("Please sign in to search");
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const data = await api.search.query(token, query.trim());
        setResults(data);
        setActiveIndex(-1);
        // Persist successful searches (non-empty API call that resolved)
        saveRecentSearch(query.trim());
        setRecentSearches(loadRecentSearches());
      } catch {
        setError("Search failed. Please try again.");
        setResults(EMPTY_RESULTS);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, isOpen, token]);

  // ── Scroll active option into view ────────────────────────────────────────

  useEffect(() => {
    if (!isOpen) return;
    if (activeIndex < 0) return;
    const active = document.getElementById(`search-result-${activeIndex}`);
    active?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, isOpen]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handleSelect(item: SearchResultItem & { category: keyof GroupedResults }) {
    const routes: Record<keyof GroupedResults, string> = {
      trades: `/trades/${encodeURIComponent(item.id)}`,
      users: `/reputation/${encodeURIComponent(item.id)}`,
      contracts: `/streams/${encodeURIComponent(item.id)}`,
    };
    router.push(routes[item.category]);
    close();
  }

  function handleRecentSearchClick(term: string) {
    setQuery(term);
    inputRef.current?.focus();
  }

  function handleClearRecent() {
    clearRecentSearches();
    setRecentSearches([]);
  }

  function handleKeyNavigation(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) =>
        allItems.length === 0 ? -1 : Math.min(i + 1, allItems.length - 1),
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, -1));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActiveIndex(allItems.length === 0 ? -1 : 0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActiveIndex(allItems.length === 0 ? -1 : allItems.length - 1);
    } else if (e.key === "PageDown") {
      e.preventDefault();
      setActiveIndex((i) =>
        allItems.length === 0
          ? -1
          : Math.min(Math.max(i, -1) + PAGE_JUMP, allItems.length - 1),
      );
    } else if (e.key === "PageUp") {
      e.preventDefault();
      setActiveIndex((i) =>
        allItems.length === 0 ? -1 : Math.max(i - PAGE_JUMP, 0),
      );
    } else if (e.key === "Enter" && activeIndex >= 0 && allItems[activeIndex]) {
      e.preventDefault();
      handleSelect(allItems[activeIndex]);
    }
  }

  /**
   * Keep keyboard focus inside the dialog while it is open. The result rows
   * are `tabIndex={-1}` (focus stays on the combobox and is tracked with
   * `aria-activedescendant`), so the only tab stops are the search field and
   * the ESC button.
   */
  function handleDialogKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "Tab") return;
    const root = dialogRef.current;
    if (!root) return;

    const target = nextTrapTarget(
      root,
      document.activeElement as HTMLElement | null,
      e.shiftKey ? "backward" : "forward",
    );
    if (target) {
      e.preventDefault();
      target.focus();
    }
  }

  // ── Derived ARIA state ────────────────────────────────────────────────────

  const isExpanded = hasResults;
  const showHint = !query && recentSearches.length === 0;
  const showRecentSearches = !query && recentSearches.length > 0;

  // ── Closed state: render the trigger button ───────────────────────────────

  if (!isOpen) {
    return (
      <button
        ref={triggerRef}
        onClick={open}
        aria-label={translateCopy("ui.open_global_search_489a247")}
        className="flex items-center gap-2 rounded-lg border border-border-default bg-bg-elevated px-2 py-1.5 text-sm text-text-muted hover:border-border-hover hover:text-text-secondary transition-colors sm:px-3"
      >
        <svg
          className="w-4 h-4"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          <circle cx="6.5" cy="6.5" r="4.5" />
          <path d="M10 10l3 3" strokeLinecap="round" />
        </svg>
        <span className="hidden sm:inline">{translateCopy("ui.search_bce0641")}</span>
        <kbd className="ml-1 hidden sm:inline-flex items-center gap-0.5 rounded border border-border-default px-1.5 py-0.5 text-[10px] font-medium text-text-muted">
          <span>⌘</span>
          {translateCopy("ui.k_a7ee38b")}
        </kbd>
      </button>
    );
  }

  // ── Open state: render the dialog ─────────────────────────────────────────

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={translateCopy("ui.global_search_a2b8a16")}
      onKeyDown={handleDialogKeyDown}
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] bg-overlay backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="w-full max-w-xl rounded-2xl border border-border-default bg-bg-card shadow-modal overflow-hidden">
        {/* ── Search input row ───────────────────────────────────────────── */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border-default">
          <svg
            className="w-4 h-4 flex-shrink-0 text-text-muted"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden="true"
          >
            <circle cx="6.5" cy="6.5" r="4.5" />
            <path d="M10 10l3 3" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-label={translateCopy("ui.search_trades_users_and_contract_3948f3a")}
            aria-autocomplete="list"
            aria-haspopup="listbox"
            aria-expanded={isExpanded}
            aria-controls={isExpanded ? RESULTS_LISTBOX_ID : undefined}
            aria-activedescendant={
              activeIndex >= 0 ? `search-result-${activeIndex}` : undefined
            }
            aria-describedby={showHint ? SEARCH_HINT_ID : undefined}
            placeholder={translateCopy("ui.search_trades_users_contracts_204acaf")}
            value={query}
            onChange={(e) => {
              const value = e.target.value;
              setQuery(value);
              if (!value.trim()) {
                setResults(EMPTY_RESULTS);
                setError(null);
              }
            }}
            onKeyDown={handleKeyNavigation}
            className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted outline-none"
          />
          {loading && (
            <svg
              className="w-4 h-4 animate-spin text-text-muted"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
              <path d="M12 2a10 10 0 0 1 10 10" />
            </svg>
          )}
          <button
            onClick={close}
            aria-label={translateCopy("ui.close_search_0906f92")}
            className="rounded px-1.5 py-0.5 text-xs text-text-muted border border-border-default hover:border-border-hover transition-colors"
          >
            {translateCopy("ui.esc_1f7a4f9")}
          </button>
        </div>

        {/* ── Scope filter pills ─────────────────────────────────────────── */}
        <div
          role="group"
          aria-label={translateCopy("ui.filter_by_category_bcd139c")}
          className="flex items-center gap-1.5 px-4 py-2 border-b border-border-default overflow-x-auto"
        >
          {SCOPE_PILLS.map(({ scope: s, labelKey }) => (
            <button
              key={s}
              onClick={() => {
                setScope(s);
                setActiveIndex(-1);
              }}
              aria-pressed={scope === s}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                scope === s
                  ? "bg-brand-primary text-white"
                  : "bg-bg-elevated text-text-secondary hover:bg-bg-muted hover:text-text-primary border border-border-default"
              }`}
            >
              {translateCopy(labelKey)}
            </button>
          ))}
        </div>

        {/* ── Results / recent searches / hints ─────────────────────────── */}
        {isExpanded ? (
          /* Listbox is only rendered when there are results — keeps the ARIA
             contract clean: the listbox only ever contains option elements. */
          <div
            id={RESULTS_LISTBOX_ID}
            className="max-h-[60vh] overflow-y-auto p-2"
            role="listbox"
            aria-label={translateCopy("ui.search_results_0144dae")}
          >
            {(Object.keys(CATEGORY_LABELS) as Array<keyof GroupedResults>).map((category) => {
              if (!visibleCategories.includes(category)) return null;
              const items = results[category];
              if (items.length === 0) return null;

              // Compute offset within the filtered allItems array
              const baseOffset = allItems.findIndex((item) => item.category === category);

              return (
                <div
                  key={category}
                  className="mb-1"
                  role="group"
                  aria-labelledby={`search-group-${category}`}
                >
                  <p
                    id={`search-group-${category}`}
                    className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-text-muted"
                  >
                    {CATEGORY_LABELS[category]}
                  </p>
                  {items.map((item, idx) => {
                    const globalIdx = baseOffset + idx;
                    const isActive = activeIndex === globalIdx;
                    return (
                      <button
                        key={item.id}
                        id={`search-result-${globalIdx}`}
                        role="option"
                        tabIndex={-1}
                        aria-selected={isActive}
                        onClick={() => handleSelect({ ...item, category })}
                        className={`w-full flex items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
                          isActive
                            ? "bg-bg-elevated text-text-primary"
                            : "text-text-secondary hover:bg-bg-elevated hover:text-text-primary"
                        }`}
                      >
                        <span className="flex-1 text-sm font-medium truncate">{item.title}</span>
                        {item.subtitle && (
                          <span className="text-xs text-text-muted truncate max-w-[40%]">
                            {item.subtitle}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="p-2">
            {error && (
              <p className="px-3 py-4 text-center text-sm text-status-danger">{error}</p>
            )}

            {/* No results for this query */}
            {!error && query && !loading && !hasAnyResults && (
              <p role="status" className="px-3 py-4 text-center text-sm text-text-muted">
                {translateCopy("ui.no_results_for_2a5f91d")}
                {query}&rdquo;
              </p>
            )}

            {/* No results for this scope (but other categories have results) */}
            {!error && query && !loading && hasAnyResults && !hasResults && (
              <p role="status" className="px-3 py-4 text-center text-sm text-text-muted">
                {translateCopy("ui.no_results_for_2a5f91d")}
                {query}&rdquo;
              </p>
            )}

            {/* Recent searches */}
            {showRecentSearches && (
              <div>
                <div className="flex items-center justify-between px-3 py-1.5">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-text-muted">
                    {translateCopy("ui.recent_searches_3b1e8a2")}
                  </p>
                  <button
                    onClick={handleClearRecent}
                    className="text-xs text-text-muted hover:text-text-secondary transition-colors"
                  >
                    {translateCopy("ui.clear_recent_searches_a4d7f12")}
                  </button>
                </div>
                <ul role="list">
                  {recentSearches.map((term) => (
                    <li key={term}>
                      <button
                        onClick={() => handleRecentSearchClick(term)}
                        className="w-full flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-text-secondary hover:bg-bg-elevated hover:text-text-primary transition-colors"
                      >
                        <svg
                          className="w-3.5 h-3.5 flex-shrink-0 text-text-muted"
                          viewBox="0 0 16 16"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          aria-hidden="true"
                        >
                          <circle cx="8" cy="8" r="6" />
                          <path d="M8 5v3l2 2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        {term}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Idle hint (no query, no recent searches) */}
            {showHint && (
              <p
                id={SEARCH_HINT_ID}
                className="px-3 py-4 text-center text-sm text-text-muted"
              >
                {translateCopy("ui.type_to_search_trades_users_and__6fdf7a0")}
              </p>
            )}

            {/* Hint element must always exist in the DOM when the hint is
                the active describedby target, so keep it hidden when not
                visible to avoid stale aria-describedby references. */}
            {!showHint && (
              <span id={SEARCH_HINT_ID} className="sr-only" aria-hidden="true" />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
