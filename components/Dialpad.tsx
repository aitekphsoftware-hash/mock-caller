import React from 'react';

const keys = [
  { number: '1', letters: '' },
  { number: '2', letters: 'ABC' },
  { number: '3', letters: 'DEF' },
  { number: '4', letters: 'GHI' },
  { number: '5', letters: 'JKL' },
  { number: '6', letters: 'MNO' },
  { number: '7', letters: 'PQRS' },
  { number: '8', letters: 'TUV' },
  { number: '9', letters: 'WXYZ' },
  { number: '*', letters: '' },
  { number: '0', letters: '+' },
  { number: '#', letters: '' },
];

export const Dialpad: React.FC = () => {
  return (
    <div className="grid grid-cols-3 gap-4 md:gap-6 max-w-xs mx-auto">
      {keys.map((key) => (
        <div key={key.number} className="flex items-center justify-center">
          <div className="w-16 h-16 md:w-20 md:h-20 rounded-full bg-gray-700/50 flex flex-col items-center justify-center text-white cursor-default">
            <span className="text-3xl md:text-4xl font-light">{key.number}</span>
            {key.letters && <span className="text-xs tracking-widest">{key.letters}</span>}
          </div>
        </div>
      ))}
    </div>
  );
};
