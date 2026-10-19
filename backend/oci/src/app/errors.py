"""Uniform error envelope: {"error": {"code", "message", "details"?}}."""

from typing import Any

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class APIError(Exception):
    """Domain error carrying a stable machine-readable code."""

    def __init__(
        self, status_code: int, code: str, message: str, *, retry_after: int | None = None
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        # Seconds until a retry would succeed — carried as a `Retry-After`
        # header (issue #339's too_many_attempts), not in the error body.
        self.retry_after = retry_after


class NotFoundError(APIError):
    def __init__(self, message: str) -> None:
        super().__init__(status_code=404, code="not_found", message=message)


def error_response(
    status_code: int,
    code: str,
    message: str,
    details: Any = None,
    *,
    retry_after: int | None = None,
) -> JSONResponse:
    error: dict[str, Any] = {"code": code, "message": message}
    if details is not None:
        error["details"] = details
    headers = {"Retry-After": str(retry_after)} if retry_after is not None else None
    return JSONResponse(status_code=status_code, content={"error": error}, headers=headers)


HTTP_STATUS_CODES = {
    404: "not_found",
    405: "method_not_allowed",
}


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(APIError)
    async def handle_api_error(request: Request, exc: APIError) -> JSONResponse:
        return error_response(exc.status_code, exc.code, exc.message, retry_after=exc.retry_after)

    @app.exception_handler(StarletteHTTPException)
    async def handle_http_exception(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = HTTP_STATUS_CODES.get(exc.status_code, "http_error")
        return error_response(exc.status_code, code, str(exc.detail))

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        return error_response(
            422, "validation_error", "Request validation failed", jsonable_encoder(exc.errors())
        )
