"""FastAPI dependencies shared by the routers."""
from fastapi import HTTPException, Request

import security

COOKIE = "weekslate_session"


def is_authed(request: Request) -> bool:
    """True if no PIN is set, or the request carries a valid session."""
    if not security.pin_is_set():
        return True
    return security.session_valid(request.cookies.get(COOKIE))


def require_admin(request: Request) -> None:
    if not is_authed(request):
        raise HTTPException(401, "PIN required")
