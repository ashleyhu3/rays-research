import { useState, useRef, useEffect } from 'react';

const SOURCE_LABELS = {
  pypi:       'PyPI',
  trends:     'Trends',
  reddit:     'Reddit',
  jobs:       'Jobs',
  github:     'GitHub',
  gpu:        'GPU',
  openrouter: 'OpenRouter',
  eia:        'Electricity',
  mops:       'Supply Chain',
};

export default function ChatPanel({ open, onClose }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput]       = useState('');
  const [loading, setLoading]   = useState(false);
  const bottomRef               = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  async function send(e) {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    setInput('');
    setMessages(prev => [...prev, { role: 'user', text }]);
    setLoading(true);

    try {
      const res  = await fetch('/api/chat', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ message: text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      setMessages(prev => [...prev, { role: 'assistant', text: data.text, sources: data.sources ?? [] }]);
    } catch (err) {
      setMessages(prev => [...prev, { role: 'error', text: err.message }]);
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <span className="chat-title">Ask the data</span>
        <button className="chat-close" onClick={onClose}>✕</button>
      </div>

      <div className="chat-messages">
        {messages.length === 0 && (
          <p className="chat-hint">Ask anything — "How does OpenAI compare to Anthropic on GitHub?" or "Which GPU is cheapest right now?"</p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg chat-msg-${m.role}`}>
            <p className="chat-msg-text">{m.text}</p>
            {m.sources?.length > 0 && (
              <div className="chat-sources">
                {m.sources.map(s => (
                  <span key={s} className="chat-source-tag">
                    {SOURCE_LABELS[s] ?? s}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
        {loading && (
          <div className="chat-msg chat-msg-assistant">
            <span className="chat-dots"><span/><span/><span/></span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <form className="chat-form" onSubmit={send}>
        <input
          className="chat-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Ask about the data…"
          disabled={loading}
          autoFocus
        />
        <button className="chat-send" type="submit" disabled={loading || !input.trim()}>
          ↑
        </button>
      </form>
    </div>
  );
}
