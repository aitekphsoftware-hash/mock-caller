export interface VADOptions {
  analyserNode: AnalyserNode;
  onSpeechStart: () => void;
  onSpeechEnd: () => void;
  threshold?: number;
  silenceTimeout?: number;
}

/**
 * A simple Voice Activity Detector that uses the Web Audio API's AnalyserNode
 * to determine if a user is speaking.
 */
export class VoiceActivityDetector {
  private analyserNode: AnalyserNode;
  private onSpeechStart: () => void;
  private onSpeechEnd: () => void;
  private threshold: number;
  private silenceTimeout: number;

  private speaking = false;
  private silenceTimeoutId: number | null = null;

  constructor(options: VADOptions) {
    this.analyserNode = options.analyserNode;
    this.onSpeechStart = options.onSpeechStart;
    this.onSpeechEnd = options.onSpeechEnd;
    this.threshold = options.threshold ?? 0.02;
    this.silenceTimeout = options.silenceTimeout ?? 800;
  }

  /**
   * Processes the current audio frame to detect speech. This should be called
   * repeatedly, for example, within a ScriptProcessorNode.onaudioprocess event.
   */
  process() {
    const dataArray = new Uint8Array(this.analyserNode.frequencyBinCount);
    this.analyserNode.getByteTimeDomainData(dataArray);
    const sum = dataArray.reduce((acc, val) => acc + Math.abs(val - 128), 0);
    const level = sum / dataArray.length / 128;

    if (level > this.threshold) {
      if (!this.speaking) {
        this.speaking = true;
        this.onSpeechStart();
      }
      if (this.silenceTimeoutId) {
        window.clearTimeout(this.silenceTimeoutId);
        this.silenceTimeoutId = null;
      }
    } else if (this.speaking && !this.silenceTimeoutId) {
      this.silenceTimeoutId = window.setTimeout(() => {
        this.speaking = false;
        this.onSpeechEnd();
        this.silenceTimeoutId = null;
      }, this.silenceTimeout);
    }
  }

  /**
   * Stops the VAD and cleans up any pending timeouts.
   */
  stop() {
    if (this.silenceTimeoutId) {
        window.clearTimeout(this.silenceTimeoutId);
        this.silenceTimeoutId = null;
    }
    this.speaking = false;
  }
}
