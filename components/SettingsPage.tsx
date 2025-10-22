import React, { useState } from 'react';
import { Settings } from '../types';
import { AVAILABLE_VOICES } from '../constants';

interface SettingsPageProps {
  currentSettings: Settings;
  onSave: (newSettings: Settings) => void;
  onClose: () => void;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({ currentSettings, onSave, onClose }) => {
  const [settings, setSettings] = useState<Settings>(currentSettings);

  const handleSave = () => {
    onSave(settings);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setSettings(prev => ({ ...prev, [name]: value }));
  };

  return (
    <div className="bg-gray-900 h-full flex flex-col font-sans text-white p-4 md:p-6">
      <header className="flex items-center justify-between mb-6">
        <button onClick={onClose} className="p-2">
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
            value={settings.agentName}
            onChange={handleChange}
            className="w-full bg-gray-800 border border-gray-700 rounded-md p-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label htmlFor="agentRole" className="block text-sm font-medium text-gray-400 mb-1">Role</label>
          <input
            type="text"
            id="agentRole"
            name="agentRole"
            value={settings.agentRole}
            onChange={handleChange}
            className="w-full bg-gray-800 border border-gray-700 rounded-md p-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label htmlFor="agentDescription" className="block text-sm font-medium text-gray-400 mb-1">Description (System Prompt)</label>
          <textarea
            id="agentDescription"
            name="agentDescription"
            value={settings.agentDescription}
            onChange={handleChange}
            rows={15}
            className="w-full bg-gray-800 border border-gray-700 rounded-md p-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label htmlFor="voice" className="block text-sm font-medium text-gray-400 mb-1">Voice</label>
          <select
            id="voice"
            name="voice"
            value={settings.voice}
            onChange={handleChange}
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
          onClick={handleSave}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-md transition-colors duration-200"
        >
          Save Settings
        </button>
      </footer>
    </div>
  );
};
