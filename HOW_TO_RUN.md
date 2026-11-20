# Run Scam Saver in VS Code

This guide explains how to start Scam Saver locally on macOS. The Node.js backend also serves the website files, so you do not need a separate frontend server.

## 1. Open the project

1. Install [Node.js](https://nodejs.org/) and [Visual Studio Code](https://code.visualstudio.com/) if they are not installed.
2. In VS Code, choose **File → Open Folder…** and open this Scam Saver project folder.
3. Choose **Terminal → New Terminal**. The terminal should be at the project root, where `package.json` is located.



## 2. Install project dependencies

Run this once from the project root:

```bash
npm install
```

## 3. Configure environment variables

Create your private environment file:

```bash
cp .env.example .env
```

Open `.env` in VS Code and set the values you need:

- `MONGODB_URI`: local MongoDB is `mongodb://127.0.0.1:27017/scam-saver`; for Atlas, include the intended database name at the end of the URI (for this project, `/Scam-Saver`).
- `JWT_SECRET`: replace the example with a long random secret. On macOS, generate one with `openssl rand -base64 32`.
- `ADMIN_PASSWORD`: set the password for the password-only Admin Panel login. `ADMIN_EMAIL` and `ADMIN_NAME` provide the displayed administrator identity; an admin MongoDB account is not needed to sign in.
- `GEMINI_API_KEY`: add your Gemini API key here if you want to use SCAM SAVER AI. Keep `.env` private; it is excluded from Git.
- `PORT`: defaults to `3000`.

Do not paste real keys or passwords into `.env.example` or commit `.env` to GitHub.

## 4. Start MongoDB

MongoDB is needed for database-backed features. The website and password-only Admin Panel sign-in can start without a MongoDB connection. Start MongoDB before using reports, account data, and admin review actions.

### Local MongoDB

If MongoDB Community Server is installed as a Homebrew service, start it in a VS Code terminal:

```bash
brew services start mongodb-community
```

The exact Homebrew service name can vary with the MongoDB version you installed. Check the MongoDB installation instructions if that command is not recognized. You can verify the default local connection using:

```bash
mongosh "mongodb://127.0.0.1:27017/scam-saver"
```

Exit the MongoDB shell with `exit`.

### MongoDB Atlas

If using Atlas, there is no local MongoDB server to start. Set `MONGODB_URI` in `.env` to the Atlas connection string, and make sure the Atlas database user and network access settings allow your computer to connect.

## 5. Optional development demo records

To add the clearly labeled fictional sample businesses and reports to a development database, run:

```bash
npm run seed
```

`npm run seed` does not delete existing users or reports and does not create an administrator. Demo reports contain no uploaded evidence. Never attach synthetic media as if it were evidence from a real user.

Regular users can register through the website’s **Create account** page.

If you are moving existing local data into Atlas, the migration checks are `npm run migrate:check` followed by `npm run migrate:local`. The importer requires a verified pre-migration backup, preserves existing records, and is safe to rerun. It imports database documents and relationships only; evidence files remain private files under `backend/uploads` and must be moved separately if the app runs on another machine.

Evidence files are stored privately under `backend/uploads` by default. A local server restart does not remove them. For Render, attach a persistent disk mounted at `/var/data` and set `UPLOAD_DIR=/var/data/uploads` in that service's environment; copy existing upload files and the `quarantine` directory into the mounted path before switching over.

## 6. Start Scam Saver

In a new VS Code terminal at the project root, run:

```bash
npm start
```

Wait for the terminal to show that Scam Saver is running. If MongoDB is unavailable, the server logs that database-backed features are offline; password-only Admin Panel sign-in remains available. Leave this terminal open while using the site. For development with automatic server restarts after backend code changes, run:

```bash
npm run dev
```

## 7. Open the website

Visit this address in your browser:

```text
http://localhost:3000
```

The backend serves the frontend pages and API from the same server. Do not open the HTML files directly from Finder; use the `localhost` address.

## Stop or restart the servers

- Stop Scam Saver with **Control + C** in the terminal running `npm start` or `npm run dev`.
- If MongoDB was started with Homebrew, stop it with `brew services stop mongodb-community` (adjust the service name if needed).
- If you edit `.env`, restart Scam Saver so Node.js reloads the new values.

## Common issues

- **MongoDB connection failed:** start the local MongoDB service, or check that the Atlas URI and access settings are correct.
- **Port 3000 is already in use:** stop the other Scam Saver server before starting another one.
- **AI is not configured:** set `GEMINI_API_KEY` in the project-root `.env` file and restart the backend. AI responses also depend on the Gemini project having available API quota.
- **Run the automated checks:** from the project root, run `npm test`.
