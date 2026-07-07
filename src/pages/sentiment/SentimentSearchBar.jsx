import { useRef } from 'react';
import { useSentimentSearch } from '../../context/SentimentSearchContext';

// Renders in the Topbar's title slot for the Sentiment view, replacing the
// plain page title — this keeps the ticker search always visible instead of
// scrolling away with the page content.
export default function SentimentSearchBar() {
  const { input, setInput, ticker, search, clear } = useSentimentSearch();
  const inputRef = useRef(null);

  return (
    <form className="topbar-search" onSubmit={e => { e.preventDefault(); search(); }}>
      <input
        ref={inputRef}
        className="opts-input topbar-search-input"
        value={input}
        onChange={e => setInput(e.target.value.toUpperCase())}
        placeholder="Search a ticker — options for any (NVDA, AAPL); sentiment for tracked names (MU, SNDK)…"
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="characters"
      />
      <button className="opts-search-btn" type="submit" disabled={!input.trim()}>Search</button>
      {ticker && (
        <button type="button" className="opts-search-btn" onClick={clear}>
          ← Aggregate view
        </button>
      )}
    </form>
  );
}
