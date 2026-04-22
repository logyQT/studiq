import { HealthService } from "@/server/services/health.service";
import type { HealthStatus } from "@/types";

/**
 * =============================================================================
 * HEALTH CONTROLLER
 * =============================================================================
 *
 * Kontrolery odpowiadają za:
 * - Odbieranie requestów z Route Handlers
 * - Walidację danych wejściowych
 * - Wywoływanie odpowiednich serwisów
 * - Formatowanie odpowiedzi
 *
 * Kontrolery NIE powinny zawierać logiki biznesowej - delegują ją do serwisów.
 *
 * Przykład użycia w Route Handler:
 *   import { HealthController } from "@/server/controllers/health.controller";
 *
 *   export async function GET() {
 *     const data = HealthController.getStatus();
 *     return NextResponse.json(data);
 *   }
 */
export class HealthController {
  /**
   * Pobiera status zdrowia aplikacji
   * @returns Obiekt HealthStatus z informacjami o stanie serwera
   */
  static getStatus(): HealthStatus {
    return HealthService.checkHealth();
  }

  /**
   * Przykład metody z walidacją (do rozbudowy)
   *
   * static async createResource(data: unknown) {
   *   // 1. Walidacja danych wejściowych
   *   const validated = ResourceSchema.parse(data);
   *
   *   // 2. Wywołanie serwisu
   *   const result = await ResourceService.create(validated);
   *
   *   // 3. Zwrócenie wyniku
   *   return result;
   * }
   */
}
