from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import os
import json
from pathlib import Path

router = APIRouter()

# Data path
DATA_FILE = Path(__file__).parent.parent / "data" / "users.json"

class LoginRequest(BaseModel):
    email: str
    password: str

def load_users():
    if not DATA_FILE.exists():
        return {}
    with open(DATA_FILE, "r") as f:
        return json.load(f)

@router.post("/auth/login")
async def login(req: LoginRequest):
    users = load_users()
    email = req.email.lower().strip()
    
    if email not in users:
        raise HTTPException(status_code=401, detail="Invalid email or password.")
        
    user_data = users[email]
    if user_data["password"] != req.password:
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
