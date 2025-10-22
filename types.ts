import { Blob } from "@google/genai";

export interface TranscriptMessage {
  speaker: 'user' | 'model';
  text: string;
}

export type ConversationState = 'idle' | 'connecting' | 'listening' | 'user-speaking' | 'speaking' | 'error';

export interface Settings {
  agentName: string;
  agentRole: string;
  agentDescription: string;
  voice: string;
}
