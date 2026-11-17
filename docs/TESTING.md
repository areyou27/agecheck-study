# Tests

Two layers. Both run from the project root after `npm install` (which installs only the Playwright test runner).

```
npm test          # engine, configuration, stores, summary, and server tests (node --test)
npm run test:e2e  # end-to-end tests in the real app with Playwright and Microsoft Edge
npm run test:all  # both
```

The end-to-end suite starts two copies of the reference server itself, each with a throwaway data directory in the system's temporary folder:

- port 4173, as shipped: no tokens and nothing deployed, so the app runs in preview mode
- port 4174, a research server with test-only tokens, so saving, withdrawal, and failures are tested against real requests that the tests can hold or fail in flight

It uses the Edge that is already installed on Windows and macOS (`channel: "msedge"` in `playwright.config.js`). To use Chromium instead, run `npx playwright install chromium` and change the channel.

## Unit and server tests

99 tests in `tests/engine.test.js`, `tests/storage.test.js`, and `tests/server.test.js`.

**Engine and records**
- Age categories from the approved range; ineligible and non-consenting visitors leave no record.
- Random assignment at about 1:1 from an injected source; the condition survives serialization; forced conditions work only in preview mode.
- All six condition-by-pathway flows, with every field checked against the data dictionary.
- Coding of `skipped`, `missing`, `not_reached`, `not_applicable`, `disabled`, `not_collected`, and `withheld`; an abandoned session is `incomplete_session` and never a refusal.
- The displayed-screen milestone is reported exactly once.
- Double submits, failed saves with a retry that sends the answers as they stand then, and a reload during a save.
- Relative timings with no absolute timestamp in the record.

**Withdrawal and record precedence**
- Withdrawal as its own pathway under both retention policies; the policy is unset by default and unset behaves as withholding.
- Withdrawing while a submission is being saved ends participation and withdraws the record; the pending save finishing or failing afterwards changes nothing.
- The withdrawal's save state (pending, saved, failed) is tracked apart from the withdrawal itself.
- Each milestone outranks the one before; a late save never undoes newer progress; a withdrawal replaces a submitted record in whichever order they arrive; nothing replaces a withdrawal.
- A store applies the withholding policy even when the sender did not, and withholding gives the same record whether the app or a store does it.

**Sessions**
- A preview session is not restored under research mode and cannot give assent under it, so it can never become a research record; a session does not carry over to another study version.

**Configuration**
- The defaults are structurally valid but cannot be activated.
- Each of the ten required study-information fields, emptied to nothing or to white space, blocks activation on its own.
- The withdrawal policy must be chosen, not defaulted.
- Structure: mode, version, storage, age range, simulation timing, text fields, questionnaire items and codes, scale, options, demographics.
- A configuration from outside is parsed and checked in its own mode; claiming research mode does not skip the checks.

**Stores (in-memory browser storage)**
- Local stores: a withdrawal after a submitted record, a submission after a withdrawal, older progress arriving late, duplicates, and the withholding policy.
- The research store refuses preview and synthetic records and other study versions; the demo store refuses research records.
- A refused write rejects with a clear message; unreadable stored records are an error and are never overwritten.
- The remote store reports the server's own message and unreachable servers.
- Drafts live in the tab's session storage, apart from the session and from records.
- Configuration loading: nothing served, a valid served file, a served file with emptied information (reported, not bypassed by a good saved copy), files that are not configurations, and the browser's saved copy.

**Dashboard summary**
- "Excluding withdrawn" takes numerator and denominator from the same non-withdrawn records.
- The same counts come out whichever withdrawal policy wrote the records.
- Empty groups read "no records", not 0% or NaN.
- Filters by condition, pathway, status, and study version, alone and combined.

**Server**
- Security headers, allow-listed static files, every module the pages import is served.
- Nothing is accepted until a valid research configuration is deployed: no configuration, a preview configuration, and eight kinds of invalid research configuration (placeholders, emptied information, policy not chosen, draft version, local-device storage, a submit token the server would refuse, a broken questionnaire, an unknown mode). A configuration file edited into an invalid state closes collection again.
- Token checks, dictionary validation, demo records and other versions refused, duplicates, milestones out of order, concurrent saves, oversized bodies.
- A withdrawal withdraws the record whether it arrives after or before the submission; the server withholds responses even when the browser sent them; with the policy set to retain, partial responses are kept.
- An unreadable record file is an error and is not overwritten.
- Admin token, deletion by code, configuration freezing.

## End-to-end tests

51 tests in `tests/e2e.spec.js` (the study flow) and `tests/regression.spec.js` (problems found and fixed).

**Study flow (16)**
- All six condition-by-pathway combinations, each checking the stored record field by field, that the notice is visible only in the advance condition and absent from the accessibility tree in the later one, which questionnaire items appear, that no choice is preselected, and that the two decision buttons have the same size.
- Refresh, Back, and a reload during the simulation keep the condition and step.
- Double clicks on every decision button and on Submit produce one record.
- Withdrawal is recorded as `withdrawn`, never as a decline, and reports that it was saved.
- A failed submission shows a recovery message, keeps the answers, claims nothing, and a retry succeeds with one record.
- A full pathway using only the keyboard, including clearing an answer.
- A 360 by 640 phone viewport with touch.
- No camera, microphone, or permission API is ever called; no file input; no third-party request.
- Research mode: a configuration that fails its checks never runs participants; local-device research records stay apart from demo records.

**Regression (35)**
- Drafts: questionnaire answers survive the withdrawal dialog (cancel button and Escape), a refresh, and Back; they are not in the record until submitted; eligibility and assent forms survive a refresh; an ineligible visitor's draft is dropped; drafts are cleared on withdrawal and for the next participant.
- Clear answer: appears only when there is an answer, takes no extra room when it appears, clears to blank, and a cleared item is stored as `skipped`.
- Withdrawal dialog: focus starts on the cancel button, Tab and Shift+Tab never leave it, the page behind does not respond, Escape and Cancel close it and return focus to the control that opened it, and confirming by keyboard works.
- Milestones: the displayed screen and the ID prompt are saved as soon as they are reached.
- Storage failure in the browser: shown to the participant, the flow continues, and one retry saves the newest progress.
- Layout: buttons, notice space, and frame are in the same place in both conditions at 320, 375, 414, 768, and 1000 pixels and with text at 150% and 200%, within half a pixel; the hidden spacer cannot be seen, selected, or read by assistive technology; every screen fits a 320 pixel phone at 200% text with no clipped button.
- Configuration: a served configuration that fails its checks stops the app and shows visitors no setup details; a valid served research configuration runs; a preview session left in a tab starts over under research mode and never lands in the research store; a session does not carry over to a new study version.
- Dashboard: checking requirements, a refused activation, a failed save, a tab switch, and a refresh all keep unsaved edits; activation is refused while required information is empty or the policy unchosen; imports are validated and a failing research configuration comes in as preview; the "excluding withdrawn" rate and empty groups; refresh, filters, and export scope and file names.
- Against the research test server: milestones reach the server as they happen; withdrawing while a submission is held in flight; a withdrawal whose save fails, is retried, and survives a reload; failed progress saves that recover with the newest state; a slow save never overtaken by an older one; a failed submission retried as one record; the server refusing records once no valid research configuration is deployed.

## Last run

All 99 unit and server tests and all 51 end-to-end tests passed on Windows 11 with Node 24 and Microsoft Edge.

## Not covered automatically

- Screen-reader output. Headings receive focus on each screen, errors use `role="alert"`, the dialog is a native modal, and the hidden spacer is checked against the browser's accessibility tree, but no assistive technology was run.
- Real phones. Layout is tested in desktop Edge at phone sizes and enlarged text, not on physical devices or in Safari.
- Two tabs of the same participant session at once. Saves are ordered within one tab; across tabs the stores' precedence rule still applies.
- Real-world hosting logs. See `docs/STORAGE_AND_ACCESS.md`.
