# ADR-0006: Use Zod for Request Validation

## Status

Accepted

## Context

The application needed a type-safe way to validate incoming API request bodies, query parameters, and path parameters with clear error messages.

## Decision

Zod was selected as the validation library, with schemas defined in `src/server/models/` and shared between controllers and tests.

## Consequences

### Positive
- Schemas double as TypeScript type inference (`z.infer`)
- Clear, composable validation rules with custom error messages
- Schemas can be registered for OpenAPI/Swagger documentation
- Single source of truth for request shape — used by controllers, tests, and docs
- Catches invalid input early with 422 responses

### Negative
- Requires maintaining schemas alongside route handlers
- Validation errors must be mapped to user-friendly messages on the frontend
