import { createContext, useContext } from 'react';

export const AuthCtx = createContext({ user: null, setUser: () => {} });
export const useAuth = () => useContext(AuthCtx);
