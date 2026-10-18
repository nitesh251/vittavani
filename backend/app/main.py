from uuid import UUID

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.query_service import lookup_product

app = FastAPI(title="Vittavani API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)


class AskRequest(BaseModel):
    query: str = Field(min_length=1, max_length=500)


class AskResponse(BaseModel):
    intent: str
    original_query: str
    product_name: str | None = None
    quantity: str | None = None
    unit: str | None = None
    locations: list[str]
    candidates: list[str]
    clarification_required: bool
    message: str


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def development_business_id(authorization: str | None = Header(default=None)) -> UUID:
    if settings.app_env != "development" or not settings.dev_api_token or not settings.dev_business_id:
        raise HTTPException(status_code=503, detail="Protected API is not configured")
    if authorization != f"******":
        raise HTTPException(status_code=401, detail="Authentication required")
    try:
        return UUID(settings.dev_business_id)
    except ValueError as exc:
        raise HTTPException(status_code=503, detail="Protected API is not configured") from exc


@app.post("/api/v1/ask", response_model=AskResponse)
def ask(
    body: AskRequest,
    business_id: UUID = Depends(development_business_id),
    session: Session = Depends(get_db),
) -> AskResponse:
    result = lookup_product(session, business_id, body.query)
    return AskResponse(
        intent=result.intent,
        original_query=result.original_query,
        product_name=result.product_name,
        quantity=str(result.quantity) if result.quantity is not None else None,
        unit=result.unit,
        locations=list(result.locations),
        candidates=list(result.candidates),
        clarification_required=result.clarification_required,
        message=result.message,
    )
