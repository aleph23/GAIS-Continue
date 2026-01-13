import React, { useEffect, useRef } from 'react';

interface VisualizerProps {
  analyser: AnalyserNode | null;
  color: string;
  isActive: boolean;
}

const Visualizer: React.FC<VisualizerProps> = ({ analyser, color, isActive }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !analyser) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      if (!isActive) {
         ctx.clearRect(0, 0, canvas.width, canvas.height);
         return;
      }
      
      animationRef.current = requestAnimationFrame(draw);

      analyser.getByteFrequencyData(dataArray);

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const width = canvas.width;
      const height = canvas.height;
      const barWidth = (width / bufferLength) * 2.5;
      let barHeight;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        barHeight = (dataArray[i] / 255) * height;
        
        ctx.fillStyle = color;
        // Make it slightly transparent for a glowing effect
        ctx.globalAlpha = 0.8;
        
        // Draw rounded bars
        ctx.beginPath();
        ctx.roundRect(x, height - barHeight, barWidth, barHeight, 2);
        ctx.fill();

        x += barWidth + 1;
        if (x > width) break;
      }
    };

    draw();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [analyser, color, isActive]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full rounded-lg"
      width={600}
      height={150}
    />
  );
};

export default Visualizer;
