import os
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    HF_TOKEN: str = os.environ.get("HF_TOKEN", "")
    ASR_MODEL_ID: str = os.environ.get("ASR_MODEL_ID", "mujawwad/mujawwad-v1")
    SUPABASE_URL: str = os.environ.get("SUPABASE_URL", "")
    SUPABASE_KEY: str = os.environ.get("SUPABASE_KEY", "")
    FRONTEND_URL: str = os.environ.get("FRONTEND_URL", "http://localhost:3000")
    
    class Config:
        env_file = ".env"
        extra = "ignore"

settings = Settings()
