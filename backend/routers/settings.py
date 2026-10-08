from typing import Literal, Optional

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

import security
import settings_store
from deps import is_authed, require_admin

router = APIRouter(prefix="/api/settings", tags=["settings"])


class SettingsIn(BaseModel):
    theme: Optional[Literal["dark", "light"]] = None
    default_view: Optional[Literal["week", "month"]] = None
    week_start: Optional[Literal[0, 1]] = None
    show_points: Optional[bool] = None
    match_names: Optional[bool] = None
    setup_complete: Optional[bool] = None


@router.get("")
def read_settings(request: Request):
    """Public: the wall display needs the look-and-feel settings. No secrets in here."""
    return {**settings_store.get_all(),
            "pin_set": security.pin_is_set(),
            "authed": is_authed(request)}


@router.put("", dependencies=[Depends(require_admin)])
def update_settings(body: SettingsIn):
    for key, value in body.model_dump(exclude_none=True).items():
        settings_store.set_value(key, value)
    return settings_store.get_all()
