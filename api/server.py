"""Entry point for the filmprint-api CLI command."""

import uvicorn


def start():
    uvicorn.run("api.main:app", host="0.0.0.0", port=8000, reload=True)
