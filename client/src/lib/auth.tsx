import React, { createContext, useContext, useState, useEffect } from 'react';
import { api, setAuthToken, getAuthToken } from './api';

export type Role = 'admin' | 'manager' | 'licensed_agent' | 'scheduler';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  title?: string;
  phone?: string;
  npn?: string;
  states?: string[];
  avatar_color?: string;
  daily_call_goal?: number;
  google_connected?: boolean;
  google_meet_url?: string;
  caller_id_name?: string;
  cnam?: string;
  spam_status?: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  activeRole: Role;
  setActiveRole: (role: Role) => void;
  login: (email: string, password?: string) => Promise<void>;
  logout: () => void;
  agency: any;
  period: any;
  tpmo: string;
  isManager: boolean;
  isLicensed: boolean;
  isScheduler: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeRoleOverride, setActiveRoleOverride] = useState<Role | null>(null);
  const [agency, setAgency] = useState<any>(null);
  const [period, setPeriod] = useState<any>(null);
  const [tpmo, setTpmo] = useState<string>('');

  const fetchMe = async () => {
    try {
      if (!getAuthToken()) { setLoading(false); return; }
      const res = await api.get('/auth/me');
      setUser(res.user);
      setAgency(res.agency);
      setPeriod(res.period);
      setTpmo(res.tpmo);
    } catch {
      setAuthToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMe();
  }, []);

  const login = async (email: string, password = 'Welcome123!') => {
    const res = await api.post('/auth/login', { email, password });
    setAuthToken(res.token);
    setUser(res.user);
    await fetchMe();
  };

  const logout = () => {
    setAuthToken(null);
    setUser(null);
    setActiveRoleOverride(null);
  };

  const isExecutiveAdmin = user?.email?.toLowerCase() === 'king@iwillglobal.com' || user?.email?.toLowerCase() === 'aneesha@iwillglobal.com';
  const effectiveRole: Role = isExecutiveAdmin ? 'admin' : (activeRoleOverride || user?.role || 'licensed_agent');
  const isManagerRole = effectiveRole === 'admin' || effectiveRole === 'manager';
  const isLicensedRole = effectiveRole === 'licensed_agent' || isManagerRole;
  const isSchedulerRole = effectiveRole === 'scheduler';

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        activeRole: effectiveRole,
        setActiveRole: setActiveRoleOverride,
        login,
        logout,
        agency,
        period,
        tpmo,
        isManager: isManagerRole,
        isLicensed: isLicensedRole,
        isScheduler: isSchedulerRole,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
