# TrueSendr frontend

From this directory run npm start. The backend runs separately with npm start on port 5000.
Set REACT_APP_API_URL in .env to the backend origin (local default: http://localhost:5000); trailing slashes are normalized. Restart the dev server after changing .env.

src/utilities/api.js defines the shared API URL and formats backend errors, timestamps and statuses. src/utilities/apiAuth.js attaches authentication to backend requests only, handles expired sessions, and protects newer sessions from stale responses. src/utilities/downloads.js handles authenticated CSV downloads and API failures.

Signup/login issue a workspace session. On refresh GET /me verifies that session before protected screens load; connection errors allow retry without deleting the session. Logging out clears the saved workspace; changes from another tab trigger session revalidation.

Contacts, templates, blocklist, unsubscribe lists, campaign queue/progress, analytics and exports use backend response formats. Suppression searches preserve plus-addressed emails. Template previews use sandboxed frames. Test emails use the sender configured on the backend, with no hardcoded sender dropdown.

Send Now submits scheduleTime: null. Schedule submits a future ISO timestamp. Campaign acceptance means queued/scheduled, not that every message has already been delivered. Sending controls reflect workspace mail configuration. Backend AWS credentials must be configured separately.

Run npm test for UI/request contract tests. Run npm run build for a production bundle. No live emails are sent by the tests.

## Source layout

- `src/pages/`: login, contacts, campaigns, templates, blocklist, and unsubscribe screens.
- `src/component/`: reusable header, loader, template picker, test-mail dialog, and suppression list.
- `src/styling/`: application CSS.
- `src/assets/`: images.
- `src/tests/`: frontend tests.
- `src/App.js`: screen routes and session state.
- `src/index.js`: React entry point.
- `src/utilities/api.js`, `src/utilities/apiAuth.js`, `src/utilities/downloads.js`: shared API, session, and CSV helpers.
- `src/setupTests.js`: test environment setup.

## Email template editor

The template library offers four starting designs and proper create, rename, duplicate, and delete dialogs. The full-screen editor has content/layout blocks, a style and settings panel, inline rich-text editing, personalisation, image upload/URL insertion, undo/redo, desktop/mobile views, and an isolated preview with optional sample contact values. Save remains explicit; unsaved changes are protected on close and browser refresh.

TemplateEditor.js lives in src/component; its styles live in src/styling/TemplateEditor.css. Starter HTML and preview helpers are in src/utilities/templateContent.js. Preview sample data never changes saved placeholders. Update starter example links and the company postal address before sending.

Uploaded images are stored by the backend and require a publicly reachable PUBLIC_API_URL for use outside the local machine.

## Simple email layouts

The editor now uses named sections, columns, and independently wrapped content blocks. Use Email sections on the left to insert a one-, two-, or three-column section between existing sections. Select content and use the right-hand horizontal/vertical position controls, Centre both ways, height, and padding. Selecting a column exposes insertion before/after it; column widths rebalance equally, with up to four columns per section and at least one remaining column. Move, duplicate, delete, and undo work on the selected scope shown in the breadcrumb.

Vertical middle/bottom positioning adds a 160px container if its height is Auto; the height field can change or clear it. Saved HTML uses presentation tables and align/valign attributes instead of flexbox positioning. Simple existing body content is adapted locally when opened; its data is not changed until Save. Imported merged or multi-row tables retain their structure and do not expose the simple column tools.
