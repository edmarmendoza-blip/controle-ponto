const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

class ElevenLabsService {
  constructor() {
    this._transcriptionCount = 0;
    this._transcriptionResetTime = Date.now();
    this._rateLimit = 20; // max transcriptions per hour
  }

  _checkRateLimit() {
    const now = Date.now();
    if (now - this._transcriptionResetTime > 3600000) { // 1 hour
      this._transcriptionCount = 0;
      this._transcriptionResetTime = now;
    }
    if (this._transcriptionCount >= this._rateLimit) {
      return false;
    }
    this._transcriptionCount++;
    return true;
  }

  /**
   * Speech-to-Text: transcribe audio file
   * @param {string} filePath - Path to audio file (ogg, mp3, wav, etc.)
   * @returns {Promise<{text: string, duration: number|null}>}
   */
  async transcribe(filePath) {
    if (!process.env.ELEVENLABS_API_KEY) {
      throw new Error('ELEVENLABS_API_KEY não configurada');
    }

    if (!this._checkRateLimit()) {
      throw new Error('Rate limit de transcrições atingido (20/hora)');
    }

    const form = new FormData();
    form.append('file', fs.createReadStream(filePath));
    form.append('model_id', 'scribe_v1');
    form.append('language_code', 'por');

    const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY,
        ...form.getHeaders()
      },
      body: form
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => 'Unknown error');
      throw new Error(`ElevenLabs STT error (${response.status}): ${errText}`);
    }

    const data = await response.json();
    console.log(`[ElevenLabs STT] Transcription: "${(data.text || '').substring(0, 100)}"`);
    return {
      text: data.text || '',
      duration: data.duration || null
    };
  }

  /**
   * Text-to-Speech: generate audio from text
   * @param {string} text - Text to convert to speech
   * @param {string} [voiceId] - Voice ID (default: Dorothy - friendly female)
   * @returns {Promise<string>} Path to generated audio file
   */
  async synthesize(text, voiceId = 'RGymW84CSmfVugnA5tvA') {
    if (!process.env.ELEVENLABS_API_KEY) {
      throw new Error('ELEVENLABS_API_KEY não configurada');
    }

    // Limit text length for TTS
    const truncatedText = text.substring(0, 500);

    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text: truncatedText,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75
        }
      })
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => 'Unknown error');
      throw new Error(`ElevenLabs TTS error (${response.status}): ${errText}`);
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    const outputDir = path.join(__dirname, '..', '..', 'public', 'uploads', 'whatsapp', 'tts');
    fs.mkdirSync(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, `response_${Date.now()}.mp3`);
    fs.writeFileSync(outputPath, audioBuffer);
    console.log(`[ElevenLabs TTS] Audio generated: ${outputPath}`);
    return outputPath;
  }

  /**
   * Clean up temp audio files older than 1 hour
   */
  cleanup() {
    try {
      const ttsDir = path.join(__dirname, '..', '..', 'public', 'uploads', 'whatsapp', 'tts');
      if (!fs.existsSync(ttsDir)) return;
      const files = fs.readdirSync(ttsDir);
      const oneHourAgo = Date.now() - 3600000;
      for (const file of files) {
        const filePath = path.join(ttsDir, file);
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs < oneHourAgo) {
          fs.unlinkSync(filePath);
        }
      }
    } catch (e) {
      console.error('[ElevenLabs] Cleanup error:', e.message);
    }
  }
}

module.exports = new ElevenLabsService();
