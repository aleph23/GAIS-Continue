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
      // NOTE: We do NOT force sampleRate here. Forcing it can cause "Connecting AudioNodes from AudioContexts with different sample-rate" error
      // when connecting the microphone MediaStreamSource (which is hardware locked) to the context.
      // Instead, we accept the system rate and downsample manually in the processor.
      this.inputContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.outputContext = new (window.AudioContext || (window as any).webkitAudioContext)();

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
      // Cleanup if connection failed
      this.disconnect();
      this.onError(error.message);
      this.onStatusChange('ERROR');
      throw error; // Rethrow so caller knows it failed
    }
  }

  private async handleMessage(message: LiveServerMessage) {
    if (!this.outputContext) return;

    // Handle Audio Output
    const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
    if (base64Audio) {
      console.log("Received audio response chunk from Gemini");
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
    this.isProcessingFile = true; // Stop mic input

    const session = await this.sessionPromise;
    
    // Create a temporary AudioContext to decode the uploaded file
    const tempCtx = new (window.AudioContext || (window as any).webkitAudioContext)();

    try {
        console.log("Decoding audio file...");
        const arrayBuffer = await file.arrayBuffer();
        const decodedBuffer = await tempCtx.decodeAudioData(arrayBuffer);
        
        console.log("Resampling to 16kHz...");
        // Resample to 16kHz
        const resampledData = await resampleTo16k(decodedBuffer);
        
        console.log(`Sending ${resampledData.length} samples in chunks...`);

        // Stream the audio data in chunks to simulate realtime input
        const CHUNK_SIZE = 4000; // ~0.25 seconds of audio per chunk
        
        for (let i = 0; i < resampledData.length; i += CHUNK_SIZE) {
            const chunk = resampledData.slice(i, i + CHUNK_SIZE);
            const pcmBlob = createGeminiAudioBlob(chunk);
            session.sendRealtimeInput({ media: pcmBlob });
            // Small delay to prevent overwhelming the socket
            await new Promise(r => setTimeout(r, 10));
        }

        console.log("File audio sent. Sending prompt...");
        // Send a specific prompt to indicate the clip is finished and request continuation
        session.sendRealtimeInput({ 
            content: { parts: [{ text: "I have just played a melody. Continue it from where it left off." }] } 
        });
        
        console.log("Upload sequence complete.");

    } catch (e: any) {
        console.error("Error processing audio file:", e);
        throw new Error("Failed to process audio file: " + e.message);
    } finally {
        await tempCtx.close();
        this.isProcessingFile = false; // Resume mic input
    }
  }

  public disconnect() {
    this.isProcessingFile = false;
    
    if (this.sessionPromise) {
        // session.close() if available, else just drop references
        this.sessionPromise.then(s => {
            if (s && s.close) s.close();
        }).catch(() => {}); // Ignore errors on close
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
}
