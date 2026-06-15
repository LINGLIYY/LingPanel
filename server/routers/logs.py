"""LingServer Dashboard — Log Viewer Routes

GET  /api/logs/sources   — list configured log sources
GET  /api/logs/read      — read log lines with filters + pagination
GET  /api/logs/export    — download filtered log as text
"""
from fastapi import APIRouter, HTTPException, Query, Depends
from fastapi.responses import PlainTextResponse

from server.auth import get_current_user
from server.services import log_reader

router = APIRouter(prefix="/api/logs", tags=["logs"])


@router.get("/sources")
async def list_sources(_user=Depends(get_current_user)):
    """List all configured log sources with availability."""
    return {"sources": log_reader.list_sources()}


@router.get("/read")
async def read_log(
    source_id: str = Query(..., description="Log source ID from config"),
    lines: int = Query(500, ge=1, le=2000, description="Lines per page"),
    offset: int = Query(0, ge=0),
    filter_level: str | None = Query(None, description="Minimum severity level"),
    filter_regex: str | None = Query(None, description="Regex pattern to search"),
    date_from: str | None = Query(None, description="Start date (ISO format)"),
    date_to: str | None = Query(None, description="End date (ISO format)"),
    _user=Depends(get_current_user),
):
    """Read log lines with filtering and pagination."""
    try:
        data = log_reader.read_log(
            source_id=source_id,
            lines=lines,
            offset=offset,
            filter_level=filter_level,
            filter_regex=filter_regex,
            date_from=date_from,
            date_to=date_to,
        )
        return data
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    except PermissionError as e:
        raise HTTPException(403, str(e))


@router.get("/export")
async def export_log(
    source_id: str = Query(...),
    filter_regex: str | None = Query(None),
    _user=Depends(get_current_user),
):
    """Export filtered log as downloadable text."""
    try:
        content = log_reader.export_log(source_id, filter_regex=filter_regex)
        return PlainTextResponse(
            content,
            media_type="text/plain; charset=utf-8",
            headers={"Content-Disposition": f"attachment; filename={source_id}.log"},
        )
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
