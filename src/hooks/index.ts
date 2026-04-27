/**
 * =============================================================================
 * CUSTOM HOOKS INDEX
 * =============================================================================
 *
 * Centralny punkt eksportu dla custom hooków React.
 *
 * Użycie:
 *   import { useMobile, useDebounce, useApi } from "@/hooks";
 *
 * PRZYKŁADY HOOKÓW:
 * =================
 *
 * useDebounce - opóźnia wartość:
 *   const debouncedSearch = useDebounce(searchTerm, 300);
 *
 * useLocalStorage - persystuje stan:
 *   const [theme, setTheme] = useLocalStorage("theme", "light");
 *
 * useApi - fetching z SWR pattern:
 *   const { data, isLoading, error } = useApi("/api/users");
 */

// Eksportuj hooki tutaj:
export * from './use-mobile';
export * from './use-toast';

// Dodaj własne hooki:
// export * from "./use-debounce";
// export * from "./use-local-storage";
// export * from "./use-api";
