from fastapi import APIRouter

from ..runtime import runtime_status

router = APIRouter()


@router.get("/health")
def health():
    return runtime_status()
