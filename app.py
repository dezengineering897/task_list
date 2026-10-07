import os

from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request
from flask_sqlalchemy import SQLAlchemy

# Load variables from a local .env file (if present) into the environment.
# In Docker, real env vars / --env-file already take care of this, but this
# makes `python app.py` behave the same way without extra setup.
load_dotenv()

app = Flask(__name__)

# The SQLite file lives under DATA_DIR so it can be mounted as a Docker
# volume and survive container restarts/rebuilds.
basedir = os.path.abspath(os.path.dirname(__file__))
data_dir = os.environ.get("DATA_DIR", os.path.join(basedir, "data"))
os.makedirs(data_dir, exist_ok=True)
db_path = os.path.join(data_dir, "app.db")

app.config["SQLALCHEMY_DATABASE_URI"] = f"sqlite:///{db_path}"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

db = SQLAlchemy(app)


# --------------------------------------------------------------------------
# Models
# --------------------------------------------------------------------------
class Task(db.Model):
    __tablename__ = "tasks"

    id = db.Column(db.String(64), primary_key=True)
    title = db.Column(db.String(255), nullable=False)
    due_date = db.Column(db.BigInteger, nullable=False)  # epoch ms
    interval = db.Column(db.String(16), default="none")
    repeat = db.Column(db.String(16), default="none")
    status = db.Column(db.String(16), default="active")
    expired_alert_sent = db.Column(db.Boolean, default=False)
    last_reminder_sent = db.Column(db.BigInteger, default=0)

    def to_dict(self):
        return {
            "id": self.id,
            "title": self.title,
            "dueDate": self.due_date,
            "interval": self.interval,
            "repeat": self.repeat,
            "status": self.status,
            "expiredAlertSent": self.expired_alert_sent,
            "lastReminderSent": self.last_reminder_sent,
        }


class Grocery(db.Model):
    __tablename__ = "groceries"

    id = db.Column(db.String(64), primary_key=True)
    title = db.Column(db.String(255), nullable=False)
    category = db.Column(db.String(32), nullable=False)
    depletion_days = db.Column(db.Integer, nullable=False)
    last_restocked = db.Column(db.BigInteger, nullable=False)  # epoch ms
    low_alert_sent = db.Column(db.Boolean, default=False)

    def to_dict(self):
        return {
            "id": self.id,
            "title": self.title,
            "category": self.category,
            "depletionDays": self.depletion_days,
            "lastRestocked": self.last_restocked,
            "lowAlertSent": self.low_alert_sent,
        }


def email_config_from_env():
    """EmailJS settings come ONLY from the .env file (via load_dotenv above,
    or from docker-compose, which injects the same .env values). They are
    never stored in the database and can't be changed from the UI — edit
    .env and restart the app to change them."""
    return {
        "publicKey": os.environ.get("EMAILJS_PUBLIC_KEY", "").strip(),
        "serviceId": os.environ.get("EMAILJS_SERVICE_ID", "").strip(),
        "templateId": os.environ.get("EMAILJS_TEMPLATE_ID", "").strip(),
        "userEmail": os.environ.get("EMAILJS_USER_EMAIL", "").strip(),
    }


with app.app_context():
    db.create_all()


# --------------------------------------------------------------------------
# Page routes
# --------------------------------------------------------------------------
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/healthz")
def healthz():
    return {"status": "ok"}, 200


# --------------------------------------------------------------------------
# API routes
#
# The client keeps its full tasks/groceries arrays in memory (same pattern
# as before) and, after every mutation, PUTs the whole state back here. We
# replace each table's contents in a single transaction so a save is
# atomic and there's no drift between what the browser shows and what's
# persisted in SQLite.
# --------------------------------------------------------------------------
@app.route("/api/state", methods=["GET"])
def get_state():
    tasks = [t.to_dict() for t in Task.query.all()]
    groceries = [g.to_dict() for g in Grocery.query.all()]
    return jsonify(
        {
            "tasks": tasks,
            "groceries": groceries,
            "emailConfig": email_config_from_env(),
        }
    )


@app.route("/api/state", methods=["PUT"])
def put_state():
    payload = request.get_json(force=True, silent=True) or {}
    tasks = payload.get("tasks", [])
    groceries = payload.get("groceries", [])

    try:
        Task.query.delete()
        for t in tasks:
            db.session.add(
                Task(
                    id=str(t["id"]),
                    title=t["title"],
                    due_date=int(t["dueDate"]),
                    interval=t.get("interval", "none"),
                    repeat=t.get("repeat", "none"),
                    status=t.get("status", "active"),
                    expired_alert_sent=bool(t.get("expiredAlertSent", False)),
                    last_reminder_sent=int(t.get("lastReminderSent", 0)),
                )
            )

        Grocery.query.delete()
        for g in groceries:
            db.session.add(
                Grocery(
                    id=str(g["id"]),
                    title=g["title"],
                    category=g["category"],
                    depletion_days=int(g["depletionDays"]),
                    last_restocked=int(g["lastRestocked"]),
                    low_alert_sent=bool(g.get("lowAlertSent", False)),
                )
            )

        db.session.commit()
    except (KeyError, ValueError, TypeError) as exc:
        db.session.rollback()
        return jsonify({"status": "error", "message": f"Invalid payload: {exc}"}), 400

    return jsonify({"status": "ok"})


if __name__ == "__main__":
    # Default to loopback-only for safety (fixes bandit B104 — no more
    # hardcoded 0.0.0.0). Set FLASK_RUN_HOST=0.0.0.0 in .env only if you
    # deliberately need this dev server reachable from other machines —
    # e.g. testing from your phone on the same network. The Docker image
    # does NOT use this code path; gunicorn's own bind flag in the
    # Dockerfile CMD handles container networking instead.
    host = os.environ.get("FLASK_RUN_HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "5000"))
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    app.run(host=host, port=port, debug=debug)
