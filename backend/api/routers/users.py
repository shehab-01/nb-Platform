from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.auth import require_super_admin
from api.config import settings
from api.db import get_session
from api.models import OrderEvent, Store, StoreUser, User, UserRole, UserStatus
from api.schemas import MembershipOut, MembershipsUpdate, UserUpdate, UserWithActivityOut

router = APIRouter(
    prefix="/users",
    tags=["Users"],
    dependencies=[Depends(require_super_admin)],
)


@router.get("", response_model=list[UserWithActivityOut])
async def list_users(
    session: AsyncSession = Depends(get_session),
) -> list[UserWithActivityOut]:
    confirmed = func.count().filter(
        OrderEvent.event_type == "status_changed",
        OrderEvent.new_status == "confirmed",
    )
    shipped = func.count().filter(
        OrderEvent.event_type == "status_changed",
        OrderEvent.new_status == "shipped",
    )
    rows = await session.execute(
        select(User, confirmed, shipped)
        .outerjoin(OrderEvent, OrderEvent.actor_id == User.id)
        .group_by(User.id)
        .order_by(User.created_at)
    )
    memberships = await _memberships(session)
    return [
        UserWithActivityOut(
            **UserWithActivityOut.model_validate(user).model_dump(
                exclude={"orders_confirmed", "orders_shipped", "pinned", "memberships"}
            ),
            memberships=memberships.get(user.id, []),
            orders_confirmed=conf,
            orders_shipped=comp,
            pinned=user.email in settings.super_admin_emails,
        )
        for user, conf, comp in rows
    ]


async def _memberships(
    session: AsyncSession, user_id: int | None = None
) -> dict[int, list[MembershipOut]]:
    """user id -> memberships, every user's or one user's."""
    query = (
        select(StoreUser.user_id, StoreUser.store_id, Store.slug, Store.name, StoreUser.role)
        .join(Store, Store.id == StoreUser.store_id)
        .order_by(Store.id)
    )
    if user_id is not None:
        query = query.where(StoreUser.user_id == user_id)
    out: dict[int, list[MembershipOut]] = {}
    for uid, store_id, slug, name, role in await session.execute(query):
        out.setdefault(uid, []).append(
            MembershipOut(store_id=store_id, slug=slug, name=name, role=role)
        )
    return out


async def _with_activity(session: AsyncSession, user: User) -> UserWithActivityOut:
    memberships = await _memberships(session, user.id)
    return UserWithActivityOut(
        **UserWithActivityOut.model_validate(user).model_dump(
            exclude={"orders_confirmed", "orders_shipped", "pinned", "memberships"}
        ),
        memberships=memberships.get(user.id, []),
        pinned=user.email in settings.super_admin_emails,
    )


@router.put("/{user_id}/memberships", response_model=UserWithActivityOut)
async def set_memberships(
    user_id: int,
    payload: MembershipsUpdate,
    session: AsyncSession = Depends(get_session),
) -> UserWithActivityOut:
    """Replace the user's store memberships. A user left with none keeps
    their account and sees the waiting page until assigned again."""
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    wanted = {m.store_id: m.role for m in payload.memberships}
    if wanted:
        known = set(
            (await session.scalars(select(Store.id).where(Store.id.in_(wanted)))).all()
        )
        missing = sorted(set(wanted) - known)
        if missing:
            raise HTTPException(
                status_code=400, detail=f"Unknown store id(s): {missing}"
            )
    existing = {
        row.store_id: row
        for row in (
            await session.scalars(select(StoreUser).where(StoreUser.user_id == user_id))
        ).all()
    }
    for store_id, row in existing.items():
        if store_id not in wanted:
            await session.delete(row)
        else:
            row.role = wanted[store_id]
    for store_id, role in wanted.items():
        if store_id not in existing:
            session.add(StoreUser(store_id=store_id, user_id=user_id, role=role))
    await session.commit()
    return await _with_activity(session, user)


@router.patch("/{user_id}", response_model=UserWithActivityOut)
async def update_user(
    user_id: int,
    payload: UserUpdate,
    admin: User = Depends(require_super_admin),
    session: AsyncSession = Depends(get_session),
) -> UserWithActivityOut:
    if payload.status is None and payload.role is None and payload.nickname is None:
        raise HTTPException(status_code=400, detail="Nothing to update")
    # Role and status changes are the ones that could lock an admin out of
    # their own account; renaming yourself is harmless.
    if user_id == admin.id and (
        payload.status is not None or payload.role is not None
    ):
        raise HTTPException(status_code=400, detail="Cannot change your own account")

    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    if payload.status is not None:
        user.status = payload.status
    if payload.role is not None and payload.role != user.role:
        if payload.role == UserRole.staff:
            # The config re-promotes these on their next request, so a
            # demotion here would silently undo itself.
            if user.email in settings.super_admin_emails:
                raise HTTPException(
                    status_code=400,
                    detail="This account is a super admin by server configuration "
                    "(SUPER_ADMIN_EMAILS) and cannot be changed here",
                )
            # Never leave the team with nobody able to manage it.
            others = await session.scalar(
                select(func.count()).where(
                    User.role == UserRole.super_admin,
                    User.status == UserStatus.active,
                    User.id != user.id,
                )
            )
            if not others:
                raise HTTPException(
                    status_code=400,
                    detail="Cannot remove the last super admin",
                )
        user.role = payload.role
    if payload.nickname is not None:
        nickname = payload.nickname.strip()
        # Blank means "go back to the full name" rather than an empty label.
        user.nickname = nickname or None
    await session.commit()
    return await _with_activity(session, user)


@router.delete("/{user_id}", status_code=204)
async def delete_user(
    user_id: int,
    admin: User = Depends(require_super_admin),
    session: AsyncSession = Depends(get_session),
) -> None:
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if user.status != UserStatus.pending:
        raise HTTPException(
            status_code=400,
            detail="Only pending requests can be deleted; suspend active users instead",
        )
    await session.delete(user)
    await session.commit()
