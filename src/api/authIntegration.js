// authIntegration.js - Fixed version that properly handles AuthContext structure

let authConfig = null;

/**
 * Sync authentication data with the supervisor API service
 * @param {Object} authData - Authentication data from AuthContext
 * @param {Object} authData.user - User object from context
 * @param {string} authData.token - Token from context (optional, can be in user object)
 */
export const syncWithAuthContext = (authData) => {
  try {
    console.log('Syncing auth data:', {
      hasUser: !!authData?.user,
      userId: authData?.user?.id,
      username: authData?.user?.username,
      userRole: authData?.user?.role,
      hasToken: !!(authData?.token || authData?.user?.token),
      tokenSource: authData?.token ? 'parameter' : 'user.token',
      userKeys: authData?.user ? Object.keys(authData.user) : []
    });

    if (!authData?.user) {
      console.warn('No user data provided to syncWithAuthContext');
      authConfig = null;
      return;
    }

    const user = authData.user;
    
    // Extract token - it could be in authData.token or user.token
    const token = authData.token || user.token || user.authToken;
    
    if (!token) {
      console.warn('No token found in auth data');
      authConfig = null;
      return;
    }

    // Extract user identifier - could be id, username, or other field
    const userId = user.id || user.username || user.name;
    
    if (!userId) {
      console.error('No user identifier found in user object:', Object.keys(user));
      authConfig = null;
      return;
    }

    // Validate user has supervisor role for supervisor API calls
    if (user.role !== 'supervisor') {
      console.warn(`User role '${user.role}' is not 'supervisor' - supervisor API may not work`);
    }

    // Store the auth configuration
    authConfig = {
      user: {
        id: userId, // Use username if id is not available
        username: user.username,
        role: user.role,
        unit: user.unit,
        email: user.email,
        isVerified: user.isVerified,
        // Include any other user properties that might be needed
        ...user
      },
      token: token,
      isAuthenticated: true
    };

    console.log('Auth sync successful:', {
      userId: authConfig.user.id,
      username: authConfig.user.username,
      userRole: authConfig.user.role,
      hasToken: !!authConfig.token
    });

  } catch (error) {
    console.error('Failed to sync auth context:', error);
    authConfig = null;
  }
};

/**
 * Get current authentication configuration
 * @returns {Object|null} Current auth config or null if not authenticated
 */
export const getAuthConfig = () => {
  return authConfig;
};

/**
 * Get authenticated user data
 * @returns {Object|null} User object or null if not authenticated
 */
export const getAuthenticatedUser = () => {
  return authConfig?.user || null;
};

/**
 * Get authentication token
 * @returns {string|null} Token or null if not authenticated
 */
export const getAuthToken = () => {
  return authConfig?.token || null;
};

/**
 * Check if user is authenticated
 * @returns {boolean} True if authenticated, false otherwise
 */
export const isAuthenticated = () => {
  return !!authConfig?.isAuthenticated && !!authConfig?.token && !!authConfig?.user?.id;
};

/**
 * Check if user has supervisor role
 * @returns {boolean} True if user is supervisor, false otherwise
 */
export const isSupervisor = () => {
  return authConfig?.user?.role === 'supervisor';
};

/**
 * Clear authentication data
 */
export const clearAuthConfig = () => {
  console.log('Clearing auth config');
  authConfig = null;
};

/**
 * Get authorization headers for API requests
 * @returns {Object} Headers object with Authorization header
 */
export const getAuthHeaders = () => {
  const token = getAuthToken();
  
  if (!token) {
    throw new Error('No authentication token available');
  }

  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
};

/**
 * Validate current authentication state
 * @throws {Error} If authentication is invalid
 */
export const validateAuth = () => {
  if (!isAuthenticated()) {
    throw new Error('Authentication required. Please log in again.');
  }

  if (!isSupervisor()) {
    throw new Error('Supervisor role required for this operation.');
  }

  return true;
};

// Export default object for convenience
export default {
  syncWithAuthContext,
  getAuthConfig,
  getAuthenticatedUser,
  getAuthToken,
  isAuthenticated,
  isSupervisor,
  clearAuthConfig,
  getAuthHeaders,
  validateAuth
};