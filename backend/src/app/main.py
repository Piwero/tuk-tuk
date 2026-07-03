"""FastAPI entrypoint."""

from fastapi import FastAPI

from app import __version__
from app.config import settings

app = FastAPI(title=settings.app_name, version=__version__)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "version": __version__}
