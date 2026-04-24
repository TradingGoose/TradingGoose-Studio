"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { QueryPolicy, SearchClause } from "@/lib/logs/query-types";
import { serializeQuery } from "@/lib/logs/query-parser";
import {
  type FolderData,
  type MonitorRowSuggestionData,
  SearchSuggestions,
  type WorkflowData,
} from "@/lib/logs/search-suggestions";
import { cn } from "@/lib/utils";
import { useSearchState } from "@/app/workspace/[workspaceId]/logs/hooks/use-search-state";

interface AutocompleteSearchProps {
  value: string;
  onChange: (value: string) => void;
  queryPolicy: QueryPolicy;
  placeholder?: string;
  workflowsData?: WorkflowData[];
  foldersData?: FolderData[];
  availableMonitorRows?: MonitorRowSuggestionData[];
  className?: string;
  onOpenChange?: (open: boolean) => void;
  showActiveFilters?: boolean;
  showTextSearchIndicator?: boolean;
  externalClauses?: SearchClause[];
  onRemoveExternalClause?: (clause: SearchClause) => void;
}

export function AutocompleteSearch({
  value,
  onChange,
  queryPolicy,
  placeholder = "Search logs...",
  workflowsData = [],
  foldersData = [],
  availableMonitorRows = [],
  className,
  onOpenChange,
  showActiveFilters = true,
  showTextSearchIndicator = true,
  externalClauses = [],
  onRemoveExternalClause,
}: AutocompleteSearchProps) {
  const suggestionEngine = useMemo(
    () =>
      new SearchSuggestions({
        policy: queryPolicy,
        workflowsData,
        foldersData,
        monitorRows: availableMonitorRows,
      }),
    [availableMonitorRows, foldersData, queryPolicy, workflowsData],
  );

  const {
    clauses,
    currentInput,
    textSearch,
    invalidQualifierFragments,
    committedQuery,
    isOpen,
    suggestions,
    sections,
    highlightedIndex,
    highlightedBadgeIndex,
    inputRef,
    dropdownRef,
    handleInputChange,
    handleSuggestionSelect,
    handleKeyDown,
    handleFocus,
    handleBlur,
    removeBadge,
    clearAll,
    initializeFromQuery,
    setHighlightedIndex,
  } = useSearchState({
    queryPolicy,
    getSuggestions: (input) => suggestionEngine.getSuggestions(input),
  });

  const lastPropValueRef = useRef(value);
  const pendingCommittedQueryRef = useRef<string | null>(null);
  const pendingHydrationValueRef = useRef<string | null>(null);
  const hasHydratedRef = useRef(false);

  useEffect(() => {
    if (pendingHydrationValueRef.current !== null) {
      if (committedQuery !== pendingHydrationValueRef.current) {
        return;
      }

      pendingHydrationValueRef.current = null;
      hasHydratedRef.current = true;
      return;
    }

    if (!hasHydratedRef.current) {
      return;
    }

    if (committedQuery === lastPropValueRef.current) {
      return;
    }

    pendingCommittedQueryRef.current = committedQuery;
    onChange(committedQuery);
  }, [committedQuery, onChange]);

  useEffect(() => {
    if (
      pendingCommittedQueryRef.current !== null &&
      value === pendingCommittedQueryRef.current
    ) {
      lastPropValueRef.current = value;
      pendingCommittedQueryRef.current = null;
      return;
    }

    if (hasHydratedRef.current && value === lastPropValueRef.current) {
      return;
    }

    lastPropValueRef.current = value;
    pendingHydrationValueRef.current = value;
    initializeFromQuery(value);
  }, [initializeFromQuery, value]);

  useEffect(() => {
    onOpenChange?.(isOpen);
  }, [isOpen, onOpenChange]);

  useEffect(() => {
    if (!isOpen || highlightedIndex < 0) return;
    const container = dropdownRef.current;
    const optionElement = container?.querySelector<HTMLElement>(
      `[data-index="${highlightedIndex}"]`,
    );
    if (optionElement) {
      try {
        optionElement.scrollIntoView({ block: "nearest", behavior: "smooth" });
      } catch {
        optionElement.scrollIntoView({ block: "nearest" });
      }
    }
  }, [dropdownRef, highlightedIndex, isOpen]);

  const inputContainerRef = useRef<HTMLDivElement>(null);
  const [dropdownWidth, setDropdownWidth] = useState(500);

  useEffect(() => {
    const measure = () => {
      if (inputContainerRef.current) {
        setDropdownWidth(inputContainerRef.current.offsetWidth);
      }
    };

    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const hasClauses = clauses.length + externalClauses.length > 0;
  const hasTextSearch = textSearch.length > 0;
  const suggestionType =
    sections.length > 0
      ? "multi-section"
      : suggestions.length > 0
        ? suggestions[0]?.category
        : null;

  const handleTextSearchClear = useCallback(() => {
    initializeFromQuery(
      serializeQuery(
        {
          clauses,
          textSearch: "",
        },
        queryPolicy,
      ),
    );
  }, [clauses, initializeFromQuery, queryPolicy]);

  return (
    <div className={cn("relative", className)}>
      <Popover
        open={isOpen}
        onOpenChange={(open) => {
          if (!open) {
            setHighlightedIndex(-1);
          }
        }}
      >
        <PopoverTrigger asChild>
          <div
            ref={inputContainerRef}
            className="relative flex h-9 w-full items-center rounded-md border border-border bg-card/60 px-2 text-sm transition-colors focus-within:border-ring focus-within:ring-1 focus-within:ring-ring"
          >
            <Search
              className="mr-2 h-4 w-4 flex-shrink-0 text-muted-foreground"
              strokeWidth={2}
            />
            <div className="flex flex-1 items-center gap-1.5 overflow-x-auto text-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {showActiveFilters &&
                externalClauses.map((clause) => (
                  <Button
                    key={`external:${clause.id}`}
                    variant="outline"
                    size="sm"
                    className="h-6 flex-shrink-0 gap-1 rounded-sm px-2 text-[11px]"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      onRemoveExternalClause?.(clause);
                    }}
                  >
                    <span className="text-foreground">{clause.raw}</span>
                    <X className="h-3 w-3" />
                  </Button>
                ))}

              {showActiveFilters &&
                clauses.map((clause, index) => (
                  <Button
                    key={`clause:${index}:${clause.id}`}
                    variant="outline"
                    size="sm"
                    className={cn(
                      "h-6 flex-shrink-0 gap-1 rounded-sm px-2 text-[11px]",
                      highlightedBadgeIndex === index &&
                        "border-ring text-foreground",
                    )}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      removeBadge(index);
                    }}
                  >
                    <span className="text-foreground">{clause.raw}</span>
                    <X className="h-3 w-3" />
                  </Button>
                ))}

              {showTextSearchIndicator && hasTextSearch && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 flex-shrink-0 gap-1 rounded-sm px-2 text-[11px]"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    handleTextSearchClear();
                  }}
                >
                  <span className="text-muted-foreground">text:</span>
                  <span className="text-foreground">{textSearch}</span>
                  <X className="h-3 w-3" />
                </Button>
              )}

              <input
                ref={inputRef}
                value={currentInput}
                onChange={(event) => handleInputChange(event.target.value)}
                onKeyDown={handleKeyDown}
                onFocus={handleFocus}
                onBlur={handleBlur}
                placeholder={!hasClauses && !hasTextSearch ? placeholder : ""}
                className="h-full min-w-[120px] flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck="false"
              />
            </div>

            {(hasClauses || hasTextSearch || currentInput) && (
              <Button
                variant="ghost"
                size="icon"
                className="ml-1 h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
                onMouseDown={(event) => {
                  event.preventDefault();
                  clearAll();
                }}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </PopoverTrigger>

        <PopoverContent
          align="start"
          className="p-1"
          style={{ width: dropdownWidth }}
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <div ref={dropdownRef} className="max-h-[300px] overflow-y-auto">
            {sections.length > 0 ? (
              <div className="space-y-2">
                {sections.map((section) => (
                  <div key={section.title} className="space-y-1">
                    <div className="px-2 pt-1 font-medium text-[11px] uppercase tracking-wide text-muted-foreground">
                      {section.title}
                    </div>
                    <div className="space-y-0.5">
                      {section.suggestions.map((suggestion) => {
                        const index = suggestions.findIndex(
                          (entry) => entry.id === suggestion.id,
                        );
                        return (
                          <button
                            key={suggestion.id}
                            type="button"
                            data-index={index}
                            className={cn(
                              "flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent",
                              index === highlightedIndex && "bg-accent",
                            )}
                            onMouseDown={(event) => {
                              event.preventDefault();
                              handleSuggestionSelect(suggestion);
                            }}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-medium">
                                {suggestion.label}
                              </div>
                              {suggestion.description ? (
                                <div className="truncate text-muted-foreground text-xs">
                                  {suggestion.description}
                                </div>
                              ) : null}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
                <div className="space-y-0.5">
                  {suggestions
                    .filter((suggestion) => suggestion.category === "show-all")
                    .map((suggestion) => {
                      const index = suggestions.findIndex(
                        (entry) => entry.id === suggestion.id,
                      );
                      return (
                        <button
                          key={suggestion.id}
                          type="button"
                          data-index={index}
                          className={cn(
                            "flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent",
                            index === highlightedIndex && "bg-accent",
                          )}
                          onMouseDown={(event) => {
                            event.preventDefault();
                            handleSuggestionSelect(suggestion);
                          }}
                        >
                          <div className="min-w-0 flex-1 truncate font-medium">
                            {suggestion.label}
                          </div>
                        </button>
                      );
                    })}
                </div>
              </div>
            ) : (
              <div className="space-y-0.5">
                {suggestions.map((suggestion, index) => (
                  <button
                    key={suggestion.id}
                    type="button"
                    data-index={index}
                    className={cn(
                      "flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent",
                      index === highlightedIndex && "bg-accent",
                    )}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      handleSuggestionSelect(suggestion);
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">
                        {suggestion.label}
                      </div>
                      {suggestion.description ? (
                        <div className="truncate text-muted-foreground text-xs">
                          {suggestion.description}
                        </div>
                      ) : null}
                    </div>
                    {suggestion.category !== "show-all" && suggestionType ? (
                      <Badge
                        variant="secondary"
                        className="shrink-0 text-[10px] capitalize"
                      >
                        {suggestion.category}
                      </Badge>
                    ) : null}
                  </button>
                ))}
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>

      {invalidQualifierFragments.length > 0 ? (
        <div className="mt-1 truncate text-destructive text-xs">
          Unsupported qualifier: {invalidQualifierFragments.join(", ")}
        </div>
      ) : null}
    </div>
  );
}
