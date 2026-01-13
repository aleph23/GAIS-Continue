import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { createGeminiAudioBlob, decodePCM, pcmToAudioBuffer, encodePCM, resampleTo16k, downsampleTo16k } from '../utils/audioUtils';
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
  private isProcessingFile = false; // Flag to mute mic during upload
  private hasActiveMic = false;
  
  // Callback for status updates
  public onStatusChange: (status: string) => void = () => {};
  public onError: (error: string) => void = () => {};
  public onTextReceived: (text: string) => void = () => {};

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  public async connect() {
    try {
      this.onStatusChange('CONNECTING');
      
      // Initialize Audio Contexts
      this.inputContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.outputContext = new (window.AudioContext || (window as any).webkitAudioContext)();

      // Ensure output context is running (browsers often suspend it until user interaction)
      if (this.outputContext.state === 'suspended') {
        await this.outputContext.resume();
      }

      // Analysers for visualization
      this.inputAnalyser = this.inputContext.createAnalyser();
      this.inputAnalyser.fftSize = 256;
      this.outputAnalyser = this.outputContext.createAnalyser();
      this.outputAnalyser.fftSize = 256;

      // Attempt to Start Microphone Stream (Optional)
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this.inputSource = this.inputContext.createMediaStreamSource(stream);
        this.inputSource.connect(this.inputAnalyser);

        // Process Audio Input
        this.scriptProcessor = this.inputContext.createScriptProcessor(4096, 1, 1);
        
        this.scriptProcessor.onaudioprocess = (e) => {
          // Prevent mic input if session is missing, context is missing, OR if we are currently uploading a file
          if (!this.sessionPromise || !this.inputContext || this.isProcessingFile) return;

          const inputData = e.inputBuffer.getChannelData(0);
          
          // Downsample to 16kHz before sending
          const downsampledData = downsampleTo16k(inputData, this.inputContext.sampleRate);
          const pcmBlob = createGeminiAudioBlob(downsampledData);
          
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
        this.hasActiveMic = true;

      } catch (micErr) {
        console.warn("Microphone access denied or unavailable. Continuing in receive-only/file-upload mode.", micErr);
        this.hasActiveMic = false;
        // Do not fail the whole connection; just skip mic setup
      }

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
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
          },
        }
      });
      
    } catch (error: any) {
      // Cleanup if connection failed
      this.disconnect();
      this.onError(error.message);
      this.onStatusChange('ERROR');
      throw error; // Rethrow so caller knows it failed
    }
  }

  private async handleMessage(message: LiveServerMessage) {
    if (!this.outputContext) return;

    // Handle Text and Audio from Model Turn
    const parts = message.serverContent?.modelTurn?.parts || [];
    
    for (const part of parts) {
      // 1. Handle Text Response (logging it for debugging)
      if (part.text) {
        console.log("AI Text Response:", part.text);
        this.onTextReceived(part.text);
      }

      // 2. Handle Audio Response
      if (part.inlineData?.data) {
        const base64Audio = part.inlineData.data;
        // console.log(`Received audio chunk: ${base64Audio.length} bytes`);
        
        // Ensure time is monotonic
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
    }

    // Handle interruptions
    if (message.serverContent?.interrupted) {
      console.log("Audio interrupted");
      this.nextStartTime = 0;
    }
    
    if (message.serverContent?.turnComplete) {
      console.log("Turn complete");
    }
  }

  public async sendAudioFile(file: File) {
    if (!this.sessionPromise) {
        throw new Error("Session not active");
    }

    console.log("Starting file upload:", file.name);
    this.isProcessingFile = true; // Stop mic input if active
    
    if (this.outputContext && this.outputContext.state === 'suspended') {
      await this.outputContext.resume();
    }
    if (this.inputContext && this.inputContext.state === 'suspended') {
      await this.inputContext.resume();
    }

    // Decode audio first
    // We use inputContext to decode if available to share resources, otherwise new context
    const decodeCtx = this.inputContext || new (window.AudioContext || (window as any).webkitAudioContext)();
    let resampledData: Float32Array;

    try {
        console.log("Decoding audio file...");
        const arrayBuffer = await file.arrayBuffer();
        const decodedBuffer = await decodeCtx.decodeAudioData(arrayBuffer);
        
        console.log("Normalizing and resampling to 16kHz...");
        resampledData = await resampleTo16k(decodedBuffer);
        
        // Normalize volume (Simple Peak Normalization)
        let maxVal = 0;
        for (let i = 0; i < resampledData.length; i++) {
            if (Math.abs(resampledData[i]) > maxVal) maxVal = Math.abs(resampledData[i]);
        }
        if (maxVal > 0) {
            const scale = 0.95 / maxVal; // Leave a little headroom
            console.log(`Normalizing audio gain by factor of ${scale.toFixed(2)}`);
            for (let i = 0; i < resampledData.length; i++) {
                resampledData[i] *= scale;
            }
        }

    } catch (e: any) {
        console.error("Error decoding audio file:", e);
        this.isProcessingFile = false;
        throw new Error("Failed to decode audio file: " + e.message);
    }

    // Try to stream the data, with one retry attempt
    try {
        await this.streamAudioData(resampledData);
    } catch (e: any) {
        console.error("Stream failed:", e);
        
        // Retry logic for connection issues
        if (e.message?.includes('unavailable') || e.message?.includes('timeout') || e.message?.includes('closed') || e.message?.includes('Session not active')) {
            console.log("Connection issue detected. Attempting to reconnect and retry upload...");
            this.disconnect();
            await this.connect();
            // Retry once
            await this.streamAudioData(resampledData);
        } else {
            throw e;
        }
    } finally {
        this.isProcessingFile = false; // Resume mic input
    }
  }

  private async streamAudioData(data: Float32Array) {
      if (!this.sessionPromise) throw new Error("Session not active");
      const session = await this.sessionPromise;

      console.log(`Streaming ${data.length} samples...`);

      // 8192 samples @ 16kHz = ~0.512 seconds
      // Sending every 50ms = ~10x speed.
      const CHUNK_SIZE = 8192; 
      
      // VISUALIZATION SETUP
      // We want to visualize this data as it goes out.
      // We can use the inputContext and inputAnalyser
      if (this.inputContext && this.inputAnalyser) {
          // Create a buffer for the whole file to play into the analyser (muted at destination)
          // This is purely for visual feedback
          try {
             const vizBuffer = this.inputContext.createBuffer(1, data.length, 16000);
             vizBuffer.copyToChannel(data, 0);
             const vizSource = this.inputContext.createBufferSource();
             vizSource.buffer = vizBuffer;
             vizSource.connect(this.inputAnalyser);
             // Do NOT connect to destination, or user hears it twice/echo
             // Start it now, it will play at 1x speed visually, while we upload at 10x speed.
             // This mismatch is acceptable, or we can playback faster.
             vizSource.playbackRate.value = 5.0; // Match upload speed roughly
             vizSource.start();
          } catch(e) { console.warn("Viz error", e)}
      }

      for (let i = 0; i < data.length; i += CHUNK_SIZE) {
          const chunk = data.slice(i, i + CHUNK_SIZE);
          const pcmBlob = createGeminiAudioBlob(chunk);
          
          try {
            session.sendRealtimeInput({ media: pcmBlob });
          } catch(e) {
             throw new Error("Failed to send chunk: " + e);
          }
          
          await new Promise(r => setTimeout(r, 50));
      }

      console.log("File audio sent. Sending completion prompt...");
      // Explicitly ask for response
      session.sendRealtimeInput({ 
          content: { parts: [{ text: "I have finished playing. Generate a musical continuation now." }] } 
      });
      console.log("Upload sequence complete.");
  }

  public disconnect() {
    this.isProcessingFile = false;
    this.hasActiveMic = false;
    
    if (this.sessionPromise) {
        this.sessionPromise.then(s => {
            if (s && s.close) s.close();
        }).catch(() => {});
    }
    
    if (this.scriptProcessor) {
        this.scriptProcessor.disconnect();
        this.scriptProcessor.onaudioprocess = null;
    }
    
    if (this.inputSource) {
        this.inputSource.disconnect();
    }

    if (this.inputContext && this.inputContext.state !== 'closed') {
        this.inputContext.close();
    }
    
    if (this.outputContext && this.outputContext.state !== 'closed') {
        this.outputContext.close();
    }

    this.sessionPromise = null;
    this.inputContext = null;
    this.outputContext = null;
    this.scriptProcessor = null;
    this.inputSource = null;
    this.nextStartTime = 0;
    this.onStatusChange('DISCONNECTED');
  }

  public getInputAnalyser() { return this.inputAnalyser; }
  public getOutputAnalyser() { return this.outputAnalyser; }
  public isMicEnabled() { return this.hasActiveMic; }
}