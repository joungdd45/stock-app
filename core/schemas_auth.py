# schemas_auth.py
from pydantic import BaseModel, Field

class UserCreate(BaseModel):
    username: str = Field(..., min_length=2, max_length=50)  # 예: "01", "02"
    password: str = Field(..., min_length=6, max_length=100)
    role: str = Field(..., pattern="^(admin|staff)$")

class LoginRequest(BaseModel):
    username: str
    password: str

class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
    must_change_password: bool

class PasswordChangeRequest(BaseModel):
    old_password: str
    new_password: str

class UserMe(BaseModel):
    username: str
    role: str
    password_reset_required: bool
    disabled: bool
