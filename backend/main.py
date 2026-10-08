"""Weekslate API. Run locally with:  uvicorn main:app --reload --host 0.0.0.0

Adding a feature = new file in routers/ + one include_router line below.
"""
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles

from db import init_db
from routers import auth, calendar, calendars, chores, people, scores, settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="Weekslate", lifespan=lifespan)


@app.middleware("http")
async def safe_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


app.include_router(auth.router)
app.include_router(settings.router)
app.include_router(calendars.router)
app.include_router(people.router)
app.include_router(chores.router)
app.include_router(scores.router)
app.include_router(calendar.router)

# Frontend is mounted last so /api/* routes win.
FRONTEND_DIR = os.environ.get(
    "WEEKSLATE_FRONTEND", os.path.join(os.path.dirname(__file__), "..", "frontend")
)
if os.path.isdir(FRONTEND_DIR):
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
