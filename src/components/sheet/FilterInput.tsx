import {
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
  type KeyboardEvent,
} from "react";
import { Input } from "@/components/ui/input";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";

interface FilterInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  columnValues?: string[];
  fetchDistinctValues?: () => Promise<string[]>;
  id?: string;
  ariaLabel?: string;
}

export function FilterInput({
  value,
  onChange,
  placeholder,
  columnValues = [],
  fetchDistinctValues,
  id,
  ariaLabel,
}: FilterInputProps) {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [distinctValues, setDistinctValues] = useState<string[]>([]);
  const [isLoadingDistinct, setIsLoadingDistinct] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (
      showSuggestions &&
      fetchDistinctValues &&
      distinctValues.length === 0 &&
      !isLoadingDistinct
    ) {
      const controller = new AbortController();

      const loadDistinctValues = async () => {
        setIsLoadingDistinct(true);
        try {
          const values = await fetchDistinctValues();
          if (!controller.signal.aborted) {
            setDistinctValues(values);
          }
        } catch (err) {
          if (!controller.signal.aborted) {
            logger.error("Failed to fetch distinct values:", err);
          }
        } finally {
          if (!controller.signal.aborted) {
            setIsLoadingDistinct(false);
          }
        }
      };

      loadDistinctValues();

      return () => {
        controller.abort();
      };
    }
  }, [
    showSuggestions,
    fetchDistinctValues,
    distinctValues.length,
    isLoadingDistinct,
  ]);

  const suggestions = useMemo(() => {
    const sourceValues =
      distinctValues.length > 0 ? distinctValues : columnValues;

    if (!value.trim() || sourceValues.length === 0) return [];

    const lowerQuery = value.toLowerCase();
    const filtered = sourceValues
      .filter((val) => val && val.toLowerCase().includes(lowerQuery))
      .slice(0, 10);

    return filtered;
  }, [value, columnValues, distinctValues]);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(e.target.value);
      setShowSuggestions(true);
      setSelectedIndex(-1);
    },
    [onChange],
  );

  const handleClear = useCallback(() => {
    onChange("");
    setShowSuggestions(false);
    inputRef.current?.focus();
  }, [onChange]);

  const applySuggestion = useCallback(
    (suggestion: string) => {
      onChange(suggestion);
      setShowSuggestions(false);
      setSelectedIndex(-1);
      inputRef.current?.focus();
    },
    [onChange],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (!showSuggestions || suggestions.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev < suggestions.length - 1 ? prev + 1 : prev,
        );
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : -1));
      } else if (e.key === "Enter" && selectedIndex >= 0) {
        e.preventDefault();
        applySuggestion(suggestions[selectedIndex]!);
      } else if (e.key === "Escape") {
        e.preventDefault();
        setShowSuggestions(false);
        setSelectedIndex(-1);
      }
    },
    [showSuggestions, suggestions, selectedIndex, applySuggestion],
  );

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setShowSuggestions(false);
        setSelectedIndex(-1);
      }
    };

    if (showSuggestions) {
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showSuggestions]);

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Input
          ref={inputRef}
          id={id}
          value={value}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setShowSuggestions(true)}
          placeholder={placeholder}
          aria-label={ariaLabel}
          className="h-7 text-xs pr-6"
        />
        {value && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-muted"
            aria-label="Clear filter"
          >
            <X className="h-3 w-3 text-muted-foreground" />
          </button>
        )}
      </div>

      {showSuggestions && suggestions.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-0.5 bg-popover border rounded-md shadow-md z-50 max-h-48 overflow-y-auto">
          {suggestions.map((suggestion, index) => (
            <button
              key={index}
              type="button"
              className={cn(
                "w-full text-left px-2 py-1.5 text-xs hover:bg-accent cursor-pointer",
                selectedIndex === index && "bg-accent",
              )}
              onMouseDown={(e) => {
                e.preventDefault();
                applySuggestion(suggestion);
              }}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
