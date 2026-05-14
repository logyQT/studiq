# ADR-0004: Use Service/Controller Architecture

## Status

Accepted

## Context

The application needed a clean separation between request handling, business logic, and data access to maintain testability and code organization as the codebase grows.

## Decision

A service/controller architecture was adopted:
- **Controllers** handle HTTP concerns: parsing, validation, response formatting
- **Services** handle business logic: database queries, computations, orchestration
- **Guards** handle authorization: role checks, ownership verification
- **Models** define Zod schemas for request validation

## Consequences

### Positive
- Controllers are thin and easily testable with mocked services
- Services can be reused across multiple controllers
- Clear responsibility boundaries reduce coupling
- Unit tests can mock at the service level without hitting the database
- Integration tests verify the full stack without changing code

### Negative
- More files and boilerplate compared to a single-file approach
- Requires discipline to keep controllers thin and services focused
- Additional indirection can make debugging slightly more complex
