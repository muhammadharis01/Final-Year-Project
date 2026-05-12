import logging
from dataclasses import dataclass
from typing import List, Dict, Any, Optional, Tuple

import torch
import torchaudio.functional as F_audio
from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor

logger = logging.getLogger(__name__)


@dataclass
class PhonemeSpan:
    token_id: int
    phoneme: str
    start_frame: int
    end_frame: int
    log_prob: float
    gop: float
    gop_percentage: float


@dataclass
class WordGopResult:
    word_index: int
    graphemes: str
    marked_graphemes: str
    start_time: float
    end_time: float
    gop_score: float
    phoneme_spans: List[PhonemeSpan]
    mispronounced_segments: List[Dict[str, Any]]


class GopAnalyzerService:
    """
    End-to-end GoP-based analysis built around a CTC model.

    Responsibilities:
    - Load Wav2Vec2 model + processor.
    - Run inference to obtain logits and log softmax.
    - Perform CTC forced alignment using reference phoneme ids.
    - Compute per-phoneme and per-word GoP scores.
    - Group by '|' into words and mark low-GoP graphemes.
    """

    FRAME_SHIFT_SECONDS = 0.02  # 20ms frames

    def __init__(self, model_id: str, phoneme_to_grapheme_map: Dict[str, str]):
        self.phoneme_to_grapheme_map = phoneme_to_grapheme_map

        try:
            self.processor = Wav2Vec2Processor.from_pretrained(model_id)
            self.model = Wav2Vec2ForCTC.from_pretrained(model_id)

            device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
            self.model.to(device)
            self.device = device

            # Cache some token ids
            self.blank_id = self.processor.tokenizer.pad_token_id
            self.pipe_delim_id = self.processor.tokenizer.convert_tokens_to_ids("|")
        except Exception as e:
            logger.error(f"Failed to load GoP model: {e}")
            raise RuntimeError(f"Could not load GoP model: {e}")

    def _calculate_gop(self, audio_log_probs: torch.Tensor, start_frame: int, end_frame: int, target_id: int) -> float:
        """
        Calculate raw GoP score for a single phoneme span.
        """
        segment_log_probs = audio_log_probs[start_frame:end_frame]
        if segment_log_probs.numel() == 0:
            return -100.0

        target_probs = segment_log_probs[:, target_id]
        max_probs, _ = torch.max(segment_log_probs, dim=1)
        frame_gop = target_probs - max_probs
        gop_score = torch.mean(frame_gop).item()
        return gop_score

    @staticmethod
    def _normalize_gop(raw_gop: float, strictness: float = 15.0) -> float:
        """
        Map raw GoP (usually <= 0) into a 0-100 range.
        """
        scaled_score = 100.0 + (raw_gop * strictness)
        return max(0.0, min(100.0, scaled_score))

    def _calculate_word_score(self, word_spans: List[PhonemeSpan]) -> float:
        """
        Aggregate a word's phoneme spans into a single 0-100 score.
        Currently uses an unweighted mean of phoneme percentages.
        """
        if not word_spans:
            return 0.0
        total = sum(span.gop_percentage for span in word_spans)
        return total / len(word_spans)

    def _forced_align(
        self, log_probs: torch.Tensor, ref_ids: List[int]
    ) -> Tuple[List[F_audio.TokenSpan], torch.Tensor]:
        """
        Wrapper around torchaudio forced alignment.
        """
        refs = torch.tensor([ref_ids], dtype=torch.int32, device=log_probs.device)
        alignments, scores = F_audio.forced_align(
            log_probs, refs, blank=self.blank_id
        )
        merged = F_audio.merge_tokens(alignments[0], scores[0])
        return merged, log_probs.squeeze(0)

    def _token_id_to_phoneme(self, token_id: int) -> str:
        return self.processor.tokenizer.convert_ids_to_tokens(token_id)

    def analyze(
        self,
        audio_array,
        ref_phoneme_seq: str,
        ref_grapheme_words: List[str],
        strictness: float = 15.0,
        phoneme_bad_threshold: float = 60.0,
        word_good_threshold: float = 75.0,
    ) -> Tuple[List[WordGopResult], str, List[str]]:
        """
        Main entrypoint: run inference, forced alignment, GoP and word aggregation.
        """
        # 1) Run model to get logits and log_probs
        with torch.inference_mode():
            processed = self.processor(
                audio_array,
                sampling_rate=16000,
                return_tensors="pt",
                padding=True,
            )
            input_values = processed.input_values.to(self.device)
            output = self.model(input_values)
            logits = output.logits  # (1, T, V)
            
            # Greedy search for raw prediction (what the model thinks it hears without constraints)
            predicted_ids = torch.argmax(logits, dim=-1)
            raw_prediction = self.processor.batch_decode(predicted_ids)[0]
            logger.info(f"--- Tajweed Analysis Debug ---")
            logger.info(f"Reference Phonemes: {ref_phoneme_seq}")
            logger.info(f"Raw Model Prediction: {raw_prediction}")
            logger.info(f"------------------------------")
            
            # --- Hard Output (Top Guess) ---
            predicted_ids = torch.argmax(logits, dim=-1)
            hard_output = self.processor.batch_decode(predicted_ids)[0]

            # Collapse CTC repeats and drop blanks → ordered list of phoneme tokens
            # the model actually predicted. Used to render "what we heard".
            hard_tokens: List[str] = []
            prev_id = -1
            for tok_id in predicted_ids[0].tolist():
                if tok_id == self.blank_id or tok_id == prev_id:
                    prev_id = tok_id
                    continue
                prev_id = tok_id
                hard_tokens.append(self._token_id_to_phoneme(tok_id))

            log_probs = torch.log_softmax(logits, dim=-1)  # (1, T, V)

        # 2) Prepare reference ids
        # Remove spaces so tokenizer sees individual symbols including '|'
        ref_ids = self.processor.tokenizer(
            ref_phoneme_seq.replace(" ", "")
        ).input_ids

        # 3) Forced alignment
        token_spans, audio_log_probs = self._forced_align(log_probs, ref_ids)

        # 4) Build PhonemeSpan list with GoP
        phoneme_spans: List[PhonemeSpan] = []
        for span in token_spans:
            token_id = int(span.token)
            if token_id == self.blank_id:
                continue

            raw_gop = self._calculate_gop(
                audio_log_probs, span.start, span.end, token_id
            )
            gop_pct = self._normalize_gop(raw_gop, strictness=strictness)

            phoneme = self._token_id_to_phoneme(token_id)
            phoneme_spans.append(
                PhonemeSpan(
                    token_id=token_id,
                    phoneme=phoneme,
                    start_frame=int(span.start),
                    end_frame=int(span.end),
                    log_prob=float(span.score),
                    gop=raw_gop,
                    gop_percentage=gop_pct,
                )
            )

        # 5) Group into words based on '|' token
        words: List[WordGopResult] = []
        current_word_spans: List[PhonemeSpan] = []
        word_index = 0

        def flush_current_word():
            nonlocal word_index, current_word_spans
            if not current_word_spans:
                return

            word_start = current_word_spans[0].start_frame * self.FRAME_SHIFT_SECONDS
            word_end = current_word_spans[-1].end_frame * self.FRAME_SHIFT_SECONDS
            word_score = self._calculate_word_score(current_word_spans)

            graphemes = (
                ref_grapheme_words[word_index]
                if word_index < len(ref_grapheme_words)
                else f"word_{word_index}"
            )

            # Build per-span grapheme offsets by sequentially "rendering" graphemes
            # from phoneme->grapheme mapping.
            offsets: List[Tuple[int, int]] = []
            cursor = 0
            for sp in current_word_spans:
                g = self.phoneme_to_grapheme_map.get(sp.phoneme, sp.phoneme)
                start_i = cursor
                end_i = cursor + len(g)
                offsets.append((start_i, end_i))
                cursor = end_i

            mispronounced_segments: List[Dict[str, Any]] = []
            for idx, span in enumerate(current_word_spans):
                if span.gop_percentage < phoneme_bad_threshold:
                    g = self.phoneme_to_grapheme_map.get(span.phoneme, span.phoneme)
                    start_i, end_i = offsets[idx]
                    mispronounced_segments.append(
                        {
                            "grapheme": g,
                            "phoneme": span.phoneme,
                            "gop_score": span.gop_percentage,
                            "start_index": start_i,
                            "end_index": end_i,
                        }
                    )

            # Construct a marked word string (wrap low-GoP segments in [])
            # We rely on offsets derived from phoneme->grapheme concatenation.
            marked = []
            for idx, span in enumerate(current_word_spans):
                g = self.phoneme_to_grapheme_map.get(span.phoneme, span.phoneme)
                if span.gop_percentage < phoneme_bad_threshold:
                    marked.append(f"[{g}]")
                else:
                    marked.append(g)
            marked_graphemes = "".join(marked)

            words.append(
                WordGopResult(
                    word_index=word_index,
                    graphemes=graphemes,
                    marked_graphemes=marked_graphemes,
                    start_time=word_start,
                    end_time=word_end,
                    gop_score=word_score,
                    phoneme_spans=current_word_spans.copy(),
                    mispronounced_segments=mispronounced_segments,
                )
            )
            current_word_spans = []
            word_index += 1

        for span in phoneme_spans:
            if span.token_id == self.pipe_delim_id:
                flush_current_word()
            else:
                current_word_spans.append(span)

        # Last word if sentence did not end with '|'
        flush_current_word()

        return words, hard_output, hard_tokens
