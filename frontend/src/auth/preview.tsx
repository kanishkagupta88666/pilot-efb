import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthSignInPage } from './AuthSignInPage';
createRoot(document.getElementById('root')!).render(<BrowserRouter><AuthSignInPage standalone /></BrowserRouter>);
