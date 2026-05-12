from fastapi import APIRouter, Depends, Form, File, UploadFile, Request, HTTPException
from app.models.schemas import AnalysisResponse, FeedbackRequest, WaitlistRequest, JsonAnalysisRequest
from app.api.facade import RecitationAnalyzerFacade
import base64
import io
from starlette.datastructures import UploadFile as StarletteUploadFile, Headers

router = APIRouter()

def get_facade(request: Request) -> RecitationAnalyzerFacade:
    """
    Dependency injection function to retrieve the safely initialized 
    services from the application state (set during lifespan startup)
    """
    return RecitationAnalyzerFacade(
        audio_processor=request.app.state.audio_processor,
        supabase_service=request.app.state.supabase_service,
        phonemes_db=request.app.state.phonemes_db,
        graphemes_db=request.app.state.graphemes_db,
        gop_analyzer=request.app.state.gop_analyzer,
    )

@router.get("/health")
async def health_check():
    return {"status": "healthy"}

@router.post("/analyze", response_model=AnalysisResponse)
async def analyze_recitation(
    session_id: str = Form(...),
    surah_num: int = Form(...),
    ayah_num: int = Form(...),
    audio_file: UploadFile = File(...),
    facade: RecitationAnalyzerFacade = Depends(get_facade)
):
    """
    Accepts surah_num, ayah_num, and an audio_file (UploadFile),
    orchestrates Tajweed analysis, and returns batched generative feedback.
    """
    if surah_num != 1 and not (95 <= surah_num <= 114):
        raise HTTPException(
            status_code=400,
            detail=f"Surah {surah_num} is not supported. Only Al-Fatiha (1) and Surahs 95-114 are currently supported."
        )
        
    return await facade.analyze(session_id, surah_num, ayah_num, audio_file)

@router.post("/analyze-json", response_model=AnalysisResponse)
async def analyze_recitation_json(
    request_data: JsonAnalysisRequest,
    facade: RecitationAnalyzerFacade = Depends(get_facade)
):
    """
    Accepts base64 audio and orchestrates analysis.
    Compatibility endpoint for the mobile app.
    """
    try:
        # Decode base64 audio
        audio_bytes = base64.b64decode(request_data.audio_base64)
        
        # Create a mock UploadFile for the facade
        mock_file = StarletteUploadFile(
            filename="upload.webm",
            file=io.BytesIO(audio_bytes),
            headers=Headers({"content-type": "audio/webm"})
        )
        
        return await facade.analyze(
            request_data.session_id or "local-dev",
            request_data.surah,
            request_data.ayah,
            mock_file
        )
    except Exception as e:
        import logging
        logging.getLogger(__name__).error(f"JSON Analysis failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/feedback")
async def submit_feedback(
    request_data: FeedbackRequest,
    request: Request
):
    """
    Accepts feedback from the user regarding the accuracy of a word's analysis.
    """
    supabase = request.app.state.supabase_service
        
    feedback_id = supabase.save_feedback(
        recitation_id=request_data.recitation_id,
        word_index=request_data.word_index,
        is_accurate=request_data.is_accurate
    )
    
    if not feedback_id:
        raise HTTPException(status_code=500, detail="Failed to save feedback.")
        
    return {"status": "success", "feedback_id": feedback_id}

@router.post("/waitlist")
async def join_waitlist(
    request_data: WaitlistRequest,
    request: Request
):
    """
    Accepts an email address to join the waitlist.
    """
    supabase = request.app.state.supabase_service
        
    success = supabase.join_waitlist(email=request_data.email)
    
    if not success:
        raise HTTPException(status_code=500, detail="Failed to join waitlist.")
        
    return {"status": "success"}
