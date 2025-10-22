import React from 'react';
import { ConversationState } from '../types';

interface AudioVisualizerProps {
  level: number;
  state: ConversationState;
}

const stateConfig = {
    idle: {
        orbColor: 'bg-green-500',
        glowColor: 'shadow-green-500/50',
        icon: (
             <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
            </svg>
        ),
    },
    connecting: {
        orbColor: 'bg-blue-500',
        glowColor: 'shadow-blue-500/50',
        icon: <div className="h-12 w-12 border-4 border-t-transparent border-white rounded-full animate-spin"></div>,
    },
    listening: {
        orbColor: 'bg-green-500',
        glowColor: 'shadow-green-500/50',
        icon: (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.49 6-3.31 6-6.72h-1.7z" />
            </svg>
        ),
    },
    'user-speaking': {
        orbColor: 'bg-blue-500',
        glowColor: 'shadow-blue-500/70',
        icon: (
             <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.49 6-3.31 6-6.72h-1.7z" />
            </svg>
        ),
    },
    speaking: {
        orbColor: 'bg-purple-500',
        glowColor: 'shadow-purple-500/70',
        icon: (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12" viewBox="0 0 24 24" fill="currentColor">
                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
            </svg>
        ),
    },
    error: {
        orbColor: 'bg-yellow-500',
        glowColor: 'shadow-yellow-500/50',
        icon: (
             <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
            </svg>
        ),
    }
};


export const AudioVisualizer: React.FC<AudioVisualizerProps> = ({ level, state }) => {
    const { orbColor, glowColor, icon } = stateConfig[state];

    const isPulsating = state === 'user-speaking' || state === 'speaking';
    const isListening = state === 'listening';
    const scale = 1 + level * (isPulsating ? 1.5 : 0);
    const orbSize = state === 'idle' || state === 'error' ? 'w-48 h-48' : 'w-20 h-20 md:w-24 md:h-24';

    return (
        <div
            aria-label={state}
            className={`relative ${orbSize} rounded-full flex items-center justify-center text-white transition-all duration-300 ease-in-out ${orbColor} shadow-2xl ${glowColor} ${isListening ? 'animate-pulse' : ''}`}
            style={{
                transform: `scale(${scale})`,
                transition: 'transform 50ms linear, background-color 300ms ease-in-out, width 300ms ease-in-out, height 300ms ease-in-out',
            }}
        >
            {icon}
        </div>
    );
};