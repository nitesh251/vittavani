from urllib.error import URLError

import jwt
from fastapi import HTTPException
from jwt import PyJWKClient
from jwt.exceptions import PyJWKClientConnectionError


def verify_supabase_access_token(token: str, project_url: str) -> str:
    project_url = project_url.rstrip("/")
    if not project_url:
        raise HTTPException(status_code=503, detail="Supabase authentication is not configured")

    issuer = f"{project_url}/auth/v1"
    try:
        signing_key = PyJWKClient(
            f"{issuer}/.well-known/jwks.json",
            cache_jwk_set=True,
            lifespan=300,
            timeout=5,
        ).get_signing_key_from_jwt(token)
    except (PyJWKClientConnectionError, URLError, TimeoutError, OSError) as exc:
        raise HTTPException(status_code=503, detail="Could not verify the authentication service") from exc
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail="Authentication required") from exc

    try:
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["ES256", "RS256", "EdDSA"],
            audience="authenticated",
            issuer=issuer,
            options={"require": ["exp", "sub", "iss", "aud"]},
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail="Authentication required") from exc

    subject = claims.get("sub")
    if not isinstance(subject, str) or not subject:
        raise HTTPException(status_code=401, detail="Authentication required")
    return subject
