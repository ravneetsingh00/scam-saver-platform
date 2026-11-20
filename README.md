# SCAM SAVER

**Stay Alert. Stay Protected.** Scam Saver is a lightweight fraud reporting and business signal platform built with vanilla HTML/CSS/JavaScript, Node.js, Express, MongoDB and Mongoose. Reports are private to their submitter and authorized administrators while pending. Only verified report summaries are shown publicly. Community report counts and risk labels are informational signals, not proof of fraud or wrongdoing.

## Requirements

- Node.js 18+
- MongoDB 6+ (local service or MongoDB Atlas)
- npm

## Install and run

1. From the project root, install dependencies:

   ```bash
   npm install
   ```

2. Create the environment file:

   ```bash
   cp .env.example .env
   ```

3. Set `MONGODB_URI`, `JWT_SECRET`, `CLIENT_ORIGIN`, and admin credentials in `.env`. To enable the AI Investigation Assistant, also set `OPENAI_API_KEY` to an API key from your OpenAI API project. Keep the key only in backend `.env`; it is never sent to the browser. `OPENAI_MODEL` defaults to `gpt-4.1-mini` and can be changed to a model enabled for your API project. Web search and model usage can incur API charges. Without a key, the rest of the app works and the assistant displays setup guidance. Use a long, unique random JWT secret and a strong admin password. For a local MongoDB install, the default URI is `mongodb://127.0.0.1:27017/scam-saver`. For Atlas, use the connection string supplied by your cluster and allow the development machine's IP in Atlas network access.

4. Start MongoDB. For example, with Homebrew on macOS: `brew services start mongodb-community` (the exact service name depends on your installed MongoDB version). Confirm your database is reachable before continuing.

5. Seed fictional demo records:

   ```bash
   npm run seed
   ```

   The seed script adds or updates fictional demo businesses and reports without deleting existing users or reports. It uses an existing account and does not create an administrator. Run it only against a development/demo database; the records are clearly marked fictional.

   Fictional demo reports intentionally contain no uploaded evidence. Do not attach synthetic files to demo businesses; upload evidence only with a real test report or a user's genuine submission.

6. Start the application:

   ```bash
   npm start
   ```

7. Open [http://localhost:3000](http://localhost:3000).

The Express process serves the frontend and `/api` from the same origin. Run `npm test` for report schema and case PDF checks. Use `npm run dev` for automatic restarts while developing.

For a safe local-to-Atlas recovery, `npm run migrate:check` performs a read-only preflight, then `npm run migrate:local` imports source users, businesses, reports and investigations into the explicitly named `Scam-Saver` database with original IDs and relationships. The importer requires the protected `.local-backups` pre-migration backups, refuses conflicting IDs or natural keys, uses insert-only upserts, and can be rerun without duplicating records. It does not copy evidence into MongoDB: files remain under `backend/uploads` and must be copied separately to persistent storage when deploying to another machine.

Evidence files are private and are served only through authenticated report endpoints; the upload directory is never exposed as static public content. Local development uses `backend/uploads` by default, which persists across local server restarts. On Render or another host with ephemeral storage, attach a persistent disk (for Render, for example, mounted at `/var/data`) and configure the backend environment variable `UPLOAD_DIR=/var/data/uploads`. Copy any existing upload files, including the `quarantine` subdirectory, into that persistent directory before switching the configured path. No MongoDB schema migration is needed for evidence metadata.

## Demo accounts

The admin email and password are the values you set as `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env`. The seed script creates three fictional user accounts:

- `demo1@scamsaver.test` / `DemoPass123!`
- `demo2@scamsaver.test` / `DemoPass123!`
- `demo3@scamsaver.test` / `DemoPass123!`

The seed creates eight fictional businesses and ten fictional reports. Demo content is explicitly marked in the database with `isDemo` and descriptions identify it as fictional.

## Features

- Registration, bcrypt password hashing, JWT authentication and user/admin authorization
- Business search by name, owner, category or location; detail page with verified report summaries
- Five-step private fraud case filing with structured entity, incident, narrative, complaint and reporter details; drafts; duplicate suggestions; generated case IDs; timeline and case PDF export
- User case tracking with review history and additional-information replies; the admin review dashboard supports Needs Information, Under Review, Verified, Rejected and Cancelled decisions, full case/evidence review, moderation history, deletion with evidence cleanup, status/search filters, and PDF summaries
- Authenticated AI Investigation Assistant using the OpenAI Responses API and web search, plus an optional report-writing assistant that drafts neutral incident wording and requires explicit reporter approval
- The AI investigation workflow searches only public business information and never sends reporter identity or submitted report descriptions; it separates sourced facts from public claims and warning signs and does not make guilt/safety determinations. The optional report-writing assistant sends the reporter-provided narrative to OpenAI with `store: false` to create wording; the UI warns users to remove names/private details first, and sensitive contact and credential patterns are scrubbed server-side.
- MongoDB connection failure logs setup guidance while allowing the website and environment-password admin sign-in to start; database-backed features remain unavailable until MongoDB connects
- Basic API rate limiting for authentication, Helmet headers and configurable CORS

## API overview

- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`
- `GET /api/businesses`, `GET /api/businesses/:id`; business create/update/delete require admin authentication
- `POST /api/reports`, `PATCH /api/reports/:id/draft`, `POST /api/reports/:id/submit`, `POST /api/reports/duplicates`, and `POST /api/reports/assistant/organize` require user authentication
- `GET /api/reports/my`, `GET /api/reports/:id`, `GET /api/reports/:id/pdf`, and private evidence endpoints are scoped to the submitting user or an administrator. `POST /api/reports/:id/response` lets the reporter answer a Needs Information request. Admin-only report listing and `PATCH /api/reports/:id/status` support moderation history.
- Evidence is private, served only through authenticated case endpoints, and removed with its case when an admin deletes it
- `GET /api/admin/stats`, `GET /api/admin/users`, and `GET /api/admin/reports.pdf` require admin authentication. The stats endpoint includes report status counts, the last six months, and report-type totals.
- `POST /api/investigations`, `GET /api/investigations`, `GET /api/investigations/:id`, `POST /api/investigations/:id/chat`, and `GET /api/investigations/:id/pdf` require user authentication and are scoped to the signed-in user's records.

## Security and operational notes

- Never commit `.env`; `.gitignore` excludes it. Do not use the example admin password in a deployed environment.
- Uploaded evidence accepts up to five JPG, PNG, WEBP, PDF, MP4, WebM, MOV, MP3, M4A, WAV or OGG files, 20 MB each. Images, video and audio can be previewed in the private case views. File signatures are checked and files are stored privately under `backend/uploads`, served only through authenticated routes. Back up this directory if you need to retain evidence. For production, use private object storage and HTTPS.
- Configure `CLIENT_ORIGIN` to the exact trusted frontend origin when hosting frontend separately. The default same-origin app uses `http://localhost:3000`.
- The existing account system does not verify email ownership; the filing form uses the signed-in account email and clearly identifies that limitation. Add an email-delivery verification workflow before treating account email as verified. Drafts and allegations remain private to their reporter and authorized moderators.

## Admin panel and local password

Use the **Admin Panel** link in the site header to open the password gate. The password is requested for every panel entry, including a refresh or direct URL visit. Admin sign-in compares the submitted password with `ADMIN_PASSWORD` from the project root `.env` and does not require an administrator record in MongoDB. The login is rate limited to five failed attempts per 15-minute window. A signed, short-lived admin token is issued after a successful comparison, and admin API routes continue to enforce the admin role. MongoDB is still required for database-backed admin pages and actions; the web server and password check can start while MongoDB is unavailable.
