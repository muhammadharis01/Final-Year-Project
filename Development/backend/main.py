from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import json
import os
import sys
import logging
import traceback
from fastapi.responses import JSONResponse
from fastapi.requests import Request

from app.services.audio import AudioProcessor
from app.services.gop_analyzer import GopAnalyzerService
from app.services.supabase_service import SupabaseService
from app.api.endpoints import router as api_router
from app.core.config import settings

# Set up aggressive logging to stdout to bypass Docker container buffering issues on HF Spaces
logging.basicConfig(
    stream=sys.stdout,
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Lifespan context manager to initialize inference models and data once
    during startup. This guarantees the model is NOT re-loaded inside
    the request handler.
    """
    base_dir = os.path.dirname(os.path.abspath(__file__))
    
    # 1. Load Data Dependencies
    with open(os.path.join(base_dir, "phonemes.json"), "r", encoding="utf-8") as f:
        phonemes_db = json.load(f)
    with open(os.path.join(base_dir, "p2g_map.json"), "r", encoding="utf-8") as f:
        grapheme_map = json.load(f)
        
    # Extract structural graphemes representing the word strings
    graphemes_db = {}
    for key, seq in phonemes_db.items():
        words = []
        current_word = ""
        for p in seq.replace("|", " | ").split():
            if p == "|":
                words.append(current_word)
                current_word = ""
            else:
                current_word += grapheme_map.get(p, p)
        if current_word:
            words.append(current_word)
        graphemes_db[key] = words

    # 2. Instantiate Main Services
    try:
        app.state.audio_processor = AudioProcessor()
        # New GoP-based analyzer service
        app.state.gop_analyzer = GopAnalyzerService(
            model_id=settings.ASR_MODEL_ID,
            phoneme_to_grapheme_map=grapheme_map,
        )
        app.state.supabase_service = SupabaseService()
        
        # Share data sets to app state
        app.state.phonemes_db = phonemes_db
        app.state.graphemes_db = graphemes_db
        
        logger.info("Application startup completed successfully.")
    except Exception as e:
        logger.error(f"Error during application startup initialization: {e}")
        raise
        
    yield
    
    logger.info("Application shutdown.")

app = FastAPI(title="Mujawwad — Quran Recitation Analysis", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Add route logic
app.include_router(api_router)

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """
    Catch-all exception handler to ensure that ANY unhandled crash in the processing pipeline 
    is aggressively written to the Hugging Face Space logs with a full stack trace.
    """
    error_msg = f"Unhandled Exception during request to {request.url.path}:\n{traceback.format_exc()}"
    logger.error(error_msg)
    
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal Server Error occurred. Please check the backend Space logs."},
    )
