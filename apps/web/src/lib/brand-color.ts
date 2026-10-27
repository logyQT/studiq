export const DEFAULT_BRAND_COLOR = '#000000';

/**
 * The colour the picker and the hex label show: what the user is picking right now (the
 * draft) wins over the saved value. Showing the saved value first made every second
 * change snap back while "Zapisz" still submitted the invisible draft (#272).
 */
export function resolveBrandColor(draft: string | null, saved: string | null | undefined): string {
  return draft ?? saved ?? DEFAULT_BRAND_COLOR;
}

/**
 * The draft can be dropped once the server returns it as the saved colour, so the field
 * follows the server again (e.g. another admin changes the colour). Compared
 * case-insensitively because the browser colour input lower-cases hex values.
 */
export function isDraftSaved(draft: string | null, saved: string | null | undefined): boolean {
  return draft !== null && !!saved && draft.toLowerCase() === saved.toLowerCase();
}
