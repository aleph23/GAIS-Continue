import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { createGeminiAudioBlob, decodePCM, pcmToAudioBuffer, encodePCM, resampleTo16k } from '../utils/audioUtils';
import { INPUT_SAMPLE_RATE, OUTPUT_SAMPLE_RATE } from '../types';

export class LiveManager {
  private ai: GoogleGenAI;
  private inputContext: AudioContext | null = null;
  private outputContext: AudioContext | null = null;
  private session: any = null; // Session type isn't fully exported yet in some versions, using any for safety
  private sessionPromise: Promise<any> | null = null;
  private nextStartTime = 0;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private inputSource: MediaStreamAudioSourceNode | null = null;
  private inputAnalyser: AnalyserNode | null = null;
  private outputAnalyser: AnalyserNode | null = null;
  
  // Callback for status updates
  public onStatusChange: (status: string) => void = () => {};
  public onError: (error: string) => void = () => {};

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  public async connect() {
    try {
      this.onStatusChange('CONNECTING');
      
      // Initialize Audio Contexts
      this.inputContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: INPUT_SAMPLE_RATE,
      });
      this.outputContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: OUTPUT_SAMPLE_RATE,
      });

      // Analysers for visualization
      this.inputAnalyser = this.inputContext.createAnalyser();
      this.inputAnalyser.fftSize = 256;
      this.outputAnalyser = this.outputContext.createAnalyser();
      this.outputAnalyser.fftSize = 256;

      // Start Microphone Stream
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.inputSource = this.inputContext.createMediaStreamSource(stream);
      this.inputSource.connect(this.inputAnalyser);

      // Process Audio Input
      // Using ScriptProcessor as per Gemini examples (AudioWorklet is better modern practice, but sticking to provided patterns)
      this.scriptProcessor = this.inputContext.createScriptProcessor(4096, 1, 1);
      
      this.scriptProcessor.onaudioprocess = (e) => {
        if (!this.sessionPromise) return;

        const inputData = e.inputBuffer.getChannelData(0);
        const pcmBlob = createGeminiAudioBlob(inputData);
        
        this.sessionPromise.then(session => {
          try {
            session.sendRealtimeInput({ media: pcmBlob });
          } catch (err) {
            console.error("Error sending audio chunk", err);
          }
        });
      };

      this.inputSource.connect(this.scriptProcessor);
      this.scriptProcessor.connect(this.inputContext.destination);

      // Connect to Gemini
      this.sessionPromise = this.ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            this.onStatusChange('CONNECTED');
            console.log('Gemini Live Session Opened');
          },
          onmessage: this.handleMessage.bind(this),
          onclose: () => {
            this.onStatusChange('DISCONNECTED');
            console.log('Gemini Live Session Closed');
          },
          onerror: (err) => {
            this.onStatusChange('ERROR');
            this.onError(err.message || 'Unknown error');
            console.error('Gemini Live Error:', err);
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: `You are a world-class musical improviser. 
          Your goal is to complete the user's musical idea seamlessly.
          If the user sings, hums, or plays a melody, continue it in the same key, tempo, and style.
          If the user is silent, wait.
          DO NOT SPEAK. ONLY GENERATE MUSICAL AUDIO (singing, humming, beatboxing, or whistling).
          Be creative and expressive.`,
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } }, // Kore has a nice tone
          },
        }
      });

    } catch (error: any) {
      this.onError(error.message);
      this.onStatusChange('ERROR');
    }
  }

  private async handleMessage(message: LiveServerMessage) {
    if (!this.outputContext) return;

    // Handle Audio Output
    const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
    if (base64Audio) {
      this.nextStartTime = Math.max(this.nextStartTime, this.outputContext.currentTime);
      
      try {
        const audioBuffer = await pcmToAudioBuffer(
            decodePCM(base64Audio),
            this.outputContext,
            OUTPUT_SAMPLE_RATE
        );
        
        const source = this.outputContext.createBufferSource();
        source.buffer = audioBuffer;
        
        // Connect to analyser and destination
        if (this.outputAnalyser) {
            source.connect(this.outputAnalyser);
            this.outputAnalyser.connect(this.outputContext.destination);
        } else {
            source.connect(this.outputContext.destination);
        }

        source.start(this.nextStartTime);
        this.nextStartTime += audioBuffer.duration;
        
      } catch (e) {
        console.error("Error decoding audio response", e);
      }
    }

    // Handle interruptions
    if (message.serverContent?.interrupted) {
      this.nextStartTime = 0;
      // In a real app we might want to cancel currently playing nodes, 
      // but simple queue management handles most overlapping nicely by simple time reset if logic allows.
      // For strict cancellation we'd need to track active sources.
    }
  }

  public async sendAudioFile(file: File) {
    if (!this.sessionPromise) {
        throw new Error("Session not active");
    }

    const session = await this.sessionPromise;
    
    // Create a temporary AudioContext to decode the uploaded file
    const tempCtx = new (window.AudioContext || (window as any).webkitAudioContext)();

    try {
        const arrayBuffer = await file.arrayBuffer();
        const decodedBuffer = await tempCtx.decodeAudioData(arrayBuffer);
        
        // Resample to 16kHz
        const resampledData = await resampleTo16k(decodedBuffer);
        
        // Stream the audio data in chunks to simulate realtime input
        // Using larger chunks than realtime to speed up "upload" but small enough for server buffering
        const CHUNK_SIZE = 4000; // ~0.25 seconds of audio per chunk
        
        for (let i = 0; i < resampledData.length; i += CHUNK_SIZE) {
            const chunk = resampledData.slice(i, i + CHUNK_SIZE);
            const pcmBlob = createGeminiAudioBlob(chunk);
            session.sendRealtimeInput({ media: pcmBlob });
            // Small delay to prevent overwhelming the socket
            await new Promise(r => setTimeout(r, 10));
        }

        // Send a specific prompt to indicate the clip is finished and request continuation
        session.sendRealtimeInput({ 
            content: { parts: [{ text: "I have just played a melody. Continue it from where it left off." }] } 
        });

    } catch (e: any) {
        console.error("Error processing audio file:", e);
        throw new Error("Failed to process audio file: " + e.message);
    } finally {
        await tempCtx.close();
    }
  }

  public disconnect() {
    if (this.sessionPromise) {
        // session.close() if available, else just drop references
        this.sessionPromise.then(s => {
            if (s.close) s.close();
        });
    }
    
    if (this.scriptProcessor) {
        this.scriptProcessor.disconnect();
        this.scriptProcessor.onaudioprocess = null;
    }
    
    if (this.inputSource) {
        this.inputSource.disconnect();
    }

    if (this.inputContext) {
        this.inputContext.close();
    }
    
    if (this.outputContext) {
        this.outputContext.close();
    }

    this.sessionPromise = null;
    this.inputContext = null;
    this.outputContext = null;
    this.nextStartTime = 0;
    this.onStatusChange('DISCONNECTED');
  }

  public getInputAnalyser() { return this.inputAnalyser; }
  public getOutputAnalyser() { return this.outputAnalyser; }
}
