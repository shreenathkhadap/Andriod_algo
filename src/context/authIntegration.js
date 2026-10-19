// authIntegration.js
// This utility helps integrate the supervisor API service with your existing auth system

import AsyncStorage from '@react-native-async-storage/async-storage';

// Constants for storage keys
const AUTH_TOKEN_KEY = 'auth_token';
const USER_INFO_KEY = 'user_info';

/**
 * Initialize authentication for supervisor API
 * Call this when user logs in successfully
 */
export const initializeAuth = async (authToken, userInfo) => {
  try {
    // Store in AsyncStorage for persistence
    await AsyncStorage.setItem(AUTH_TOKEN_KEY, authToken);
    await AsyncStorage.setItem(USER_INFO_KEY, JSON.stringify(userInfo));
    
    // Set global variables for immediate access
    global.authToken = authToken;
    global.currentUser = userInfo;
    
    console.log('✅ Authentication initialized for supervisor API');
    return true;
  } catch (error) {
    console.error('❌ Failed to initialize authentication:', error);
    return false;
  }
};

/**
 * Clear authentication data
 * Call this when user logs out
 */
export const clearAuth = async () => {
  try {
    await AsyncStorage.multiRemove([AUTH_TOKEN_KEY, USER_INFO_KEY]);
    global.authToken = null;
    global.currentUser = null;
    console.log('✅ Authentication cleared');
    return true;
  } catch (error) {
    console.error('❌ Failed to clear authentication:', error);
    return false;
  }
};

/**
 * Load authentication from storage on app start
 * Call this in your app initialization
 */
export const loadAuthFromStorage = async () => {
  try {
    const [authToken, userInfoString] = await AsyncStorage.multiGet([
      AUTH_TOKEN_KEY,
      USER_INFO_KEY
    ]);
    
    if (authToken[1] && userInfoString[1]) {
      global.authToken = authToken[1];
      global.currentUser = JSON.parse(userInfoString[1]);
      console.log('✅ Authentication loaded from storage');
      return {
        token: authToken[1],
        user: JSON.parse(userInfoString[1])
      };
    }
    
    console.log('ℹ️ No stored authentication found');
    return null;
  } catch (error) {
    console.error('❌ Failed to load authentication from storage:', error);
    return null;
  }
};

/**
 * Check if user is authenticated
 */
export const isAuthenticated = () => {
  return !!(global.authToken && global.currentUser);
};

/**
 * Get current auth token
 */
export const getAuthToken = () => {
  return global.authToken || null;
};

/**
 * Get current user info
 */
export const getCurrentUser = () => {
  return global.currentUser || null;
};

/**
 * Update user info (for profile updates, role changes, etc.)
 */
export const updateUserInfo = async (updatedUserInfo) => {
  try {
    const newUserInfo = {
      ...global.currentUser,
      ...updatedUserInfo
    };
    
    await AsyncStorage.setItem(USER_INFO_KEY, JSON.stringify(newUserInfo));
    global.currentUser = newUserInfo;
    
    console.log('✅ User info updated');
    return true;
  } catch (error) {
    console.error('❌ Failed to update user info:', error);
    return false;
  }
};

/**
 * Refresh auth token
 */
export const refreshAuthToken = async (newToken) => {
  try {
    await AsyncStorage.setItem(AUTH_TOKEN_KEY, newToken);
    global.authToken = newToken;
    console.log('✅ Auth token refreshed');
    return true;
  } catch (error) {
    console.error('❌ Failed to refresh auth token:', error);
    return false;
  }
};

/**
 * Integration with your existing AuthContext
 * Use this to sync with your auth context
 */
export const syncWithAuthContext = (authContext) => {
  if (authContext.user && authContext.token) {
    global.authToken = authContext.token;
    global.currentUser = authContext.user;
    console.log('✅ Synced with AuthContext');
  }
};

// Hook for React components to use auth state
export const useAuthSync = (authContext) => {
  const syncAuth = () => {
    if (authContext?.user && authContext?.token) {
      syncWithAuthContext(authContext);
    }
  };
  
  return {
    syncAuth,
    isAuthenticated: isAuthenticated(),
    currentUser: getCurrentUser(),
    authToken: getAuthToken()
  };
};