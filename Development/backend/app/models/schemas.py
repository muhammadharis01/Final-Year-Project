from typing import List, Optional
from pydantic import BaseModel

class GraphemeScore(BaseModel):
    grapheme: str
    score: float
    index: int
    phoneme: Optional[str] = None
    tajweed_rule: Optional[str] = None

class TajweedError(BaseModel):
    position: int
    recognized: Optional[str] = None
    expected: Optional[str] = None
    error_type: str
    word: str

class WordAnalysisResult(BaseModel):
    word_index: int
    word_graphemes: str
    start_time: float
    end_time: float
    word_score: float
    graphemes: List[GraphemeScore]

class AnalysisResponse(BaseModel):
    success: bool = True
    surah: int
    ayah: int
    overall_accuracy: float
    accuracy: float = 0.0
    error_count: int = 0
    errors: List[TajweedError] = []
    words: List[WordAnalysisResult]
    recitation_id: Optional[int] = None
    reference: Optional[str] = None
    reference_phonemes: Optional[str] = None
    transcription: Optional[str] = None

class FeedbackRequest(BaseModel):
    recitation_id: int
    word_index: int
    is_accurate: bool

class WaitlistRequest(BaseModel):
    email: str

class JsonAnalysisRequest(BaseModel):
    audio_base64: str
    surah: int
    ayah: int
    session_id: Optional[str] = "local-dev"
