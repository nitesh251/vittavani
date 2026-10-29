from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Location


def location_paths(session: Session, business_id: UUID) -> dict[UUID, str]:
    locations = {
        location.id: location
        for location in session.scalars(
            select(Location).where(Location.business_id == business_id)
        )
    }
    paths: dict[UUID, str] = {}
    for location_id, location in locations.items():
        parts: list[str] = []
        visited: set[UUID] = set()
        current = location
        while current.id not in visited:
            visited.add(current.id)
            parts.append(current.name)
            if current.parent_location_id is None:
                break
            parent = locations.get(current.parent_location_id)
            if parent is None:
                break
            current = parent
        paths[location_id] = " > ".join(reversed(parts))
    return paths
