/**
 * Tests for GlobalSearch component (#773, #51)
 *
 * Covers: keyboard trigger, search input, results display,
 *         empty results, navigation on select, error state,
 *         the ARIA combobox contract, focus management
 *         (focus into the dialog, Tab containment, focus return),
 *         recent searches persistence, and scope filter pills.
 */

import { render, screen, waitFor, act, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GlobalSearch } from "@/components/GlobalSearch";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useRouter } from "next/navigation";

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock("next/navigation", () => ({
  useRouter: jest.fn(),
}));

jest.mock("@/hooks/useAuth", () => ({
  useAuth: jest.fn(),
}));

jest.mock("@/lib/api", () => ({
  api: {
    search: {
      query: jest.fn(),
    },
  },
}));

const mockPush = jest.fn();
const mockUseRouter = useRouter as jest.MockedFunction<typeof useRouter>;
const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockSearch = api.search.query as jest.MockedFunction<typeof api.search.query>;

const MOCK_AUTH = {
  token: "test-token",
  address: null,
  shortAddress: null,
  isAuthenticated: true,
  isWalletConnected: true,
  isWalletDetected: true,
  isLoading: false,
  error: null,
  connectWallet: jest.fn(),
  authenticate: jest.fn(),
  logout: jest.fn(),
  refreshAuth: jest.fn(),
};

const MOCK_RESULTS = {
  trades: [
    { id: "t1", title: "Trade #001", subtitle: "FUNDED" },
    { id: "t2", title: "Trade #002", subtitle: "PENDING" },
  ],
  users: [{ id: "u1", title: "Alice Seller" }],
  contracts: [{ id: "c1", title: "Contract AMN-99" }],
};

/** localStorage key used by the component under test. */
const RECENT_KEY = "eziagric:recentSearches";

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  mockUseRouter.mockReturnValue({ push: mockPush } as unknown as ReturnType<typeof useRouter>);
  mockUseAuth.mockReturnValue(MOCK_AUTH);
  mockSearch.mockResolvedValue(MOCK_RESULTS);
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Opens search by firing keydown directly on document (no timer dependency). */
function pressMetaK() {
  fireEvent.keyDown(document, { key: "k", metaKey: true });
}

function pressCtrlK() {
  fireEvent.keyDown(document, { key: "k", ctrlKey: true });
}

function pressEscape() {
  fireEvent.keyDown(document, { key: "Escape" });
}

/**
 * Types a query into the search field and waits out the 300ms debounce under
 * real timers, so the test never has to reason about fake-timer flushing.
 */
async function typeQuery(query: string) {
  const user = userEvent.setup();
  await user.type(screen.getByRole("combobox"), query);
  await waitFor(() => expect(mockSearch).toHaveBeenCalled());
}

// ── Keyboard trigger ──────────────────────────────────────────────────────────

describe("GlobalSearch — keyboard trigger", () => {
  it("renders a closed trigger button by default", () => {
    render(<GlobalSearch />);
    expect(screen.getByRole("button", { name: /open global search/i })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens the modal on Cmd+K", () => {
    render(<GlobalSearch />);
    pressMetaK();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("opens the modal on Ctrl+K", () => {
    render(<GlobalSearch />);
    pressCtrlK();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("closes on Escape", () => {
    render(<GlobalSearch />);
    pressMetaK();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    pressEscape();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes when clicking the Esc button", async () => {
    render(<GlobalSearch />);
    pressMetaK();
    await userEvent.click(screen.getByRole("button", { name: /close search/i }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("toggles closed on second Cmd+K", () => {
    render(<GlobalSearch />);
    pressMetaK();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    pressMetaK();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("restores focus to the trigger after closing", async () => {
    const user = userEvent.setup();
    render(<GlobalSearch />);
    await user.click(screen.getByRole("button", { name: /open global search/i }));
    pressEscape();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /open global search/i })).toHaveFocus(),
    );
  });
});

// ── Search input ──────────────────────────────────────────────────────────────

describe("GlobalSearch — search input", () => {
  it("shows the search input when open", () => {
    render(<GlobalSearch />);
    pressMetaK();
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  it("shows idle hint text before typing", () => {
    render(<GlobalSearch />);
    pressMetaK();
    expect(screen.getByText(/type to search/i)).toBeInTheDocument();
  });

  it("debounces and calls the search API after 300ms", async () => {
    jest.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

    render(<GlobalSearch />);
    pressMetaK();

    await user.type(screen.getByRole("combobox"), "maize");
    expect(mockSearch).not.toHaveBeenCalled();

    act(() => jest.advanceTimersByTime(300));
    await waitFor(() => expect(mockSearch).toHaveBeenCalledWith("test-token", "maize"));

    jest.useRealTimers();
  });

  it("does not call the API for an empty query", async () => {
    jest.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

    render(<GlobalSearch />);
    pressMetaK();

    await user.type(screen.getByRole("combobox"), "m");
    await user.clear(screen.getByRole("combobox"));
    act(() => jest.advanceTimersByTime(300));
    expect(mockSearch).not.toHaveBeenCalled();

    jest.useRealTimers();
  });
});

// ── Combobox ARIA contract ────────────────────────────────────────────────────

describe("GlobalSearch — combobox semantics", () => {
  it("declares the combobox popup contract on the search field", () => {
    render(<GlobalSearch />);
    pressMetaK();

    const combobox = screen.getByRole("combobox");
    expect(combobox).toHaveAttribute("aria-autocomplete", "list");
    expect(combobox).toHaveAttribute("aria-haspopup", "listbox");
  });

  it("collapses the popup and describes the field by the hint while empty", () => {
    render(<GlobalSearch />);
    pressMetaK();

    const combobox = screen.getByRole("combobox");
    expect(combobox).toHaveAttribute("aria-expanded", "false");
    expect(combobox).not.toHaveAttribute("aria-controls");
    expect(combobox).toHaveAttribute("aria-describedby", "global-search-hint");
    expect(document.getElementById("global-search-hint")).not.toBeNull();
  });

  it("keeps status copy outside the listbox so it only ever contains options", () => {
    render(<GlobalSearch />);
    pressMetaK();

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByText(/type to search/i)).toBeInTheDocument();
  });

  it("links the active option to the combobox accessibly", async () => {
    render(<GlobalSearch />);
    pressMetaK();
    await typeQuery("trade");
    await waitFor(() => expect(screen.getByText("Trade #001")).toBeInTheDocument());

    const combobox = screen.getByRole("combobox");
    expect(combobox).toHaveAttribute("aria-expanded", "true");
    expect(combobox).toHaveAttribute("aria-controls", "global-search-results");
    expect(screen.getByRole("listbox", { name: /search results/i })).toHaveAttribute(
      "id",
      "global-search-results",
    );
    fireEvent.keyDown(combobox, { key: "ArrowDown" });
    expect(combobox).toHaveAttribute("aria-activedescendant", "search-result-0");
  });

  it("exposes result rows as non-tabbable options tracked by aria-activedescendant", async () => {
    render(<GlobalSearch />);
    pressMetaK();
    await typeQuery("trade");
    await waitFor(() => expect(screen.getByText("Trade #001")).toBeInTheDocument());

    const options = screen.getAllByRole("option") as HTMLElement[];
    expect(options).toHaveLength(4);
    options.forEach((option: HTMLElement) => {
      expect(option).toHaveAttribute("tabindex", "-1");
    });
  });

  it("jumps through the results with Home, End and PageDown", async () => {
    render(<GlobalSearch />);
    pressMetaK();
    await typeQuery("trade");
    await waitFor(() => expect(screen.getByText("Trade #001")).toBeInTheDocument());

    const combobox = screen.getByRole("combobox");

    fireEvent.keyDown(combobox, { key: "End" });
    expect(combobox).toHaveAttribute("aria-activedescendant", "search-result-3");

    fireEvent.keyDown(combobox, { key: "Home" });
    expect(combobox).toHaveAttribute("aria-activedescendant", "search-result-0");

    fireEvent.keyDown(combobox, { key: "PageDown" });
    expect(combobox).toHaveAttribute("aria-activedescendant", "search-result-3");
  });

  it("reports the empty-result message through a status region", async () => {
    mockSearch.mockResolvedValue({ trades: [], users: [], contracts: [] });
    render(<GlobalSearch />);
    pressMetaK();
    await typeQuery("xyznotfound");

    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});

// ── Focus management ──────────────────────────────────────────────────────────

describe("GlobalSearch — focus management", () => {
  it("moves focus into the search field when opened", async () => {
    render(<GlobalSearch />);
    pressMetaK();

    await waitFor(() => expect(screen.getByRole("combobox")).toHaveFocus());
  });

  it("keeps Tab cycling through the dialog controls", async () => {
    const user = userEvent.setup();
    render(<GlobalSearch />);
    pressMetaK();

    const combobox = screen.getByRole("combobox");
    const closeButton = screen.getByRole("button", { name: /close search/i });
    const allFilter = screen.getByRole("button", { name: /^all$/i });
    const tradesFilter = screen.getByRole("button", { name: /^trades$/i });
    await waitFor(() => expect(combobox).toHaveFocus());

    await user.tab();
    expect(closeButton).toHaveFocus();

    await user.tab();
    expect(allFilter).toHaveFocus();

    await user.tab();
    expect(tradesFilter).toHaveFocus();

    await user.tab({ shift: true });
    expect(allFilter).toHaveFocus();
  });

  it("closes on backdrop click and restores focus to the trigger", async () => {
    const user = userEvent.setup();
    render(<GlobalSearch />);
    await user.click(screen.getByRole("button", { name: /open global search/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("dialog"));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /open global search/i })).toHaveFocus(),
    );
  });
});

// ── Results display ───────────────────────────────────────────────────────────

describe("GlobalSearch — results display", () => {
  it("renders grouped results after a successful search", async () => {
    render(<GlobalSearch />);
    pressMetaK();
    await typeQuery("trade");
    await waitFor(() => expect(screen.getByText("Trade #001")).toBeInTheDocument());

    const results = within(screen.getByRole("listbox"));
    expect(results.getByText("Trades")).toBeInTheDocument();
    expect(results.getByText("Users")).toBeInTheDocument();
    expect(results.getByText("Contracts")).toBeInTheDocument();
    expect(screen.getByText("Alice Seller")).toBeInTheDocument();
    expect(screen.getByText("Contract AMN-99")).toBeInTheDocument();
  });

  it("shows subtitle text when provided", async () => {
    render(<GlobalSearch />);
    pressMetaK();
    await typeQuery("trade");
    await waitFor(() => expect(screen.getByText("FUNDED")).toBeInTheDocument());
  });
});

// ── Empty results ─────────────────────────────────────────────────────────────

describe("GlobalSearch — empty results", () => {
  it("shows a no-results message when API returns empty arrays", async () => {
    jest.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    mockSearch.mockResolvedValue({ trades: [], users: [], contracts: [] });

    render(<GlobalSearch />);
    pressMetaK();
    await user.type(screen.getByRole("combobox"), "xyznotfound");
    act(() => jest.advanceTimersByTime(300));

    await waitFor(() => expect(screen.getByText(/no results for/i)).toBeInTheDocument());

    jest.useRealTimers();
  });
});

// ── Error state ───────────────────────────────────────────────────────────────

describe("GlobalSearch — error state", () => {
  it("shows an error message when the search API fails", async () => {
    jest.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    mockSearch.mockRejectedValue(new Error("Network error"));

    render(<GlobalSearch />);
    pressMetaK();
    await user.type(screen.getByRole("combobox"), "trade");
    act(() => jest.advanceTimersByTime(300));

    await waitFor(() => expect(screen.getByText(/search failed/i)).toBeInTheDocument());

    jest.useRealTimers();
  });
});

// ── Navigation on select ──────────────────────────────────────────────────────

describe("GlobalSearch — navigation on select", () => {
  it("navigates to the trade detail page when a trade result is clicked", async () => {
    render(<GlobalSearch />);
    pressMetaK();
    await typeQuery("trade");
    await waitFor(() => screen.getByText("Trade #001"));

    await userEvent.click(screen.getByText("Trade #001"));

    expect(mockPush).toHaveBeenCalledWith("/trades/t1");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("navigates via keyboard ArrowDown + Enter", async () => {
    render(<GlobalSearch />);
    pressMetaK();
    await typeQuery("trade");
    await waitFor(() => screen.getByText("Trade #001"));

    // First ArrowDown selects index 0 (Trade #001)
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });

    expect(mockPush).toHaveBeenCalledWith("/trades/t1");
  });

  it("navigates user results to their reputation page", async () => {
    render(<GlobalSearch />);
    pressMetaK();
    await typeQuery("alice");
    await waitFor(() => expect(screen.getByText("Alice Seller")).toBeInTheDocument());

    await userEvent.click(screen.getByText("Alice Seller"));
    expect(mockPush).toHaveBeenCalledWith("/reputation/u1");
  });

  it("navigates contract results to the stream detail route", async () => {
    render(<GlobalSearch />);
    pressMetaK();
    await typeQuery("contract");
    await waitFor(() => expect(screen.getByText("Contract AMN-99")).toBeInTheDocument());

    await userEvent.click(screen.getByText("Contract AMN-99"));
    expect(mockPush).toHaveBeenCalledWith("/streams/c1");
  });
});

// ── Recent searches ───────────────────────────────────────────────────────────

describe("GlobalSearch — recent searches", () => {
  it("shows the idle hint when there are no recent searches", () => {
    render(<GlobalSearch />);
    pressMetaK();

    expect(screen.getByText(/type to search/i)).toBeInTheDocument();
    expect(screen.queryByText(/recent searches/i)).not.toBeInTheDocument();
  });

  it("displays up to 5 stored recent searches when opened with an empty input", () => {
    localStorage.setItem(
      RECENT_KEY,
      JSON.stringify(["maize", "trade #001", "wheat", "contract AMN", "soybeans"]),
    );

    render(<GlobalSearch />);
    pressMetaK();

    expect(screen.getByText(/recent searches/i)).toBeInTheDocument();
    expect(screen.getByText("maize")).toBeInTheDocument();
    expect(screen.getByText("trade #001")).toBeInTheDocument();
    expect(screen.getByText("wheat")).toBeInTheDocument();
    expect(screen.getByText("contract AMN")).toBeInTheDocument();
    expect(screen.getByText("soybeans")).toBeInTheDocument();
    // Idle hint should NOT be shown when there are recent searches
    expect(screen.queryByText(/type to search/i)).not.toBeInTheDocument();
  });

  it("does not display more than 5 recent searches", () => {
    localStorage.setItem(
      RECENT_KEY,
      JSON.stringify(["one", "two", "three", "four", "five", "six"]),
    );

    render(<GlobalSearch />);
    pressMetaK();

    const recentItems = screen
      .getAllByRole("listitem")
      .filter((el) => el.closest('[role="list"]'));
    // The list should have at most 5 items
    expect(recentItems.length).toBeLessThanOrEqual(5);
    expect(screen.queryByText("six")).not.toBeInTheDocument();
  });

  it("persists a successful search query to localStorage", async () => {
    jest.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

    render(<GlobalSearch />);
    pressMetaK();
    await user.type(screen.getByRole("combobox"), "maize");
    act(() => jest.advanceTimersByTime(300));

    await waitFor(() => expect(mockSearch).toHaveBeenCalled());

    const stored = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as string[];
    expect(stored).toContain("maize");

    jest.useRealTimers();
  });

  it("prepends the newest query and deduplicates", async () => {
    localStorage.setItem(RECENT_KEY, JSON.stringify(["maize"]));

    jest.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

    render(<GlobalSearch />);
    pressMetaK();
    // Type the same term again
    await user.type(screen.getByRole("combobox"), "maize");
    act(() => jest.advanceTimersByTime(300));

    await waitFor(() => expect(mockSearch).toHaveBeenCalled());

    const stored = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as string[];
    // Should only appear once, at the front
    expect(stored.filter((q) => q === "maize")).toHaveLength(1);
    expect(stored[0]).toBe("maize");

    jest.useRealTimers();
  });

  it("clicking a recent search populates the input field", async () => {
    localStorage.setItem(RECENT_KEY, JSON.stringify(["wheat trade"]));
    const user = userEvent.setup();

    render(<GlobalSearch />);
    pressMetaK();

    await user.click(screen.getByText("wheat trade"));

    expect(screen.getByRole("combobox")).toHaveValue("wheat trade");
  });

  it("clears all recent searches when the Clear recent button is clicked", async () => {
    localStorage.setItem(RECENT_KEY, JSON.stringify(["maize", "wheat"]));
    const user = userEvent.setup();

    render(<GlobalSearch />);
    pressMetaK();

    expect(screen.getByText("maize")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /clear recent/i }));

    expect(screen.queryByText("maize")).not.toBeInTheDocument();
    expect(screen.queryByText("wheat")).not.toBeInTheDocument();
    // Should fall back to the idle hint
    expect(screen.getByText(/type to search/i)).toBeInTheDocument();
    expect(localStorage.getItem(RECENT_KEY)).toBeNull();
  });

  it("hides recent searches once the user starts typing", async () => {
    localStorage.setItem(RECENT_KEY, JSON.stringify(["maize"]));
    const user = userEvent.setup();

    render(<GlobalSearch />);
    pressMetaK();

    expect(screen.getByText("maize")).toBeInTheDocument();

    await user.type(screen.getByRole("combobox"), "w");

    expect(screen.queryByText(/recent searches/i)).not.toBeInTheDocument();
  });

  it("re-shows recent searches after clearing the input", async () => {
    localStorage.setItem(RECENT_KEY, JSON.stringify(["maize"]));
    const user = userEvent.setup();

    render(<GlobalSearch />);
    pressMetaK();

    await user.type(screen.getByRole("combobox"), "w");
    expect(screen.queryByText(/recent searches/i)).not.toBeInTheDocument();

    await user.clear(screen.getByRole("combobox"));

    await waitFor(() =>
      expect(screen.getByText(/recent searches/i)).toBeInTheDocument(),
    );
  });
});

// ── Scope filter pills ────────────────────────────────────────────────────────

describe("GlobalSearch — scope filter pills", () => {
  it("renders all four scope filter pills when open", () => {
    render(<GlobalSearch />);
    pressMetaK();

    expect(screen.getByRole("button", { name: /^all$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^trades$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^streams$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^disputes$/i })).toBeInTheDocument();
  });

  it("defaults to the All pill being pressed", () => {
    render(<GlobalSearch />);
    pressMetaK();

    expect(screen.getByRole("button", { name: /^all$/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: /^trades$/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("switches the pressed state when a pill is clicked", async () => {
    const user = userEvent.setup();
    render(<GlobalSearch />);
    pressMetaK();

    await user.click(screen.getByRole("button", { name: /^trades$/i }));

    expect(screen.getByRole("button", { name: /^trades$/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: /^all$/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("Trades scope shows only trade results", async () => {
    const user = userEvent.setup();
    render(<GlobalSearch />);
    pressMetaK();

    await user.click(screen.getByRole("button", { name: /^trades$/i }));
    await typeQuery("trade");

    await waitFor(() => expect(screen.getByText("Trade #001")).toBeInTheDocument());
    expect(screen.queryByText("Alice Seller")).not.toBeInTheDocument();
    expect(screen.queryByText("Contract AMN-99")).not.toBeInTheDocument();
  });

  it("Streams scope shows only contract results", async () => {
    const user = userEvent.setup();
    render(<GlobalSearch />);
    pressMetaK();

    await user.click(screen.getByRole("button", { name: /^streams$/i }));
    await typeQuery("contract");

    await waitFor(() => expect(screen.getByText("Contract AMN-99")).toBeInTheDocument());
    expect(screen.queryByText("Trade #001")).not.toBeInTheDocument();
    expect(screen.queryByText("Alice Seller")).not.toBeInTheDocument();
  });

  it("Disputes scope shows a no-results status (no disputes category in API yet)", async () => {
    const user = userEvent.setup();
    render(<GlobalSearch />);
    pressMetaK();

    await user.click(screen.getByRole("button", { name: /^disputes$/i }));
    await typeQuery("dispute");

    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("All scope shows results from all categories", async () => {
    const user = userEvent.setup();
    render(<GlobalSearch />);
    pressMetaK();

    // Start on Trades, then switch back to All
    await user.click(screen.getByRole("button", { name: /^trades$/i }));
    await user.click(screen.getByRole("button", { name: /^all$/i }));
    await typeQuery("trade");

    await waitFor(() => expect(screen.getByText("Trade #001")).toBeInTheDocument());
    expect(screen.getByText("Alice Seller")).toBeInTheDocument();
    expect(screen.getByText("Contract AMN-99")).toBeInTheDocument();
  });

  it("resets scope to All when the dialog is reopened", async () => {
    const user = userEvent.setup();
    render(<GlobalSearch />);
    pressMetaK();

    await user.click(screen.getByRole("button", { name: /^trades$/i }));
    expect(screen.getByRole("button", { name: /^trades$/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // Close and reopen
    pressEscape();
    pressMetaK();

    expect(screen.getByRole("button", { name: /^all$/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: /^trades$/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});
