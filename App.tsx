import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Music, Activity, AlertCircle, FileAudio, MessageSquare } from 'lucide-react';
import { LiveManager } from './services/liveManager';
import Visualizer from './components/Visualizer';
import FileUpload from './components/FileUpload';
import { ConnectionState } from './types';

const API_KEY = process.env.API_KEY || '';

const App: React.FC = () => {
  const [connectionState, setConnectionState] = useState<string>(ConnectionState.DISCONNECTED);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isMicActive, setIsMicActive] = useState(false);
  const [aiText, setAiText] = useState<string | null>(null);
  const liveManagerRef = useRef<LiveManager | null>(null);

  // Analysers for visualization
  const [inputAnalyser, setInputAnalyser] = useState<AnalyserNode | null>(null);
  const [outputAnalyser, setOutputAnalyser] = useState<AnalyserNode | null>(null);

  useEffect(() => {
    if (!API_KEY) {
      setError("API Key is missing. Please set process.env.API_KEY.");
      setConnectionState(ConnectionState.ERROR);
    }
    
    // Cleanup on unmount
    return () => {
      if (liveManagerRef.current) {
        liveManagerRef.current.disconnect();
      }
    };
  }, []);

  const startSession = async () => {
    setError(null);
    setAiText(null);
    // Always start fresh if we are starting a session
    if (liveManagerRef.current) {
        liveManagerRef.current.disconnect();
    }
    
    const manager = new LiveManager(API_KEY);
    liveManagerRef.current = manager;

    manager.onStatusChange = (status) => {
      setConnectionState(status);
      if (status === 'CONNECTED') {
        setInputAnalyser(manager.getInputAnalyser());
        setOutputAnalyser(manager.getOutputAnalyser());
        setIsMicActive(manager.isMicEnabled());
      } else if (status === 'DISCONNECTED') {
        setIsMicActive(false);
      }
    };

    manager.onError = (err) => {
      setError(err);
    };

    manager.onTextReceived = (text) => {
      setAiText(text);
      // Clear text after a few seconds if it's just a short acknowledgment, 
      // but keep if it's an instruction
      setTimeout(() => setAiText(null), 5000);
    };

    try {
        await manager.connect();
        return manager;
    } catch (e) {
        console.error("Connection failed", e);
        throw e;
    }
  };

  const toggleConnection = async () => {
    if (connectionState === ConnectionState.CONNECTED || connectionState === ConnectionState.CONNECTING) {
      liveManagerRef.current?.disconnect();
      liveManagerRef.current = null;
      setConnectionState(ConnectionState.DISCONNECTED);
      setInputAnalyser(null);
      setOutputAnalyser(null);
      setIsMicActive(false);
      setAiText(null);
    } else {
      await startSession();
    }
  };

  const handleFileUpload = async (file: File) => {
    if (isUploading) return;
    
    setIsUploading(true);
    setError(null);
    setAiText(null);

    try {
      let manager = liveManagerRef.current;
      
      const isDisconnected = !manager || 
                             connectionState === ConnectionState.DISCONNECTED || 
                             connectionState === ConnectionState.ERROR;
                             
      if (isDisconnected) {
        manager = await startSession();
      } else if (connectionState === ConnectionState.CONNECTING) {
         throw new Error("Connection in progress. Please wait a moment.");
      }
      
      if (!manager) {
          throw new Error("Failed to initialize session");
      }

      await manager.sendAudioFile(file);
    } catch (e: any) {
      console.error("Upload process failed", e);
      setError(e.message || "Upload failed");
    } finally {
      setIsUploading(false);
    }
  };

  const isConnected = connectionState === ConnectionState.CONNECTED;
  const isConnecting = connectionState === ConnectionState.CONNECTING;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-4 relative overflow-hidden">
      
      {/* Background Ambience */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-purple-900/20 rounded-full blur-[128px]"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-cyan-900/20 rounded-full blur-[128px]"></div>
      </div>

      <div className="z-10 w-full max-w-4xl flex flex-col items-center gap-8">
        
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-5xl font-black bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-purple-500 tracking-tight">
            Melody Weaver
          </h1>
          <p className="text-slate-400 text-lg max-w-md mx-auto">
            Sing, hum, or upload a melody. AI will listen and weave a continuation in real-time.
          </p>
        </div>

        {/* Main Controls */}
        <div className="flex flex-col items-center gap-6 w-full">
          
          {/* Visualizers Container */}
          <div className="w-full grid grid-cols-1 md:grid-cols-2 gap-4 h-48">
            {/* Input Visualizer */}
            <div className="relative bg-slate-900/50 border border-slate-800 rounded-xl overflow-hidden backdrop-blur-sm shadow-xl">
              <div className="absolute top-2 left-3 text-xs font-bold text-cyan-500 uppercase tracking-widest flex items-center gap-2">
                {isMicActive ? <Mic size={12} /> : <FileAudio size={12} />} 
                {isMicActive ? 'Mic Input' : 'File Input'}
              </div>
              <div className="w-full h-full p-2">
                <Visualizer 
                  analyser={inputAnalyser} 
                  color="#22d3ee" 
                  isActive={isConnected && (isMicActive || isUploading)} 
                />
              </div>
            </div>

            {/* Output Visualizer */}
            <div className="relative bg-slate-900/50 border border-slate-800 rounded-xl overflow-hidden backdrop-blur-sm shadow-xl">
               <div className="absolute top-2 left-3 text-xs font-bold text-purple-500 uppercase tracking-widest flex items-center gap-2">
                <Music size={12} /> AI Response
              </div>
              <div className="w-full h-full p-2">
                <Visualizer 
                  analyser={outputAnalyser} 
                  color="#a855f7" 
                  isActive={isConnected} 
                />
              </div>
              {/* AI Text Overlay */}
              {aiText && (
                <div className="absolute bottom-4 left-4 right-4 bg-slate-950/80 p-3 rounded-lg border border-purple-500/30 text-sm text-purple-200 backdrop-blur flex items-start gap-2 animate-in fade-in slide-in-from-bottom-2">
                  <MessageSquare size={16} className="mt-0.5 shrink-0" />
                  <span>{aiText}</span>
                </div>
              )}
            </div>
          </div>

          {/* Action Area */}
          <div className="flex flex-wrap justify-center items-center gap-6 mt-4">
            
            {/* Main Toggle Button */}
            <button
              onClick={toggleConnection}
              disabled={isConnecting}
              title={isMicActive ? "Mute Microphone / Disconnect" : "Disconnect / Connect Mic"}
              className={`
                relative flex items-center justify-center w-24 h-24 rounded-full transition-all duration-500
                ${isConnected 
                  ? 'bg-red-500/10 text-red-500 border-2 border-red-500/50 hover:bg-red-500/20 shadow-[0_0_30px_rgba(239,68,68,0.3)]' 
                  : 'bg-cyan-500 text-slate-950 hover:bg-cyan-400 shadow-[0_0_30px_rgba(34,211,238,0.4)]'
                }
                ${isConnecting ? 'opacity-50 cursor-wait scale-90' : 'scale-100'}
              `}
            >
              {isConnecting ? (
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-current"></div>
              ) : isConnected ? (
                isMicActive ? <MicOff size={32} /> : <FileAudio size={32} className="animate-pulse" />
              ) : (
                <Mic size={32} />
              )}
            </button>

            {/* Separator */}
            <div className="h-12 w-px bg-slate-800 mx-4 hidden md:block"></div>

            {/* File Upload */}
            <div className="flex flex-col items-center">
               <FileUpload 
                 onFileSelect={handleFileUpload} 
                 disabled={isUploading} 
                 isUploading={isUploading}
               />
               <span className="text-xs text-slate-500 mt-2">
                 Supported: .mp3, .wav (auto-converts)
               </span>
            </div>

          </div>

          {/* Status Text */}
          <div className="h-6">
            {isConnecting && (
              <span className="text-cyan-400 animate-pulse flex items-center gap-2 text-sm font-medium">
                <Activity size={16} /> Connecting to Gemini Live...
              </span>
            )}
            
            {isConnected && isUploading && (
              <span className="text-yellow-400 flex items-center gap-2 text-sm font-medium animate-pulse">
                 Processing and sending audio clip...
              </span>
            )}

            {isConnected && !isUploading && (
               <span className="text-green-400 flex items-center gap-2 text-sm font-medium">
                {isMicActive ? (
                   <>
                     <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div> 
                     Listening... (Sing or play now)
                   </>
                ) : (
                   <>
                     <Music size={16} /> 
                     Connected (Mic Disabled). AI will respond to files.
                   </>
                )}
              </span>
            )}

            {connectionState === ConnectionState.DISCONNECTED && !error && !isUploading && (
               <span className="text-slate-500 text-sm">Ready to start session</span>
            )}
             {error && (
              <span className="text-red-400 flex items-center gap-2 text-sm font-medium">
                <AlertCircle size={16} /> {error}
              </span>
            )}
          </div>
        </div>
        
        {/* Instructions */}
        <div className="bg-slate-900/40 p-6 rounded-2xl border border-slate-800 max-w-2xl w-full">
          <h3 className="text-slate-300 font-semibold mb-3 flex items-center gap-2">
            <span className="bg-cyan-500/10 text-cyan-400 text-xs px-2 py-1 rounded">PRO TIP</span>
            How to use
          </h3>
          <ul className="space-y-2 text-sm text-slate-400">
            <li className="flex gap-2">
              <span className="text-cyan-500 font-bold">1.</span>
              Start the session by clicking the microphone button (or just upload a file to auto-start).
            </li>
            <li className="flex gap-2">
              <span className="text-cyan-500 font-bold">2.</span>
              Sing a short melody (10-15 seconds) or play an instrument clearly.
            </li>
            <li className="flex gap-2">
              <span className="text-cyan-500 font-bold">3.</span>
              Pause and wait. The AI will attempt to pick up the rhythm and key and continue the tune.
            </li>
             <li className="flex gap-2">
              <span className="text-cyan-500 font-bold">4.</span>
              Upload a short audio clip (MP3/WAV) to feed it directly to the model.
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default App;