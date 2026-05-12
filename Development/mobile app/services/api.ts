/**
 * Mujawwad API Service
 * Handles communication with the FastAPI backend for Tajweed analysis
 */

const API_BASE_URL = __DEV__
    ? 'http://127.0.0.1:8000'  // Development (FastAPI on port 8000)
    : 'https://production';  // Production

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

export interface TajweedError {
    position: number;
    recognized: string | null;
    expected: string | null;
    error_type: string;
    word: string;
}

export interface GraphemeScore {
    grapheme: string;
    score: number;
    index: number;
    phoneme?: string | null;
    tajweed_rule?: string | null;
}

export interface WordAnalysisResult {
    word_index: number;
    word_graphemes: string;
    start_time: number;
    end_time: number;
    word_score: number;
    graphemes: GraphemeScore[];
    feedback?: string | null;
}

export interface AnalysisResult {
    success: boolean;
    reference_phonemes?: string;
    transcription?: string;
    accuracy: number;
    error_count: number;
    errors: TajweedError[];
    words: WordAnalysisResult[];
}

async function fetchWithRetry(url: string, options: RequestInit, retries = MAX_RETRIES): Promise<Response> {
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const response = await fetch(url, options);
            if (response.ok || response.status < 500) {
                return response;
            }
            if (attempt < retries) {
                console.log(`Retry ${attempt + 1}/${retries} after ${response.status}...`);
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * Math.pow(2, attempt)));
            } else {
                return response;
            }
        } catch (error) {
            if (attempt < retries) {
                console.log(`Retry ${attempt + 1}/${retries} after network error...`);
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * Math.pow(2, attempt)));
            } else {
                throw error;
            }
        }
    }
    throw new Error('Max retries exceeded');
}

export async function analyzeRecitation(
    audioUri: string,
    surah: number,
    ayah: number
): Promise<AnalysisResult> {
    try {
        console.log('Starting analysis for:', { audioUri, surah, ayah });

        const response = await fetch(audioUri);
        const blob = await response.blob();

        const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const result = reader.result as string;
                const base64Data = result.includes(',')
                    ? result.split(',')[1]
                    : result;
                resolve(base64Data);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });

        console.log('Audio converted to base64, length:', base64.length);

        const apiResponse = await fetchWithRetry(`${API_BASE_URL}/analyze-json`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                audio_base64: base64,
                surah: surah,
                ayah: ayah,
            }),
        });

        console.log('Response status:', apiResponse.status);

        if (!apiResponse.ok) {
            const errorText = await apiResponse.text();
            console.error('API Error:', errorText);
            throw new Error(`HTTP error! status: ${apiResponse.status}`);
        }

        const result = await apiResponse.json();
        console.log('Analysis result:', result);
        return result;
    } catch (error) {
        console.error('Analysis failed:', error);
        throw error;
    }
}

export default {
    analyzeRecitation,
};
