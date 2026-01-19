import React, { useState } from 'react';
import { ToastProvider } from './context/ToastContext';
import { DownloadProvider } from './context/DownloadContext';
import Navbar from './components/Navbar';
import Hero from './components/Hero';
import ModeSelection from './components/ModeSelection';
import MovieMode from './components/MovieMode';
import SeriesMode from './components/SeriesMode';
import DownloadHUD from './components/DownloadHUD';
import ToastContainer from './components/ToastContainer';
import SettingsModal from './components/SettingsModal';

// Import styles
import './styles/index.css';
import './styles/navbar.css';
import './styles/hero.css';
import './styles/mode-selection.css';
import './styles/download-section.css';
import './styles/series-mode.css';
import './styles/download-hud.css';
import './styles/modals.css';

function App() {
    const [currentMode, setCurrentMode] = useState(null);
    const [settingsOpen, setSettingsOpen] = useState(false);

    const handleModeChange = (mode) => {
        setCurrentMode(mode);
        // Scroll to the section
        setTimeout(() => {
            const section = document.getElementById(`${mode}-section`);
            if (section) {
                section.scrollIntoView({ behavior: 'smooth' });
            }
        }, 100);
    };

    return (
        <ToastProvider>
            <DownloadProvider>
                <div className="app">
                    <Navbar onSettingsClick={() => setSettingsOpen(true)} />
                    
                    <main>
                        <Hero />
                        
                        <ModeSelection 
                            currentMode={currentMode} 
                            onModeChange={handleModeChange} 
                        />
                        
                        <MovieMode isActive={currentMode === 'movie'} />
                        <SeriesMode isActive={currentMode === 'series'} />
                    </main>

                    <DownloadHUD />
                    <ToastContainer />
                    
                    <SettingsModal 
                        isOpen={settingsOpen} 
                        onClose={() => setSettingsOpen(false)} 
                    />
                </div>
            </DownloadProvider>
        </ToastProvider>
    );
}

export default App;
