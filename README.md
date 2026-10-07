# Task & Grocery Dashboard (Flask + SQLite + Docker)

A Flask app that serves the Task & Grocery dashboard. Tasks and groceries
are stored server-side in **SQLite** via a small REST API. EmailJS settings
are read **only from the `.env` file** — they aren't stored in the database
or editable in the UI.

## Project structure

```
task-grocery-app/
├── app.py                 # Flask app: page route + REST API + SQLAlchemy models
├── requirements.txt
├── Dockerfile
├── docker-compose.yml
├── .dockerignore
├── templates/
│   └── index.html         # Page markup (Jinja-served)
├── static/
│   └── app.js              # Client-side logic — fetches/saves state via the REST API
└── data/                   # Created automatically — holds app.db (SQLite file)
```

## What changed from the localStorage version

- On page load, the client calls `loadState()`, which fetches
  `GET /api/state` instead of reading `localStorage`.
- Every mutation (add/complete/extend/delete/restock task or grocery item)
  still updates the in-memory `tasks`/`groceries` arrays exactly as before,
  then `saveData()` sends the whole updated arrays to `PUT /api/state`,
  which replaces the corresponding SQLite tables in one transaction.
- EmailJS settings come only from `.env` (see Configuration below). The
  page shows a read-only status card saying whether email alerts are on.
- Each grocery item has a **stock %**. Set it when adding an item
  ("Current Stock (%)", default 100) and change it any time with the %
  box next to the item (type a value, press Enter). "Restock" sets it back
  to 100%. The low-stock alert fires at 20% remaining.
- The "Create & Connect File" / "Open Existing File" buttons (File System
  Access API) are gone — persistence is automatic and server-side now, and
  works in any browser, not just Chromium.
- A status pill in the header ("💾 Synced to SQLite" / "Saving…" / a save
  error) replaces the old file-connection indicator.
- The .TXT / .DOCX export buttons are unchanged — they still export
  whatever is currently loaded in the browser.

## Run locally (no Docker)

```bash
python -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Visit http://localhost:5000 — a SQLite file is created at `data/app.db`.

## Run with Docker

```bash
docker build -t task-grocery-app .
docker run -p 5000:5000 --env-file .env -v task-grocery-data:/app/data task-grocery-app
```

The `-v` flag mounts a named volume so your data survives container
restarts/rebuilds. Without it, the database lives only inside the container
and is lost when the container is removed.

## Run with Docker Compose (recommended)

```bash
docker compose up --build
```

This creates and mounts a `db-data` named volume for `/app/data`, so the
SQLite file persists across `docker compose down` / `up` cycles (it's only
removed if you run `docker compose down -v`).

Visit http://localhost:5000.

## REST API reference

| Method | Path                 | Purpose                                              |
|--------|----------------------|-------------------------------------------------------|
| GET    | `/api/state`         | Returns `{ tasks, groceries, emailConfig }`            |
| PUT    | `/api/state`         | Replaces all tasks/groceries with the given arrays     |
| GET    | `/healthz`           | Health check (used by Docker's `HEALTHCHECK`)          |

`PUT /api/state` expects:
```json
{
  "tasks": [
    {
      "id": "1234567890",
      "title": "Submit report",
      "dueDate": 1780000000000,
      "interval": "none",
      "repeat": "none",
      "status": "active",
      "expiredAlertSent": false,
      "lastReminderSent": 0
    }
  ],
  "groceries": [
    {
      "id": "9876543210",
      "title": "Milk",
      "category": "food",
      "depletionDays": 7,
      "lastRestocked": 1755000000000,
      "lowAlertSent": false
    }
  ]
}
```

## Configuration

| Env var       | Default                 | Purpose                                              |
|---------------|--------------------------|--------------------------------------------------------|
| `DATA_DIR`    | `<app dir>/data`         | Directory the SQLite file (`app.db`) is stored in       |
| `PORT`        | `5000`                    | Port the dev server binds to (`python app.py` only)     |
| `FLASK_DEBUG` | `0`                        | Set to `1` to enable Flask debug mode                   |
| `EMAILJS_PUBLIC_KEY`, `EMAILJS_SERVICE_ID`, `EMAILJS_TEMPLATE_ID`, `EMAILJS_USER_EMAIL` | blank | EmailJS settings. Read only from `.env`; restart after changing. Any blank → email alerts off |

The Docker image sets `DATA_DIR=/app/data` and always runs via `gunicorn`
on port 5000 regardless of `PORT`.

## Notes

- EmailJS credentials live only in `.env`. The actual email send still
  happens client-side via the EmailJS JS SDK, so the public key, service ID,
  template ID and recipient are sent to the browser (EmailJS public keys are
  designed to be public). `.env` is excluded from the Docker image via
  `.dockerignore`.
- Stock % isn't a separate column: setting it back-dates `lastRestocked` so
  the item is that far through its depletion cycle, and it keeps counting
  down at the same speed from there.
- The old `email_config` table in existing databases is no longer read and
  can be ignored (or dropped).
- `gunicorn` runs 3 worker processes by default. SQLite (with its default
  file-locking) handles this fine for a single-user or small-team app. If
  you expect many concurrent writers, consider Postgres — swapping the
  `SQLALCHEMY_DATABASE_URI` in `app.py` is the only change needed since the
  models use plain SQLAlchemy.
- `PUT /api/state` replaces the tasks/groceries tables wholesale on every
  save (mirroring the old "write the whole localStorage blob" pattern).
  That's simple and correct for this app's scale; if you outgrow it, swap
  in per-row `POST`/`PATCH`/`DELETE` endpoints instead.
