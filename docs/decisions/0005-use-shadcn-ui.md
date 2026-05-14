# ADR-0005: Use shadcn/ui for UI Components

## Status

Accepted

## Context

The application needed a consistent, accessible, and customizable component library that integrates well with TailwindCSS and Radix UI primitives.

## Decision

`shadcn/ui` was selected as the UI component library.

## Consequences

### Positive
- Components are copied into the project — full control over customization
- Built on Radix UI primitives for accessibility
- TailwindCSS-based styling — consistent with existing design system
- No runtime dependency — components are part of the codebase
- Large ecosystem of pre-built components (dialogs, tables, forms, etc.)

### Negative
- Components must be updated manually (no npm updates)
- Initial setup requires running `npx shadcn-ui@latest add` for each component
- Larger codebase footprint compared to importing a library
