import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { pwaManager } from './game/pwa.ts';
import './index.css';

// Strictly activates ONLY in production standalone web builds (no-op in dev, Android, YouTube Playables)
pwaManager.init();

createRoot(document.getElementById('root')!).render(<App />);
