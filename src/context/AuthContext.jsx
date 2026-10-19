import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter, useSegments } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { jwtDecode } from 'jwt-decode';
import { createContext, useContext, useEffect, useState } from 'react';
import { useDispatch } from 'react-redux';
import { clearAuthData, setAuthData } from '../store/authSlice';
import { migrateAsyncStorageAlertsToSQLite } from '../utils/alertStorage';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser]           = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  const router   = useRouter();
  const segments = useSegments();
  const dispatch = useDispatch();

  const getExpectedAuthGroup = (role) => {
    if (!role) return null;
    switch (role.toLowerCase().trim()) {
      case 'admin':  return '(admin)';
      case 'viewer': return '(viewer)';
      default:       return null;
    }
  };

  const signIn = async (userData) => {
    console.log('Sign in data:', userData);
    await SecureStore.setItemAsync('user_data', JSON.stringify(userData.user));
    setUser(userData.user);
    dispatch(setAuthData({ user: userData.user, token: userData.user.token }));
  };

  const signOut = async () => {
    try {
      console.log('Signing out...');
      await SecureStore.deleteItemAsync('user_data');

      const allKeys = await AsyncStorage.getAllKeys();
      const cachedAlertKeys = allKeys.filter((key) => key.startsWith('aksha_alerts_'));
      if (cachedAlertKeys.length > 0) {
        await AsyncStorage.multiRemove(cachedAlertKeys);
      }

      setUser(null);
      dispatch(clearAuthData());
      router.replace('/');
    } catch (err) {
      console.error('Error during sign out:', err);
    }
  };

  // One-time migration of any pre-SQLite alert cache — safe to call on every
  // startup, it's a no-op after the first successful run (see alertStorage.js).
  useEffect(() => {
    migrateAsyncStorageAlertsToSQLite();
  }, []);

  // ── Load user from SecureStore on app start ────────────────────────────────
  useEffect(() => {
    const loadUser = async () => {
      try {
        const stored = await SecureStore.getItemAsync('user_data');
        if (stored) {
          const parsedUser = JSON.parse(stored);
          const token      = parsedUser?.token;

          if (!token) throw new Error('No token found in user data.');

          const decoded = jwtDecode(token);
          const EXP_FALLBACK_MS = 12 * 60 * 60 * 1000;
          const expiryMs = decoded?.exp
            ? decoded.exp * 1000
            : Date.now() + EXP_FALLBACK_MS;

          if (Date.now() > expiryMs) {
            console.log('Token expired. Logging out.');
            await signOut();
            return;
          }

          setUser(parsedUser);
          dispatch(setAuthData({ user: parsedUser, token }));
        }
      } catch (error) {
        console.error('Auth Load Error:', error.message);
        setUser(null);
        dispatch(clearAuthData());
      } finally {
        setIsLoading(false);
      }
    };
    loadUser();
  }, []);

  // ── Redirect logic ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === '(admin)' || segments[0] === '(viewer)';

    const onInitialScreen =
      segments[0] === undefined ||
      segments[0] === 'index'   ||
      segments[0] === 'signin'  ||
      segments[0] === 'signup';

    console.log('Auth routing check:', {
      role:           user?.role,
      segments:       segments[0],
      inAuthGroup,
      isVerified:     user?.isVerified,
      onInitialScreen,
    });

    if (user && user.isVerified) {
      const expectedAuthGroup = getExpectedAuthGroup(user.role);

      // Already in correct group — do nothing
      if (segments[0] === expectedAuthGroup) {
        console.log('User in correct auth group');
        return;
      }

      // On login/signup/index — redirect to Home
      if (onInitialScreen) {
        if (user.role === 'admin') {
          router.replace('/(admin)/tabs/Home');
        } else if (user.role === 'viewer') {
          router.replace('/(viewer)/tabs/monitor');
        }
        return;
      }

      // In wrong auth group — redirect to correct Home
      console.log('User in wrong group, redirecting to correct home');
      if (user.role === 'admin') {
        router.replace('/(admin)/tabs/Home');
      } else if (user.role === 'viewer') {
        router.replace('/(viewer)/tabs/monitor');
      }

    } else {
      // Not logged in
      if (inAuthGroup) {
        console.log('Unauthorized access, redirecting to signin');
        router.replace('/signin');
      } else if (onInitialScreen) {
        return;
      } else {
        router.replace('/signin');
      }
    }
  }, [user, isLoading, segments]);

  return (
    <AuthContext.Provider value={{ user, signIn, signOut, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};