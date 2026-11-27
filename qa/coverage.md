# QA case coverage

Every case in `qa/cases/` mapped to the technique that should own it. This is the
classification, not the scoreboard — what has actually shipped is tracked in `#926`
(which owns the counts, so this file does not restate a snapshot that goes stale).

- **193 cases**: 175 end-to-end, 10 API-level,
  8 manual-owned — four of them carry a partial spec, and all eight are listed
  with the reason automation cannot cover the whole case at the bottom.
- First pass, generated from each case's front-matter and steps; a case that mixes UI and
  API work is filed under `e2e`, because the UI is what has to be exercised either way.
- `manual` does not mean "skip" and does not mean "no spec": it means the whole
  case cannot be asserted without a print pipeline, CDP network emulation or
  human judgement, so it stays on the release checklist even when a spec pins part
  of it.
- A case whose product behaviour contradicts its text is an issue, not a spec — `#926`
  tracks the open ones. Turning a case into a spec:
  `.agents/skills/studiq-qa-case/SKILL.md`.

## By area

| area      |     e2e |    api | manual |   total |
| --------- | ------: | -----: | -----: | ------: |
| AUT       |      20 |      0 |      0 |      20 |
| BIL       |       6 |      0 |      0 |       6 |
| EDU       |      41 |      0 |      2 |      43 |
| LIM       |       2 |      1 |      1 |       4 |
| MGR       |      28 |      0 |      0 |      28 |
| NFR       |       3 |      0 |      5 |       8 |
| ONB       |      10 |      0 |      0 |      10 |
| PUB       |       8 |      0 |      0 |       8 |
| SEC       |       5 |      8 |      0 |      13 |
| STU       |      52 |      1 |      0 |      53 |
| **total** | **175** | **10** |  **8** | **193** |

## Cases

| case        | area | prio | owner  | note                                                                 |
| ----------- | ---- | ---- | ------ | -------------------------------------------------------------------- |
| AUT-01      | AUT  | P1   | e2e    |                                                                      |
| AUT-02      | AUT  | P2   | e2e    |                                                                      |
| AUT-03      | AUT  | P2   | e2e    |                                                                      |
| AUT-04      | AUT  | P2   | e2e    |                                                                      |
| AUT-05      | AUT  | P2   | e2e    |                                                                      |
| AUT-06      | AUT  | P2   | e2e    |                                                                      |
| AUT-07      | AUT  | P1   | e2e    |                                                                      |
| AUT-08      | AUT  | P1   | e2e    |                                                                      |
| AUT-09      | AUT  | P2   | e2e    |                                                                      |
| AUT-10      | AUT  | P2   | e2e    |                                                                      |
| AUT-11      | AUT  | P2   | e2e    |                                                                      |
| AUT-12      | AUT  | P1   | e2e    |                                                                      |
| AUT-13      | AUT  | P2   | e2e    |                                                                      |
| AUT-14      | AUT  | P1   | e2e    |                                                                      |
| AUT-15      | AUT  | P1   | e2e    |                                                                      |
| AUT-16      | AUT  | P1   | e2e    |                                                                      |
| AUT-17      | AUT  | P1   | e2e    |                                                                      |
| AUT-18      | AUT  | P1   | e2e    |                                                                      |
| AUT-19      | AUT  | P1   | e2e    |                                                                      |
| AUT-20      | AUT  | P1   | e2e    | zakładka `/manage` członka: karta braku dostępu, adres bez zmian     |
| BIL-01      | BIL  | P2   | e2e    |                                                                      |
| BIL-02      | BIL  | P2   | e2e    |                                                                      |
| BIL-03      | BIL  | P1   | e2e    |                                                                      |
| BIL-04      | BIL  | P1   | e2e    |                                                                      |
| BIL-05      | BIL  | P1   | e2e    |                                                                      |
| BIL-06      | BIL  | P1   | e2e    |                                                                      |
| EDU-01      | EDU  | P2   | e2e    |                                                                      |
| EDU-02      | EDU  | P2   | e2e    |                                                                      |
| EDU-ASG-01  | EDU  | P1   | e2e    |                                                                      |
| EDU-ASG-02  | EDU  | P2   | e2e    |                                                                      |
| EDU-ASG-03  | EDU  | P2   | e2e    |                                                                      |
| EDU-ASG-04  | EDU  | P1   | e2e    |                                                                      |
| EDU-ASG-05  | EDU  | P1   | e2e    |                                                                      |
| EDU-ASG-06  | EDU  | P2   | e2e    |                                                                      |
| EDU-ASG-07  | EDU  | P2   | e2e    |                                                                      |
| EDU-ASG-08  | EDU  | P1   | e2e    |                                                                      |
| EDU-ASG-09  | EDU  | P2   | e2e    |                                                                      |
| EDU-ASG-10  | EDU  | P2   | manual | print layout - needs a print/PDF pipeline, not a DOM assertion       |
| EDU-ASG-11  | EDU  | P2   | e2e    | kartkówka kolegi na liście, szczegół odmówiony (ADR-0015 6e)         |
| EDU-DECK-01 | EDU  | P2   | e2e    |                                                                      |
| EDU-DECK-02 | EDU  | P1   | e2e    |                                                                      |
| EDU-DECK-03 | EDU  | P2   | e2e    |                                                                      |
| EDU-DECK-04 | EDU  | P2   | e2e    |                                                                      |
| EDU-DECK-05 | EDU  | P2   | e2e    |                                                                      |
| EDU-DECK-06 | EDU  | P2   | e2e    |                                                                      |
| EDU-DECK-07 | EDU  | P1   | e2e    | grupa = odczyt; zapis 403; brak edycji w edytorze ról (#961)         |
| EDU-GRP-01  | EDU  | P2   | e2e    |                                                                      |
| EDU-GRP-02  | EDU  | P2   | e2e    |                                                                      |
| EDU-GRP-03  | EDU  | P2   | e2e    |                                                                      |
| EDU-GRP-04  | EDU  | P2   | e2e    |                                                                      |
| EDU-GRP-05  | EDU  | P2   | e2e    |                                                                      |
| EDU-Q-01    | EDU  | P2   | e2e    |                                                                      |
| EDU-Q-02    | EDU  | P1   | e2e    |                                                                      |
| EDU-Q-03    | EDU  | P2   | e2e    |                                                                      |
| EDU-Q-04    | EDU  | P2   | e2e    |                                                                      |
| EDU-Q-05    | EDU  | P2   | e2e    |                                                                      |
| EDU-Q-06    | EDU  | P2   | e2e    |                                                                      |
| EDU-QZ-01   | EDU  | P2   | e2e    |                                                                      |
| EDU-QZ-02   | EDU  | P1   | e2e    |                                                                      |
| EDU-QZ-03   | EDU  | P2   | e2e    |                                                                      |
| EDU-QZ-04   | EDU  | P2   | manual | offline/online recovery mid-flow - CDP network emulation             |
| EDU-QZ-05   | EDU  | P2   | e2e    |                                                                      |
| EDU-QZ-06   | EDU  | P2   | e2e    |                                                                      |
| EDU-REP-01  | EDU  | P2   | e2e    |                                                                      |
| EDU-REP-02  | EDU  | P2   | e2e    |                                                                      |
| EDU-ST-01   | EDU  | P2   | e2e    |                                                                      |
| EDU-ST-02   | EDU  | P2   | e2e    |                                                                      |
| EDU-ST-03   | EDU  | P2   | e2e    |                                                                      |
| EDU-ST-04   | EDU  | P2   | e2e    |                                                                      |
| EDU-TOP-01  | EDU  | P2   | e2e    |                                                                      |
| LIM-02      | LIM  | P1   | manual | mutates plan_limits directly in SQL before the UI check              |
| LIM-03      | LIM  | P2   | e2e    |                                                                      |
| LIM-04      | LIM  | P2   | e2e    |                                                                      |
| LIM-05      | LIM  | P1   | api    | drives the HTTP API directly - Playwright request / integration test |
| MGR-01      | MGR  | P2   | e2e    |                                                                      |
| MGR-02      | MGR  | P2   | e2e    |                                                                      |
| MGR-03      | MGR  | P2   | e2e    |                                                                      |
| MGR-ACC-01  | MGR  | P1   | e2e    |                                                                      |
| MGR-GRP-01  | MGR  | P1   | e2e    |                                                                      |
| MGR-GRP-02  | MGR  | P2   | e2e    |                                                                      |
| MGR-INV-01  | MGR  | P1   | e2e    |                                                                      |
| MGR-INV-02  | MGR  | P2   | e2e    |                                                                      |
| MGR-INV-03  | MGR  | P2   | e2e    |                                                                      |
| MGR-INV-04  | MGR  | P2   | e2e    |                                                                      |
| MGR-MEM-01  | MGR  | P1   | e2e    |                                                                      |
| MGR-MEM-02  | MGR  | P1   | e2e    |                                                                      |
| MGR-MEM-03  | MGR  | P1   | e2e    |                                                                      |
| MGR-MEM-04  | MGR  | P2   | e2e    |                                                                      |
| MGR-MEM-05  | MGR  | P2   | e2e    |                                                                      |
| MGR-REP-01  | MGR  | P2   | e2e    |                                                                      |
| MGR-ROL-01  | MGR  | P2   | e2e    | gate: `org.role.manage` (QA case; e2e deleted)                       |
| MGR-ROL-02  | MGR  | P2   | e2e    |                                                                      |
| MGR-ROL-03  | MGR  | P2   | e2e    |                                                                      |
| MGR-ROL-04  | MGR  | P1   | e2e    |                                                                      |
| MGR-SEAT-01 | MGR  | P2   | e2e    |                                                                      |
| MGR-SEAT-02 | MGR  | P2   | e2e    |                                                                      |
| MGR-SEAT-03 | MGR  | P2   | e2e    |                                                                      |
| MGR-SET-01  | MGR  | P2   | e2e    |                                                                      |
| MGR-SET-02  | MGR  | P2   | e2e    |                                                                      |
| MGR-SET-03  | MGR  | P2   | e2e    |                                                                      |
| MGR-SET-04  | MGR  | P2   | e2e    |                                                                      |
| MGR-SET-05  | MGR  | P2   | e2e    |                                                                      |
| NFR-01      | NFR  | P2   | e2e    |                                                                      |
| NFR-02      | NFR  | P1   | e2e    |                                                                      |
| NFR-03      | NFR  | P2   | manual | theme sweep across key screens - visual judgement                    |
| NFR-04      | NFR  | P1   | e2e    |                                                                      |
| NFR-05      | NFR  | P2   | manual | keyboard-only walkthrough - focus order, not assertions              |
| NFR-06      | NFR  | P2   | manual | offline behaviour across four flows - CDP emulation                  |
| NFR-07      | NFR  | P2   | manual | console/network dependency sweep - judgement over a whole run        |
| NFR-08      | NFR  | P2   | manual | cross-browser smoke matrix - needs the browser matrix job            |
| ONB-01      | ONB  | P2   | e2e    |                                                                      |
| ONB-02      | ONB  | P1   | e2e    |                                                                      |
| ONB-03      | ONB  | P2   | e2e    |                                                                      |
| ONB-04      | ONB  | P2   | e2e    |                                                                      |
| ONB-05      | ONB  | P2   | e2e    |                                                                      |
| ONB-06      | ONB  | P2   | e2e    |                                                                      |
| ONB-07      | ONB  | P1   | e2e    |                                                                      |
| ONB-08      | ONB  | P2   | e2e    |                                                                      |
| ONB-09      | ONB  | P2   | e2e    |                                                                      |
| ONB-10      | ONB  | P1   | e2e    |                                                                      |
| PUB-01      | PUB  | P1   | e2e    |                                                                      |
| PUB-02      | PUB  | P2   | e2e    |                                                                      |
| PUB-03      | PUB  | P1   | e2e    |                                                                      |
| PUB-04      | PUB  | P2   | e2e    |                                                                      |
| PUB-05      | PUB  | P3   | e2e    |                                                                      |
| PUB-06      | PUB  | P3   | e2e    |                                                                      |
| PUB-07      | PUB  | P2   | e2e    |                                                                      |
| PUB-08      | PUB  | P2   | e2e    |                                                                      |
| SEC-01      | SEC  | P1   | e2e    |                                                                      |
| SEC-02      | SEC  | P1   | api    | drives the HTTP API directly - Playwright request / integration test |
| SEC-03      | SEC  | P2   | e2e    |                                                                      |
| SEC-04      | SEC  | P1   | e2e    |                                                                      |
| SEC-05      | SEC  | P1   | api    | drives the HTTP API directly - Playwright request / integration test |
| SEC-06      | SEC  | P1   | api    | drives the HTTP API directly - Playwright request / integration test |
| SEC-07      | SEC  | P2   | api    | drives the HTTP API directly - Playwright request / integration test |
| SEC-08      | SEC  | P1   | api    | drives the HTTP API directly - Playwright request / integration test |
| SEC-09      | SEC  | P1   | api    | drives the HTTP API directly - Playwright request / integration test |
| SEC-10      | SEC  | P1   | e2e    |                                                                      |
| SEC-11      | SEC  | P2   | e2e    |                                                                      |
| SEC-12      | SEC  | P2   | api    | drives the HTTP API directly - Playwright request / integration test |
| SEC-13      | SEC  | P2   | api    | drives the HTTP API directly - Playwright request / integration test |
| STU-01      | STU  | P1   | e2e    |                                                                      |
| STU-02      | STU  | P2   | e2e    |                                                                      |
| STU-03      | STU  | P2   | e2e    |                                                                      |
| STU-04      | STU  | P2   | e2e    |                                                                      |
| STU-05      | STU  | P1   | e2e    |                                                                      |
| STU-06      | STU  | P2   | e2e    |                                                                      |
| STU-07      | STU  | P1   | e2e    |                                                                      |
| STU-08      | STU  | P2   | e2e    |                                                                      |
| STU-09      | STU  | P1   | e2e    |                                                                      |
| STU-10      | STU  | P2   | e2e    |                                                                      |
| STU-11      | STU  | P1   | e2e    |                                                                      |
| STU-12      | STU  | P2   | e2e    |                                                                      |
| STU-13      | STU  | P3   | e2e    |                                                                      |
| STU-14      | STU  | P2   | e2e    |                                                                      |
| STU-15      | STU  | P1   | e2e    |                                                                      |
| STU-16      | STU  | P2   | e2e    |                                                                      |
| STU-17      | STU  | P2   | e2e    |                                                                      |
| STU-18      | STU  | P2   | e2e    |                                                                      |
| STU-19      | STU  | P1   | e2e    |                                                                      |
| STU-20      | STU  | P2   | e2e    |                                                                      |
| STU-21      | STU  | P1   | e2e    |                                                                      |
| STU-22      | STU  | P2   | e2e    |                                                                      |
| STU-23      | STU  | P2   | e2e    |                                                                      |
| STU-24      | STU  | P2   | e2e    |                                                                      |
| STU-26      | STU  | P2   | e2e    |                                                                      |
| STU-27      | STU  | P2   | e2e    |                                                                      |
| STU-28      | STU  | P2   | e2e    |                                                                      |
| STU-29      | STU  | P1   | e2e    |                                                                      |
| STU-30      | STU  | P2   | e2e    |                                                                      |
| STU-31      | STU  | P2   | e2e    |                                                                      |
| STU-32      | STU  | P2   | e2e    |                                                                      |
| STU-33      | STU  | P2   | e2e    |                                                                      |
| STU-34      | STU  | P2   | e2e    |                                                                      |
| STU-35      | STU  | P1   | e2e    |                                                                      |
| STU-36      | STU  | P2   | api    | drives the HTTP API directly - Playwright request / integration test |
| STU-37      | STU  | P2   | e2e    |                                                                      |
| STU-38      | STU  | P2   | e2e    |                                                                      |
| STU-39      | STU  | P2   | e2e    |                                                                      |
| STU-40      | STU  | P2   | e2e    |                                                                      |
| STU-41      | STU  | P2   | e2e    |                                                                      |
| STU-42      | STU  | P2   | e2e    |                                                                      |
| STU-43      | STU  | P2   | e2e    |                                                                      |
| STU-44      | STU  | P2   | e2e    |                                                                      |
| STU-45      | STU  | P2   | e2e    |                                                                      |
| STU-47      | STU  | P2   | e2e    | ai-suite: fake inference server                                      |
| STU-48      | STU  | P2   | e2e    | ai-suite: fake inference server                                      |
| STU-49      | STU  | P2   | e2e    |                                                                      |
| STU-50      | STU  | P2   | e2e    |                                                                      |
| STU-51      | STU  | P2   | e2e    |                                                                      |
| STU-52      | STU  | P3   | e2e    |                                                                      |
| STU-53      | STU  | P3   | e2e    |                                                                      |
| STU-54      | STU  | P2   | e2e    |                                                                      |
| STU-55      | STU  | P2   | e2e    |                                                                      |

## Manual-owned, with the reason automation cannot cover the whole case

| case       | reason                                                         | partial spec  |
| ---------- | -------------------------------------------------------------- | ------------- |
| EDU-ASG-10 | print layout - needs a print/PDF pipeline, not a DOM assertion | print view    |
| EDU-QZ-04  | offline/online recovery mid-flow - CDP network emulation       | —             |
| LIM-02     | mutates plan_limits directly in SQL before the UI check        | the real caps |
| NFR-03     | theme sweep across key screens - visual judgement              | —             |
| NFR-05     | keyboard-only walkthrough - focus order, not assertions        | focus order   |
| NFR-06     | offline behaviour across four flows - CDP emulation            | —             |
| NFR-07     | console/network dependency sweep - judgement over a whole run  | smoke journey |
| NFR-08     | cross-browser smoke matrix - needs the browser matrix job      | —             |

A partial spec pins the part a browser can see; it does not move the case off the
manual checklist. The four with `—` are the ones with no spec at all.

## How the automated cases get built

- One spec per case in `__tests__/qa/<AREA>/<ID>.spec.ts` — `test.describe()` may
  carry `@case:<ID>`, so a shard's report names the case that failed.
- Every case gets an isolated tenant — the default `content` shape, or the one in
  `__tests__/qa/profiles/<ID>.json` when the case needs another
  (`bun scripts/qa-tenant.ts <ID>`), read through `loadTenant()`; no spec creates
  accounts or writes shared rows.
- UI cases drive the real path with the tenant's own users; API cases use
  Playwright's request context with the seeded session cookie.
- Run it with `bun run test:qa __tests__/qa/<AREA>/<ID>.spec.ts` in a shell that
  has this checkout's stack contract and `QA_APP_URL` exported (the case skill's
  Commands block); CI seeds a shard's areas once and runs four path-scoped shards,
  plus `ai-suite` for the AI cases against the fake inference server.
- Gate: 5/5 independent fresh-tenant runs, a mutation that turns the spec red for
  the right reason, and the manual list above acknowledged as the only remaining
  manual coverage.
