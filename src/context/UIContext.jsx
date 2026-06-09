import { createContext, useContext, useState } from 'react';

const UIContext = createContext({ tableMode: false, setTableMode: () => {} });
export const useUI = () => useContext(UIContext);

export function UIProvider({ children }) {
  const [tableMode, setTableMode] = useState(false);
  return (
    <UIContext.Provider value={{ tableMode, setTableMode }}>
      {children}
    </UIContext.Provider>
  );
}
