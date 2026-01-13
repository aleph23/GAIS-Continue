import React from 'react';
import { Upload, Loader2 } from 'lucide-react';

interface FileUploadProps {
  onFileSelect: (file: File) => void;
  disabled: boolean;
  isUploading: boolean;
}

const FileUpload: React.FC<FileUploadProps> = ({ onFileSelect, disabled, isUploading }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onFileSelect(e.target.files[0]);
      // Reset value so same file can be selected again if needed
      e.target.value = '';
    }
  };

  const isDisabled = disabled || isUploading;

  return (
    <div className="relative group">
      <input
        type="file"
        accept="audio/*"
        onChange={handleChange}
        disabled={isDisabled}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed z-10"
      />
      <button
        disabled={isDisabled}
        className={`flex items-center gap-2 px-6 py-3 rounded-full font-semibold transition-all duration-300
          ${isDisabled 
            ? 'bg-slate-800/50 text-slate-500 border-slate-700' 
            : 'bg-slate-800 text-cyan-400 hover:bg-slate-700 hover:text-cyan-300 border border-cyan-900 shadow-[0_0_15px_rgba(34,211,238,0.1)]'
          }`}
      >
        {isUploading ? <Loader2 size={20} className="animate-spin" /> : <Upload size={20} />}
        <span>{isUploading ? 'Sending Clip...' : 'Upload Clip (~10s)'}</span>
      </button>
    </div>
  );
};

export default FileUpload;
