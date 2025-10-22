import React, { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, LiveSession, LiveServerMessage, Modality } from "@google/genai";
import { DEFAULT_SETTINGS, AVAILABLE_VOICES } from './constants';
import { createBlob, decode, decodeAudioData } from './utils/audio';
import { AudioVisualizer } from './components/AudioVisualizer';
import { TranscriptionDisplay } from './components/TranscriptionDisplay';
import { ConversationState, Settings, TranscriptMessage } from './types';
import { VoiceActivityDetector } from './utils/vad';
import { Dialpad } from './components/Dialpad';

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
        // Load saved settings
        const savedSettings = localStorage.getItem('ayla-settings');
        if (savedSettings) {
            const parsedSettings = JSON.parse(savedSettings);
            setSettings(parsedSettings);
            setEditingSettings(parsedSettings);
        }

        // Load saved transcripts
        const savedTranscripts = localStorage.getItem('ayla-transcripts');
        if (savedTranscripts) {
            try {
                const parsedTranscripts = JSON.parse(savedTranscripts);
                if (Array.isArray(parsedTranscripts)) {
                    setTranscripts(parsedTranscripts);
                }
            } catch (e) {
                console.error("Failed to parse transcripts from localStorage", e);
                localStorage.removeItem('ayla-transcripts');
            }
        }
    }, []);

    // Save transcripts to localStorage whenever they change
    useEffect(() => {
        if (transcripts.length > 0) {
            localStorage.setItem('ayla-transcripts', JSON.stringify(transcripts));
        } else {
            localStorage.removeItem('ayla-transcripts');
        }
    }, [transcripts]);

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
    const showConversationView = isConversationActive || transcripts.length > 0;

    const getStatusText = () => {
        if (conversationState === 'connecting') return 'Connecting...';
        if (isConversationActive) return `Call Duration: ${formatDuration(callDuration)}`;
        return 'Ready to Call';
    }

    return (
        <div className="bg-gray-900 h-full flex flex-col font-sans text-white p-4 md:p-6">
            {!showConversationView && (
                <div className="flex-grow flex flex-col items-center justify-center text-center">
                    <header className="absolute top-4 right-4">
                        <button onClick={handleOpenSettings} className="p-2 text-gray-400 hover:text-white" aria-label="Settings">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7" viewBox="0 0 24 24" fill="currentColor"><path d="M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65C14.46 2.18 14.25 2 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1c-.23-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49.42l.38-2.65c.61-.25 1.17-.59-1.69-.98l2.49 1c.23.09.49 0 .61.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.65zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z"/></svg>
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

            {showConversationView && (
                 <div className="flex-grow flex flex-col items-center justify-between w-full overflow-hidden">
                    {/* Header */}
                    <div className="text-center pt-8 flex-shrink-0 w-full relative">
                        <h1 className="text-3xl font-semibold">{settings.agentName} AI Assistant</h1>
                        <p className="text-lg text-green-400">{getStatusText()}</p>
                        {!isConversationActive && (
                             <div className="absolute top-0 right-0">
                                <button onClick={handleOpenSettings} className="p-2 text-gray-400 hover:text-white" aria-label="Settings">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7" viewBox="0 0 24 24" fill="currentColor"><path d="M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65C14.46 2.18 14.25 2 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69-.98l-2.49-1c-.23-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49.42l.38-2.65c.61-.25 1.17-.59-1.69-.98l2.49 1c.23.09.49 0 .61.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.65zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z"/></svg>
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Transcription */}
                    <TranscriptionDisplay transcripts={transcripts} agentName={settings.agentName} />

                    {/* Footer Controls */}
                    <footer className="w-full flex flex-col items-center justify-center flex-shrink-0 p-4">
                        {isConversationActive ? (
                            <>
                                <div className="mb-4 flex items-center justify-center" style={{minHeight: '260px'}}>
                                    { (conversationState === 'listening' || conversationState === 'user-speaking' || conversationState === 'connecting') 
                                        ? <AudioVisualizer state={conversationState} level={audioLevel} />
                                        : <Dialpad />
                                    }
                                </div>
                                <button onClick={handleStopConversation} className="w-16 h-16 bg-red-600 rounded-full text-white flex items-center justify-center" aria-label="End Call">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" viewBox="0 0 24 24" fill="currentColor"><path d="M12 9c-1.6 0-3.15.25-4.62.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.1-2.66 1.82.79.72 1.68 1.33 2.66 1.82.33.16.56.5.56.9v3.1c1.47.47 3.02.72 4.62.72 5.52 0 10-4.48 10-10S17.52 9 12 9z" opacity=".3"/><path d="M12 9c1.6 0 3.15-.25 4.62-.72-1.47-.47-3.02-.72-4.62-.72-5.52 0-10 4.48-10 10 0 1.6.25 3.15.72 4.62C2.25 21.35 2 19.7 2 18c0-5.52 4.48-10 10-10zm0 12c-1.6 0-3.15-.25-4.62-.72v-3.1c-.33-.16-.56-.51-.56-.9-.98-.49-1.87-1.1-2.66-1.82-.33-.28-.39-.73-.15-1.07.79-.72 1.68-1.33 2.66-1.82.33-.16.56-.5.56-.9v-3.1C8.85 9.25 10.4 9 12 9c5.52 0 10 4.48 10 10s-4.48 10-10 10z"/></svg>
                                </button>
                            </>
                        ) : (
                            <button onClick={handleStartConversation} className="bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-6 rounded-full transition-colors duration-200 flex items-center gap-2" disabled={conversationState === 'connecting'}>
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M19.95 21q-3.125 0-6.2-.987-3.075-1-5.538-3.463-2.462-2.462-3.462-5.537Q3.762 8.125 3.762 5.05q0-.45.3-.75.3-.3.75-.3h3.9q.375 0 .638.225.262.225.337.575l.75 3.525q.05.25.025.512-.025.263-.175.488l-2.4 2.4q.925 1.6 2.388 3.062 1.462 1.463 3.062 2.388l2.4-2.4q.225-.15.488-.175.262-.025.512.025l3.525.75q.35.075.575.337.225.263.225.638v3.9q0 .45-.3.75-.3.3-.75.3Z"/>
                                </svg>
                                Start New Call
                            </button>
                        )}
                    </footer>
                 </div>
            )}
        </div>
    );
};

export default App;