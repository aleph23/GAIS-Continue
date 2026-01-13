import { Modality } from '@google/genai';

export interface AudioConfig {
  sampleRate: number;
  channels: number;
}

export enum ConnectionState {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  ERROR = 'ERROR',
}

export interface VisualizerData {
  input: Uint8Array;
  output: Uint8Array;
}

export const INPUT_SAMPLE_RATE = 16000;
export const OUTPUT_SAMPLE_RATE = 24000;
