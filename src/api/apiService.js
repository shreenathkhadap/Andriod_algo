import axios from 'axios';

const API_BASE_URL =
  process.env.EXPO_PUBLIC_GATEWAY_URL || 'http://localhost:3000';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 30000,
});

// Interceptors for logging
api.interceptors.request.use(
  (config) => {
    console.log('API Request:', {
      url: config.url,
      method: config.method,
      baseURL: config.baseURL,
    });
    return config;
  },
  (error) => Promise.reject(error)
);

api.interceptors.response.use(
  (response) => {
    console.log('API Response:', {
      status: response.status,
      url: response.config.url,
    });
    return response;
  },
  (error) => {
    console.error('API Response Error:', {
      status: error.response?.status,
      data: error.response?.data,
      url: error.config?.url,
    });
    return Promise.reject(error);
  }
);

//IMAGE UPLOAD + OCR (POST /extract-info)
const uploadImageToS3 = async (imageUri, username, description, unit) => {
  if (!imageUri) throw new Error('Image URI is required');
  if (!username) throw new Error('Username is required');

  const apiUrl = process.env.EXPO_PUBLIC_GATEWAY_URL;
  if (!apiUrl) throw new Error('EXPO_PUBLIC_GATEWAY_URL not set');

  const response = await fetch(imageUri);
  if (!response.ok) throw new Error(`Failed to fetch image: ${response.statusText}`);

  const blob = await response.blob();
  if (blob.size > 5 * 1024 * 1024) {
    throw new Error('Image too large. Please use <5MB.');
  }

  const base64String = await blobToBase64(blob);

  const payload = {
    image_data: base64String,
    submitted_by: username,
    description: description || '',
    unit: unit || '',
  };

  const apiResponse = await axios.post(`${apiUrl}/extract-info`, payload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 60000,
  });

  return apiResponse.data;
};

const registerUser = async (username, email, password, siteId) => {
  const payload = {
    username: username.trim(),
    email:    email.trim().toLowerCase(),
    password: password,
    siteId:   siteId.trim(),
  };

  console.log('Register payload:', payload);

  const apiResponse = await axios.post(
    `${API_BASE_URL}/mobile/register`,
    payload,
    {
      headers: { 'Content-Type': 'application/json' },
      timeout: 60000,
    }
  );

  console.log('Register response:', apiResponse.data);
  return apiResponse.data;
};

const loginInAksha = async (username, password, expoToken) => {  
  
  const payload = {
    identifier: username.trim().toLowerCase(),
    password:  password.trim(),
    expoToken: expoToken,   // ← use passed token
  };

  console.log('Login payload:', JSON.stringify(payload));

  const apiResponse = await axios.post(
    `${API_BASE_URL}/mobile/login`,
    payload,
    {
      headers: { 'Content-Type': 'application/json' },
      timeout: 60000,
    }
  );

  console.log('Login response:', apiResponse.data);
  return apiResponse.data;
};

const blobToBase64 = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result?.split(',')[1];
      base64String ? resolve(base64String) : reject(new Error('Failed to convert to base64'));
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

//SAVE INVOICE (QR SCANNER → POST /save-invoice)
const saveInvoiceData = async (qrRawData) => {
  const apiUrl = process.env.EXPO_PUBLIC_GATEWAY_URL;
  if (!apiUrl) throw new Error('EXPO_PUBLIC_GATEWAY_URL not set');

  const parsed = parseQRData(qrRawData);

  const response = await axios.post(`${apiUrl}/save-invoice`, parsed, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 15000,
  });

  return response.data;
};

//SAVE Quality Data
const saveQualityData = async (payload) => {

  const apiUrl = process.env.EXPO_PUBLIC_GATEWAY_URL;
  if (!apiUrl) throw new Error('EXPO_PUBLIC_GATEWAY_URL not set');
  console.log(typeof data);
  // const parsed = parseQRData(data);
  // console.log(jsonString)
  console.log(`${apiUrl}/quality/upload`);


  const apiResponse = await axios.post(`${apiUrl}/quality/upload`, payload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 60000,
  });
  console.log('apiResponse', apiResponse.data);
  return apiResponse.data;
};

const parseQRData = (qrString) => {
  try {
    return { ...JSON.parse(qrString) };
  } catch {
    const parts = qrString.split(',');
    return {
      TML_PO_Number: parts[0] || '',
      TML_PO_Order_Item_No: parts[1] || '',
      Vendor_Invoice_Part_Qty: parts[2] || '',
      Vendor_GST_Invoice_No: parts[3] || '',
      Vendor_Invoice_Date: parts[4] || '',
      Vendor_Invoice_Basic_Gross_Rate: parts[5] || '',
      Vendor_Invoice_Net_Rate: parts[6] || '',
      Vendor_Code: parts[7] || '',
      Invoice_Part_Number: parts[8] || '',
      Tax_Values_CGST: parts[9] || '',
      Tax_Values_SGST: parts[10] || '',
      Tax_Values_IGST: parts[11] || '',
      Tax_Values_UGST: parts[12] || '',
      Tax_Rates_CGST_Percent: parts[13] || '',
      Tax_Rates_SGST_Percent: parts[14] || '',
      Tax_Rates_IGST_Percent: parts[15] || '',
      Tax_Rates_UGST_Percent: parts[16] || '',
      Cess: parts[17] || '',
      Total_Invoice_Value: parts[18] || '',
      HSN_SAC_Code: parts[19] || '',
    };
  }
};

// GET ALL INVOICES (GET /getinvoices)
const fetchInvoices = async () => {
  const response = await api.get('/getinvoices');
  console.log(response.data);
  return response.data;
};

//GET ONE INVOICE (GET /getinvoice)
const getInvoice = async (gateNumber, invoiceNumber) => {
  const response = await api.get('/getinvoice', {
    params: { GateNumber: gateNumber, InvoiceNumber: invoiceNumber },
  });
  return response.data;
};

// APPROVE INVOICE (PUT /update-info)
const approveInvoice = async (gateNumber, invoiceNumber, approvedBy) => {
  const response = await api.put('/update-info', {
    GateNumber: gateNumber,
    InvoiceNumber: invoiceNumber,
    approvedBy,
  });
  return response.data;
};

// UPDATE NOTIFICATION PREFERENCE (PUT /mobile/update?email=...)
// Per notification_feature_documentation.md: the route was refactored to
// exclusively handle this one field — only { notificationsEnabled } in the
// body, email passed as a query param, nothing else.
const updateNotificationPreference = async (email, notificationsEnabled, token) => {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const apiResponse = await axios.put(
    'https://hbzo58z4zk.execute-api.ap-south-1.amazonaws.com/prod/mobile/update',
    { notificationsEnabled },
    {
      params: { email },
      headers,
      timeout: 30000,
    }
  );

  return apiResponse.data;
};

// GET MOBILE USERS FOR SITE (GET /mobile-users?siteId=...)
// Used to read back the account's server-stored notificationsEnabled value —
// the login response doesn't include it, and registration can default it
// independently of whatever's cached locally, so the server is the
// authoritative source the first time a screen needs to know the real state.
const getMobileUsers = async (siteId, token) => {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const apiResponse = await axios.get(
    'https://hbzo58z4zk.execute-api.ap-south-1.amazonaws.com/prod/mobile-users',
    {
      params: { siteId },
      headers,
      timeout: 30000,
    }
  );

  return apiResponse.data?.users ?? apiResponse.data ?? [];
};

//HEALTH CHECK
const healthCheck = async () => {
  const apiUrl = process.env.EXPO_PUBLIC_GATEWAY_URL;
  const response = await axios.get(`${apiUrl}/health`, { timeout: 5000 });
  return { status: 'ok', data: response.data };
};

//
// 🔹 EXPORTS
//
export {
  approveInvoice, blobToBase64, fetchInvoices, getInvoice, getMobileUsers, healthCheck, loginInAksha, saveInvoiceData, saveQualityData, updateNotificationPreference, uploadImageToS3, registerUser
};
