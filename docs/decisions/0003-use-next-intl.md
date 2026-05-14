# ADR-0003: Use next-intl for Internationalization

## Status

Accepted

## Context

The application targets a multilingual user base and requires server-side and client-side translation support with Next.js App Router compatibility.

## Decision

`next-intl` was selected as the internationalization library.

## Consequences

### Positive
- Native App Router support with server component integration
- Request-based locale detection via middleware
- Type-safe message keys
- Separation of translation files in `src/i18n/messages/`
- Works with both Server and Client Components

### Negative
- Adds complexity to routing (locale prefixes if enabled)
- Translation files must be maintained manually or via external tooling
