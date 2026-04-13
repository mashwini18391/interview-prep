// ============================================
// AI Interview Prep Coach — Web Speech API
// ============================================

class SpeechHandler {
  constructor() {
    this.recognition = null;
    this.isRecording = false;
    this.transcript = '';
    this.onResult = null;
    this.onStateChange = null;
    this.supported = this._checkSupport();
  }

  _checkSupport() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  init() {
    if (!this.supported) return false;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.recognition = new SpeechRecognition();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = 'en-US';

    this.recognition.onresult = (event) => {
      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += t;
        } else {
          interimTranscript += t;
        }
      }

      if (finalTranscript) {
        this.transcript += finalTranscript;
      }

      if (this.onResult) {
        this.onResult({
          final: this.transcript,
          interim: interimTranscript,
          combined: this.transcript + interimTranscript
        });
      }
    };

    this.recognition.onerror = (event) => {
      console.error('Speech recognition error:', event.error);
      if (event.error !== 'no-speech') {
        this.stop();
      }
    };

    this.recognition.onend = () => {
      if (this.isRecording) {
        // Restart if still supposed to be recording
        try { this.recognition.start(); } catch (e) { /* already started */ }
      } else {
        this._updateState(false);
      }
    };

    return true;
  }

  start(existingText = '') {
    if (!this.recognition) {
      if (!this.init()) return false;
    }

    this.transcript = existingText ? existingText + ' ' : '';
    this.isRecording = true;
    this._updateState(true);

    try {
      this.recognition.start();
      return true;
    } catch (e) {
      console.error('Failed to start speech recognition:', e);
      this.isRecording = false;
      this._updateState(false);
      return false;
    }
  }

  stop() {
    this.isRecording = false;
    if (this.recognition) {
      try { this.recognition.stop(); } catch (e) { /* not started */ }
    }
    this._updateState(false);
    return this.transcript;
  }

  toggle(existingText = '') {
    if (this.isRecording) {
      return this.stop();
    } else {
      this.start(existingText);
      return null;
    }
  }

  _updateState(recording) {
    if (this.onStateChange) {
      this.onStateChange(recording);
    }
  }

  destroy() {
    this.stop();
    this.recognition = null;
  }
}

export { SpeechHandler };
