// supervisorApiService.js - Debug version to help identify authentication issues

import axios from 'axios';
import { getAuthConfig, getAuthHeaders, validateAuth } from './authIntegration';

const API_BASE_URL = process.env.EXPO_PUBLIC_GATEWAY_URL || 'http://localhost:3000';

console.log('Supervisor API Service initialized with base URL:', API_BASE_URL);

// Create axios instance with default config
const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor for debugging
api.interceptors.request.use(
  (config) => {
    console.log('🔍 API Request Debug:', {
      url: config.url,
      method: config.method,
      baseURL: config.baseURL,
      headers: config.headers,
      data: config.data ? 'Present' : 'None'
    });
    return config;
  },
  (error) => {
    console.error('❌ API Request Error:', error);
    return Promise.reject(error);
  }
);

// Response interceptor for debugging
api.interceptors.response.use(
  (response) => {
    console.log('✅ API Response Success:', {
      status: response.status,
      url: response.config.url,
      dataSize: response.data ? JSON.stringify(response.data).length : 0
    });
    return response;
  },
  (error) => {
    console.error('❌ API Response Error:', {
      status: error.response?.status,
      statusText: error.response?.statusText,
      url: error.config?.url,
      data: error.response?.data,
      message: error.message
    });
    return Promise.reject(error);
  }
);

/**
 * Helper function to create authenticated request config
 */
const createAuthConfig = (supervisorId) => {
  try {
    console.log('🔐 Creating auth config for supervisor:', supervisorId);
    
    // Get auth configuration
    const authConfig = getAuthConfig();
    console.log('📋 Auth config:', {
      hasAuthConfig: !!authConfig,
      hasUser: !!authConfig?.user,
      hasToken: !!authConfig?.token,
      userId: authConfig?.user?.id,
      userRole: authConfig?.user?.role
    });
    
    if (!authConfig) {
      throw new Error('No authentication configuration found. Please log in again.');
    }
    
    // Validate authentication
    validateAuth();
    
    // Get auth headers
    const headers = getAuthHeaders();
    console.log('📤 Request headers:', {
      hasAuth: !!headers.Authorization,
      authType: headers.Authorization ? headers.Authorization.split(' ')[0] : 'None'
    });
    
    return { headers };
    
  } catch (error) {
    console.error('❌ Auth config creation failed:', error.message);
    throw new Error(`Authentication error: ${error.message}`);
  }
};

/**
 * Fetch pending invoices for supervisor review
 */
export const fetchPendingInvoices = async (supervisorId, options = {}) => {
  try {
    console.log('📥 Fetching pending invoices:', { supervisorId, options });
    
    if (!supervisorId) {
      throw new Error('Supervisor ID is required');
    }
    
    const authConfig = createAuthConfig(supervisorId);
    
    const params = {
      supervisorId,
      status: 'pending_review',
      ...options
    };
    
    console.log('📋 Request params:', params);
    
    const response = await api.get('/supervisor/pending-invoices', {
      ...authConfig,
      params
    });
    
    console.log('✅ Fetch pending invoices success:', {
      invoicesCount: response.data?.invoices?.length || 0,
      totalCount: response.data?.totalCount || 0
    });
    
    return response.data;
    
  } catch (error) {
    console.error('❌ Fetch pending invoices failed:', {
      supervisorId,
      error: error.message,
      status: error.response?.status,
      data: error.response?.data
    });
    
    if (error.response?.status === 401) {
      throw new Error('Authentication failed. Please log in again.');
    } else if (error.response?.status === 403) {
      throw new Error('Access denied. Supervisor role required.');
    } else if (error.response?.status >= 500) {
      throw new Error('Server error. Please try again later.');
    } else if (error.message.includes('Network Error') || error.code === 'ECONNABORTED') {
      throw new Error('Network error. Please check your connection.');
    }
    
    throw new Error(error.message || 'Failed to fetch pending invoices');
  }
};

/**
 * Approve an invoice
 */
export const approveInvoice = async (invoiceId, supervisorId, comment = '') => {
  try {
    console.log('✅ Approving invoice:', { invoiceId, supervisorId, hasComment: !!comment });
    
    if (!invoiceId || !supervisorId) {
      throw new Error('Invoice ID and Supervisor ID are required');
    }
    
    const authConfig = createAuthConfig(supervisorId);
    
    const requestData = {
      invoiceId,
      supervisorId,
      action: 'approve',
      comment: comment || '',
      reviewedAt: new Date().toISOString()
    };
    
    console.log('📋 Approve request data:', requestData);
    
    const response = await api.post('/supervisor/review-invoice', requestData, authConfig);
    
    console.log('✅ Approve invoice success:', response.data);
    
    return response.data;
    
  } catch (error) {
    console.error('❌ Approve invoice failed:', {
      invoiceId,
      supervisorId,
      error: error.message,
      status: error.response?.status,
      data: error.response?.data
    });
    
    if (error.response?.status === 401) {
      throw new Error('Authentication failed. Please log in again.');
    } else if (error.response?.status === 403) {
      throw new Error('Access denied. Supervisor role required.');
    } else if (error.response?.status === 404) {
      throw new Error('Invoice not found or already processed.');
    }
    
    throw new Error(error.message || 'Failed to approve invoice');
  }
};

/**
 * Reject an invoice
 */
export const rejectInvoice = async (invoiceId, supervisorId, comment) => {
  try {
    console.log('❌ Rejecting invoice:', { invoiceId, supervisorId, hasComment: !!comment });
    
    if (!invoiceId || !supervisorId) {
      throw new Error('Invoice ID and Supervisor ID are required');
    }
    
    if (!comment || comment.trim() === '') {
      throw new Error('Comment is required for invoice rejection');
    }
    
    const authConfig = createAuthConfig(supervisorId);
    
    const requestData = {
      invoiceId,
      supervisorId,
      action: 'reject',
      comment: comment.trim(),
      reviewedAt: new Date().toISOString()
    };
    
    console.log('📋 Reject request data:', requestData);
    
    const response = await api.post('/supervisor/review-invoice', requestData, authConfig);
    
    console.log('✅ Reject invoice success:', response.data);
    
    return response.data;
    
  } catch (error) {
    console.error('❌ Reject invoice failed:', {
      invoiceId,
      supervisorId,
      error: error.message,
      status: error.response?.status,
      data: error.response?.data
    });
    
    if (error.response?.status === 401) {
      throw new Error('Authentication failed. Please log in again.');
    } else if (error.response?.status === 403) {
      throw new Error('Access denied. Supervisor role required.');
    } else if (error.response?.status === 404) {
      throw new Error('Invoice not found or already processed.');
    }
    
    throw new Error(error.message || 'Failed to reject invoice');
  }
};

/**
 * Request additional information for an invoice
 */
export const requestAdditionalInfo = async (invoiceId, supervisorId, message) => {
  try {
    console.log('ℹ️ Requesting additional info:', { invoiceId, supervisorId, hasMessage: !!message });
    
    if (!invoiceId || !supervisorId) {
      throw new Error('Invoice ID and Supervisor ID are required');
    }
    
    if (!message || message.trim() === '') {
      throw new Error('Message is required for additional information request');
    }
    
    const authConfig = createAuthConfig(supervisorId);
    
    const requestData = {
      invoiceId,
      supervisorId,
      action: 'request_info',
      comment: message.trim(),
      reviewedAt: new Date().toISOString()
    };
    
    console.log('📋 Request info data:', requestData);
    
    const response = await api.post('/supervisor/review-invoice', requestData, authConfig);
    
    console.log('✅ Request additional info success:', response.data);
    
    return response.data;
    
  } catch (error) {
    console.error('❌ Request additional info failed:', {
      invoiceId,
      supervisorId,
      error: error.message,
      status: error.response?.status,
      data: error.response?.data
    });
    
    if (error.response?.status === 401) {
      throw new Error('Authentication failed. Please log in again.');
    } else if (error.response?.status === 403) {
      throw new Error('Access denied. Supervisor role required.');
    } else if (error.response?.status === 404) {
      throw new Error('Invoice not found or already processed.');
    }
    
    throw new Error(error.message || 'Failed to request additional information');
  }
};

/**
 * Get invoice details
 */
export const getInvoiceDetails = async (invoiceId, supervisorId) => {
  try {
    console.log('📋 Getting invoice details:', { invoiceId, supervisorId });
    
    if (!invoiceId || !supervisorId) {
      throw new Error('Invoice ID and Supervisor ID are required');
    }
    
    const authConfig = createAuthConfig(supervisorId);
    
    const response = await api.get(`/supervisor/invoice/${invoiceId}`, {
      ...authConfig,
      params: { supervisorId }
    });
    
    console.log('✅ Get invoice details success:', {
      invoiceId: response.data?.id,
      status: response.data?.status
    });
    
    return response.data;
    
  } catch (error) {
    console.error('❌ Get invoice details failed:', {
      invoiceId,
      supervisorId,
      error: error.message,
      status: error.response?.status,
      data: error.response?.data
    });
    
    if (error.response?.status === 401) {
      throw new Error('Authentication failed. Please log in again.');
    } else if (error.response?.status === 403) {
      throw new Error('Access denied. Supervisor role required.');
    } else if (error.response?.status === 404) {
      throw new Error('Invoice not found.');
    }
    
    throw new Error(error.message || 'Failed to get invoice details');
  }
};

export default {
  fetchPendingInvoices,
  approveInvoice,
  rejectInvoice,
  requestAdditionalInfo,
  getInvoiceDetails,
};