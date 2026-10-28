# MGR-INV-01 — Wysłanie zaproszenia z rolą

- id: MGR-INV-01
- priority: P1 krytyczny
- module: MGR – Panel managera organizacji (/manage)
- section: Zaproszenia (/manage/invites)
- prereqs: none
- source: StudiQ Dokument Testera v1.3

## Prerequisite (verbatim)

M1, WSB Merito (4/5 członków).

## Steps

1. Otwórz /manage/invites.
2. Wpisz e-mail invite1@example.com, wybierz rolę „member”.
3. Kliknij „Wyślij zaproszenia”.
4. W sekcji „Wyniki” kliknij „Kopiuj link”.

## Expected result

- Toast „Wysłano 1 zaproszeń.”; w sekcji „Wyniki” plakietka „Sukces” i przycisk „Kopiuj link” (toast „Skopiowano!”).
- W tabeli „Wysłane zaproszenia” nowe zaproszenie ze statusem „Oczekujące”.
- W Inbucket brak wiadomości lub wiadomość z linkiem (zanotuj – jeżeli mail nie jest wysyłany, link kopiowany ręcznie).

## Prerequisite context (tenant model)

The verbatim prerequisite names the legacy manual seed (`M1`, WSB Merito 4/5
members). The automated case runs on the `content` tenant of its own case instead:

```bash
bun scripts/qa-tenant.ts MGR-INV-01 --fresh   # new org + users per independent run
```

- **Tenant key**: `tenantKey('qa/cases/MGR-INV-01.md', <title>, 'qa-shared')` — with
  `--fresh` the title carries a run suffix, so each independent run gets brand-new,
  still deterministic ids (`tenantId(key, entity)`).
- **Organization**: one org with its default group `G1`; the seeded `manager` is its
  `admin`. The case's "4/5 członków" is not reproduced — the invitation list has to start
  empty so the new row is unambiguous (the spec also tolerates a tenant that already
  holds earlier invitations, and then proves that exactly one new one appeared).
- **Users** (password `Seed4Test!`): `manager` (manager, org `admin`), plus the profile's
  `teacher` and `student` members, which this case does not use.
- **Invitee**: stays the bare address `invite1@example.com` — never a fixture account,
  exactly as in the case.
- **Roles**: the org's trigger-created defaults; „member” is the `member` role, whose
  display name is „Student”.
- **Profile**: `content` (the default, so no entry is needed in `qa/tests/profiles/<CASE>.json`).

## Walk observations (shared app, pl)

- `/manage/invites` for the org's manager: heading „Zaproszenia”, form card „Zaproś
  członków” with `#email-0` and `#role-0` (placeholder „Rola”), buttons „Dodaj kolejną”
  and „Wyślij zaproszenia”.
- The role select lists display names Admin / Student / Teacher. The case's „member” is
  the option „Student” (DB role name `member`).
- One submitted row → toast „Wysłano 1 zaproszeń.”, a „Wyniki” row with the address,
  „Kod zaproszenia: <32 hex>”, badge „Sukces” and the buttons „Kopiuj kod” /
  „Kopiuj link”.
- „Kopiuj link” → toast „Skopiowano!” and `http://localhost:3010/join?token=<32 hex>` on
  the clipboard — the same `inviteLink` the bulk endpoint returned.
- „Wysłane zaproszenia” lists the new row immediately: address, role „Student”, status
  „Oczekujące”, sent date and the „Anuluj” action.
- The public preview `GET /api/v1/organization/invites?token=…` resolves the copied code
  to this organization, the invitee address and role `member`, without consuming it.
- Inbucket: **no message**. The shared app runs without a mail adapter (`MAIL_DRIVER`
  unset ⇒ mail is opt-in, #604), so the copied link is the delivery path — precisely the
  variant the case allows ("brak wiadomości … link kopiowany ręcznie"). Not asserted.
