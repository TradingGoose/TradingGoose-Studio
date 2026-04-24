/**
 * @vitest-environment jsdom
 */

import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOGS_QUERY_POLICY, MONITOR_QUERY_POLICY } from "@/lib/logs/query-policy";
import { SearchSuggestions } from "@/lib/logs/search-suggestions";
import type { QueryPolicy } from "@/lib/logs/query-types";
import { useSearchState } from "./use-search-state";

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

function HookHarness({
  query,
  queryPolicy = LOGS_QUERY_POLICY,
  getSuggestions = () => null,
  onState,
}: {
  query: string;
  queryPolicy?: QueryPolicy;
  getSuggestions?: Parameters<typeof useSearchState>[0]["getSuggestions"];
  onState: (value: ReturnType<typeof useSearchState>) => void;
}) {
  const state = useSearchState({
    queryPolicy,
    getSuggestions,
  });
  const { initializeFromQuery } = state;

  useEffect(() => {
    initializeFromQuery(query);
  }, [initializeFromQuery, query]);

  useEffect(() => {
    onState(state);
  }, [onState, state]);
  return null;
}

describe("useSearchState", () => {
  let container: HTMLDivElement;
  let root: Root;
  let snapshot: ReturnType<typeof useSearchState> | null;

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    snapshot = null;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("initializes committed state from a serialized query", async () => {
    await act(async () => {
      root.render(
        createElement(HookHarness, {
          query: "workflow:#wf-1 error text",
          onState: (value) => {
            snapshot = value;
          },
        }),
      );
    });

    expect(snapshot?.committedQuery).toBe("workflow:#wf-1 error text");
    expect(snapshot?.invalidQualifierFragments).toEqual([]);
  });

  it("tracks invalid qualifier fragments separately from valid clauses", async () => {
    await act(async () => {
      root.render(
        createElement(HookHarness, {
          query: "workflow:#wf-1 invalid:thing text",
          onState: (value) => {
            snapshot = value;
          },
        }),
      );
    });

    expect(snapshot?.committedQuery).toBe("workflow:#wf-1 text");
    expect(snapshot?.invalidQualifierFragments).toEqual(["invalid:thing"]);
  });

  it("keeps pending input out of the committed query until an explicit commit", async () => {
    await act(async () => {
      root.render(
        createElement(HookHarness, {
          query: "",
          onState: (value) => {
            snapshot = value;
          },
        }),
      );
    });

    await act(async () => {
      snapshot?.handleInputChange("provider:#alpaca");
    });

    expect(snapshot?.committedQuery).toBe("");

    await act(async () => {
      snapshot?.commitCurrentInput();
    });

    expect(snapshot?.committedQuery).toBe("provider:#alpaca");
  });

  it("commits pending input when the search field blurs", async () => {
    vi.useFakeTimers();

    await act(async () => {
      root.render(
        createElement(HookHarness, {
          query: "",
          onState: (value) => {
            snapshot = value;
          },
        }),
      );
    });

    await act(async () => {
      snapshot?.handleInputChange("provider:#alpaca");
    });

    await act(async () => {
      snapshot?.handleBlur();
      vi.advanceTimersByTime(150);
    });

    expect(snapshot?.committedQuery).toBe("provider:#alpaca");
    vi.useRealTimers();
  });

  it("commits show-all suggestions as text search", async () => {
    await act(async () => {
      root.render(
        createElement(HookHarness, {
          query: "",
          onState: (value) => {
            snapshot = value;
          },
        }),
      );
    });

    await act(async () => {
      snapshot?.handleSuggestionSelect({
        id: "show-all:alpha",
        value: "alpha",
        label: 'Search for "alpha"',
        category: "show-all",
      });
    });

    expect(snapshot?.committedQuery).toBe("alpha");
  });

  it("rebuilds the committed query through serialized clauses when badges are removed", async () => {
    await act(async () => {
      root.render(
        createElement(HookHarness, {
          query: "workflow:#wf-1",
          onState: (value) => {
            snapshot = value;
          },
        }),
      );
    });

    await act(async () => {
      snapshot?.handleSuggestionSelect({
        id: "provider:alpaca",
        value: "provider:#alpaca",
        label: "alpaca",
        category: "provider",
      });
    });

    expect(snapshot?.committedQuery).toBe("workflow:#wf-1 provider:#alpaca");

    const workflowBadgeIndex =
      snapshot?.clauses.findIndex(
        (clause) => clause.raw === "workflow:#wf-1",
      ) ?? -1;

    await act(async () => {
      snapshot?.removeBadge(workflowBadgeIndex);
    });

    expect(snapshot?.committedQuery).toBe("provider:#alpaca");
  });

  it("preserves mixed text and clause ordering through initialization and edits", async () => {
    await act(async () => {
      root.render(
        createElement(HookHarness, {
          query: "alpha workflow:#wf-1 beta",
          onState: (value) => {
            snapshot = value;
          },
        }),
      );
    });

    expect(snapshot?.committedQuery).toBe("alpha workflow:#wf-1 beta");

    await act(async () => {
      snapshot?.handleSuggestionSelect({
        id: "provider:alpaca",
        value: "provider:#alpaca",
        label: "alpaca",
        category: "provider",
      });
    });

    expect(snapshot?.committedQuery).toBe(
      "alpha workflow:#wf-1 beta provider:#alpaca",
    );

    const workflowBadgeIndex =
      snapshot?.clauses.findIndex(
        (clause) => clause.raw === "workflow:#wf-1",
      ) ?? -1;

    await act(async () => {
      snapshot?.removeBadge(workflowBadgeIndex);
    });

    expect(snapshot?.committedQuery).toBe("alpha beta provider:#alpaca");
  });

  it("removes only the targeted duplicate clause badge", async () => {
    await act(async () => {
      root.render(
        createElement(HookHarness, {
          query: "provider:#alpaca provider:#alpaca workflow:#wf-1",
          onState: (value) => {
            snapshot = value;
          },
        }),
      );
    });

    expect(snapshot?.clauses.map((clause) => clause.raw)).toEqual([
      "provider:#alpaca",
      "provider:#alpaca",
      "workflow:#wf-1",
    ]);

    await act(async () => {
      snapshot?.removeBadge(0);
    });

    expect(snapshot?.clauses.map((clause) => clause.raw)).toEqual([
      "provider:#alpaca",
      "workflow:#wf-1",
    ]);
    expect(snapshot?.committedQuery).toBe("provider:#alpaca workflow:#wf-1");
  });

  it("commits negated field suggestions with the negation prefix intact", async () => {
    vi.useFakeTimers();
    const engine = new SearchSuggestions({ policy: MONITOR_QUERY_POLICY });

    await act(async () => {
      root.render(
        createElement(HookHarness, {
          query: "",
          queryPolicy: MONITOR_QUERY_POLICY,
          getSuggestions: engine.getSuggestions.bind(engine),
          onState: (value) => {
            snapshot = value;
          },
        }),
      );
    });

    await act(async () => {
      snapshot?.handleInputChange("-status:");
      vi.advanceTimersByTime(100);
    });

    const negatedStatusSuggestion = snapshot?.suggestions[0]?.value;
    expect(negatedStatusSuggestion?.startsWith("-status:")).toBe(true);

    await act(async () => {
      snapshot?.handleSuggestionSelect(snapshot?.suggestions[0]!);
    });

    expect(snapshot?.committedQuery).toBe(negatedStatusSuggestion);
    vi.useRealTimers();
  });

  it("keeps partial presence suggestions available through the interactive state flow", async () => {
    vi.useFakeTimers();
    const engine = new SearchSuggestions({ policy: MONITOR_QUERY_POLICY });

    await act(async () => {
      root.render(
        createElement(HookHarness, {
          query: "",
          queryPolicy: MONITOR_QUERY_POLICY,
          getSuggestions: engine.getSuggestions.bind(engine),
          onState: (value) => {
            snapshot = value;
          },
        }),
      );
    });

    await act(async () => {
      snapshot?.handleInputChange("has:mo");
      vi.advanceTimersByTime(100);
    });

    expect(snapshot?.suggestions.map((suggestion) => suggestion.value)).toEqual([
      "has:monitor",
    ]);

    await act(async () => {
      snapshot?.handleSuggestionSelect(snapshot?.suggestions[0]!);
    });

    expect(snapshot?.committedQuery).toBe("has:monitor");
    vi.useRealTimers();
  });
});
