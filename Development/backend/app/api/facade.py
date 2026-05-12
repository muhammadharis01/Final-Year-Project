from fastapi import UploadFile, HTTPException
from typing import Dict, List
import logging

from app.services.audio import AudioProcessor
from app.services.supabase_service import SupabaseService
from app.services.gop_analyzer import GopAnalyzerService
from app.services.tajweed_rules import derive_error_type, derive_tajweed_rule
from app.models.schemas import (
    AnalysisResponse,
    WordAnalysisResult,
    GraphemeScore,
    TajweedError,
)
import uuid

logger = logging.getLogger(__name__)


class RecitationAnalyzerFacade:
    def __init__(
        self,
        audio_processor: AudioProcessor,
        supabase_service: SupabaseService,
        phonemes_db: Dict[str, List[str]],
        graphemes_db: Dict[str, List[str]],
        gop_analyzer: GopAnalyzerService,
    ):
        """
        An orchestrator class that calls the services in the correct order to process a user's request.
        """
        self.audio_processor = audio_processor
        self.supabase_service = supabase_service
        self.gop_analyzer = gop_analyzer
        
        # In-memory mapping of Surah/Ayah combinations to reference data
        self.phonemes_db = phonemes_db
        self.graphemes_db = graphemes_db

    def _tokens_to_grapheme_text(self, tokens: List[str]) -> str:
        p2g = self.gop_analyzer.phoneme_to_grapheme_map
        out: List[str] = []
        for t in tokens:
            if t == "|":
                out.append(" ")
            else:
                out.append(p2g.get(t, t))
        return "".join(out).strip()

    async def analyze(self, session_id: str, surah_num: int, ayah_num: int, audio_file: UploadFile) -> AnalysisResponse:
        key = f"{surah_num}:{ayah_num}"
        
        if key not in self.phonemes_db or key not in self.graphemes_db:
            raise HTTPException(status_code=404, detail=f"Reference data for Surah {surah_num}, Ayah {ayah_num} not found.")
            
        ref_seq = self.phonemes_db[key]
        ref_words = self.graphemes_db[key]
        
        audio_url = None
        
        try:
            request_id = str(uuid.uuid4())
            audio_bytes = await audio_file.read()
            filename = f"{session_id}_{surah_num}_{ayah_num}.webm"
            audio_url = self.supabase_service.upload_audio(audio_bytes, filename)
            await audio_file.seek(0)
        
            # 1. Process Audio
            audio_array = await self.audio_processor.process(audio_file)

            # 2. GoP-based analysis using logits + forced alignment
            gop_words, raw_model_output, heard_tokens = self.gop_analyzer.analyze(
                audio_array=audio_array,
                ref_phoneme_seq=ref_seq,
                ref_grapheme_words=ref_words,
            )

            # 3. Map GoP word results into WordAnalysisResult structures
            words: List[WordAnalysisResult] = []
            for gw in gop_words:
                graphemes: List[GraphemeScore] = []
                grapheme_index = 0
                for sp in gw.phoneme_spans:
                    if sp.phoneme == "|":
                        continue

                    grapheme = self.gop_analyzer.phoneme_to_grapheme_map.get(sp.phoneme, sp.phoneme)
                    graphemes.append(
                        GraphemeScore(
                            grapheme=grapheme,
                            score=sp.gop_percentage,
                            index=grapheme_index,
                            phoneme=sp.phoneme,
                            tajweed_rule=derive_tajweed_rule(sp.phoneme),
                        )
                    )
                    grapheme_index += 1

                words.append(
                    WordAnalysisResult(
                        word_index=gw.word_index,
                        word_graphemes=gw.graphemes,
                        start_time=gw.start_time,
                        end_time=gw.end_time,
                        word_score=gw.gop_score,
                        graphemes=graphemes,
                    )
                )

            # (Removed noisy logging of mapped words)

            recitation_id = self.supabase_service.save_recitation(
                session_id=session_id,
                surah_number=surah_num,
                ayah_number=ayah_num,
                audio_url=audio_url,
                raw_model_output=raw_model_output,
                parsed_result=[w.model_dump() for w in words] if words else None
            )

            all_errors: List[TajweedError] = []
            for word in words:
                for g in word.graphemes:
                    if g.score >= 90.0:
                        continue
                    all_errors.append(TajweedError(
                        position=g.index,
                        recognized=None,
                        expected=g.grapheme,
                        error_type=derive_error_type(g.phoneme or ""),
                        word=word.word_graphemes,
                    ))

            # Calculate overall accuracy as average GoP score across words
            if words:
                total_score = sum(w.word_score or 0.0 for w in words)
                accuracy = max(0.0, min(100.0, total_score / len(words)))
            else:
                accuracy = 0.0
            
            return AnalysisResponse(
                success=True,
                surah=surah_num,
                ayah=ayah_num,
                overall_accuracy=round(accuracy, 2),
                accuracy=round(accuracy, 2),
                error_count=len(all_errors),
                errors=all_errors,
                words=words,
                recitation_id=recitation_id,
                reference_phonemes=ref_seq,
                transcription=self._tokens_to_grapheme_text(heard_tokens),
            )
            
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Analysis orchestration failed: {e}")
            raise HTTPException(status_code=500, detail=f"Internal processing error: {str(e)}")
