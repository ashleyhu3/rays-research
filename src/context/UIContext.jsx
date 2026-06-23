import { createContext, useContext, useState } from 'react';

const UIContext = createContext({ tableMode: false, setTableMode: () => {}, editMode: false, setEditMode: () => {} });
export const useUI = () => useContext(UIContext);

export function UIProvider({ children }) {
  const [tableMode, setTableMode] = useState(false);
  const [editMode,  setEditMode]  = useState(false);
  return (
    <UIContext.Provider value={{ tableMode, setTableMode, editMode, setEditMode }}>
      {children}
    </UIContext.Provider>
  );
}
