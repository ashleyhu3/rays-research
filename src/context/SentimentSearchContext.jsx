import { createContext, useContext, useState } from 'react';
import { useData } from './DataContext';

// Shared ticker-search state for the Sentiment page. Lifted out of the page
// component so the search bar can be rendered in the Topbar (always visible,
// above the scrolling content) while the page below still reads/drives the
// same ticker selection.
const SentimentSearchContext = createContext(null);

export function SentimentSearchProvider({ children }) {
  const { liveData } = useData();
  const sd = liveData?.sentiment;
  const [input, setInput] = useState('');
  const [ticker, setTicker] = useState(null);

  function search(raw) {
    const t = (raw ?? input).trim().toUpperCase();
    if (!t) return;
    setInput(t);
    setTicker(t);
  }

  function clear() {
    setTicker(null);
    setInput('');
  }

  const available = sd ? Object.keys(sd.tickers) : [];

  return (
    <SentimentSearchContext.Provider value={{ input, setInput, ticker, setTicker, search, clear, available }}>
      {children}
    </SentimentSearchContext.Provider>
  );
}

export const useSentimentSearch = () => useContext(SentimentSearchContext);
