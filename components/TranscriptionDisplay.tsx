import React, { useEffect, useRef } from 'react';
import { TranscriptMessage } from '../types';

interface TranscriptionDisplayProps {
  transcripts: TranscriptMessage[];
}

export const TranscriptionDisplay: React.FC<TranscriptionDisplayProps> = ({ transcripts }) => {
  const endOfMessagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endOfMessagesRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcripts]);

  return (
    <div className="w-full max-w-2xl flex-grow overflow-y-auto p-4 space-y-6 pb-48">
      {transcripts.map((msg, index) => (
        <div key={index} className={`flex items-start gap-3 ${msg.speaker === 'user' ? 'justify-end' : 'justify-start'}`}>
          {msg.speaker === 'model' && (
            <div className="w-10 h-10 rounded-full bg-red-700 flex-shrink-0 flex items-center justify-center font-bold">
              A
            </div>
          )}
          <div
            className={`rounded-2xl p-4 max-w-md ${
              msg.speaker === 'user'
                ? 'bg-blue-600 rounded-br-none'
                : 'bg-gray-700 rounded-bl-none'
            }`}
          >
            <p className="text-white text-base">{msg.text}</p>
          </div>
        </div>
      ))}
      <div ref={endOfMessagesRef} />
    </div>
  );
};
