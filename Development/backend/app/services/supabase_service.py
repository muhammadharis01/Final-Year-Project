import logging
from supabase import create_client, Client
from app.core.config import settings

logger = logging.getLogger(__name__)

class SupabaseService:
    def __init__(self):
        self.url = settings.SUPABASE_URL
        self.key = settings.SUPABASE_KEY
        self.client = None
        
        # Check if URL/Key are missing or still set to placeholders
        placeholders = ["your_supabase_url_here", "your_supabase_anon_key_here", ""]
        if not self.url or self.url in placeholders or not self.key or self.key in placeholders:
            logger.warning("Supabase URL or Key missing or invalid. Database and Storage features are disabled.")
            return
            
        try:
            self.client: Client = create_client(self.url, self.key)
            logger.info("Supabase client initialized successfully")
        except Exception as e:
            logger.error(f"Failed to initialize Supabase client: {e}")

    def save_recitation(self, session_id: str, surah_number: int, ayah_number: int, audio_url: str, raw_model_output: str | None, parsed_result: dict | None) -> int | None:
        """
        Saves a recitation record to the 'recitations' table.
        Returns the ID of the inserted record.
        """
        if not self.client:
            return None
            
        try:
            data = {
                "session_id": session_id,
                "surah_number": surah_number,
                "ayah_number": ayah_number,
                "audio_url": audio_url,
                "raw_model_output": raw_model_output,
                "parsed_result": parsed_result
            }
            response = self.client.table("recitations").insert(data).execute()
            if response.data and len(response.data) > 0:
                return response.data[0]['id']
            return None
        except Exception as e:
            logger.error(f"Failed to save recitation to Supabase: {e}")
            return None

    def save_feedback(self, recitation_id: int, word_index: int, is_accurate: bool) -> int | None:
        """
        Saves feedback to the 'feedback' table.
        Returns the ID of the inserted record.
        """
        if not self.client:
            # Return a dummy ID to avoid breaking local UI flows if requested
            return 0
            
        try:
            data = {
                "recitation_id": recitation_id,
                "word_index": word_index,
                "is_accurate": is_accurate
            }
            response = self.client.table("feedback").insert(data).execute()
            if response.data and len(response.data) > 0:
                return response.data[0]['id']
            return None
        except Exception as e:
            logger.error(f"Failed to save feedback to Supabase: {e}")
            return None

    def join_waitlist(self, email: str, source: str = 'results_modal') -> bool:
        """
        Saves an email to the 'waitlist' table.
        Returns True if successful.
        """
        if not self.client:
            return True # Mock success for local dev
            
        try:
            data = {
                "email": email,
                "source": source
            }
            # Upsert ensures that if the email exists, we don't throw an error
            self.client.table("waitlist").upsert(data, on_conflict="email").execute()
            return True
        except Exception as e:
            logger.error(f"Failed to join waitlist in Supabase: {e}")
            return False

    def upload_audio(self, file_bytes: bytes, filename: str) -> str | None:
        """
        Uploads audio to the 'beta-audios' bucket and returns the public URL.
        """
        if not self.client:
            return None
            
        try:
            # Upload the file
            bucket_name = "beta-audios"
            res = self.client.storage.from_(bucket_name).upload(
                file=file_bytes,
                path=filename,
                file_options={"content-type": "audio/webm"}
            )
            
            # Get public URL
            url = self.client.storage.from_(bucket_name).get_public_url(filename)
            return url
        except Exception as e:
            logger.error(f"Failed to upload audio to Supabase Storage: {e}")
            return None
