import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Music, Activity, AlertCircle } from 'lucide-react';
import { LiveManager } from './services/liveManager';
import Visualizer from './components/Visualizer';
import FileUpload from './components/FileUpload';
import { ConnectionState } from './types';

const API_KEY = process.env.API_KEY || '';

const App: React.FC = () => {
  const [connectionState, setConnectionState] = useState<string>(ConnectionState.DISCONNECTED);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
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
    const manager = new LiveManager(API_KEY);
    liveManagerRef.current = manager;

    manager.onStatusChange = (status) => {
      setConnectionState(status);
      if (status === 'CONNECTED') {
        setInputAnalyser(manager.getInputAnalyser());
        setOutputAnalyser(manager.getOutputAnalyser());
      }
    };

    manager.onError = (err) => {
      setError(err);
    };

    await manager.connect();
    return manager;
  };

  const toggleConnection = async () => {
    if (connectionState === ConnectionState.CONNECTED || connectionState === ConnectionState.CONNECTING) {
      liveManagerRef.current?.disconnect();
      liveManagerRef.current = null;
      setConnectionState(ConnectionState.DISCONNECTED);
      setInputAnalyser(null);
      setOutputAnalyser(null);
    } else {
      await startSession();
    }
  };

  const handleFileUpload = async (file: File) => {
    if (isUploading) return;
    
    setIsUploading(true);
    try {
      let manager = liveManagerRef.current;
      
      // If disconnected, start the session first
      if (!manager || connectionState === ConnectionState.DISCONNECTED) {
        manager = await startSession();
      } else if (connectionState === ConnectionState.CONNECTING) {
         if (!manager) throw new Error("Session initializing...");
      }
      
      if (!manager) throw new Error("Failed to initialize session");

      await manager.sendAudioFile(file);
    } catch (e: any) {
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
                <Mic size={12} /> Input
              </div>
              <div className="w-full h-full p-2">
                <Visualizer 
                  analyser={inputAnalyser} 
                  color="#22d3ee" 
                  isActive={isConnected} 
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
            </div>
          </div>

          {/* Action Area */}
          <div className="flex flex-wrap justify-center items-center gap-6 mt-4">
            
            {/* Main Toggle Button */}
            <button
              onClick={toggleConnection}
              disabled={isConnecting}
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
                <MicOff size={32} />
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
            {isConnected && !isUploading && (
              <span className="text-green-400 flex items-center gap-2 text-sm font-medium">
                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div> 
                Listening... (Sing or play now)
              </span>
            )}
            {isConnected && isUploading && (
              <span className="text-yellow-400 flex items-center gap-2 text-sm font-medium animate-pulse">
                 Processing and sending audio clip...
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
              Start the session by clicking the microphone button.
            </li>
            <li className="flex gap-2">
              <span className="text-cyan-500 font-bold">2.</span>
              Sing a short melody (10-15 seconds) or play an instrument clearly near the mic.
            </li>
            <li className="flex gap-2">
              <span className="text-cyan-500 font-bold">3.</span>
              Pause and wait. The AI will attempt to pick up the rhythm and key and continue the tune.
            </li>
             <li className="flex gap-2">
              <span className="text-cyan-500 font-bold">4.</span>
              Or, upload a short audio clip (MP3/WAV) to feed it directly to the model.
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default App;