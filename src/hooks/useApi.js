import { useCallback, useState } from 'react';

export const useApi = () => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const callAPI = useCallback(async (url, method = 'GET', body = null, headers = {}) => {
    setLoading(true);
    setError(null);
    setData(null);

    try {
      const options = {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
      };

      if (body && method !== 'GET') {
        options.body = JSON.stringify(body);
      }

      const response = await fetch(url, options);
      const json = await response.json();

      if (!response.ok) {
        // Improved error message extraction
        const errorMessage = json?.message || json?.error || 'API request failed';
        throw new Error(errorMessage);
      }

      setData(json);
      return json; // Return the data instead of response
    } catch (err) {
      console.error('API Error:', err);
      setError(err.message);
      throw err; // Re-throw to handle in components
    } finally {
      setLoading(false);
    }
  }, []);

  return { callAPI, data, error, loading };
};