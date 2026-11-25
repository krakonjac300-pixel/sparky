import { useState, type ReactNode } from 'react';
import { Dialog } from './forms.tsx';
import terms from '../docs/one-life-terms.md?raw';
import privacy from '../docs/privacy.md?raw';

const agreementVersion = '2026-11-22-preview-2';
const agreementKey = 'one-life-terms-version';

export function LegalDocuments() {
  return <>{[terms, privacy].map((document, index) => <details className="audit" key={index}>
    <summary>{index === 0 ? 'Terms of use' : 'Privacy notice'}</summary>
    {document.replace(/\r\n/g, '\n').split('\n\n').slice(1).map((paragraph) => paragraph.startsWith('## ')
      ? <h3 key={paragraph}>{paragraph.slice(3)}</h3> : paragraph.trim() && <p key={paragraph}>{paragraph.trim()}</p>)}
    {index === 1 && <p><a href="https://openai.com/policies/privacy-policy/">OpenAI privacy policy</a> · <a href="https://policies.google.com/privacy">Google privacy policy</a></p>}
  </details>)}</>;
}

export function LegalGate({ children }: { children: ReactNode }) {
  const [accepted, setAccepted] = useState(() => {
    try { return localStorage.getItem(agreementKey) === agreementVersion; } catch { return false; }
  });
  const [error, setError] = useState('');
  if (accepted) return children;
  return <div className="app-shell"><main>
    <Dialog title="Welcome to Sparky" close={() => setError('Accept the terms when you are ready to use Sparky.')}>
      <div className="form-stack">
        <p>Review the terms and privacy notice. Your acceptance stays on this device. Connections and permissions are optional.</p>
        <p>Automatic Downloads backups start off. On Android 10 or later, Settings lets you save readable copies of your records, including health history and chats. Those files can survive reset or uninstall.</p>
        <LegalDocuments />
        <button className="primary-button" type="button" onClick={() => {
          try { localStorage.setItem(agreementKey, agreementVersion); setAccepted(true); }
          catch { setError('Sparky could not save your choice. Enable local storage and try again.'); }
        }}>I agree to the terms</button>
        {error && <p role="status">{error}</p>}
      </div>
    </Dialog>
  </main></div>;
}
