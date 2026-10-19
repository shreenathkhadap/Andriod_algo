import * as Crypto from 'expo-crypto';

export const hashSHA256 = async (password) => {
  const SECRET_KEY = process.env.EXPO_PUBLIC_PASSWORD_SECRET_KEY;

  if (!SECRET_KEY) {
    throw new Error("❌ Missing EXPO_PUBLIC_PASSWORD_SECRET_KEY in .env");
  }

  // Simulated HMAC_SHA256 (Expo doesn't support native HMAC)
  const input = password + SECRET_KEY;

  return await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    input,
    { encoding: Crypto.CryptoEncoding.HEX }
  );
};