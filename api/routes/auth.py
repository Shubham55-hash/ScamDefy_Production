from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import hmac
import os
import json
from pathlib import Path

router = APIRouter()

# Local-dev user store. Excluded from the Docker image (see .dockerignore);
# containers must supply their own file via AUTH_USERS_FILE.
DEFAULT_USERS_FILE = Path(__file__).parent.parent / "data" / "users.json"

class LoginRequest(BaseModel):
    email: str
    password: str

def _users_file() -> Path:
    override = os.getenv("AUTH_USERS_FILE")
    return Path(override) if override else DEFAULT_USERS_FILE

def load_users():
    users_file = _users_file()
    if not users_file.exists():
        return {}
    with open(users_file, "r") as f:
        return json.load(f)

@router.post("/auth/login")
async def login(req: LoginRequest):
    users = load_users()
    email = req.email.lower().strip()
    
    if email not in users:
        raise HTTPException(status_code=401, detail="Invalid email or password.")
        
    user_data = users[email]
    if not hmac.compare_digest(user_data["password"].encode(), req.password.encode()):
        raise HTTPException(status_code=401, detail="Invalid email or password.")
        
    return {
        "success": True,
        "user": {
            "email": email,
            "name": user_data["name"],
            "role": user_data["role"]
        },
        "token": f"sd_sess_{os.urandom(8).hex()}" # Mock session token
    }
