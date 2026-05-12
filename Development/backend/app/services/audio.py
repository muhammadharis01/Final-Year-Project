import io
import soundfile as sf
import tempfile
import os
import subprocess
import numpy as np
from fastapi import UploadFile, HTTPException

class AudioProcessor:
    def __init__(self, target_sr: int = 16000):
        self.target_sr = target_sr

    async def process(self, audio_file: UploadFile) -> np.ndarray:
        """
        Reads UploadFile and writes to a temporary file. 
        Browsers natively record in WebM/MP4, which soundfile cannot read in-memory.
        We explicitly use ffmpeg via subprocess to convert it to a WAV file, 
        then read with soundfile (avoids deprecated librosa audioread fallbacks).
        """
        tmp_in_path = ""
        tmp_out_path = ""
        try:
            content = await audio_file.read()
            
            # Create temporary files
            with tempfile.NamedTemporaryFile(delete=False, suffix=".webm") as tmp_in:
                tmp_in.write(content)
                tmp_in_path = tmp_in.name
                
            with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as tmp_out:
                tmp_out_path = tmp_out.name
                
            try:
                # Compile ffmpeg command to forcefully decode the inbound WebM/MP4 
                # into a mono streaming 16kHz WAV file.
                cmd = [
                    "ffmpeg",
                    "-y",             # Overwrite output file flag
                    "-i", tmp_in_path,# Input file
                    "-ar", str(self.target_sr), # Sample rate
                    "-ac", "1",       # Channels (1 = mono)
                    tmp_out_path      # Output file
                ]
                
                # Execute ffmpeg synchronously
                # Timeout to prevent zombies, capture output for debugging
                process = subprocess.run(
                    cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10
                )
                
                if process.returncode != 0:
                    error_msg = process.stderr.decode('utf-8')
                    raise RuntimeError(f"FFmpeg conversion failed: {error_msg}")
                    
                # Read the resulting native WAV file clean with soundfile
                audio, _ = sf.read(tmp_out_path)
                return audio.astype(np.float32)
                
            finally:
                # Ensure we clean up BOTH temporary files immediately
                if os.path.exists(tmp_in_path):
                    os.unlink(tmp_in_path)
                if os.path.exists(tmp_out_path):
                    os.unlink(tmp_out_path)
                    
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid audio format or unable to process: {str(e)}")
