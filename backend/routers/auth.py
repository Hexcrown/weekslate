from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel

import security
from deps import COOKIE, is_authed, require_admin

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginIn(BaseModel):
    pin: str


class PinIn(BaseModel):
    pin: Optional[str] = None      # null removes the PIN


def _client(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _start_session(response: Response, token: str) -> None:
    response.set_cookie(COOKIE, token, max_age=security.SESSION_TTL,
                        httponly=True, samesite="lax", path="/")


@router.get("/status")
def status(request: Request):
    return {"pin_set": security.pin_is_set(), "authed": is_authed(request)}


@router.post("/login")
def login(body: LoginIn, request: Request, response: Response):
    if not security.pin_is_set():
        return {"ok": True}
    try:
        token = security.login(body.pin, _client(request))
    except security.Locked as exc:
        raise HTTPException(429, "Too many tries. Wait " + str(exc.wait) + " seconds and try again.")
    except security.BadPin:
        raise HTTPException(401, "That PIN isn't right.")
    _start_session(response, token)
    return {"ok": True}


@router.post("/logout")
def logout(request: Request, response: Response):
    security.end_session(request.cookies.get(COOKIE))
    response.delete_cookie(COOKIE, path="/")
    return {"ok": True}


@router.post("/pin", dependencies=[Depends(require_admin)])
def set_pin(body: PinIn, response: Response):
    """Set, change, or (with pin: null) remove the PIN. Needs the current session."""
    if body.pin is None:
        security.clear_pin()
        response.delete_cookie(COOKIE, path="/")
        return {"pin_set": False}
    if not security.valid_pin_format(body.pin):
        raise HTTPException(422, "Use 4 to 8 digits.")
    security.set_pin(body.pin)                   # signs everyone else out
    _start_session(response, security.new_session())
    return {"pin_set": True}
