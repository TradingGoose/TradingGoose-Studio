import type React from "react";
import { useCallback, useMemo, useRef, useState } from "react";
import { parseQuery, serializeQuery } from "@/lib/logs/query-parser";
import type { QueryPolicy, QuerySegment } from "@/lib/logs/query-types";
import type {
  Suggestion,
  SuggestionGroup,
  SuggestionSection,
} from "@/app/workspace/[workspaceId]/logs/types";

interface UseSearchStateOptions {
  queryPolicy: QueryPolicy;
  getSuggestions: (input: string) => SuggestionGroup | null;
  debounceMs?: number;
}

const mergeSegments = (current: QuerySegment[], next: QuerySegment[]) => {
  const nextClauseRaws = new Set(
    next
      .filter(
        (segment): segment is Extract<QuerySegment, { kind: "clause" }> =>
          segment.kind === "clause",
      )
      .map((segment) => segment.clause.raw),
  );

  const preservedCurrent = current.filter(
    (segment) =>
      segment.kind !== "clause" || !nextClauseRaws.has(segment.clause.raw),
  );

  return [...preservedCurrent, ...next];
};

const getClausesFromSegments = (segments: QuerySegment[]) =>
  segments.flatMap((segment) =>
    segment.kind === "clause" ? [segment.clause] : [],
  );

const getTextSearchFromSegments = (segments: QuerySegment[]) =>
  segments
    .flatMap((segment) => (segment.kind === "text" ? [segment.value] : []))
    .join(" ")
    .trim();

export function useSearchState({
  queryPolicy,
  getSuggestions,
  debounceMs = 100,
}: UseSearchStateOptions) {
  const [segments, setSegments] = useState<QuerySegment[]>([]);
  const [currentInput, setCurrentInput] = useState("");
  const [invalidQualifierFragments, setInvalidQualifierFragments] = useState<
    string[]
  >([]);

  const [isOpen, setIsOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [sections, setSections] = useState<SuggestionSection[]>([]);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [highlightedBadgeIndex, setHighlightedBadgeIndex] = useState<
    number | null
  >(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  const clauses = useMemo(() => getClausesFromSegments(segments), [segments]);
  const textSearch = useMemo(
    () => getTextSearchFromSegments(segments),
    [segments],
  );
  const committedQuery = useMemo(
    () => serializeQuery({ clauses, textSearch, segments }, queryPolicy),
    [clauses, queryPolicy, segments, textSearch],
  );

  const updateSuggestions = useCallback(
    (input: string) => {
      const suggestionGroup = getSuggestions(input);

      if (suggestionGroup && suggestionGroup.suggestions.length > 0) {
        setSuggestions(suggestionGroup.suggestions);
        setSections(suggestionGroup.sections || []);
        setIsOpen(true);
        setHighlightedIndex(0);
      } else {
        setSuggestions([]);
        setSections([]);
        setIsOpen(false);
        setHighlightedIndex(-1);
      }
    },
    [getSuggestions],
  );

  const mergeParsedInput = useCallback(
    (input: string) => {
      const parsed = parseQuery(input, queryPolicy);

      if (
        parsed.clauses.length === 0 &&
        parsed.textSearch.length === 0 &&
        parsed.invalidQualifierFragments.length > 0
      ) {
        setInvalidQualifierFragments(parsed.invalidQualifierFragments);
        return false;
      }

      setSegments((current) => mergeSegments(current, parsed.segments));
      setCurrentInput("");
      setInvalidQualifierFragments(parsed.invalidQualifierFragments);
      return true;
    },
    [queryPolicy],
  );

  const handleInputChange = useCallback(
    (value: string) => {
      setCurrentInput(value);
      setHighlightedBadgeIndex(null);
      setInvalidQualifierFragments([]);

      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      debounceRef.current = setTimeout(() => {
        updateSuggestions(value);
      }, debounceMs);
    },
    [debounceMs, updateSuggestions],
  );

  const handleSuggestionSelect = useCallback(
    (suggestion: Suggestion) => {
      if (suggestion.category === "show-all") {
        const parsed = parseQuery(suggestion.value.trim(), queryPolicy);
        setSegments((current) => [
          ...current.filter((segment) => segment.kind === "clause"),
          ...parsed.segments.filter((segment) => segment.kind === "text"),
        ]);
        setCurrentInput("");
        setInvalidQualifierFragments(parsed.invalidQualifierFragments);
        setIsOpen(false);
        return;
      }

      if (
        suggestion.category === "qualifier" &&
        suggestion.value.endsWith(":")
      ) {
        setCurrentInput(suggestion.value);
        updateSuggestions(suggestion.value);
        return;
      }

      const committed = mergeParsedInput(suggestion.value);
      setIsOpen(false);

      if (committed && inputRef.current) {
        inputRef.current.focus();
      }
    },
    [mergeParsedInput, queryPolicy, updateSuggestions],
  );

  const removeBadge = useCallback((index: number) => {
    setSegments((current) => {
      let clauseIndex = -1;

      return current.filter((segment) => {
        if (segment.kind !== "clause") {
          return true;
        }

        clauseIndex += 1;
        return clauseIndex !== index;
      });
    });
    setHighlightedBadgeIndex(null);

    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  const clearAll = useCallback(() => {
    setSegments([]);
    setCurrentInput("");
    setInvalidQualifierFragments([]);
    setIsOpen(false);
    setHighlightedBadgeIndex(null);

    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  const commitCurrentInput = useCallback(() => {
    if (!currentInput.trim()) {
      setInvalidQualifierFragments([]);
      return;
    }

    mergeParsedInput(currentInput.trim());
    setIsOpen(false);
  }, [currentInput, mergeParsedInput]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "Backspace" && currentInput === "") {
        event.preventDefault();

        if (highlightedBadgeIndex !== null) {
          removeBadge(highlightedBadgeIndex);
        } else if (clauses.length > 0) {
          setHighlightedBadgeIndex(clauses.length - 1);
        }
        return;
      }

      if (
        highlightedBadgeIndex !== null &&
        !["ArrowDown", "ArrowUp", "Enter"].includes(event.key)
      ) {
        setHighlightedBadgeIndex(null);
      }

      if (event.key === "Enter") {
        event.preventDefault();

        if (isOpen && highlightedIndex >= 0 && suggestions[highlightedIndex]) {
          handleSuggestionSelect(suggestions[highlightedIndex]!);
        } else {
          commitCurrentInput();
        }
        return;
      }

      if (!isOpen) return;

      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          setHighlightedIndex((current) =>
            Math.min(current + 1, suggestions.length - 1),
          );
          break;
        case "ArrowUp":
          event.preventDefault();
          setHighlightedIndex((current) => Math.max(current - 1, 0));
          break;
        case "Escape":
          event.preventDefault();
          setIsOpen(false);
          setHighlightedIndex(-1);
          break;
        case "Tab":
          if (highlightedIndex >= 0 && suggestions[highlightedIndex]) {
            event.preventDefault();
            handleSuggestionSelect(suggestions[highlightedIndex]!);
          }
          break;
      }
    },
    [
      clauses.length,
      commitCurrentInput,
      currentInput,
      handleSuggestionSelect,
      highlightedBadgeIndex,
      highlightedIndex,
      isOpen,
      removeBadge,
      suggestions,
    ],
  );

  const handleFocus = useCallback(() => {
    updateSuggestions(currentInput);
  }, [currentInput, updateSuggestions]);

  const handleBlur = useCallback(() => {
    setTimeout(() => {
      commitCurrentInput();
      setIsOpen(false);
      setHighlightedIndex(-1);
    }, 150);
  }, [commitCurrentInput]);

  const initializeFromQuery = useCallback(
    (query: string) => {
      const parsed = parseQuery(query, queryPolicy);
      setSegments(parsed.segments);
      setCurrentInput("");
      setInvalidQualifierFragments(parsed.invalidQualifierFragments);
    },
    [queryPolicy],
  );

  return {
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
    commitCurrentInput,
    initializeFromQuery,
    setHighlightedIndex,
  };
}
