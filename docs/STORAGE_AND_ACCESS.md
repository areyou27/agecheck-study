# Storage and access-control limitations

Read this before choosing a storage configuration and before writing the "data storage" paragraph of the study information.

## The three modes

| Mode | Where records go | Works across devices? | Who can read them |
|---|---|---|---|
| Preview (default) | The demo store in the browser's local storage, marked `preview_walkthrough` or `synthetic_demo` | No | Anyone using that browser |
| Research, local-device | The research store in **that browser's** local storage | **No.** A participant on their own phone is not collected anywhere. | Anyone using that browser, including the next participant if the dashboard is opened on it |
| Research, remote-endpoint | The reference server's data directory (`server/data/records.json`) | Yes, while the server is reachable | Whoever holds the admin token, plus whoever can read the server's file system |

Demo and research records use different storage keys, different dashboard views, and different export file names. Each store also refuses records of the other kind: the research store takes only `research` records of its own study version, and the demo store takes only preview and synthetic records. A session that began in preview mode is dropped when research mode becomes active, so it cannot continue as a research record.

## What stays in the participant's browser tab

Two things live in the tab's session storage and are gone when the tab closes:

- **The session**: the step, the assigned condition, the choices made. This is what lets a refresh or the Back button return to the same step with the same condition.
- **Drafts**: answers typed or selected but not yet submitted, on the eligibility form, the assent checkbox, and the questionnaire. Drafts are never sent anywhere and never become part of a record unless the participant submits. They are cleared when the answers are submitted, when the participant withdraws, when an ineligible visitor exits, and when another participant starts.

## How a record is saved

- The record is created at assent and saved again at each milestone: the assigned verification screen displayed, the initial decision, the uncertain result and ID prompt reached, the ID decision, the questionnaire submitted, a withdrawal.
- Saves go out one at a time and always carry the record as it stands when the save actually runs. A slow or failed request is therefore never followed by an older one.
- Every store applies the same rule to anything that still arrives late or twice: newer progress replaces older, and an older save is ignored. There is always one record per response.
- If a save fails, the participant sees a notice that their progress has not reached the study's records, can keep going, and can retry. The next milestone retries by itself. The app never reports a save that did not happen.
- If the questionnaire's save fails, the answers stay on the page with a "Try again" button. Until a save succeeds the record stays `in_progress`.
- Stored records that cannot be read (a damaged file or damaged browser storage) are reported as an error. They are never treated as "no records" and never overwritten.

## Withdrawal

- Withdrawing ends participation immediately, including while a questionnaire submission is still being saved.
- A withdrawal takes precedence over everything: it replaces an in-progress or submitted record, and no later or delayed save can replace it. This holds in the browser's stores and on the server, in whichever order the requests arrive.
- The withdrawal policy chosen in the configuration is applied in three places, so they cannot disagree: when the app builds the record, when a browser store keeps it, and when the server keeps it. With "withhold", decisions, answers, timings, and any recruitment code become `withheld`, and what remains is the fact of withdrawal, the condition, and the step reached. With "keep partial responses", the record keeps what was given, marked withdrawn; questionnaire answers are kept only if the participant had pressed Submit.
- The withdrawn screen says which state the save is in: being saved, saved, or not saved yet. If it has not been saved, the participant can retry, the page retries by itself when reopened, and the response code is shown so the researcher can remove the record by hand. "Start a new session" appears only once the withdrawal is saved.
- **Limit:** if a withdrawal's save keeps failing and the participant closes the tab, the stored record stays in its last saved state. The response code is the fallback: delete the record by code in the dashboard.

## Local-device mode

Use only for in-person sessions on a device the researcher controls.

- Browser local storage is per browser profile. Clearing site data, using a private window, or switching browsers hides or removes the records.
- Export after every session and store the export where the approved plan says.
- The researcher dashboard on the same device shows research records without any password. Do not leave the device unattended with the dashboard open, and do not use a shared or school-managed device whose storage others can inspect.
- Nothing leaves the device, so there is no server log and no IP address recorded by this app. The device itself may still keep browser history.

## Remote-endpoint mode (the reference server)

`server/server.js` is a small Node server with no npm dependencies. It serves the static app and provides:

- `POST /api/submit`, which requires the shared **submit token** (`X-Study-Token` header). The token is shipped to participants inside the served configuration. It only allows writing a record. It cannot read, list, or delete anything.
- `GET /api/admin/records`, `DELETE /api/admin/records/<code>`, `GET|PUT /api/admin/config`, which require the **admin token** as a Bearer token. Enter it in the dashboard; it is kept in that tab's session storage only and never written into any page or file.
- **A configuration gate.** The server accepts no record until a valid research configuration has been deployed to it, and it rechecks that configuration on every submission. A configuration is refused if any required study information is empty or a placeholder, the version is a draft, the withdrawal policy is not chosen, the storage is not the remote endpoint, or its submit token does not match the server's own.
- Server-side validation of every record against the data dictionary. Unknown fields, bad values, demo records, and records for the wrong study version are refused.
- The record precedence and withdrawal policy described above.
- A body size limit (32 KB), a per-address request limit kept only in memory, and atomic file writes.
- Security headers on every response, including a `Permissions-Policy` that blocks camera and microphone, and a Content Security Policy that allows only same-origin scripts and connections.

The tokens come from environment variables (`AGECHECK_SUBMIT_TOKEN`, `AGECHECK_ADMIN_TOKEN`). They are never in the frontend code or the repository. `server/data/` is gitignored.

### Limitations you must disclose or fix before collection

- **Hosting logs.** This server logs only method, path, status, and duration. Your hosting provider, reverse proxy, or tunnel almost certainly logs IP addresses and timestamps for every request. Find out what it keeps and for how long, and say so in the study information. Do not promise anonymity until you have checked.
- **Transport.** Serve over HTTPS. Over plain HTTP the submit token and every record cross the network unencrypted.
- **One shared submit token.** Anyone who extracts it from the served configuration could post fabricated records. Mitigations: a long random token, HTTPS, the rate limit, and inspecting exports for implausible records. This is a limitation of any browser-only study instrument without accounts.
- **The dashboard page is public but powerless.** `researcher.html` contains no secret. In remote mode every data request is authenticated by the server. It is still better not to advertise the URL.
- **Backups.** `records.json` is a single file. Keep a copy per the approved retention plan and delete it per the approved schedule.
- **No encryption at rest** beyond the operating system's. If the host is shared, treat the data directory accordingly.
- **Free text.** `q_open_influence` can contain whatever a participant typed. Review it before sharing an export.

## Configuration deployment

The participant app looks for its configuration in this order:

1. `study.config.json` served next to `index.html` (a file you place there, or the reference server serving the configuration pushed through the dashboard).
2. The configuration saved in that browser by the researcher dashboard.
3. The built-in defaults (preview mode).

Whichever it finds is checked before use, with the research-mode checks if it claims research mode. A configuration that fails stops the app with a plain "not available" message. It does not fall back to the next source, because that would hide a broken deployment. Visitors to a deployed page are shown no setup details; the reasons are written to the browser console and shown in the dashboard.

Participants on their own devices only ever hit option 1 or 3, so a deployed site cannot slip into research mode without a deployed file. The served configuration includes the submit token on purpose, since participants' browsers need it to submit.

Once research records exist on the server, `PUT /api/admin/config` is refused. To revise the study, export and remove the data, or start a new data directory with a new study version.

## What is never stored

Names, email addresses, birth dates, addresses, student IDs, government IDs, images, device identifiers, absolute timestamps, draft answers that were never submitted, and the answers of anyone who was ineligible or did not agree to take part. The app never requests camera, microphone, or location access and has no file-upload field.
