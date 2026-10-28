# MGR-REP-01 — Zgłoszenia w organizacji

- id: MGR-REP-01
- priority: P2 ważny
- module: MGR – Panel managera organizacji (/manage)
- section: Zgłoszenia i konto managera
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

Istnieją zgłoszenia w organizacji WSB Merito.

## Steps

1. Otwórz /manage/reports.
2. Otwórz wątek i napisz odpowiedź.

## Expected result

- Opis „Zgłoszenia dotyczące pytań i grup w Twojej organizacji.”; manager widzi zgłoszenia z całej organizacji.
- Zgłoszenia „do grupy” oznaczone „Grupa: <nazwa>”.

## Prerequisite context (tenant model)

The verbatim prerequisite names the legacy manual seed (organization „WSB Merito”
with `manager@dev.local` and password `pass`). The automated case owns a seeded
tenant with the same shape instead:

- **Tenant key**: `tenantKey('qa/cases/MGR-REP-01.md', 'MGR-REP-01#<run>', 'qa-shared')`
  plus a per-run suffix (`QA_RUN_SUFFIX`, otherwise fresh). Every org/user/group id
  is `tenantId(key, entity)`, so a run is reproducible by pinning the suffix and two
  independent runs never share an organization.
- **Organization under test** (`qa-mgr-rep01-<run>-a`): `manager` (manager account,
  org role `admin`, creator of the default group `G1`), `teacher` (educator, org role
  `teacher`) and `student` (student, org role `member`, enrolled in `G1`).
- **Control organization** (`qa-mgr-rep01-<run>-b`): its own manager/teacher/student
  and group `G2`, with a report of its own. Nothing from it may reach org A's manager.
- **Reports** (built through the product's API, same requests the UI makes):
  1. the teacher owns a question bank with one open question; the student reports
     that question — reporter = student, recipient = teacher, so the manager is
     **not** a participant and still has to see it („cała organizacja”);
  2. the student reports the group `G1` — recipient = the group's creator (the
     manager), which is also why the thread is reachable for the reply in step 2.
- The spec seeds the graph at run time with the shared helpers
  (`__tests__/helpers/tenant-seed.ts`); no profile is added to
  `qa/tests/profiles/<CASE>.json`, because each independent run needs its own reports.

## Walk observations (qa-env-1, shared app :3010 / DB :54421, pl)

- Sidebar „Zgłoszenia” opens `/manage/reports`; the page heading is „Zgłoszenia” and
  the description is exactly „Zgłoszenia dotyczące pytań i grup w Twojej
  organizacji.”. The toolbar above the list has the search field „Szukaj po treści
  pytania lub nazwy grupy”, the status filter „Wszystkie” and the sort „Ostatnia
  aktywność”. The sidebar entry carries the unread-count badge.
- One card per report: avatar + the counterpart's name (the student, because the
  manager participates in neither thread as a reporter), an unread dot for a new
  report, the status badge „Otwarte” on the right and the date `DD.MM.YYYY`. The
  second line is the question content for a question report and „Grupa: G1” for a
  group report.
- The question report between the student and the teacher is listed for the manager
  even though the manager is neither reporter nor recipient — i.e. the whole
  organization's reports are visible, not just the manager's own threads.
- A report from a second organization is neither listed nor openable: `GET
/api/v1/question-reports/<id>` answers 404 for org A's manager.
- The thread (`/manage/reports/<id>`) shows a back arrow, the counterpart, the
  report target (question content or „Grupa: G1”), the status badge and „Oznacz jako
  rozwiązane”. Messages carry the author's name and a timestamp; the composer at the
  bottom is a textarea „Napisz odpowiedź...” with an icon button „Wyślij odpowiedź”.
- Sending a reply renders it right-aligned under „QA manager”, clears the textarea
  and keeps the report „Otwarte”; the message is persisted (`GET
/api/v1/question-reports/<id>` returns it) and survives a reload. The group thread
  keeps the „Grupa: G1” label.
- No deviation from the expected result was observed.
