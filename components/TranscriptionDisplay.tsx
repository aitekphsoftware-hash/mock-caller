import React, { useEffect, useRef } from 'react';
import { TranscriptMessage } from '../types';

interface TranscriptionDisplayProps {
  transcripts: TranscriptMessage[];
  agentName: string;
}

export const TranscriptionDisplay: React.FC<TranscriptionDisplayProps> = ({ transcripts, agentName }) => {
  const endOfMessagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endOfMessagesRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcripts]);

  return (
    <div className="w-full max-w-2xl flex-grow overflow-y-auto p-4 space-y-6 pb-48">
      {transcripts.map((msg, index) => {
        if (msg.speaker === 'user') {
          return (
            <div key={index} className="flex items-end gap-3 justify-end">
              <div
                className="order-1 rounded-2xl p-4 max-w-md bg-blue-600 rounded-br-none"
              >
                <p className="text-white text-base">{msg.text}</p>
              </div>
              <div className="order-2 w-10 h-10 rounded-full bg-gray-500 flex-shrink-0 flex items-center justify-center font-bold text-lg">
                Y
              </div>
            </div>
          );
        } else { // speaker is 'model'
          return (
            <div key={index} className="flex items-end gap-3 justify-start">
               <div className="order-1 w-10 h-10 rounded-full bg-red-700 flex-shrink-0 flex items-center justify-center font-bold text-lg">
                {agentName ? agentName.charAt(0).toUpperCase() : 'A'}
              </div>
              <div
                className="order-2 rounded-2xl p-4 max-w-md bg-gray-700 rounded-bl-none"
              >
                <p className="text-white text-base">{msg.text}</p>
              </div>
            </div>
          );
        }
      })}
      <div ref={endOfMessagesRef} />
    </div>
  );
};
