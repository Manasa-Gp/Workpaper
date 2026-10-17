# Trail — a working slice of a tax workpaper

A small web app that loads the Okafor-Lindqvist packet and shows one idea end to end:

> **Every number on the return is a claim that carries its own proof.**
> Click a number → see how it was built → open the source document with the exact field marked → see what was checked → add a note, adjust it with a reason, or sign it off. A sign-off reopens by itself if the number changes afterwards.

This is a slice, not the whole workpaper. See [What is and is not here](#what-is-and-is-not-here).

---

## Run it

You need Python 3.8+ (backend) and Node 18+ (only for the logic tests). Nothing to install: the backend uses only Python's standard library.

1. **Put the packet here:** `backend/data/packet.json` (exactly as delivered).
2. From the `Workpaper` folder:

```bash
python3 backend/server.py       # or: npm start
```

3. Open http://localhost:3000

The backend serves the packet, saves your notes and sign-offs, and also serves the frontend files, so one command runs everything. If `packet.json` is missing, the page shows a file picker instead.

Run the logic tests (no browser needed):

```bash
node frontend/test/logic.test.mjs      # or: npm test
```

---

## The files

```
Workpaper/
├── README.md                 this file
├── package.json              scripts: start, test
├── backend/
│   ├── server.py             the whole backend (about 90 lines, standard library only)
│   └── data/
│       ├── packet.json       <- PUT THE PACKET HERE. Never modified.
│       └── events.json       created on the first save (notes, adjustments, sign-offs)
└── frontend/
    ├── index.html            the page: top bar + three columns. Loads src/main.js.
    ├── styles.css            all styling (light and dark, phone width)
    ├── src/
    │   ├── main.js           START HERE. State, event handlers, render loop.
    │   ├── loadPacket.js     asks the backend for the packet
    │   ├── packetIndex.js    builds lookup tables from the JSON
    │   ├── trace.js          follows a number to its evidence (and forward to what uses it)
    │   ├── checks.js         checks that do not trust the pipeline or the engine
    │   ├── events.js         notes / adjustments / sign-offs: saving, history, reopening
    │   ├── roles.js          who can do what
    │   ├── format.js         number and date formatting
    │   ├── dom.js            tiny helper for building HTML elements
    │   └── views/
    │       ├── topbar.js     title, role switcher, reset
    │       ├── picker.js     LEFT column: every number on the return
    │       ├── claim.js      MIDDLE column: one number and its whole story
    │       └── source.js     RIGHT column: the document (or other evidence)
    └── test/
        └── logic.test.mjs    tests for trace, checks and sign-off against the real packet
```

**What crosses between the two folders** (three endpoints, nothing else):

| Frontend call | Backend endpoint | Does |
|---|---|---|
| `loadFromBackend()` in `loadPacket.js` | `GET /api/packet` | sends `backend/data/packet.json` |
| `loadEvents()` in `events.js` | `GET /api/events` | sends `backend/data/events.json` (or an empty list) |
| `saveEvents()` in `events.js` | `PUT /api/events` | replaces `events.json` with the list sent |

**Reading order that makes sense:** `backend/server.py` (short) → `main.js` → `packetIndex.js` → `trace.js` → `checks.js` → `views/claim.js` → `views/source.js` → `events.js`.

---

## The flow, step by step

### X
            │    └─ not found → showFilePicker()   main.js         → readPacketFile()  loadPacket.js
            └─ start(packet)                       main.js
                 ├─ buildIndex(packet)             packetIndex.js  lookup tables
                 ├─ loadEvents()                   events.js       saved notes etc. from the browser
                 ├─ computeStatuses(index)         main.js
                 │    └─ for every line with sources:
                 │         traceClaim()            trace.js        gather evidence
                 │         claimChecks()           checks.js       run the checks
                 │         worst()                 checks.js       one status per line
                 ├─ setKey(first line)             main.js         pick a line, open its first problem source
                 └─ render()                       main.js         draw the page
```

### 2. Drawing the page: `render()` in `main.js`

`render()` redraws the four areas from `state`. Views never change state; they only call the handlers in `on`.

```
render()
  ├─ renderTopbar()   views/topbar.js   reads roles.js
  ├─ renderPicker()   views/picker.js   reads state.statusByKey, events.js
  ├─ renderClaim()    views/claim.js    calls trace.js, checks.js, events.js, roles.js
  └─ renderSource()   views/source.js   calls trace.js, checks.js, packetIndex.js
```

### 3. What happens on each click

| You do | Handler in `main.js` | What it changes | Then |
|---|---|---|---|
| Click a number in the left list or a link in the middle | `on.select(key)` | sets the URL hash → `hashchange` → `setKey(key)` | `render()` |
| Click a source under "Where it came from" | `on.source(ref)` | `state.sourceRef` | `render()`, scrolls to the marked field |
| Type in the search box | `on.filter(text)` | `state.filter` | `render()` keeps focus and scroll |
| Tick "Needs attention" | `on.attention(flag)` | `state.onlyAttention` | `render()` |
| Change "Acting as" | `on.role(roleKey)` | `state.role` | `render()` (buttons enable or disable) |
| Add note / Adjust / Sign off | `on.add(event)` | appends to `state.events`, `saveEvents()` | `render()` |
| Reset saved work (admin) | `on.reset()` | clears `state.events` | `render()` |

### 4. Following one number: `F1040.1a` (wages, 212,400)

This is the trail the whole app is built around. Each arrow is one function call.

```
picker row click
  └─ on.select('F1040.1a')                               main.js
       └─ setKey()                                       main.js
            ├─ traceClaim(index, 'F1040.1a')             trace.js
            │    ├─ index.current.byKey.get(...)         packetIndex.js   the line
            │    └─ resolveSource('ev-0016'), ('ev-0035')   trace.js      → the two W-2 values + their documents
            └─ claimChecks(index, trace)                 checks.js
                 ├─ tieOut()          104,600 + 107,800 = 212,400  ✓
                 └─ for each source value: sourceChecks()
                      ├─ printedMatch()    is "104,600.00" printed on D08 page 1?  ✓
                      ├─ confidence()      0.99  ✓ (with a reminder that a high score is not proof)
                      ├─ duplicateDoc()    D09 and D10 look identical  ! ← the engine note says "counted once"
                      └─ duplicatePage()   no repeated pages  ✓

renderClaim()     views/claim.js    shows the value, rule, sources, checks, what uses it, history
renderSource()    views/source.js   opens D09 and marks "107,800.00" on page 1
```

### 5. What a "source" can be: `resolveSource()` in `trace.js`

A line's `sources` list is not only documents. `resolveSource()` turns each reference string into an object with a `kind`, so the views never parse strings:

| Reference | `kind` | Shown in the right column as |
|---|---|---|
| `ev-0016` | `value` | the document, page and marked field |
| `qa-14`, `msg-07`, `call-01` | `client` | the client's question and answer, message or call notes |
| `py:/return_2024/...` | `prior` | the record from last year's return |
| `agency:/...` | `agency` | an IRS or FTB record |
| `ref:param.mileage_rate` | `param` | an engine parameter |
| `asset:SAC-APPL` | `asset` | the asset record |
| `household:ngozi` | `person` | the household record |
| `timeline:tl-20` | `event` | the timeline event |
| `doc:D30#page32` | `unread` | a warning that this page was never read |

### 6. Notes, adjustments and sign-offs: `events.js`

Nothing is overwritten. Every action is an **event** appended to a list. `saveEvents()` sends the list to the backend (`PUT /api/events`), which writes `backend/data/events.json`. A copy also goes in the browser's `localStorage` as a fallback when the backend is not running.

```
claim.js  actions()  builds an event with newEvent()          events.js
   └─ on.add(event)                                           main.js
        ├─ saveEvents()                                       events.js
        └─ render()
             └─ effectiveValue(line, events)                  events.js   engine value, or the latest adjustment
             └─ signoffState(line, events)                    events.js   'none' | 'signed' | 'reopened'
```

- The **engine value** is never edited. The **effective value** is the engine value unless an adjustment says otherwise. The middle column shows both.
- A **sign-off** records the value it covered. If the effective value later differs, `signoffState()` returns `reopened`.
- An **adjustment** needs a reason, and shows an estimated tax effect: the change × the packet's rate per dollar (`taxEffect()` in `events.js`). The packet says the engine cannot be rerun, so this is an estimate and is labelled as one.
- A sign-off is blocked when a check has failed and nobody has written a note about it.

### 7. Roles: `roles.js`

| Role | Name (from `packet.firm.staff`) | Can |
|---|---|---|
| Preparer | Priya Raman | add notes, adjust numbers |
| Reviewer | Daniel Ortiz | add notes, verify flagged checks, sign off |
| Partner | Helen Strand | add notes, verify flagged checks, sign off |
| Client | Ngozi Okafor | view only |
| Administrator | Jo Kimura | reset saved work |

`claim.js` disables a button the current role does not have and puts the reason in its tooltip. This is a prototype: roles are enforced in the interface, not by a server.

The full access design (including roles the prototype does not have yet) is in "Who can see and do what" below.

## Who can see and do what

The packet fixes some of these rules (cited below). The rest are design choices.
This is the target design. The prototype enforces only part of it, and only in the
browser (see "Known limits").

### What each role can see

| Role | Return numbers | Checks and warnings | Internal notes | Full SSNs, bank numbers, IP PINs | Adjustments and tax effect | Sign-off history |
|---|---|---|---|---|---|---|
| Preparer, with clearance | Yes | Yes | Yes | Yes, every view logged | Yes | Yes |
| Preparer, without clearance | Yes | Yes | Yes | Masked | Yes | Yes |
| Reviewer | Yes | Yes | Yes | Yes, every view logged | Yes | Yes |
| Partner | Yes | Yes | Yes | Yes, every view logged | Yes | Yes |
| Quality reviewer | Yes, read-only, from 2027-01-04 | Yes | Yes | Yes, every view logged | Yes | Yes |
| Client | Summary only | No | No | Own household only, masked | No | Signed off or not |
| Firm administrator | No | No | No | No (only if access is granted, and then logged) | No | No |

The firm's filing credentials (EFIN, ERO PIN, PTINs) are not part of the workpaper.
They belong on the e-file forms and the signed return.

### What each role can do

| Role | Adjust a number | Sign off | Change the firm's rules |
|---|---|---|---|
| Preparer (either kind) | Yes | No | No |
| Reviewer | No (writes a review note instead) | Yes, never on their own work | No |
| Partner | No (writes a review note instead) | Yes, and required for any adjustment with a tax effect over 1,000 | No |
| Quality reviewer | No, read-only | No | No |
| Client | No | Approves the return and authorizes e-file only | No |
| Firm administrator | No | No | Yes |

Why a reviewer or partner does not adjust: the packet says a person may not review or
sign off on work they prepared. A reviewer who changed a number would be reviewing their
own change, so they write a note and the preparer makes the change.

### Where the packet says so

- **Masking:** "Staff without sensitive-data clearance see SSNs, bank and account numbers and IP PINs masked; every unmasked view is logged." (`firm.starter_standards.rules`). Marcus Bell, a preparer, has `sensitive_data_clearance: false` and the note "no access to full SSNs or bank numbers"; Priya Raman has clearance.
- **No self-review:** "A person may not review or sign off on work they prepared."
- **Partner for large adjustments:** "Any adjustment with a tax effect over 1,000 (federal or state) requires partner sign-off."
- **Order of approval:** reviewer sign-off, then partner sign-off, then client approval and e-file authorization (`required_steps`).
- **Who changes the rules:** the standards "may be changed through the firm administrator role" (`starter_standards.note`).
- **Access starts on a date:** each person has `active_from`; the quality reviewer starts 2027-01-04 and selects the return that day (timeline `tl-27`).
- **Partner signs returns:** `firm_identity.paid_preparer_signing_returns` is the partner, Helen Strand.
- **Clients see a summary:** the client's message says "Reviewed the summary, looks good" (`client.messages`).
- **Left open by the packet:** it says reviews, notes and sign-offs are not included and are ours to design, so who sees internal notes and checks, and what a client sees, are design choices. They follow the usual practice that a client sees a summary and their own documents, not the firm's working file, and that an administrator manages access, not returns.

### What a server must decide, and what the browser can do

If the browser could lie about it, the server has to do it. If it is only how it looks, the browser does it.

| What | Where it belongs |
|---|---|
| Who the person is (login, role) | Server |
| Which claims and documents a person may see | Server |
| Masking SSNs, bank numbers, IP PINs | Server, before the data is sent |
| The sign-off rule (note needed, verification needed) | Server enforces; the browser also greys out the button and says why |
| Who may adjust, sign off or reset | Server enforces; the browser mirrors it |
| Running the checks | Server is the authority; the browser may show them instantly |
| Stamping each event with who and when | Server (name from the session, time from its own clock) |
| Colours, folding, layout | Browser |

Today the server only stores the packet and the list of events. Every rule above runs in
the browser, which is fine for a prototype and is the first thing to change.

---

## The data contract that matters: the locator

Every extracted value carries a **locator**: `{ documentId, page, field, label, textAsRead, position }`, built by `locatorFor()` in `trace.js`.

`views/source.js` has one function, `renderDocument()`, that draws a **simulated** document from the packet's `printed_content` and marks the field by finding the text that was read. The packet's `position` boxes are synthetic, so the simulated view shows them as text and does not draw with them.

**To use real documents:** replace `renderDocument()` with a function that renders the PDF page and overlays a rectangle from `locator.position`. Nothing else changes, because every number already carries a locator and every view reads it from there.

---

## What the checks catch

`checks.js` compares sources to each other and to the printed text. It does not use the engine's confidence score as proof. These are real problems in the packet that the app surfaces without being told where to look. Open each by typing the key in the search box or adding it to the URL, for example `http://localhost:3000/#F2441.1b`.

| Open this number | What the app shows | Why it is a problem |
|---|---|---|
| `F1040.1a` Wages | "Same issuer and the same figures as D10" | The Halvorsen W-2 was uploaded twice (a phone photo). Counted once, but nothing proved it. |
| `SchC.44a` Business miles | "Page 3 has the same figures as page 2" | The mileage log's page 3 is a second scan of page 2. The 3,700 miles are counted twice. |
| `F2441.1b` Care provider | The ID is marked in red: read `74-3829516`, printed `74-3829156` | Two digits swapped at 0.97 confidence. |
| `F8949.B.N1` RSU sale | "Nothing is printed in this field. The pipeline recorded 0." | RSU basis was blank and became $0, so tax would be paid twice on the vested value. |
| `SchA.11` Cash gifts | Low confidence (0.41) and the amount does not match the handwritten `$?,500.00` | The parish receipt could be 1,500 or 7,500. |
| `F8949.H.C6` Crypto lot | "The pipeline found no value for this field" | A lot with no cost basis. |

The left list has a **Needs attention** toggle that lists all lines with a warning or a failure.

Other problems in the packet (for example the Subaru valued at 6,000 when the charity sold it for 2,900, California wages taken from a W-2 that does not reflect the move, or an estimated payment of 4,000 where the IRS transcript shows 3,000) need comparisons between a line and the client's answers or the agency records. Those checks are not built in this slice.

---

## What is and is not here

**Built**
- Load the packet as delivered, from the backend or a file picker
- Trace any of the 627 lines in the current version (v3) to its sources, inputs and what uses it
- Document view with the field marked, page tabs, and where a document landed
- Checks: printed-text match, confidence, duplicate document, duplicate page, source tie-out
- Notes, adjustments with a reason and an estimated tax effect, sign-offs that reopen
- Role switcher with enforced permissions
- Safe rendering: packet text and notes are only ever put on the page as plain text (`createTextNode` in `dom.js`), never as markup. Nothing in `frontend/src` uses `innerHTML`; check with `grep -rn innerHTML frontend/src`, which should print nothing. `npm test` fails if it ever does.
- A flagged check that a reviewer or partner confirms with "Mark verified" (for example a possible copy of a document that no line uses)
- Sign-off rule: warnings and failures need a note; flagged checks need verification
- Checks on the adjusted value: the original tie-out stays, and a second warning says the adjusted value no longer matches its sources
- Passed checks fold under one line; long document pages fold into groups
- Saving on the backend; light and dark themes; phone width

**Not built yet** (all in the brief)
- Versions v1 and v2, "what changed since I last looked", compare, what-ifs
- Bulk actions with undo
- The timeline replay, extensions, e-file rejections, freezing at filing, amendments
- Client questions, assignments, deadlines, notifications
- Depreciation by asset, sales detail, books to tax, state split and the other area summaries as dedicated views (they are all reachable as lines)
- Checks against client answers and agency records
- Sensitive-data view logs, time against budget

**Known limits**
- The backend is a single file with a JSON file for storage: no users, no login, no locking. Roles are enforced in the interface only. A real system needs a database and real authentication.
- The sign-off rule (a warning or failure needs a note of at least 15 characters; a flagged check needs "Mark verified") and the role checks run in the browser only. It checks that a reason exists, not whether it is a good one; that is the reviewer's judgment.
- Not built from the access design: the preparer without clearance (masked SSNs), the quality reviewer and client views, view logging, and partner sign-off for adjustments over 1,000.
- Other people's changes appear on this screen after a reload or the next save. There is no live updating, because redrawing the page would lose half-typed notes.
- The estimated tax effect only has a rate mapped for wages and Schedule C gross receipts (`CATEGORY` in `events.js`).
- Google Fonts load from the internet. Offline, the page falls back to system fonts.

---

## How to extend it

| To add | Where |
|---|---|
| A new check | A function in `checks.js` returning `{ id, label, status, detail }`, then call it from `sourceChecks()` or `claimChecks()` |
| A new kind of evidence | A new branch in `resolveSource()` (`trace.js`) and a case in `renderRecord()` (`views/source.js`) |
| A tax-effect rate for another line | An entry in `CATEGORY` (`events.js`) |
| Another version of the return | `index.versions` already holds all three; `index.current` is the last. A compare view would read two of them |
| A new role or permission | `ROLES` in `roles.js` |

---

## How this was built

Built with Claude (Anthropic) as the coding assistant, working from the case-study brief and the packet README. Claude wrote the code and ran the tests and a headless-browser check against the real packet. The design idea, the choice of what to build first, and the review are mine. Replace this paragraph with your own account if it differs.
