# AgeCheck Study

A working prototype of a disclosed simulation for an AP Research experiment. Participants try a scripted facial age check on a fictional social platform, **ConnectSpace**, and answer a short questionnaire. The only thing that varies is whether they are told **before** the check that a government ID might be requested, or only **after** the check cannot confirm their age.

The app never uses a camera or microphone, never collects or analyzes images, never asks for a real ID or any personal identifier, has no upload field, and shows no age estimate or confidence score. It is not an age-verification service.

It ships in **preview mode**. Real collection stays off until the researcher completes the study information, chooses a withdrawal policy and a storage configuration, and activates research mode in the dashboard.

## Run it

No build step. The frontend is plain HTML, CSS, and JavaScript modules.

```bash
node server/server.js
```

Then open <http://127.0.0.1:8080/> for the participant app and <http://127.0.0.1:8080/researcher.html> for the researcher dashboard. Any static file server also works for preview mode, for example `python -m http.server 8000` in this folder.

Useful preview-only URL parameters (ignored in research mode):

- `?condition=advance` or `?condition=later` forces a condition.
- `?failSubmit=1` makes the first submission fail so you can see the recovery message.
- `?reset=1` clears the current session and any unfinished answers (works in both modes; use it between participants on a shared device, or the "Start a new session" button at the end).

Tests need Node 20 or newer and `npm install` (it installs only the Playwright test runner; the end-to-end tests use the Microsoft Edge already on the machine):

```bash
npm test          # 99 unit and server tests
npm run test:e2e  # 51 end-to-end tests in a real browser
```

## Project layout

| Path | What it is |
|---|---|
| `index.html`, `src/app.js` | Participant app |
| `researcher.html`, `src/researcher.js` | Researcher dashboard: counts, filters, records, exports, data dictionary, deletion by code, demo data, configuration and activation |
| `src/study-config.js` | The versioned study configuration: every piece of wording, the questionnaire, eligibility, storage, and the checks a configuration must pass |
| `src/engine.js` | The session as a pure state machine, plus record building |
| `src/data-dictionary.js` | The single definition of every field and code, and the rule for what a store keeps when a record arrives twice or out of order; used by the app, the server, and the exports |
| `src/storage.js` | Demo, local-device, and remote-endpoint stores; unfinished answers; configuration loading |
| `src/summary.js` | The dashboard's counts, completion rates, and filters |
| `src/demo-data.js`, `src/export.js` | Synthetic demo records; CSV and JSON export |
| `server/server.js` | Reference backend with no dependencies: static serving, validated submissions, token-protected admin API |
| `tests/` | Unit, server, and end-to-end tests |
| `tools/` | Regenerates the data dictionary document and the screenshots |
| `docs/` | Experimental logic, data dictionary, storage limitations, hosting, approval checklist, testing summary, screenshots |

## How the experiment works

See [docs/EXPERIMENTAL_LOGIC.md](docs/EXPERIMENTAL_LOGIC.md). In short: eligibility, assent, random 1:1 assignment at assent, the scenario, the verification screen (the only screen that differs), a fixed three-second simulated check, the same uncertain result and ID request for everyone who started, a skippable questionnaire for everyone still in the study, and a debrief with a response code. Withdrawal is a separate control from declining the platform's verification.

Unfinished answers are kept in the browser tab so a refresh, the Back button, or the withdrawal dialog cannot lose them. They are never sent anywhere and never become part of a record unless the participant submits. Any single-choice answer can be cleared back to blank.

## Data

See [docs/DATA_DICTIONARY.md](docs/DATA_DICTIONARY.md). Records contain only approved fields: a random response ID and code, study version, condition, whether the assigned screen was displayed, the initial decision, whether the uncertain result and ID prompt were reached, the ID-stage decision, the final pathway, submission and questionnaire status, each questionnaire item stored separately, and relative timings between steps. Missing data is coded explicitly as `not_reached`, `skipped`, `missing`, `not_applicable`, `disabled`, `not_collected`, or `withheld`. No absolute timestamps are stored.

The record is saved at every milestone, including when the assigned screen is displayed and when the ID prompt is reached, so someone who leaves on a screen is still recorded as having reached it. There is always exactly one record per response. Newer progress replaces older, a late save never undoes it, and a withdrawal replaces everything.

## Storage and access

See [docs/STORAGE_AND_ACCESS.md](docs/STORAGE_AND_ACCESS.md). Preview mode writes only clearly marked demo records. Research mode offers local-device storage (one device only; a participant on another device is not collected anywhere) or the reference server (works across devices; tokens live in environment variables; records are validated server-side). Each store refuses records of the other kind, and the server accepts nothing until a valid research configuration has been deployed to it. If a save fails, the participant is told and the app retries; it never claims a save that did not happen. Hosting providers may log IP addresses, so do not promise anonymity until that is checked.

Reference server environment variables:

```bash
AGECHECK_SUBMIT_TOKEN=<long random string>   # shared by participants' browsers; write-only
AGECHECK_ADMIN_TOKEN=<different long string> # researcher only; never in the frontend
AGECHECK_DATA_DIR=server/data                # gitignored
AGECHECK_ALLOWED_ORIGIN=https://...          # only if the static app is hosted elsewhere
HOST=127.0.0.1 PORT=8080
```

## Hosting

See [docs/HOSTING.md](docs/HOSTING.md). GitHub Pages can host the static app (preview mode and in-person local-device sessions) but cannot run the server, so collecting from participants' own devices needs the reference server on a host that runs Node with persistent storage.

## Before collection

See [docs/APPROVAL_CHECKLIST.md](docs/APPROVAL_CHECKLIST.md). Research mode cannot be activated while any required study information is empty or still a placeholder, the version is a draft, the withdrawal policy has not been chosen, or storage is not configured. The same checks run wherever a configuration enters the app: saving, importing, a served `study.config.json`, and the server. A configuration that fails them stops the app instead of running participants. The configuration freezes on activation; the server refuses configuration changes once research records exist.

## Tests performed

See [docs/TESTING.md](docs/TESTING.md). All 99 unit and server tests and all 51 end-to-end tests pass. They cover the six pathways, refresh and back navigation, duplicate clicks, withdrawal (including during a pending submission and when its save fails), unfinished answers, milestone saves, storage failures and retries, configuration checks, identical layout of the two conditions from 320 to 1000 pixels and with enlarged text, keyboard-only use and dialog focus, the absence of camera, microphone, file inputs and third-party requests, the dashboard's rates, filters and exports, and research-mode gating.

## Assumptions and defaults

- Eligibility defaults to ages 16 and 17 as single-year categories; the range is configurable before activation.
- Recruitment codes and demographic items are off by default.
- The withdrawal policy has no default. The researcher must choose it before activation. Until then, preview mode withholds a withdrawn participant's responses, the more protective choice.
- The questionnaire items are custom draft items, not validated scales, and are stored item by item with no composite score.
- The simulated check lasts 3,000 ms for everyone.
- The study information wording is placeholder text that the researcher must replace; the app does not claim any approval and does not supply contacts or policies.
- The fictional platform uses a neutral design with no real platform's branding.
