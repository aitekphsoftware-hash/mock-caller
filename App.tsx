import React, { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, LiveSession, LiveServerMessage, Modality } from "@google/genai";
import { DEFAULT_SETTINGS, AVAILABLE_VOICES } from './constants';
import { createBlob, decode, decodeAudioData } from './utils/audio';
import { AudioVisualizer } from './components/AudioVisualizer';
import { TranscriptionDisplay } from './components/TranscriptionDisplay';
import { ConversationState, Settings, TranscriptMessage } from './types';
import { VoiceActivityDetector } from './utils/vad';

const App: React.FC = () => {
    const [conversationState, setConversationState] = useState<ConversationState>('idle');
    const [audioLevel, setAudioLevel] = useState(0);
    const [errorMessage, setErrorMessage] = useState('');
    const [callDuration, setCallDuration] = useState(0);
    const [showSettings, setShowSettings] = useState(false);
    const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
    const [editingSettings, setEditingSettings] = useState<Settings>(settings);
    const [transcripts, setTranscripts] = useState<TranscriptMessage[]>([]);

    const sessionPromiseRef = useRef<Promise<LiveSession> | null>(null);
    const inputAudioContextRef = useRef<AudioContext | null>(null);
    const outputAudioContextRef = useRef<AudioContext | null>(null);
    const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
    const microphoneStreamRef = useRef<MediaStream | null>(null);
    
    const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
    const nextStartTimeRef = useRef<number>(0);

    const inputAnalyserNodeRef = useRef<AnalyserNode | null>(null);
    const outputAnalyserNodeRef = useRef<AnalyserNode | null>(null);
    const animationFrameRef = useRef<number>(0);

    const vadRef = useRef<VoiceActivityDetector | null>(null);
    
    const callTimerIntervalRef = useRef<number | null>(null);

    useEffect(() => {
        const savedSettings = localStorage.getItem('ayla-settings');
        if (savedSettings) {
            const parsedSettings = JSON.parse(savedSettings);
            setSettings(parsedSettings);
            setEditingSettings(parsedSettings);
        }
    }, []);

    const handleOpenSettings = () => {
        setEditingSettings(settings);
        setShowSettings(true);
    };

    const handleSaveSettings = () => {
        setSettings(editingSettings);
        localStorage.setItem('ayla-settings', JSON.stringify(editingSettings));
        setShowSettings(false);
    };

    const handleSettingsChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setEditingSettings(prev => ({ ...prev, [name]: value }));
    };

    useEffect(() => {
        if (conversationState !== 'idle' && conversationState !== 'error' && conversationState !== 'connecting') {
            if (!callTimerIntervalRef.current) {
                callTimerIntervalRef.current = window.setInterval(() => {
                    setCallDuration(prev => prev + 1);
                }, 1000);
            }
        } else {
            if (callTimerIntervalRef.current) {
                clearInterval(callTimerIntervalRef.current);
                callTimerIntervalRef.current = null;
            }
            setCallDuration(0);
        }
        return () => {
            if (callTimerIntervalRef.current) {
                clearInterval(callTimerIntervalRef.current);
            }
        };
    }, [conversationState]);

    const formatDuration = (seconds: number) => {
        const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
        const secs = (seconds % 60).toString().padStart(2, '0');
        return `${mins}:${secs}`;
    };

    const visualizeAudio = useCallback(() => {
        let level = 0;
        if (conversationState === 'user-speaking' && inputAnalyserNodeRef.current) {
            const dataArray = new Uint8Array(inputAnalyserNodeRef.current.frequencyBinCount);
            inputAnalyserNodeRef.current.getByteTimeDomainData(dataArray);
            const sum = dataArray.reduce((acc, val) => acc + Math.abs(val - 128), 0);
            level = sum / dataArray.length / 128;
        } else if (conversationState === 'speaking' && outputAnalyserNodeRef.current) {
            const dataArray = new Uint8Array(outputAnalyserNodeRef.current.frequencyBinCount);
            outputAnalyserNodeRef.current.getByteFrequencyData(dataArray);
            const sum = dataArray.reduce((acc, val) => acc + val, 0);
            level = sum / dataArray.length / 255;
        }
        setAudioLevel(level);
        animationFrameRef.current = requestAnimationFrame(visualizeAudio);
    }, [conversationState]);

    useEffect(() => {
        if (conversationState === 'user-speaking' || conversationState === 'speaking') {
            animationFrameRef.current = requestAnimationFrame(visualizeAudio);
        } else {
            cancelAnimationFrame(animationFrameRef.current);
            setAudioLevel(0);
        }
        return () => cancelAnimationFrame(animationFrameRef.current);
    }, [conversationState, visualizeAudio]);


    const handleStopConversation = useCallback(() => {
        sessionPromiseRef.current?.then(session => session.close());
        
        microphoneStreamRef.current?.getTracks().forEach(track => track.stop());
        scriptProcessorRef.current?.disconnect();
        inputAudioContextRef.current?.close();
        outputAudioContextRef.current?.close();
        
        sessionPromiseRef.current = null;
        inputAudioContextRef.current = null;
        outputAudioContextRef.current = null;
        scriptProcessorRef.current = null;
        microphoneStreamRef.current = null;

        vadRef.current?.stop();
        vadRef.current = null;
        
        setConversationState('idle');
    }, []);

    const handleStartConversation = useCallback(async () => {
        setConversationState('connecting');
        setErrorMessage('');
        setTranscripts([]);

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            microphoneStreamRef.current = stream;

            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });

            const systemInstruction = `SYSTEM PROMPT — ${settings.agentName.toUpperCase()} (${settings.agentRole.toUpperCase()})

ROLE & BRAND
You are **${settings.agentName}**, an expert ${settings.agentRole}.
${settings.agentDescription}`;


            sessionPromiseRef.current = ai.live.connect({
                model: 'gemini-2.5-flash-native-audio-preview-09-2025',
                config: {
                    systemInstruction,
                    responseModalities: [Modality.AUDIO],
                    inputAudioTranscription: {},
                    outputAudioTranscription: {},
                    speechConfig: {
                        voiceConfig: { prebuiltVoiceConfig: { voiceName: settings.voice } },
                    },
                },
                callbacks: {
                    onopen: () => {
                        inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
                        outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });

                        const source = inputAudioContextRef.current.createMediaStreamSource(stream);
                        scriptProcessorRef.current = inputAudioContextRef.current.createScriptProcessor(4096, 1, 1);
                        
                        inputAnalyserNodeRef.current = inputAudioContextRef.current.createAnalyser();
                        inputAnalyserNodeRef.current.fftSize = 256;

                        outputAnalyserNodeRef.current = outputAudioContextRef.current.createAnalyser();
                        outputAnalyserNodeRef.current.fftSize = 256;

                        vadRef.current = new VoiceActivityDetector({
                            analyserNode: inputAnalyserNodeRef.current,
                            onSpeechStart: () => setConversationState(prevState => (prevState === 'listening' ? 'user-speaking' : prevState)),
                            onSpeechEnd: () => setConversationState(prevState => (prevState === 'user-speaking' ? 'listening' : prevState)),
                        });
                        
                        const outputNode = outputAudioContextRef.current.createGain();
                        outputNode.connect(outputAnalyserNodeRef.current);
                        outputAnalyserNodeRef.current.connect(outputAudioContextRef.current.destination);

                        scriptProcessorRef.current.onaudioprocess = (audioProcessingEvent) => {
                            const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                            const pcmBlob = createBlob(inputData);
                            sessionPromiseRef.current?.then((session) => {
                                session.sendRealtimeInput({ media: pcmBlob });
                            });

                            vadRef.current?.process();
                        };

                        source.connect(inputAnalyserNodeRef.current);
                        inputAnalyserNodeRef.current.connect(scriptProcessorRef.current);
                        scriptProcessorRef.current.connect(inputAudioContextRef.current.destination);
                        setConversationState('listening');
                    },
                    onmessage: async (message: LiveServerMessage) => {
                        if (message.serverContent?.inputTranscription) {
                            const text = message.serverContent.inputTranscription.text;
                            setTranscripts(prev => {
                                const newTranscripts = [...prev];
                                const last = newTranscripts[newTranscripts.length - 1];
                                if (last && last.speaker === 'user') {
                                    last.text += text;
                                } else {
                                    newTranscripts.push({ speaker: 'user', text });
                                }
                                return newTranscripts;
                            });
                        }
            
                        if (message.serverContent?.outputTranscription) {
                            const text = message.serverContent.outputTranscription.text;
                            setTranscripts(prev => {
                                const newTranscripts = [...prev];
                                const last = newTranscripts[newTranscripts.length - 1];
                                if (last && last.speaker === 'model') {
                                    last.text += text;
                                } else {
                                    newTranscripts.push({ speaker: 'model', text });
                                }
                                return newTranscripts;
                            });
                        }
                        
                        const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
                        if (base64Audio && outputAudioContextRef.current && outputAnalyserNodeRef.current) {
                             if(conversationState !== 'speaking') setConversationState('speaking');

                            nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outputAudioContextRef.current.currentTime);
                            const audioBuffer = await decodeAudioData(decode(base64Audio), outputAudioContextRef.current, 24000, 1);

                            const source = outputAudioContextRef.current.createBufferSource();
                            source.buffer = audioBuffer;
                            source.connect(outputAnalyserNodeRef.current);
                            source.addEventListener('ended', () => {
                                sourcesRef.current.delete(source);
                                if (sourcesRef.current.size === 0) {
                                    setConversationState('listening');
                                }
                            });
                            source.start(nextStartTimeRef.current);
                            nextStartTimeRef.current += audioBuffer.duration;
                            sourcesRef.current.add(source);
                        }
                        
                        if (message.serverContent?.interrupted) {
                            for (const source of sourcesRef.current.values()) {
                                source.stop();
                                sourcesRef.current.delete(source);
                            }
                            nextStartTimeRef.current = 0;
                            setConversationState('listening');
                        }
                    },
                    onclose: () => {
                        handleStopConversation();
                    },
                    onerror: (e: ErrorEvent) => {
                        console.error('Gemini Live API Error:', e);
                        setErrorMessage('An error occurred. Please try again.');
                        setConversationState('error');
                        handleStopConversation();
                    },
                },
            });

        } catch (error) {
            console.error("Failed to start conversation:", error);
            setErrorMessage("Could not access microphone. Please grant permission and try again.");
            setConversationState('error');
        }
    }, [handleStopConversation, conversationState, settings]);

    if (showSettings) {
        return (
            <div className="bg-gray-900 h-full flex flex-col font-sans text-white p-4 md:p-6">
              <header className="flex items-center justify-between mb-6">
                <button onClick={() => setShowSettings(false)} className="p-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <h1 className="text-2xl font-semibold">Settings</h1>
                <div className="w-8"></div>
              </header>
        
              <div className="flex-grow overflow-y-auto space-y-6">
                <div>
                  <label htmlFor="agentName" className="block text-sm font-medium text-gray-400 mb-1">Agent Name</label>
                  <input
                    type="text"
                    id="agentName"
                    name="agentName"
                    value={editingSettings.agentName}
                    onChange={handleSettingsChange}
                    className="w-full bg-gray-800 border border-gray-700 rounded-md p-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label htmlFor="agentRole" className="block text-sm font-medium text-gray-400 mb-1">Role</label>
                  <input
                    type="text"
                    id="agentRole"
                    name="agentRole"
                    value={editingSettings.agentRole}
                    onChange={handleSettingsChange}
                    className="w-full bg-gray-800 border border-gray-700 rounded-md p-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label htmlFor="agentDescription" className="block text-sm font-medium text-gray-400 mb-1">Description (System Prompt)</label>
                  <textarea
                    id="agentDescription"
                    name="agentDescription"
                    value={editingSettings.agentDescription}
                    onChange={handleSettingsChange}
                    rows={15}
                    className="w-full bg-gray-800 border border-gray-700 rounded-md p-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label htmlFor="voice" className="block text-sm font-medium text-gray-400 mb-1">Voice</label>
                  <select
                    id="voice"
                    name="voice"
                    value={editingSettings.voice}
                    onChange={handleSettingsChange}
                    className="w-full bg-gray-800 border border-gray-700 rounded-md p-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {AVAILABLE_VOICES.map(voiceName => (
                      <option key={voiceName} value={voiceName}>{voiceName}</option>
                    ))}
                  </select>
                </div>
              </div>
        
              <footer className="mt-6">
                <button
                  onClick={handleSaveSettings}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-md transition-colors duration-200"
                >
                  Save Settings
                </button>
              </footer>
            </div>
          );
    }

    const isConversationActive = conversationState !== 'idle' && conversationState !== 'error';

    const getStatusText = () => {
        if (conversationState === 'connecting') return 'Connecting...';
        if (isConversationActive) return `Call Duration: ${formatDuration(callDuration)}`;
        return 'Ready to Call';
    }

    return (
        <div className="bg-gray-900 h-full flex flex-col font-sans text-white p-4 md:p-6">
            {!isConversationActive && (
                <div className="flex-grow flex flex-col items-center justify-center text-center">
                    <header className="absolute top-4 right-4">
                        <button onClick={handleOpenSettings} className="p-2 text-gray-400 hover:text-white" aria-label="Settings">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7" viewBox="0 0 24 24" fill="currentColor"><path d="M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65C14.46 2.18 14.25 2 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1c-.23-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1c.23.09.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.65zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z"/></svg>
                        </button>
                    </header>
                    <img src="https://i.ibb.co/6y4t1Gj/turkish-airlines-logo-white.png" alt="Turkish Airlines Logo" className="h-10 md:h-12 mb-8"/>
                    <button onClick={handleStartConversation} disabled={conversationState === 'connecting'}>
                        <AudioVisualizer state={conversationState} level={audioLevel} />
                    </button>
                    <p className="mt-8 text-xl text-gray-300">{conversationState === 'connecting' ? 'Connecting...' : `Call ${settings.agentName} AI Assistant`}</p>
                    {errorMessage && <p className="text-red-400 mt-4">{errorMessage}</p>}
                </div>
            )}

            {isConversationActive && (
                 <div className="flex-grow flex flex-col items-center justify-between w-full overflow-hidden">
                    {/* Header */}
                    <div className="text-center pt-8 flex-shrink-0">
                        <h1 className="text-3xl font-semibold">{settings.agentName} AI Assistant</h1>
                        <p className="text-lg text-green-400">{getStatusText()}</p>
                    </div>

                    {/* Transcription */}
                    <TranscriptionDisplay transcripts={transcripts} />

                    {/* Footer Controls */}
                    <footer className="w-full flex flex-col items-center justify-center flex-shrink-0 p-4">
                        <div className="flex items-center justify-center space-x-8 w-full max-w-xs">
                             <button className="p-4 bg-gray-700/60 rounded-full text-gray-300 cursor-not-allowed" aria-label="Mute">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7" viewBox="0 0 24 24" fill="currentColor"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1.2-9.1c0-.66.54-1.2 1.2-1.2.66 0 1.2.54 1.2 1.2l-.01 6.2c0 .66-.53 1.2-1.19 1.2s-1.2-.54-1.2-1.2V4.9zm6.5 6.2c0 .55.45 1 1 1s1-.45 1-1V9.4c0-.55-.45-1-1-1s-1 .45-1 1v1.7zM8.7 4.9v6.2c0 .66-.54 1.2-1.2 1.2s-1.2-.54-1.2-1.2V4.9c0-.66.54-1.2 1.2-1.2s1.2.54 1.2 1.2zM5 9.4v1.7c0 .55.45 1 1 1s1-.45 1-1V9.4c0-.55-.45-1-1-1s-1 .45-1 1zm12.33 3.19c-.38.38-.38 1.02 0 1.41A8.963 8.963 0 0 1 19 18c0 3.54-2.5 6.45-5.78 6.91l-.02.09c0 .55-.45 1-1 1s-1-.45-1-1l-.02-.09C8.5 24.45 6 21.54 6 18c0-1.38.31-2.69.87-3.81.38-.38.38-1.02 0-1.41a.996.996 0 0 0-1.41 0A8.963 8.963 0 0 0 4 18c0 4.41 3.59 8 8 8s8-3.59 8-8c0-1.99-.74-3.8-1.97-5.22a.996.996 0 0 0-1.41 0z"/></svg>
                            </button>
                             <AudioVisualizer state={conversationState} level={audioLevel} />
                             <button className="p-4 bg-gray-700/60 rounded-full text-gray-300 cursor-not-allowed" aria-label="Speaker">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
                             </button>
                        </div>
                        <button onClick={handleStopConversation} className="mt-8 w-16 h-16 bg-red-600 rounded-full text-white flex items-center justify-center" aria-label="End Call">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" viewBox="0 0 24 24" fill="currentColor"><path d="M12 9c-1.6 0-3.15.25-4.62.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.1-2.66 1.82.79.72 1.68 1.33 2.66 1.82.33.16.56.5.56.9v3.1c1.47.47 3.02.72 4.62.72 5.52 0 10-4.48 10-10S17.52 9 12 9z" opacity=".3"/><path d="M12 9c1.6 0 3.15-.25 4.62-.72-1.47-.47-3.02-.72-4.62-.72-5.52 0-10 4.48-10 10 0 1.6.25 3.15.72 4.62C2.25 21.35 2 19.7 2 18c0-5.52 4.48-10 10-10zm0 12c-1.6 0-3.15-.25-4.62-.72v-3.1c-.33-.16-.56-.51-.56-.9-.98-.49-1.87-1.1-2.66-1.82-.33-.28-.39-.73-.15-1.07.79-.72 1.68-1.33 2.66-1.82.33-.16.56-.5.56-.9v-3.1C8.85 9.25 10.4 9 12 9c5.52 0 10 4.48 10 10s-4.48 10-10 10z"/></svg>
                        </button>
                    </footer>
                 </div>
            )}
        </div>
    );
};

export default App;